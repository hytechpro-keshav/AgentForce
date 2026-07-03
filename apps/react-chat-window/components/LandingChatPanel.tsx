"use client";

import { useReducer, useState, useRef, useEffect } from "react";
import {
  createInitialIntakeState,
  intakeReducer,
  type IntakeSession
} from "@/lib/intake-flow";
import {
  bootstrapIntakeSession,
  buildCaseCreatePayload,
  buildTurnRequestBody,
  canSubmitCase,
  deviceGreeting,
  deviceSelectionEvent,
  fetchIntakeConfig,
  loadIntakeContext,
  parseTurnResponse,
  resolveCaseDescription,
  shouldShowDevicePicker
} from "@/lib/intake-client";

export function LandingChatPanel() {
  const [open, setOpen] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(
    intakeReducer,
    createInitialIntakeState()
  );

  // email phase
  const [emailValue, setEmailValue] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // otp phase
  const [otpCode, setOtpCode] = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // triage phase
  const [contextLoading, setContextLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);

  // confirm phase
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t1 = setTimeout(() => {
      if (!open) setShowBubble(true);
    }, 3400);
    const t2 = setTimeout(() => setShowBubble(false), 13000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [open]);

  // The anchor sits BELOW the picker/CTA widgets, so newly cued chips and the
  // submit button scroll into view too — not just the latest message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    state.messages,
    state.devicePickerRequested,
    state.suggestedAssetId,
    state.selectedAssetId,
    state.readyToSubmit
  ]);

  useEffect(() => {
    void fetchIntakeConfig().then((config) => {
      setBootstrapAvailable(config.bootstrapAvailable);
    });
  }, []);

  useEffect(() => {
    if (open && bootstrapAvailable && state.phase === "email") {
      dispatch({ type: "startBootstrap" });
    }
  }, [open, bootstrapAvailable, state.phase]);

  useEffect(() => {
    if (state.phase !== "bootstrapping") {
      return;
    }

    let cancelled = false;
    async function runBootstrap() {
      setBootstrapError(null);
      try {
        const session = await bootstrapIntakeSession();
        if (cancelled) return;
        dispatch({ type: "verified", session });
        await loadContext(session.accessToken);
      } catch {
        if (!cancelled) {
          setBootstrapError(
            "Could not start the support session. Please try again."
          );
          dispatch({ type: "bootstrapFailed" });
        }
      }
    }

    void runBootstrap();
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = emailValue.trim();
    if (!value) return;
    setEmailSubmitting(true);
    setEmailError(null);
    try {
      const res = await fetch("/api/intake/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value })
      });
      if (!res.ok && res.status !== 200) {
        setEmailError(
          res.status === 429
            ? "Too many attempts. Please wait a moment."
            : "Couldn't start verification. Check your email and try again."
        );
        return;
      }
      dispatch({ type: "otpSent", email: value.toLowerCase() });
    } catch {
      setEmailError("Could not reach the service. Check your connection.");
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = otpCode.trim();
    if (!value) return;
    setOtpSubmitting(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/intake/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: state.email, code: value })
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        setOtpError(
          res.status === 429
            ? "Too many attempts. Please wait a moment."
            : "Invalid or expired code. Please try again."
        );
        return;
      }
      const accessToken = String(json.accessToken ?? "");
      if (!accessToken) {
        setOtpError("Verification failed. Please request a new code.");
        return;
      }
      const session: IntakeSession = {
        accessToken,
        expiresAt: String(json.expiresAt ?? ""),
        subject: String(json.subject ?? "customer-intake-session")
      };
      dispatch({ type: "verified", session });
      void loadContext(accessToken);
    } catch {
      setOtpError("Could not reach the service. Check your connection.");
    } finally {
      setOtpSubmitting(false);
    }
  }

  async function loadContext(accessToken: string) {
    setContextLoading(true);
    try {
      const context = await loadIntakeContext(accessToken);
      dispatch({ type: "contextLoaded", context });
      const greeting = deviceGreeting(context);
      dispatch({
        type: "appendMessage",
        message: { role: "assistant", content: greeting, uiOnly: true }
      });
    } catch {
      dispatch({ type: "contextLoaded", context: { devices: [], shipTo: {} } });
    } finally {
      setContextLoading(false);
    }
  }

  async function sendTurn(
    nextMessages: Array<{ role: "user" | "assistant"; content: string }>,
    selectedAssetId: string | null
  ) {
    if (!state.session?.accessToken) return;
    setSending(true);
    setTurnError(null);
    try {
      const res = await fetch("/api/intake/turn", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${state.session.accessToken}`
        },
        body: JSON.stringify(
          buildTurnRequestBody(nextMessages, selectedAssetId)
        )
      });
      if (!res.ok) {
        setTurnError("Couldn't process that. Please try again.");
        return;
      }
      dispatch({ type: "turnResult", ...parseTurnResponse(await res.json()) });
    } catch {
      setTurnError("Could not reach the service. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  function handleSend() {
    const text = chatInput.trim();
    if (!text || !state.session?.accessToken || sending) return;
    const userMessage = { role: "user" as const, content: text };
    const nextMessages = [
      ...state.messages.filter((m) => !m.uiOnly),
      userMessage
    ].map((m) => ({ role: m.role, content: m.content }));
    dispatch({ type: "appendMessage", message: userMessage });
    setChatInput("");
    void sendTurn(nextMessages, state.selectedAssetId);
  }

  // Selection is a conversation event: a hidden [event] note goes to the
  // model so it acknowledges the pick instead of asking which device.
  function handleDeviceSelected(assetId: string) {
    if (sending) return;
    dispatch({ type: "selectDevice", assetId });
    const label = devices.find((d) => d.assetId === assetId)?.label;
    if (!label || !state.session?.accessToken) return;
    const event = {
      role: "user" as const,
      content: deviceSelectionEvent(label),
      hidden: true
    };
    dispatch({ type: "appendMessage", message: event });
    const nextMessages = [
      ...state.messages.filter((m) => !m.uiOnly),
      event
    ].map((m) => ({ role: m.role, content: m.content }));
    void sendTurn(nextMessages, assetId);
  }

  async function handleSubmitCase() {
    if (!state.session?.accessToken || !canSubmitCase(state)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/intake/case", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${state.session.accessToken}`
        },
        body: JSON.stringify(buildCaseCreatePayload(state))
      });
      const json = (await res.json().catch(() => ({}))) as {
        caseId?: string;
        caseNumber?: string;
      };
      if (!res.ok || !json.caseId) {
        setSubmitError("Couldn't create the case. Please try again.");
        return;
      }
      dispatch({
        type: "caseCreated",
        caseId: json.caseId,
        caseNumber: json.caseNumber
      });
    } catch {
      setSubmitError("Could not reach the service. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  const devices = state.context?.devices ?? [];
  const showDevicePicker = shouldShowDevicePicker(state);
  const reviewReady = state.readyToSubmit && canSubmitCase(state);

  function renderBody() {
    const { phase } = state;

    if (phase === "bootstrapping") {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            padding: "28px 12px",
            minHeight: "180px"
          }}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              border: "3px solid #E6EDF4",
              borderTopColor: "#139ED9",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite"
            }}
          />
          <div style={{ fontSize: "13px", color: "#5A7189" }}>
            Connecting to your account…
          </div>
          {bootstrapError ? (
            <div style={{ fontSize: "12px", color: "#C0492E" }}>{bootstrapError}</div>
          ) : null}
        </div>
      );
    }

    if (phase === "email") {
      return (
        <form
          onSubmit={(e) => void handleEmailSubmit(e)}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <div
            style={{
              fontSize: "13.5px",
              lineHeight: 1.5,
              color: "#33495F",
              padding: "13px",
              background: "#fff",
              borderRadius: "13px 13px 13px 4px",
              border: "1px solid #E6EDF4"
            }}
          >
            Hi, I&apos;m Ably — how can I help you today?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              style={{ fontSize: "12px", fontWeight: 600, color: "#0A2540" }}
            >
              Work email
            </label>
            <input
              type="email"
              placeholder="you@company.com"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              disabled={emailSubmitting}
              required
              style={{
                border: "1px solid #DCE6EF",
                borderRadius: "10px",
                padding: "10px 12px",
                fontSize: "13.5px",
                color: "#0A2540",
                outline: "none",
                background: "#F7FAFD",
                fontFamily: "inherit"
              }}
            />
          </div>
          {emailError && (
            <div
              style={{
                fontSize: "12.5px",
                color: "#C0492E",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "8px",
                padding: "8px 12px"
              }}
            >
              {emailError}
            </div>
          )}
          <div style={{ fontSize: "11px", color: "#8598AB", lineHeight: 1.45 }}>
            We&apos;ll email you a one-time code to verify your identity before
            creating a support case.
          </div>
          <button
            type="submit"
            disabled={emailSubmitting || emailValue.trim().length === 0}
            style={{
              background: "#139ED9",
              color: "#fff",
              border: 0,
              borderRadius: "10px",
              padding: "11px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity:
                emailSubmitting || !emailValue.trim() ? 0.6 : 1
            }}
          >
            {emailSubmitting ? "Sending code…" : "Send verification code"}
          </button>
        </form>
      );
    }

    if (phase === "otp") {
      return (
        <form
          onSubmit={(e) => void handleOtpSubmit(e)}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <div
            style={{
              fontSize: "13.5px",
              lineHeight: 1.5,
              color: "#33495F",
              padding: "13px",
              background: "#fff",
              borderRadius: "13px 13px 13px 4px",
              border: "1px solid #E6EDF4"
            }}
          >
            We sent a code to{" "}
            <strong style={{ color: "#0A2540" }}>{state.email}</strong>. Enter
            it below to continue.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              style={{ fontSize: "12px", fontWeight: 600, color: "#0A2540" }}
            >
              Verification code
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={otpCode}
              onChange={(e) =>
                setOtpCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))
              }
              disabled={otpSubmitting}
              required
              style={{
                border: "1px solid #DCE6EF",
                borderRadius: "10px",
                padding: "10px 12px",
                fontSize: "13.5px",
                color: "#0A2540",
                outline: "none",
                background: "#F7FAFD",
                fontFamily: "inherit",
                letterSpacing: ".2em",
                textAlign: "center"
              }}
            />
          </div>
          {otpError && (
            <div
              style={{
                fontSize: "12.5px",
                color: "#C0492E",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "8px",
                padding: "8px 12px"
              }}
            >
              {otpError}
            </div>
          )}
          <button
            type="submit"
            disabled={otpSubmitting || otpCode.trim().length < 4}
            style={{
              background: "#139ED9",
              color: "#fff",
              border: 0,
              borderRadius: "10px",
              padding: "11px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: otpSubmitting || otpCode.trim().length < 4 ? 0.6 : 1
            }}
          >
            {otpSubmitting ? "Verifying…" : "Verify and continue"}
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "reset",
                skipEmailVerification: bootstrapAvailable
              })
            }
            disabled={otpSubmitting}
            style={{
              background: "none",
              color: "#5A7189",
              border: 0,
              borderRadius: "10px",
              padding: "8px",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit"
            }}
          >
            ← Use a different email
          </button>
        </form>
      );
    }

    if (phase === "triage") {
      if (contextLoading) {
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "32px",
              color: "#8598AB",
              fontSize: "13px"
            }}
          >
            Loading your account…
          </div>
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            gap: "8px"
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {state.messages
              .filter((m) => !m.hidden)
              .map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start"
                }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    padding: "9px 12px",
                    borderRadius:
                      m.role === "user"
                        ? "13px 13px 4px 13px"
                        : "13px 13px 13px 4px",
                    fontSize: "13px",
                    lineHeight: 1.45,
                    background:
                      m.role === "user" ? "#139ED9" : "#fff",
                    color: m.role === "user" ? "#fff" : "#33495F",
                    border:
                      m.role === "user" ? "none" : "1px solid #E6EDF4"
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
          </div>
          {showDevicePicker && (
            <div style={{ paddingTop: "4px" }}>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#5A7189",
                  marginBottom: "6px"
                }}
              >
                {state.suggestedAssetId
                  ? "Tap to confirm the affected device"
                  : "Which device is affected?"}
              </div>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}
              >
              {[...devices]
                .sort((a, b) =>
                  a.assetId === state.suggestedAssetId
                    ? -1
                    : b.assetId === state.suggestedAssetId
                      ? 1
                      : 0
                )
                .map((d) => {
                const suggested = d.assetId === state.suggestedAssetId;
                return (
                  <button
                    key={d.assetId}
                    onClick={() => handleDeviceSelected(d.assetId)}
                    disabled={sending}
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: suggested ? "#fff" : "#0E5E86",
                      background: suggested ? "#139ED9" : "#fff",
                      border: suggested
                        ? "1px solid #139ED9"
                        : "1px solid rgba(19,158,217,.3)",
                      borderRadius: "100px",
                      padding: "6px 12px",
                      cursor: sending ? "default" : "pointer",
                      opacity: sending ? 0.6 : 1,
                      fontFamily: "inherit"
                    }}
                  >
                    {suggested ? `✓ ${d.label}` : d.label}
                  </button>
                );
              })}
              </div>
            </div>
          )}
          {devices.length > 0 && state.selectedAssetId && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                paddingTop: "4px",
                fontSize: "12px"
              }}
            >
              <span
                style={{
                  background: "#139ED9",
                  color: "#fff",
                  borderRadius: "100px",
                  padding: "5px 11px",
                  fontWeight: 600
                }}
              >
                {devices.find((d) => d.assetId === state.selectedAssetId)?.label}
              </span>
              <button
                onClick={() => dispatch({ type: "clearDevice" })}
                style={{
                  background: "none",
                  border: "none",
                  color: "#5A7189",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: 0,
                  textDecoration: "underline"
                }}
              >
                Change
              </button>
            </div>
          )}
          {turnError && (
            <div
              style={{ fontSize: "12px", color: "#C0492E", padding: "4px 0" }}
            >
              {turnError}
            </div>
          )}
          {reviewReady && (
            <button
              onClick={() => dispatch({ type: "toConfirm" })}
              style={{
                background: "#0A2540",
                color: "#fff",
                border: 0,
                borderRadius: "10px",
                padding: "10px",
                fontSize: "13.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                marginTop: "4px"
              }}
            >
              Review & submit case →
            </button>
          )}
          <div ref={messagesEndRef} />
        </div>
      );
    }

    if (phase === "confirm") {
      const description = resolveCaseDescription(state);
      const subject =
        state.extracted.subject || description.split(/\r?\n/)[0] || "";
      const deviceLabel = devices.find(
        (d) => d.assetId === state.selectedAssetId
      )?.label;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div
            style={{
              background: "#F7FAFD",
              border: "1px solid #E6EDF4",
              borderRadius: "12px",
              padding: "14px"
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontFamily: "'IBM Plex Mono',monospace",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "#8598AB",
                marginBottom: "8px"
              }}
            >
              Summary
            </div>
            <div
              style={{
                fontSize: "13.5px",
                fontWeight: 600,
                color: "#0A2540",
                marginBottom: "4px"
              }}
            >
              {subject}
            </div>
            {deviceLabel && (
              <div style={{ fontSize: "12.5px", color: "#5A7189" }}>
                Device: {deviceLabel}
              </div>
            )}
            <div style={{ fontSize: "12.5px", color: "#5A7189", marginTop: "4px" }}>
              Priority: {state.extracted.priority ?? "Medium"}
            </div>
            <div
              style={{
                fontSize: "11px",
                fontFamily: "'IBM Plex Mono',monospace",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "#8598AB",
                margin: "12px 0 6px"
              }}
            >
              Description
            </div>
            <textarea
              value={description}
              onChange={(e) =>
                dispatch({
                  type: "editDescription",
                  description: e.target.value
                })
              }
              rows={5}
              aria-label="Case description"
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontSize: "12.5px",
                lineHeight: 1.5,
                color: "#33495F",
                background: "#fff",
                border: "1px solid #E6EDF4",
                borderRadius: "8px",
                padding: "8px 10px",
                fontFamily: "inherit",
                resize: "vertical"
              }}
            />
          </div>
          {submitError && (
            <div
              style={{
                fontSize: "12px",
                color: "#C0492E",
                background: "#FEF2F2",
                borderRadius: "8px",
                padding: "8px 12px"
              }}
            >
              {submitError}
            </div>
          )}
          <button
            onClick={() => void handleSubmitCase()}
            disabled={submitting || !canSubmitCase(state)}
            style={{
              background: "#139ED9",
              color: "#fff",
              border: 0,
              borderRadius: "10px",
              padding: "11px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: submitting ? 0.6 : 1
            }}
          >
            {submitting ? "Submitting…" : "Submit support case"}
          </button>
          <button
            onClick={() => dispatch({ type: "backToTriage" })}
            disabled={submitting}
            style={{
              background: "none",
              color: "#5A7189",
              border: 0,
              borderRadius: "10px",
              padding: "8px",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit"
            }}
          >
            ← Edit description
          </button>
        </div>
      );
    }

    // done
    const updatesEmail = state.email || state.context?.contactEmail || "";
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "14px",
          padding: "16px 0",
          textAlign: "center"
        }}
      >
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: "#EAF7F1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1F9D6B"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div style={{ fontSize: "15px", fontWeight: 600, color: "#0A2540" }}>
          Case created!
        </div>
        {state.caseNumber && (
          <div style={{ fontSize: "13px", color: "#5A7189" }}>
            Case #{state.caseNumber}
          </div>
        )}
        <div
          style={{ fontSize: "13px", color: "#5A7189", lineHeight: 1.5 }}
        >
          We&apos;ll be in touch shortly.
          {updatesEmail ? (
            <> You&apos;ll receive updates at {updatesEmail}.</>
          ) : null}
        </div>
        <button
          onClick={() =>
            dispatch({
              type: "reset",
              skipEmailVerification: bootstrapAvailable
            })
          }
          style={{
            background: "none",
            color: "#139ED9",
            border: "1px solid #139ED9",
            borderRadius: "10px",
            padding: "9px 18px",
            fontSize: "13.5px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit"
          }}
        >
          Start another case
        </button>
      </div>
    );
  }

  const showInputBar = state.phase === "triage" && !contextLoading;

  return (
    <div
      style={{
        position: "fixed",
        right: "clamp(16px,3vw,30px)",
        bottom: "clamp(16px,3vw,30px)",
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "13px",
        pointerEvents: "none"
      }}
    >
      {/* Panel */}
      {open && (
        <div
          style={{
            pointerEvents: "auto",
            width: "min(400px,90vw)",
            maxHeight: "min(580px,80vh)",
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            border: "1px solid #E4EDF5",
            borderRadius: "18px",
            overflow: "hidden",
            boxShadow:
              "0 30px 70px -24px rgba(10,37,64,.5),0 10px 26px -14px rgba(10,37,64,.22)",
            animation: "acp-panelin .34s cubic-bezier(.34,1.4,.64,1) both"
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "11px",
              padding: "14px 15px",
              background:
                "linear-gradient(135deg, #5EC4E8, #139ED9)",
              flexShrink: 0
            }}
          >
            <span
              style={{
                flex: "none",
                width: "38px",
                height: "38px",
                borderRadius: "11px",
                background: "rgba(255,255,255,.16)",
                border: "1px solid rgba(255,255,255,.3)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "3px"
              }}
            >
              <span
                style={{
                  display: "flex",
                  gap: "6px",
                  animation: "acp-blink 4.6s ease-in-out infinite"
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "8px",
                    borderRadius: "4px",
                    background: "#fff"
                  }}
                />
                <span
                  style={{
                    width: "6px",
                    height: "8px",
                    borderRadius: "4px",
                    background: "#fff"
                  }}
                />
              </span>
              <span
                style={{
                  width: "11px",
                  height: "5px",
                  borderBottom: "2px solid #fff",
                  borderRadius: "0 0 11px 11px"
                }}
              />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'Space Grotesk',sans-serif",
                  fontWeight: 600,
                  fontSize: "15px",
                  color: "#fff",
                  letterSpacing: "-.01em"
                }}
              >
                Ably
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: "10.5px",
                  letterSpacing: ".04em",
                  color: "rgba(255,255,255,.9)"
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#5BE3A7",
                    boxShadow: "0 0 0 3px rgba(91,227,167,.28)"
                  }}
                />
                AI service guide · online
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              style={{
                flex: "none",
                width: "30px",
                height: "30px",
                borderRadius: "9px",
                border: 0,
                cursor: "pointer",
                background: "rgba(255,255,255,.14)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px",
              background: "#F7FAFD",
              minHeight: 0
            }}
          >
            {renderBody()}
          </div>

          {/* Input bar (triage only) */}
          {showInputBar && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "11px 12px",
                borderTop: "1px solid #EEF3F8",
                background: "#fff",
                flexShrink: 0
              }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Describe the issue…"
                disabled={sending}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "1px solid #DCE6EF",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontFamily: "inherit",
                  fontSize: "13.5px",
                  color: "#0A2540",
                  outline: "none",
                  background: "#F7FAFD"
                }}
              />
              <button
                onClick={() => void handleSend()}
                disabled={sending || !chatInput.trim()}
                aria-label="Send message"
                style={{
                  flex: "none",
                  width: "38px",
                  height: "38px",
                  borderRadius: "10px",
                  border: 0,
                  cursor: "pointer",
                  background: "#139ED9",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 8px 18px -6px rgba(19,158,217,.7)",
                  opacity: sending || !chatInput.trim() ? 0.6 : 1
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bubble tooltip */}
      {showBubble && !open && (
        <div
          style={{
            pointerEvents: "auto",
            position: "relative",
            maxWidth: "238px",
            background: "#fff",
            border: "1px solid #E4EDF5",
            borderRadius: "15px 15px 5px 15px",
            boxShadow: "0 18px 38px -16px rgba(10,37,64,.42)",
            padding: "12px 32px 12px 14px",
            animation: "acp-bubblein .42s cubic-bezier(.34,1.56,.64,1) both"
          }}
        >
          <div
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 600,
              fontSize: "13.5px",
              color: "#0A2540",
              letterSpacing: "-.01em"
            }}
          >
            Hi, I&apos;m Ably
          </div>
          <div
            style={{
              fontSize: "12.5px",
              lineHeight: 1.45,
              color: "#5A7189",
              marginTop: "2px"
            }}
          >
            Curious about the five pillars? I can walk you through it.
          </div>
          <button
            onClick={() => setShowBubble(false)}
            aria-label="Dismiss"
            style={{
              position: "absolute",
              top: "7px",
              right: "7px",
              width: "20px",
              height: "20px",
              borderRadius: "6px",
              border: 0,
              cursor: "pointer",
              background: "#F1F5F9",
              color: "#93A4B5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}

      {/* Chat button */}
      <div
        style={{
          pointerEvents: "auto",
          position: "relative"
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "-1px",
            right: "-1px",
            bottom: "-1px",
            left: "-1px",
            borderRadius: "50%",
            border: "2px solid #139ED9",
            opacity: 0,
            pointerEvents: "none",
            animation: "acp-ring 2.8s ease-out infinite"
          }}
        />
        <span
          style={{
            position: "absolute",
            top: "-1px",
            right: "-1px",
            bottom: "-1px",
            left: "-1px",
            borderRadius: "50%",
            border: "2px solid #139ED9",
            opacity: 0,
            pointerEvents: "none",
            animation: "acp-ring 2.8s ease-out 1.4s infinite"
          }}
        />
        <div
          style={{
            position: "relative",
            animation: "acp-botbob 3s ease-in-out infinite"
          }}
        >
          <button
            onClick={() => {
              setOpen((o) => !o);
              setShowBubble(false);
            }}
            aria-label="Chat with Ably"
            style={{
              position: "relative",
              width: "62px",
              height: "62px",
              borderRadius: "50%",
              border: 0,
              cursor: "pointer",
              padding: 0,
              background:
                "linear-gradient(155deg, #6DCCE8, #139ED9 62%, #0E7CC0)",
              boxShadow:
                "0 16px 32px -10px rgba(19,158,217,.7),0 4px 10px rgba(10,37,64,.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "acp-botwiggle 4.8s ease-in-out infinite"
            }}
          >
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "-7px",
                transform: "translateX(-50%)",
                width: "2.5px",
                height: "8px",
                borderRadius: "2px",
                background: "rgba(255,255,255,.85)",
                pointerEvents: "none"
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "-6px",
                  transform: "translateX(-50%)",
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 0 9px 1px rgba(255,255,255,.9)"
                }}
              />
            </span>
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                pointerEvents: "none"
              }}
            >
              <span
                style={{
                  display: "flex",
                  gap: "8px",
                  animation: "acp-blink 4.2s ease-in-out infinite"
                }}
              >
                <span
                  style={{
                    width: "9px",
                    height: "11px",
                    borderRadius: "5px",
                    background: "#fff"
                  }}
                />
                <span
                  style={{
                    width: "9px",
                    height: "11px",
                    borderRadius: "5px",
                    background: "#fff"
                  }}
                />
              </span>
              <span
                style={{
                  width: "15px",
                  height: "7px",
                  borderBottom: "2.5px solid #fff",
                  borderRadius: "0 0 14px 14px"
                }}
              />
            </span>
          </button>
          <span
            style={{
              position: "absolute",
              top: "-1px",
              right: "-1px",
              minWidth: "19px",
              height: "19px",
              padding: "0 5px",
              borderRadius: "10px",
              background: "#FF5B4A",
              border: "2.5px solid #fff",
              color: "#fff",
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 3px 8px rgba(255,91,74,.5)",
              pointerEvents: "none"
            }}
          >
            1
          </span>
        </div>
      </div>
    </div>
  );
}

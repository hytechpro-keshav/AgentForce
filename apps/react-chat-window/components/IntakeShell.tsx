"use client";

import { useEffect, useReducer, useState } from "react";
import { Loader2 } from "lucide-react";

import { EmailCard } from "@/components/intake/EmailCard";
import { IntakeConversation } from "@/components/intake/IntakeConversation";
import { IntakeDone } from "@/components/intake/IntakeDone";
import { IntakeSummaryCard } from "@/components/intake/IntakeSummaryCard";
import { OtpCard } from "@/components/intake/OtpCard";
import {
  bootstrapIntakeSession,
  buildCaseCreatePayload,
  canSubmitCase,
  deviceGreeting,
  fetchIntakeConfig,
  loadIntakeContext,
  shouldShowDevicePicker
} from "@/lib/intake-client";
import {
  createInitialIntakeState,
  intakeReducer,
  type IntakeSession
} from "@/lib/intake-flow";

interface IntakeShellProps {
  brandName: string;
  brandSubtitle: string;
  /** Server hint; client re-checks /api/intake/config before bootstrapping. */
  skipEmailVerification?: boolean;
}

/**
 * Guided intake orchestrator. When email verification is disabled, bootstraps
 * a verified session from the configured Salesforce account so the user can
 * talk to the AI immediately and create a Case.
 */
export function IntakeShell({
  brandName,
  brandSubtitle,
  skipEmailVerification = false
}: IntakeShellProps) {
  const [state, dispatch] = useReducer(
    intakeReducer,
    createInitialIntakeState({ skipEmailVerification })
  );
  const [contextLoading, setContextLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const token = state.session?.accessToken;
  const devices = state.context?.devices ?? [];
  const showDevicePicker = shouldShowDevicePicker(state);
  const reviewReady =
    state.issueCaptured &&
    (devices.length === 0 ? true : state.selectedAssetId !== null);

  useEffect(() => {
    if (state.phase !== "bootstrapping") {
      return;
    }

    let cancelled = false;
    async function runBootstrap() {
      setBootstrapError(null);
      try {
        const config = await fetchIntakeConfig();
        if (cancelled) return;
        if (!config.bootstrapAvailable) {
          dispatch({ type: "bootstrapFailed" });
          return;
        }
        const session = await bootstrapIntakeSession();
        if (cancelled) return;
        await handleVerified(session);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  async function handleVerified(session: IntakeSession) {
    dispatch({ type: "verified", session });
    setContextLoading(true);
    try {
      const context = await loadIntakeContext(session.accessToken);
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

  async function handleSend(text: string) {
    if (!token) return;
    const nextMessages = [
      ...state.messages.filter((m) => !m.uiOnly),
      { role: "user" as const, content: text }
    ];
    dispatch({
      type: "appendMessage",
      message: { role: "user", content: text }
    });
    setSending(true);
    setTurnError(null);
    try {
      const res = await fetch("/api/intake/turn", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content
          }))
        })
      });
      if (!res.ok) {
        setTurnError("We couldn't process that just now. Please try again.");
        return;
      }
      const json = (await res.json()) as {
        reply?: string;
        extracted?: {
          subject?: string;
          description?: string;
          priority?: "Low" | "Medium" | "High";
        };
        issueCaptured?: boolean;
      };
      dispatch({
        type: "turnResult",
        reply: json.reply ?? "Could you tell me a bit more about the issue?",
        extracted: json.extracted ?? {},
        issueCaptured: json.issueCaptured === true
      });
    } catch {
      setTurnError(
        "Could not reach the service. Please check your connection and try again."
      );
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit() {
    if (!token || !canSubmitCase(state)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/intake/case", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify(buildCaseCreatePayload(state))
      });
      const json = (await res.json().catch(() => ({}))) as {
        caseId?: string;
        caseNumber?: string;
      };
      if (!res.ok || !json.caseId) {
        setSubmitError(
          "We couldn't create the case right now. Please try again."
        );
        return;
      }
      dispatch({
        type: "caseCreated",
        caseId: json.caseId,
        caseNumber: json.caseNumber
      });
    } catch {
      setSubmitError(
        "Could not reach the service. Please check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (state.phase === "bootstrapping") {
    return (
      <main className="flex min-h-screen w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Connecting to your account…
        </p>
        {bootstrapError ? (
          <p className="text-sm text-destructive">{bootstrapError}</p>
        ) : null}
      </main>
    );
  }

  if (state.phase === "email") {
    return (
      <EmailCard
        brandName={brandName}
        brandSubtitle={brandSubtitle}
        onSent={(email) => dispatch({ type: "otpSent", email })}
      />
    );
  }

  if (state.phase === "otp") {
    return (
      <OtpCard
        email={state.email}
        onVerified={handleVerified}
        onBack={() => dispatch({ type: "reset" })}
      />
    );
  }

  if (state.phase === "triage") {
    if (contextLoading) {
      return (
        <main className="flex min-h-screen w-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      );
    }
    return (
      <IntakeConversation
        displayName={state.context?.displayName}
        messages={state.messages}
        devices={devices}
        selectedAssetId={state.selectedAssetId}
        issueCaptured={state.issueCaptured}
        showDevicePicker={showDevicePicker}
        sending={sending}
        reviewReady={reviewReady}
        error={turnError}
        onSend={handleSend}
        onSelectDevice={(assetId) =>
          dispatch({ type: "selectDevice", assetId })
        }
        onClearDevice={() => dispatch({ type: "clearDevice" })}
        onReview={() => dispatch({ type: "toConfirm" })}
      />
    );
  }

  if (state.phase === "confirm") {
    const description =
      state.extracted.description?.trim() ||
      state.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n") ||
      "Laptop issue reported via chat.";
    const deviceLabel = devices.find(
      (device) => device.assetId === state.selectedAssetId
    )?.label;
    return (
      <IntakeSummaryCard
        subject={state.extracted.subject || description.split(/\r?\n/)[0]}
        description={description}
        priority={state.extracted.priority ?? "Medium"}
        deviceLabel={deviceLabel}
        shipTo={state.context?.shipTo ?? {}}
        submitting={submitting}
        error={submitError}
        onBack={() => dispatch({ type: "backToTriage" })}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <IntakeDone
      caseNumber={state.caseNumber}
      onRestart={() =>
        dispatch({
          type: "reset",
          skipEmailVerification
        })
      }
    />
  );
}

"use client";

import { useReducer, useState } from "react";
import { Loader2 } from "lucide-react";

import { EmailCard } from "@/components/intake/EmailCard";
import { IntakeConversation } from "@/components/intake/IntakeConversation";
import { IntakeDone } from "@/components/intake/IntakeDone";
import { IntakeSummaryCard } from "@/components/intake/IntakeSummaryCard";
import { OtpCard } from "@/components/intake/OtpCard";
import {
  initialIntakeState,
  intakeReducer,
  type IntakeContext,
  type IntakeSession
} from "@/lib/intake-flow";

interface IntakeShellProps {
  brandName: string;
  brandSubtitle: string;
}

/**
 * Guided OTP intake orchestrator. Owns the phase machine and all backend
 * calls; identity lives in the verified-intake JWT (React state only, cleared
 * on refresh), and step widgets render outside any token stream.
 */
export function IntakeShell({ brandName, brandSubtitle }: IntakeShellProps) {
  const [state, dispatch] = useReducer(intakeReducer, initialIntakeState);
  const [contextLoading, setContextLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const token = state.session?.accessToken;
  const devices = state.context?.devices ?? [];
  const reviewReady =
    state.issueCaptured &&
    (devices.length === 0 ? true : state.selectedAssetId !== null);

  async function loadContext(accessToken: string) {
    setContextLoading(true);
    try {
      const res = await fetch("/api/intake/context", {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const context = (await res.json()) as IntakeContext;
        dispatch({
          type: "contextLoaded",
          context: {
            displayName: context.displayName,
            accountName: context.accountName,
            devices: Array.isArray(context.devices) ? context.devices : [],
            shipTo: context.shipTo ?? {}
          }
        });
      } else {
        // Non-fatal: proceed without prefetched devices.
        dispatch({
          type: "contextLoaded",
          context: { devices: [], shipTo: {} }
        });
      }
    } catch {
      dispatch({ type: "contextLoaded", context: { devices: [], shipTo: {} } });
    } finally {
      setContextLoading(false);
    }
  }

  function handleVerified(session: IntakeSession) {
    dispatch({ type: "verified", session });
    void loadContext(session.accessToken);
  }

  async function handleSend(text: string) {
    if (!token) return;
    const nextMessages = [
      ...state.messages,
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
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    const description =
      state.extracted.description?.trim() ||
      state.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n") ||
      "Laptop issue reported via chat.";
    try {
      const res = await fetch("/api/intake/case", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          issueDescription: description,
          ...(state.extracted.subject
            ? { subject: state.extracted.subject }
            : {}),
          ...(state.extracted.priority
            ? { priority: state.extracted.priority }
            : {}),
          ...(state.selectedAssetId ? { assetId: state.selectedAssetId } : {})
        })
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
        sending={sending}
        reviewReady={reviewReady}
        error={turnError}
        onSend={handleSend}
        onSelectDevice={(assetId) =>
          dispatch({ type: "selectDevice", assetId })
        }
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
      onRestart={() => dispatch({ type: "reset" })}
    />
  );
}

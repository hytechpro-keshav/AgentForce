"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type EscalationUrgency = "low" | "normal" | "high";

export interface EscalationInput {
  reason: string;
  urgency: EscalationUrgency;
  caseReference?: string;
}

interface EscalationDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  authToken: string;
  conversationSummary(): string;
  onSubmitted?(): void;
}

interface EscalationResult {
  escalationId: string;
  urgency: EscalationUrgency;
  nextSteps: string;
}

export function EscalationDialog({
  open,
  onOpenChange,
  authToken,
  conversationSummary,
  onSubmitted
}: EscalationDialogProps) {
  const [reason, setReason] = useState("");
  const [urgency, setUrgency] = useState<EscalationUrgency>("normal");
  const [caseReference, setCaseReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EscalationResult | null>(null);

  function reset() {
    setReason("");
    setUrgency("normal");
    setCaseReference("");
    setSubmitting(false);
    setError(null);
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("Please describe what you need help with.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/escalate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          reason: trimmedReason,
          urgency,
          conversationSummary: conversationSummary(),
          ...(caseReference.trim() ? { caseReference: caseReference.trim() } : {}),
          locale:
            typeof navigator !== "undefined" && navigator.language
              ? navigator.language.slice(0, 16)
              : undefined
        })
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        setError(
          typeof json.message === "string"
            ? (json.message as string)
            : "Could not submit your request. Please try again."
        );
        return;
      }
      setResult({
        escalationId: String(json.escalationId ?? ""),
        urgency:
          (json.urgency as EscalationUrgency) ?? urgency,
        nextSteps: String(json.nextSteps ?? "")
      });
      onSubmitted?.();
    } catch {
      setError(
        "Could not reach the chat service. Please check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Talk to a support specialist</DialogTitle>
          <DialogDescription>
            Tell us what you need help with. We&apos;ll route your request to
            the right team.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm" role="status" aria-live="polite">
            <p className="font-medium text-foreground">
              Request received (ref:&nbsp;
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {result.escalationId}
              </code>
              )
            </p>
            <p className="text-muted-foreground">{result.nextSteps}</p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="escalate-reason">What do you need help with?</Label>
              <Textarea
                id="escalate-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="Briefly describe the issue…"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="escalate-urgency">Urgency</Label>
              <select
                id="escalate-urgency"
                value={urgency}
                onChange={(e) =>
                  setUrgency(e.target.value as EscalationUrgency)
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="low">Low — general question</option>
                <option value="normal">Normal — needs help soon</option>
                <option value="high">High — blocking issue</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="escalate-case">Case reference (optional)</Label>
              <Input
                id="escalate-case"
                value={caseReference}
                onChange={(e) => setCaseReference(e.target.value)}
                maxLength={80}
                placeholder="e.g., 00012345"
                pattern="[A-Za-z0-9_.:\-]{1,80}"
              />
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !reason.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  "Submit request"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

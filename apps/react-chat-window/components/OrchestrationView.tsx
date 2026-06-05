"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  Loader2,
  ShieldQuestion,
  XCircle
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  isTerminalStatus,
  sanitizeSnapshot,
  STATUS_META,
  statusLabel,
  type OrchestrationSnapshot,
  type OrchestrationStatus
} from "@/lib/orchestration";

const STATUS_ICON: Record<
  OrchestrationStatus,
  typeof CircleDot
> = {
  assigned: CircleDot,
  running: Loader2,
  waiting_approval: ShieldQuestion,
  done: CheckCircle2,
  rejected: XCircle,
  failed: AlertTriangle
};

function StatusBadge({ status }: { status: OrchestrationStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        STATUS_META[status].tone
      )}
      data-testid="status-badge"
      data-status={status}
    >
      <Icon
        className={cn("h-3.5 w-3.5", status === "running" && "animate-spin")}
        aria-hidden
      />
      {statusLabel(status)}
    </span>
  );
}

function timelineStatus(
  snapshot: OrchestrationSnapshot,
  eventStatus: OrchestrationStatus,
  index: number
): OrchestrationStatus {
  if (
    eventStatus === "running" &&
    (index < snapshot.events.length - 1 || isTerminalStatus(snapshot.status))
  ) {
    return "done";
  }
  return eventStatus;
}

function timelineSummary(
  eventStatus: OrchestrationStatus,
  displayStatus: OrchestrationStatus,
  summary: string
): string {
  if (eventStatus !== "running" || displayStatus !== "done") {
    return summary;
  }
  if (summary === "Reading Case context from Salesforce.") {
    return "Case context read from Salesforce.";
  }
  if (summary === "Running AI triage.") {
    return "AI triage completed.";
  }
  return summary;
}

/**
 * Pure presentational panel. Renders a sanitized snapshot only — no
 * fetching, no timers, no approval controls. Exported so it can be
 * tested in isolation.
 */
export function OrchestrationPanel({
  snapshot
}: {
  snapshot: OrchestrationSnapshot;
}) {
  const { triage } = snapshot;
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
      aria-label="Node 1 triage progress"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Node 1 · Triage
          </p>
          <h2 className="text-lg font-semibold">
            {snapshot.caseNumber
              ? `Case ${snapshot.caseNumber}`
              : "Case triage"}
          </h2>
        </div>
        <StatusBadge status={snapshot.status} />
      </header>

      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        Read-only view of the orchestrator&apos;s first node. Approvals are
        handled in the account manager&apos;s email or Salesforce — never here.
      </p>

      <ol className="space-y-2" data-testid="status-timeline">
        {snapshot.events.map((event, index) => {
          const displayStatus = timelineStatus(snapshot, event.status, index);
          const summary = event.safeSummary ?? statusLabel(event.status);
          return (
            <li
              key={event.sequence}
              className="flex items-start gap-3 rounded-md border px-3 py-2"
            >
              <span className="mt-0.5">
                <StatusBadge status={displayStatus} />
              </span>
              <div className="flex-1 space-y-1.5">
                <span className="text-sm text-foreground">
                  {timelineSummary(event.status, displayStatus, summary)}
                </span>
                {event.details && event.details.length > 0 && (
                  <dl
                    className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2"
                    data-testid="event-details"
                  >
                    {event.details.map((detail) => (
                      <div
                        key={`${event.sequence}-${detail.label}`}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <dt className="text-muted-foreground">
                          {detail.label}
                        </dt>
                        <dd className="font-medium text-foreground">
                          {detail.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          );
        })}
        {snapshot.events.length === 0 && (
          <li className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" aria-hidden />
            Waiting for the first status update…
          </li>
        )}
      </ol>

      {triage && (
        <div
          className="space-y-2 rounded-lg border bg-background p-4"
          data-testid="triage-output"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Triage result</p>
            <span
              className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              data-testid="triage-priority"
            >
              priority: {triage.recommendedPriority}
            </span>
          </div>
          <p className="text-sm text-foreground">{triage.summary}</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Next step: </span>
            {triage.suggestedNextStep}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {triage.provider} · {triage.model}
            {triage.fallbackUsed ? " · fallback" : ""}
          </p>
        </div>
      )}

      {snapshot.status === "failed" && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Triage could not complete
          {snapshot.failureKind ? ` (${snapshot.failureKind})` : ""}.
        </p>
      )}
    </section>
  );
}

interface OrchestrationViewProps {
  workflowId?: string;
  caseId?: string;
  pollIntervalMs?: number;
  initialSnapshot?: OrchestrationSnapshot;
}

/**
 * Polling container. Fetches the sanitized snapshot from the
 * server-side proxy until the workflow reaches a terminal state.
 */
export function OrchestrationView({
  workflowId,
  caseId,
  pollIntervalMs = 2500,
  initialSnapshot
}: OrchestrationViewProps) {
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot | null>(
    initialSnapshot ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    const statusPath = workflowId
      ? `/api/orchestrator/${workflowId}`
      : `/api/orchestrator/case/${caseId}`;
    try {
      const response = await fetch(statusPath, {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) {
        setError(
          response.status === 404
            ? "Workflow not found."
            : "The orchestration view is unavailable."
        );
        return;
      }
      const parsed = sanitizeSnapshot(await response.json());
      if (parsed) {
        setError(null);
        setSnapshot(parsed);
        if (isTerminalStatus(parsed.status)) {
          stopped.current = true;
        }
      }
    } catch {
      setError("The orchestration view is unavailable.");
    }
  }, [caseId, workflowId]);

  useEffect(() => {
    stopped.current = false;
    void load();
    const timer = setInterval(() => {
      if (stopped.current) return;
      void load();
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [load, pollIntervalMs]);

  if (error && !snapshot) {
    return (
      <div className="rounded-xl border bg-card p-5 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading triage progress…
      </div>
    );
  }

  return <OrchestrationPanel snapshot={snapshot} />;
}

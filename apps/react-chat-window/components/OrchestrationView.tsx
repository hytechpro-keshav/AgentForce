"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  Hand,
  Loader2,
  Link2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  XCircle
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  isTerminalStatus,
  sanitizeSnapshot,
  STATUS_META,
  statusLabel,
  type OrchestrationApprovalDecision,
  type OrchestrationCustomerContext,
  type OrchestrationEvent,
  type OrchestrationExecutionTrace,
  type OrchestrationGuardrail,
  type OrchestrationKnowledgeGuidance,
  type OrchestrationNodeId,
  type OrchestrationScheduling,
  type OrchestrationSnapshot,
  type OrchestrationStateChange,
  type OrchestrationStatus,
  type OrchestrationTraceSection,
  type OrchestrationTraceValue,
  type OrchestrationVerdict
} from "@/lib/orchestration";

const STATUS_ICON: Record<OrchestrationStatus, typeof CircleDot> = {
  assigned: CircleDot,
  running: Loader2,
  waiting_approval: ShieldQuestion,
  done: CheckCircle2,
  rejected: XCircle,
  escalated: ShieldAlert,
  stopped: Hand,
  failed: AlertTriangle
};

const NODE_META: Record<
  OrchestrationNodeId,
  { label: string; shortLabel: string; description: string }
> = {
  triage: {
    label: "Node 1 · Triage",
    shortLabel: "Triage",
    description:
      "Reads the Case context, runs AI triage, and applies the approved write-back."
  },
  customer_history: {
    label: "Node 2 · Customer Context",
    shortLabel: "Customer Context",
    description:
      "Reads customer history, assembles the context package, and writes it to workflow state."
  },
  knowledge: {
    label: "Node 3 · Knowledge Base",
    shortLabel: "Knowledge",
    description:
      "Builds a targeted RAG query, retrieves approved troubleshooting guidance, and writes knowledge findings to workflow state."
  },
  parts_logistics: {
    label: "Node 4 · Parts & Logistics",
    shortLabel: "Parts & Logistics",
    description:
      "Selects the fulfillment warehouse from the Case ship-to, reads live inventory, and plans part availability and multi-segment ETA."
  },
  scheduling: {
    label: "Node 5 · Scheduling",
    shortLabel: "Scheduling",
    description:
      "Ranks technicians by skill, territory, and availability, and proposes the earliest service window after parts ETA."
  },
  guardrail: {
    label: "Node 6 · Compliance & Guardrail",
    shortLabel: "Guardrail",
    description:
      "Evaluates composite policy across all upstream channels and determines whether to auto-approve, pause for human sign-off, reject, or escalate."
  }
};

function nodeMeta(node: OrchestrationNodeId | undefined) {
  return NODE_META[node ?? "triage"] ?? NODE_META.triage;
}

function eventNode(event: OrchestrationEvent): OrchestrationNodeId {
  return event.node ?? "triage";
}

type StageStatus = OrchestrationStatus | "pending" | "skipped";

const STAGE_META: Record<
  StageStatus,
  { label: string; tone: string; icon: typeof CircleDot }
> = {
  pending: {
    label: "Pending",
    tone: "bg-slate-100 text-slate-600",
    icon: Clock
  },
  skipped: {
    label: "Skipped",
    tone: "bg-slate-100 text-slate-700",
    icon: ChevronDown
  },
  assigned: {
    label: "Assigned",
    tone: STATUS_META.assigned.tone,
    icon: CircleDot
  },
  running: {
    label: "Running",
    tone: STATUS_META.running.tone,
    icon: Loader2
  },
  waiting_approval: {
    label: "Waiting for approval",
    tone: STATUS_META.waiting_approval.tone,
    icon: ShieldQuestion
  },
  done: {
    label: "Completed",
    tone: STATUS_META.done.tone,
    icon: CheckCircle2
  },
  rejected: {
    label: "Rejected",
    tone: STATUS_META.rejected.tone,
    icon: XCircle
  },
  escalated: {
    label: "Escalated",
    tone: STATUS_META.escalated.tone,
    icon: ShieldAlert
  },
  stopped: {
    label: "Stopped (manual)",
    tone: STATUS_META.stopped.tone,
    icon: Hand
  },
  failed: {
    label: "Failed",
    tone: STATUS_META.failed.tone,
    icon: AlertTriangle
  }
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

function StageBadge({ status }: { status: StageStatus }) {
  const meta = STAGE_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        meta.tone
      )}
    >
      <Icon
        className={cn("h-3.5 w-3.5", status === "running" && "animate-spin")}
        aria-hidden
      />
      {meta.label}
    </span>
  );
}

function nodeEvents(
  snapshot: OrchestrationSnapshot,
  node: OrchestrationNodeId
): OrchestrationEvent[] {
  return snapshot.events.filter((event) => eventNode(event) === node);
}

function stageStatus(
  snapshot: OrchestrationSnapshot,
  node: OrchestrationNodeId
): StageStatus {
  if (node === "knowledge") {
    if (snapshot.knowledgeGuidance?.eligible === false) {
      return "skipped";
    }
    if (snapshot.status === "failed" && snapshot.node === node) {
      return "failed";
    }
    const events = nodeEvents(snapshot, node);
    if (events.length === 0) {
      return "pending";
    }
    if (snapshot.knowledgeGuidance) {
      return "done";
    }
    return displayEventStatus(snapshot, events.at(-1)!);
  }

  if (node === "parts_logistics") {
    if (snapshot.partsLogistics?.eligible === false) {
      return "skipped";
    }
    if (snapshot.status === "failed" && snapshot.node === node) {
      return "failed";
    }
    const events = nodeEvents(snapshot, node);
    if (events.length === 0) {
      return "pending";
    }
    if (snapshot.partsLogistics) {
      return "done";
    }
    return displayEventStatus(snapshot, events.at(-1)!);
  }

  if (node === "scheduling") {
    if (snapshot.scheduling?.eligible === false) {
      return "skipped";
    }
    if (snapshot.status === "failed" && snapshot.node === node) {
      return "failed";
    }
    const events = nodeEvents(snapshot, node);
    if (events.length === 0) {
      return "pending";
    }
    if (snapshot.scheduling) {
      return "done";
    }
    return displayEventStatus(snapshot, events.at(-1)!);
  }

  if (node === "guardrail") {
    if (snapshot.status === "failed" && snapshot.node === node) {
      return "failed";
    }
    // Operator Stop-AI takeover (6c / RC-1) lands on Node 6 and is terminal —
    // surface it as stopped regardless of any pending policy outcome.
    if (snapshot.status === "stopped") {
      return "stopped";
    }
    // A resolved approval decision wins over the raw outcome. Node 6 sets
    // the decision itself for the non-interrupt outcomes (auto-approve →
    // approved, policy reject → rejected, escalate → escalated); the human
    // resume sets approved/rejected.
    const decision = snapshot.approvalDecision;
    if (decision === "approved") return "done";
    if (decision === "rejected") return "rejected";
    if (decision === "escalated") return "escalated";
    const guardrail = snapshot.guardrail;
    if (guardrail) {
      switch (guardrail.outcome) {
        case "autoApprove":
          return "done";
        case "reject":
          return "rejected";
        case "escalate":
          return "escalated";
        case "requireHumanApproval":
          // Awaiting the out-of-band approver (no decision yet).
          return "waiting_approval";
      }
    }
    const events = nodeEvents(snapshot, node);
    return events.length === 0 ? "pending" : "running";
  }

  if (node === "customer_history") {
    if (snapshot.customerContext?.eligible === false) {
      return "skipped";
    }
    if (snapshot.status === "failed" && snapshot.node === node) {
      return "failed";
    }
    const events = nodeEvents(snapshot, node);
    if (events.length === 0) {
      return "pending";
    }
    if (snapshot.customerContext) {
      return "done";
    }
    return displayEventStatus(snapshot, events.at(-1)!);
  }

  if (snapshot.status === "failed" && snapshot.node === node) {
    return "failed";
  }
  const events = nodeEvents(snapshot, node);
  if (events.length === 0) {
    return "pending";
  }
  if (snapshot.triage) {
    if (snapshot.status === "waiting_approval") {
      return "waiting_approval";
    }
    if (snapshot.status === "rejected") {
      return "rejected";
    }
    return "done";
  }
  return displayEventStatus(snapshot, events.at(-1)!);
}

function displayEventStatus(
  snapshot: OrchestrationSnapshot,
  event: OrchestrationEvent
): OrchestrationStatus {
  if (
    event.status === "running" &&
    (event.sequence < snapshot.events.length ||
      isTerminalStatus(snapshot.status))
  ) {
    return "done";
  }
  return event.status;
}

function displayNode(snapshot: OrchestrationSnapshot): OrchestrationNodeId {
  if (snapshot.status === "done") {
    if (stageStatus(snapshot, "guardrail") !== "pending") {
      return "guardrail";
    }
    if (stageStatus(snapshot, "scheduling") !== "pending") {
      return "scheduling";
    }
    if (stageStatus(snapshot, "parts_logistics") !== "pending") {
      return "parts_logistics";
    }
    if (stageStatus(snapshot, "knowledge") !== "pending") {
      return "knowledge";
    }
    if (stageStatus(snapshot, "customer_history") !== "pending") {
      return "customer_history";
    }
    return "triage";
  }
  const lastEvent = snapshot.events.at(-1);
  return lastEvent ? eventNode(lastEvent) : snapshot.node;
}

function currentStageSummary(snapshot: OrchestrationSnapshot): string {
  if (snapshot.events.length === 0) {
    return "Workflow assigned";
  }
  const node = displayNode(snapshot);
  if (snapshot.status === "done") {
    return `${nodeMeta(node).shortLabel} ${
      stageStatus(snapshot, node) === "skipped" ? "skipped" : "finished"
    }`;
  }
  if (snapshot.status === "failed") {
    return `${nodeMeta(node).shortLabel} failed`;
  }
  if (snapshot.status === "rejected") {
    return `${nodeMeta(node).shortLabel} rejected`;
  }
  const latestNodeEvent = [...snapshot.events]
    .reverse()
    .find((event) => eventNode(event) === node);
  const displayEvent = latestNodeEvent ?? snapshot.events.at(-1)!;
  return `${nodeMeta(node).shortLabel}: ${displayEvent.safeSummary ?? statusLabel(displayEvent.status)}`;
}

const STAGE_NODES: OrchestrationNodeId[] = [
  "triage",
  "customer_history",
  "knowledge",
  "parts_logistics",
  "scheduling",
  "guardrail"
];

function completedStages(snapshot: OrchestrationSnapshot): number {
  return STAGE_NODES.filter((node) => {
    const status = stageStatus(snapshot, node);
    return status === "done" || status === "skipped";
  }).length;
}

function formatJson(value: OrchestrationTraceValue): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Node 3's `safeSummary` is often a concatenation of retrieval metadata
 * like "Product: X, Category: Y, Issue: Z". This splits that pattern
 * into scannable label/value rows for the operator. Returns an empty
 * list when the text is ordinary prose, so the caller can fall back to a
 * readable paragraph. This is display-only parsing of an already-safe,
 * already-sanitized string — never a machine contract.
 */
function parseGuidanceFields(
  summary: string
): { label: string; value: string }[] {
  const labelPattern = /(^|[,;.]\s+)([A-Z][A-Za-z0-9 /&'()-]{1,28}):\s*/g;
  const matches = [...summary.matchAll(labelPattern)];
  if (matches.length < 2) {
    return [];
  }
  const fields: { label: string; value: string }[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const label = match[2].trim();
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? summary.length)
        : summary.length;
    const value = summary
      .slice(valueStart, valueEnd)
      .replace(/[;,.\s]+$/, "")
      .trim();
    if (label && value) {
      fields.push({ label, value });
    }
  }
  return fields;
}

function JsonBlock({ value }: { value: OrchestrationTraceValue }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
      {formatJson(value)}
    </pre>
  );
}

function isRecord(
  value: OrchestrationTraceValue | undefined
): value is Record<string, OrchestrationTraceValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function traceSection(
  trace: OrchestrationExecutionTrace | undefined,
  key: string
): OrchestrationTraceSection | undefined {
  return trace?.sections.find((section) => section.key === key);
}

function readStateChanges(
  value: OrchestrationTraceValue | undefined
): OrchestrationStateChange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: OrchestrationStateChange[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const path = typeof entry.path === "string" ? entry.path : undefined;
    const change =
      entry.change === "added" || entry.change === "modified"
        ? entry.change
        : undefined;
    if (!path || !change) continue;
    out.push({
      path,
      change,
      before: entry.before,
      after: entry.after
    });
  }
  return out;
}

function NodeChip({ node }: { node: OrchestrationNodeId }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {nodeMeta(node).shortLabel}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  supporting
}: {
  label: string;
  value: string;
  supporting?: string;
}) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      {supporting ? (
        <p className="mt-1 text-sm text-muted-foreground">{supporting}</p>
      ) : null}
    </div>
  );
}

function StageRail({ snapshot }: { snapshot: OrchestrationSnapshot }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workflow stages
          </p>
          <h2 className="text-lg font-semibold">
            Current and completed stages
          </h2>
        </div>
        <StatusBadge status={snapshot.status} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {STAGE_NODES.map((node) => {
          const events = nodeEvents(snapshot, node);
          const status = stageStatus(snapshot, node);
          return (
            <div
              key={node}
              className="rounded-xl border bg-background p-4"
              data-testid={`stage-${node}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {nodeMeta(node).label}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {nodeMeta(node).description}
                  </p>
                </div>
                <StageBadge status={status} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {events.length > 0
                  ? `${events.length} step${events.length === 1 ? "" : "s"} emitted`
                  : "No events emitted yet."}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FinalVerdict({ verdict }: { verdict?: OrchestrationVerdict }) {
  if (!verdict || (!verdict.headline && !verdict.summary)) {
    return null;
  }
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
      data-testid="final-verdict"
      aria-label="Orchestrator final verdict"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Orchestrator verdict
            </p>
            {verdict.headline ? (
              <h2 className="text-lg font-semibold text-foreground">
                {verdict.headline}
              </h2>
            ) : null}
          </div>
        </div>
      </div>

      {verdict.summary ? (
        <p className="text-sm leading-relaxed text-foreground">
          {verdict.summary}
        </p>
      ) : null}

      {verdict.highlights.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {verdict.highlights.map((highlight) => (
            <span
              key={highlight.label}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {highlight.label}:
              </span>
              {highlight.value}
            </span>
          ))}
        </div>
      ) : null}

      {verdict.recommendedSteps.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recommended steps
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            {verdict.recommendedSteps.map((step, index) => (
              <li key={`${index}-${step.slice(0, 16)}`}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        Human-readable summary for operators. Generated from triage, customer
        context, and knowledge findings — downstream automation uses the typed
        channels, not this text.
      </p>
    </section>
  );
}

function KnowledgeActions({
  actions
}: {
  actions: NonNullable<
    NonNullable<OrchestrationKnowledgeGuidance["answer"]>["recommendedActions"]
  >;
}) {
  return (
    <div
      className="rounded-xl border bg-background p-4"
      data-testid="knowledge-actions"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recommended actions
      </p>
      <ul className="mt-2 space-y-2">
        {actions.map((action, index) => (
          <li
            key={`${index}-${action.actionType}`}
            className="rounded-lg border bg-card px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {action.actionType.replace(/_/g, " ")}
              </span>
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {action.confidence}
                </span>
                {action.requiredApproval ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-800">
                    Approval
                  </span>
                ) : null}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {action.rationale}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KnowledgeSafetyFlags({
  flags
}: {
  flags: NonNullable<
    NonNullable<OrchestrationKnowledgeGuidance["answer"]>["safetyFlags"]
  >;
}) {
  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 p-4"
      data-testid="knowledge-safety-flags"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Safety warnings
      </p>
      <ul className="mt-2 space-y-1.5">
        {flags.map((flag) => (
          <li key={flag.code} className="text-sm text-amber-900">
            <span className="font-medium uppercase">{flag.severity}:</span>{" "}
            {flag.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuidanceDetail({ summary }: { summary: string }) {
  const fields = parseGuidanceFields(summary);
  return (
    <div
      className="rounded-xl border bg-background p-4"
      data-testid="knowledge-guidance-detail"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recommended guidance
      </p>
      {fields.length > 0 ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <div
              key={field.label}
              className="rounded-lg border bg-card px-3 py-2"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {field.label}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {field.value}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-foreground">
          {summary}
        </p>
      )}
    </div>
  );
}

function KnowledgeGuidanceSummary({
  knowledgeGuidance
}: {
  knowledgeGuidance?: OrchestrationSnapshot["knowledgeGuidance"];
}) {
  if (!knowledgeGuidance) {
    return null;
  }

  const sourceCount = knowledgeGuidance.answer?.sources.length ?? 0;

  return (
    <section className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Node 3 output
          </p>
          <h2 className="text-lg font-semibold">Knowledge guidance</h2>
        </div>
        <StageBadge status={knowledgeGuidance.eligible ? "done" : "skipped"} />
      </div>

      <p className="text-sm text-muted-foreground">
        {knowledgeGuidance.eligible
          ? (knowledgeGuidance.eligibilityReason ??
            "Knowledge retrieval executed for this workflow.")
          : (knowledgeGuidance.eligibilityReason ??
            "Knowledge retrieval was skipped for this workflow.")}
      </p>

      <dl className="grid gap-3 md:grid-cols-2">
        <FindingCard
          label="Status"
          value={knowledgeGuidance.status ?? "Skipped"}
          supporting={
            knowledgeGuidance.degraded
              ? `Degraded: ${knowledgeGuidance.degradedSources?.join(", ") ?? "Yes"}`
              : "Degraded: No"
          }
        />
        <FindingCard
          label="Sources found"
          value={String(sourceCount)}
          supporting={
            knowledgeGuidance.answer?.retrievalId
              ? `Retrieval id: ${knowledgeGuidance.answer.retrievalId}`
              : "No retrieval id recorded"
          }
        />
        {knowledgeGuidance.answer?.guidanceConfidence ? (
          <FindingCard
            label="Guidance confidence"
            value={knowledgeGuidance.answer.guidanceConfidence}
            supporting="Graded from retrieval signals"
          />
        ) : null}
        {knowledgeGuidance.answer?.provider ? (
          <FindingCard
            label="Provider"
            value={knowledgeGuidance.answer.provider}
            supporting={
              knowledgeGuidance.answer.model
                ? `Model: ${knowledgeGuidance.answer.model}`
                : undefined
            }
          />
        ) : null}
        {knowledgeGuidance.answer?.latencyMs !== undefined ? (
          <FindingCard
            label="Latency"
            value={`${knowledgeGuidance.answer.latencyMs} ms`}
            supporting={
              knowledgeGuidance.answer.embeddingProvider
                ? `Embeddings: ${knowledgeGuidance.answer.embeddingProvider}`
                : undefined
            }
          />
        ) : null}
      </dl>

      {knowledgeGuidance.answer?.recommendedActions?.length ? (
        <KnowledgeActions
          actions={knowledgeGuidance.answer.recommendedActions}
        />
      ) : null}

      {knowledgeGuidance.answer?.safetyFlags?.length ? (
        <KnowledgeSafetyFlags flags={knowledgeGuidance.answer.safetyFlags} />
      ) : null}

      {knowledgeGuidance.answer?.displaySummary ||
      knowledgeGuidance.answer?.safeSummary ? (
        <GuidanceDetail
          summary={
            knowledgeGuidance.answer.displaySummary ??
            knowledgeGuidance.answer.safeSummary
          }
        />
      ) : null}

      {knowledgeGuidance.answer?.sources?.length ? (
        <div
          className="rounded-xl border bg-background p-4"
          data-testid="knowledge-sources"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {`Sources (${knowledgeGuidance.answer.sources.length})`}
          </p>
          <ul className="mt-3 space-y-2">
            {knowledgeGuidance.answer.sources.map((source) => (
              <li
                key={`${source.sourceId}-${source.chunkId ?? "source"}`}
                className="rounded-lg border bg-card px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <Link2
                    className="mt-0.5 h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {source.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {source.retrievalScorePercentile !== undefined
                        ? `Score: ${source.retrievalScorePercentile}`
                        : "Score unavailable"}
                      {source.version ? ` · Version: ${source.version}` : ""}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="rounded-xl border bg-background p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Knowledge guidance JSON
        </summary>
        <div className="mt-3">
          <JsonBlock
            value={knowledgeGuidance as unknown as OrchestrationTraceValue}
          />
        </div>
      </details>
    </section>
  );
}

function TriageSummary({ snapshot }: { snapshot: OrchestrationSnapshot }) {
  if (!snapshot.triage) {
    return null;
  }
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
      data-testid="triage-output"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Node 1 output
          </p>
          <h2 className="text-lg font-semibold">Triage result</h2>
        </div>
        <span
          className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          data-testid="triage-priority"
        >
          priority: {snapshot.triage.recommendedPriority}
        </span>
      </div>

      <p className="text-sm text-foreground">{snapshot.triage.summary}</p>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Next step: </span>
        {snapshot.triage.suggestedNextStep}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg border bg-background p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Provider
          </dt>
          <dd className="mt-1 font-medium text-foreground">
            {snapshot.triage.provider}
          </dd>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Model
          </dt>
          <dd className="mt-1 font-medium text-foreground">
            {snapshot.triage.model}
          </dd>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Fallback
          </dt>
          <dd className="mt-1 font-medium text-foreground">
            {snapshot.triage.fallbackUsed ? "Yes" : "No"}
          </dd>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Latency
          </dt>
          <dd className="mt-1 font-medium text-foreground">
            {snapshot.triage.latencyMs} ms
          </dd>
        </div>
      </dl>
    </section>
  );
}

function PartsLogisticsSummary({
  partsLogistics
}: {
  partsLogistics?: OrchestrationSnapshot["partsLogistics"];
}) {
  if (!partsLogistics) {
    return null;
  }

  const plans = partsLogistics.partPlans ?? [];
  const approvals = plans.filter((p) => p.requiredApproval).length;

  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
      data-testid="parts-logistics-summary"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Node 4 output
          </p>
          <h2 className="text-lg font-semibold">Parts &amp; logistics</h2>
        </div>
        <StageBadge status={partsLogistics.eligible ? "done" : "skipped"} />
      </div>

      <p className="text-sm text-muted-foreground">
        {partsLogistics.eligible
          ? (partsLogistics.eligibilityReason ??
            "Fulfillment planning executed for this workflow.")
          : (partsLogistics.eligibilityReason ??
            "Parts logistics was skipped for this workflow.")}
      </p>

      <dl className="grid gap-3 md:grid-cols-2">
        <FindingCard
          label="Status"
          value={partsLogistics.status ?? "Skipped"}
          supporting={
            partsLogistics.degraded
              ? `Degraded: ${partsLogistics.degradedSources?.join(", ") ?? "Yes"}`
              : "Degraded: No"
          }
        />
        <FindingCard
          label="Fulfillment readiness"
          value={partsLogistics.fulfillmentReadiness ?? "unknown"}
          supporting={
            partsLogistics.fulfillmentConfidence
              ? `Confidence: ${partsLogistics.fulfillmentConfidence}`
              : undefined
          }
        />
        <FindingCard label="Parts planned" value={String(plans.length)} />
        {approvals > 0 ? (
          <FindingCard
            label="Approvals required"
            value={String(approvals)}
            supporting="Resolved at the Node 6 approval gate"
          />
        ) : null}
        {partsLogistics.kbCrossCheck &&
        partsLogistics.kbCrossCheck.status !== "SKIPPED" ? (
          <FindingCard
            label="KB warehouse cross-check"
            value={partsLogistics.kbCrossCheck.status}
            supporting={`Aligned ${partsLogistics.kbCrossCheck.alignedCount} · Divergent ${partsLogistics.kbCrossCheck.divergentCount} · Undocumented ${partsLogistics.kbCrossCheck.undocumentedCount}`}
          />
        ) : null}
        {partsLogistics.writeOutcome?.applied ? (
          <FindingCard
            label="Fulfillment writes"
            value={
              partsLogistics.writeOutcome.degraded
                ? "Degraded"
                : `${partsLogistics.writeOutcome.createdCount} created`
            }
            supporting={
              partsLogistics.writeOutcome.idempotentSkipCount > 0
                ? `${partsLogistics.writeOutcome.idempotentSkipCount} reused (idempotent)`
                : "Created after approval"
            }
          />
        ) : null}
      </dl>

      {plans.length > 0 ? (
        <div
          className="rounded-xl border bg-background p-4"
          data-testid="parts-logistics-plans"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {`Part plans (${plans.length})`}
          </p>
          <ul className="mt-3 space-y-2">
            {plans.map((plan) => (
              <li
                key={plan.partNumber}
                className="rounded-lg border bg-card px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {plan.partNumber}
                      {plan.partName ? ` · ${plan.partName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`Availability: ${plan.availability} · ${plan.exceptionType}`}
                      {plan.estimatedArrivalWindow
                        ? ` · ETA ${plan.estimatedArrivalWindow}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {plan.transferRequired && plan.sourceWarehouseReference
                        ? `Transfer ${plan.sourceWarehouseReference} → ${plan.fulfillmentWarehouseReference ?? "fulfillment WH"}`
                        : plan.fulfillmentWarehouseReference
                          ? `Fulfillment WH: ${plan.fulfillmentWarehouseReference}`
                          : ""}
                    </p>
                    {plan.fulfillmentRecordType &&
                    plan.reservationStatus &&
                    plan.reservationStatus !== "planned" &&
                    plan.reservationStatus !== "none" ? (
                      <p className="mt-1 text-xs font-medium text-emerald-700">
                        {`${plan.reservationStatus.replace(/_/g, " ")} · ${plan.fulfillmentRecordType}`}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {plan.requiredApproval ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {plan.approvalReason && plan.approvalReason !== "none"
                          ? plan.approvalReason.replace(/_/g, " ")
                          : "approval"}
                      </span>
                    ) : null}
                    {plan.kbWarehouseAlignment &&
                    plan.kbWarehouseAlignment !== "unknown" ? (
                      <span
                        className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                          plan.kbWarehouseAlignment === "divergent"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {`KB ${plan.kbWarehouseAlignment}`}
                      </span>
                    ) : null}
                  </div>
                </div>
                {plan.rationale ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {plan.rationale}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SchedulingSummary({
  scheduling
}: {
  scheduling?: OrchestrationScheduling;
}) {
  if (!scheduling) {
    return null;
  }

  const candidates = scheduling.candidates ?? [];
  const window = scheduling.proposedWindow;

  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
      data-testid="scheduling-summary"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Node 5 output
          </p>
          <h2 className="text-lg font-semibold">Scheduling</h2>
        </div>
        <StageBadge status={scheduling.eligible ? "done" : "skipped"} />
      </div>

      <p className="text-sm text-muted-foreground">
        {scheduling.eligible
          ? (scheduling.eligibilityReason ??
            "Technician ranking and service-window planning executed for this workflow.")
          : (scheduling.eligibilityReason ??
            "Scheduling was skipped for this workflow.")}
      </p>

      <dl className="grid gap-3 md:grid-cols-2">
        <FindingCard
          label="Readiness"
          value={
            scheduling.schedulingReadiness ?? scheduling.status ?? "unknown"
          }
          supporting={
            scheduling.degraded
              ? `Degraded: ${scheduling.degradedSources?.join(", ") ?? "Yes"}`
              : scheduling.confidence
                ? `Confidence: ${scheduling.confidence}`
                : undefined
          }
        />
        <FindingCard
          label="Recommended technician"
          value={scheduling.recommendedResourceReference ?? "None"}
          supporting={
            candidates[0]?.matchedSkills?.length
              ? `Skills: ${candidates[0].matchedSkills.join(", ")}`
              : undefined
          }
        />
        {window?.displayWindow ? (
          <FindingCard
            label="Proposed window"
            value={window.displayWindow}
            supporting={`Basis: ${window.earliestStartBasis}${
              window.partsEtaConstrained ? " · gated on parts ETA" : ""
            }`}
          />
        ) : null}
        {scheduling.partsReadinessSeen ? (
          <FindingCard
            label="Parts readiness seen"
            value={scheduling.partsReadinessSeen}
            supporting={
              scheduling.partsEtaConsidered
                ? "Parts ETA considered in gating"
                : "No parts dependency"
            }
          />
        ) : null}
        {scheduling.requiredApproval ? (
          <FindingCard
            label="Approval"
            value={scheduling.approvalReason ?? "required"}
            supporting="Surfaced for the Node 6 approval gate"
          />
        ) : null}
      </dl>

      {candidates.length > 0 ? (
        <div
          className="rounded-xl border bg-background p-4"
          data-testid="scheduling-candidates"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {`Ranked technicians (${candidates.length})`}
          </p>
          <ul className="mt-3 space-y-2">
            {candidates.map((candidate) => (
              <li
                key={candidate.resourceReference}
                className="rounded-lg border bg-card px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {`#${candidate.rank} · ${candidate.resourceReference}`}
                      {candidate.territoryReference
                        ? ` · ${candidate.territoryReference}`
                        : ""}
                      {candidate.territoryMembership
                        ? ` (${candidate.territoryMembership})`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {candidate.matchedSkills.length > 0
                        ? `Skills: ${candidate.matchedSkills.join(", ")}`
                        : "No matched skills"}
                      {candidate.earliestAvailableAt
                        ? ` · Earliest ${candidate.earliestAvailableAt}`
                        : ""}
                    </p>
                  </div>
                  <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {`rank ${candidate.rankScore}`}
                  </span>
                </div>
                {candidate.rationale ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {candidate.rationale}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        Point-in-time plan: readiness reflects parts availability as of this
        run. Technician identity is a sanitized reference, never a full name.
      </p>
    </section>
  );
}

function guardrailBadge(
  guardrail: OrchestrationGuardrail,
  approvalDecision?: OrchestrationApprovalDecision
): { label: string; tone: string } {
  switch (guardrail.outcome) {
    case "autoApprove":
      return { label: "Auto-Approved", tone: "bg-green-100 text-green-700" };
    case "reject":
      return { label: "Rejected", tone: "bg-slate-200 text-slate-700" };
    case "escalate":
      return { label: "Escalated", tone: "bg-orange-100 text-orange-800" };
    case "requireHumanApproval":
      if (approvalDecision === "approved") {
        return { label: "Approved", tone: "bg-green-100 text-green-700" };
      }
      if (approvalDecision === "rejected") {
        return { label: "Rejected", tone: "bg-slate-200 text-slate-700" };
      }
      if (approvalDecision === "escalated") {
        return { label: "Escalated", tone: "bg-orange-100 text-orange-800" };
      }
      return {
        label: "Waiting for Approval",
        tone: "bg-amber-100 text-amber-800"
      };
  }
}

function GuardrailSummary({
  guardrail,
  approvalDecision
}: {
  guardrail?: OrchestrationGuardrail;
  approvalDecision?: OrchestrationApprovalDecision;
}) {
  if (!guardrail) {
    return null;
  }
  const badge = guardrailBadge(guardrail, approvalDecision);
  const triggered = guardrail.policyRulesTriggered;

  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
      data-testid="guardrail-summary"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Node 6 output
          </p>
          <h2 className="text-lg font-semibold">Compliance &amp; guardrail</h2>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            badge.tone
          )}
          data-testid="guardrail-outcome-badge"
        >
          {badge.label}
        </span>
      </div>

      <dl className="grid gap-3 md:grid-cols-2">
        <FindingCard
          label="Risk"
          value={`${guardrail.riskScore} / ${guardrail.riskLevel.toUpperCase()}`}
          supporting={
            guardrail.degraded ? "Evaluated on degraded inputs" : undefined
          }
        />
        <FindingCard
          label="Triggered rules"
          value={String(triggered.length)}
          supporting={
            guardrail.outcome === "autoApprove"
              ? guardrail.autoApproveReason
              : `Channels: ${guardrail.channelBasis.join(", ") || "n/a"}`
          }
        />
      </dl>

      {triggered.length > 0 ? (
        <div
          className="rounded-xl border bg-background p-4"
          data-testid="guardrail-rules"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Policy rules triggered
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {triggered.map((rule) => (
              <li
                key={rule.ruleId}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  rule.isHardRule
                    ? "bg-rose-100 text-rose-800"
                    : "bg-muted text-muted-foreground"
                )}
                title={rule.description}
              >
                {rule.ruleId}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {guardrail.approvalReasons.length > 0 ? (
        <div
          className="rounded-xl border bg-background p-4"
          data-testid="guardrail-approval-reasons"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Approval reasons
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-foreground">
            {guardrail.approvalReasons.map((reason, index) => (
              <li key={`${index}-${reason.slice(0, 16)}`}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        Deterministic policy over typed channel signals only. Approvals happen
        out of band — this console is read-only.
      </p>
    </section>
  );
}

function FindingCard({
  label,
  value,
  supporting
}: {
  label: string;
  value: string;
  supporting?: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
      {supporting ? (
        <p className="mt-1 text-xs text-muted-foreground">{supporting}</p>
      ) : null}
    </div>
  );
}

function customerFindingValue<
  K extends keyof NonNullable<OrchestrationCustomerContext["package"]>
>(
  context: OrchestrationCustomerContext,
  key: K
): NonNullable<OrchestrationCustomerContext["package"]>[K] | undefined {
  return context.package?.[key];
}

function CustomerContextSummary({
  customerContext
}: {
  customerContext?: OrchestrationCustomerContext;
}) {
  if (!customerContext) {
    return null;
  }

  const risk = customerFindingValue(customerContext, "businessRisk");
  const repeat = customerFindingValue(customerContext, "repeatIncident");
  const strategic = customerFindingValue(customerContext, "strategicAccount");
  const assets = customerFindingValue(customerContext, "installedAssets");
  const incidents = customerFindingValue(customerContext, "openIncidentCount");
  const escalations = customerFindingValue(
    customerContext,
    "escalationHistory"
  );
  const sla = customerFindingValue(customerContext, "slaClass");
  const warranty = customerFindingValue(customerContext, "warrantyStatus");

  return (
    <section className="space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Node 2 output
          </p>
          <h2 className="text-lg font-semibold">Customer context package</h2>
        </div>
        <StageBadge status={customerContext.eligible ? "done" : "skipped"} />
      </div>

      <p className="text-sm text-muted-foreground">
        {customerContext.eligible
          ? (customerContext.eligibilityReason ??
            "Customer history executed for this workflow.")
          : (customerContext.eligibilityReason ??
            "Customer history was skipped for this workflow.")}
      </p>

      <dl className="grid gap-3 md:grid-cols-2">
        {risk ? (
          <FindingCard
            label="Business risk"
            value={`${String(risk.value)} (${risk.confidence})`}
            supporting={risk.evidenceBasis}
          />
        ) : null}
        {repeat ? (
          <FindingCard
            label="Repeat failure"
            value={repeat.value.repeat ? "Triggered" : "Not triggered"}
            supporting={`${repeat.value.count} incidents in ${repeat.value.windowDays} days`}
          />
        ) : null}
        {strategic ? (
          <FindingCard
            label="Strategic account"
            value={
              strategic.notEvidenced
                ? "Not evidenced"
                : strategic.value
                  ? "Yes"
                  : "No"
            }
            supporting={strategic.evidenceBasis}
          />
        ) : null}
        {assets ? (
          <FindingCard
            label="Assets found"
            value={`${assets.value.totalAssets} assets`}
            supporting={`Models: ${assets.value.modelCount}${assets.value.primaryModel ? ` · Primary ${assets.value.primaryModel}` : ""}`}
          />
        ) : null}
        {incidents ? (
          <FindingCard
            label="Open incidents"
            value={String(incidents.value)}
            supporting={incidents.evidenceBasis}
          />
        ) : null}
        {escalations ? (
          <FindingCard
            label="Prior escalations"
            value={String(escalations.value)}
            supporting={escalations.evidenceBasis}
          />
        ) : null}
        {sla ? (
          <FindingCard
            label="SLA"
            value={String(sla.value)}
            supporting={sla.evidenceBasis}
          />
        ) : null}
        {warranty ? (
          <FindingCard
            label="Warranty"
            value={String(warranty.value)}
            supporting={warranty.evidenceBasis}
          />
        ) : null}
      </dl>

      <details className="rounded-xl border bg-background p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Customer context package JSON
        </summary>
        <div className="mt-3">
          <JsonBlock
            value={customerContext as unknown as OrchestrationTraceValue}
          />
        </div>
      </details>
    </section>
  );
}

function TraceSectionView({ section }: { section: OrchestrationTraceSection }) {
  const changes =
    section.key === "state_changes" ? readStateChanges(section.data) : [];
  return (
    <details
      className="rounded-xl border bg-background p-3"
      open={section.key.startsWith("state_")}
    >
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {section.title}
      </summary>
      <div className="mt-3 space-y-3">
        {changes.length > 0 ? (
          <ul className="space-y-2">
            {changes.map((change) => (
              <li
                key={`${change.path}-${change.change}`}
                className="rounded-lg border bg-card px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {change.path}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                      change.change === "added"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-800"
                    )}
                  >
                    {change.change}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                  <div className="rounded-md bg-muted/70 p-2">
                    <p className="font-medium text-muted-foreground">Before</p>
                    <p className="mt-1 break-all text-foreground">
                      {change.before === undefined
                        ? "n/a"
                        : JSON.stringify(change.before)}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/70 p-2">
                    <p className="font-medium text-muted-foreground">After</p>
                    <p className="mt-1 break-all text-foreground">
                      {change.after === undefined
                        ? "n/a"
                        : JSON.stringify(change.after)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <JsonBlock value={section.data} />
      </div>
    </details>
  );
}

function EventTrace({ event }: { event: OrchestrationEvent }) {
  if (!event.trace) {
    return null;
  }
  return (
    <details
      className="rounded-xl border bg-muted/30 p-3"
      data-testid="event-trace"
    >
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        Agent Reasoning / Execution Trace
      </summary>
      <div className="mt-3 space-y-3">
        {event.trace.sections.map((section) => (
          <TraceSectionView
            key={`${event.sequence}-${event.trace?.stepKey}-${section.key}`}
            section={section}
          />
        ))}
      </div>
    </details>
  );
}

function TimelineEvent({
  snapshot,
  event
}: {
  snapshot: OrchestrationSnapshot;
  event: OrchestrationEvent;
}) {
  const displayStatus = displayEventStatus(snapshot, event);
  const summary = event.safeSummary ?? statusLabel(event.status);
  return (
    <li className="rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <NodeChip node={eventNode(event)} />
            <p className="text-sm font-semibold text-foreground">{summary}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Sequence {event.sequence}
          </p>
        </div>
        <StatusBadge status={displayStatus} />
      </div>

      {event.details && event.details.length > 0 ? (
        <dl
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          data-testid="event-details"
        >
          {event.details.map((detail) => (
            <div
              key={`${event.sequence}-${detail.label}`}
              className="rounded-lg border bg-card px-3 py-2"
            >
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {detail.label}
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-3">
        <EventTrace event={event} />
      </div>
    </li>
  );
}

function ExecutionTimeline({ snapshot }: { snapshot: OrchestrationSnapshot }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Agent reasoning / execution trace
          </p>
          <h2 className="text-lg font-semibold">
            Structured execution details
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
          Auditable artifacts only
        </div>
      </div>

      <ol className="space-y-3" data-testid="status-timeline">
        {snapshot.events.map((event) => (
          <TimelineEvent
            key={`${event.sequence}-${event.node}`}
            snapshot={snapshot}
            event={event}
          />
        ))}
        {snapshot.events.length === 0 ? (
          <li className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" aria-hidden />
            Waiting for the first status update…
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function WorkflowStateInspection({
  snapshot
}: {
  snapshot: OrchestrationSnapshot;
}) {
  const stateEvents = snapshot.events.filter(
    (event) =>
      Boolean(traceSection(event.trace, "state_before")) ||
      Boolean(traceSection(event.trace, "state_after")) ||
      Boolean(traceSection(event.trace, "state_changes"))
  );

  if (stateEvents.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Workflow state inspection
        </p>
        <h2 className="text-lg font-semibold">
          State before and after each step
        </h2>
      </div>

      <div className="space-y-3">
        {stateEvents.map((event) => {
          const before = traceSection(event.trace, "state_before");
          const after = traceSection(event.trace, "state_after");
          const changes = traceSection(event.trace, "state_changes");
          return (
            <details
              key={`state-${event.sequence}`}
              className="rounded-xl border bg-background p-4"
              open={event === stateEvents[0]}
            >
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                {nodeMeta(eventNode(event)).shortLabel} ·{" "}
                {event.safeSummary ?? statusLabel(event.status)}
              </summary>
              <div className="mt-3 space-y-3">
                {changes ? <TraceSectionView section={changes} /> : null}
                {before ? <TraceSectionView section={before} /> : null}
                {after ? <TraceSectionView section={after} /> : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Pure presentational panel. Renders a sanitized snapshot only — no
 * fetching, no timers, no approval controls. Exported so it can be
 * tested in isolation.
 */
export function OrchestrationPanel({
  snapshot,
  headerControl
}: {
  snapshot: OrchestrationSnapshot;
  /**
   * RC-1b — optional control slot beside the status badge. The stateful
   * container passes the Stop-AI control here; isolated panel tests omit it,
   * preserving the panel's pure, read-only rendering.
   */
  headerControl?: ReactNode;
}) {
  return (
    <section
      className="space-y-4"
      aria-label="Orchestration operations console"
    >
      <section className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Engineering operations console
            </p>
            <h2 className="text-2xl font-semibold text-foreground">
              {snapshot.caseNumber ? `Case ${snapshot.caseNumber}` : "Workflow"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only engineering view of Node 1 triage, Node 2 customer
              context, Node 3 knowledge guidance, Node 4 parts &amp; logistics,
              Node 5 scheduling, and Node 6 compliance &amp; guardrail.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={snapshot.status} />
            {headerControl}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard
            label="Current stage"
            value={currentStageSummary(snapshot)}
            supporting={`Completed stages: ${completedStages(snapshot)}/6`}
          />
          <SummaryCard
            label="Workflow id"
            value={snapshot.workflowId}
            supporting={`Latest node: ${nodeMeta(displayNode(snapshot)).label}`}
          />
          <SummaryCard
            label="Write-back"
            value={snapshot.writeBackApplied ? "Applied" : "Pending / skipped"}
            supporting={
              snapshot.approvalRequired
                ? "Approval gate enabled"
                : "No approval gate active"
            }
          />
        </div>

        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          This view exposes sanitized execution artifacts, state transitions,
          and read-only node outputs. Approvals remain outside this console.
        </p>
      </section>

      <FinalVerdict verdict={snapshot.orchestratorVerdict} />

      <StageRail snapshot={snapshot} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          <ExecutionTimeline snapshot={snapshot} />
          <WorkflowStateInspection snapshot={snapshot} />
        </div>
        <div className="space-y-4">
          <TriageSummary snapshot={snapshot} />
          <CustomerContextSummary customerContext={snapshot.customerContext} />
          <KnowledgeGuidanceSummary
            knowledgeGuidance={snapshot.knowledgeGuidance}
          />
          <PartsLogisticsSummary partsLogistics={snapshot.partsLogistics} />
          <SchedulingSummary scheduling={snapshot.scheduling} />
          <GuardrailSummary
            guardrail={snapshot.guardrail}
            approvalDecision={snapshot.approvalDecision}
          />
        </div>
      </div>

      {snapshot.status === "stopped" ? (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          AI orchestration stopped — this Case is being handled manually
          {snapshot.stoppedAt
            ? ` since ${new Date(snapshot.stoppedAt).toLocaleString()}`
            : ""}
          .{snapshot.stopReason ? ` Reason: ${snapshot.stopReason}.` : ""}
        </p>
      ) : null}

      {snapshot.status === "failed" ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Workflow could not complete
          {snapshot.failureKind ? ` (${snapshot.failureKind})` : ""}.
        </p>
      ) : null}
    </section>
  );
}

/**
 * RC-1b (Node 6 6c) — the console's ONLY mutation. Stop AI is NOT a guardrail
 * approve/reject: it carries the operator session (`orchestrator-control`
 * scope, set as an httpOnly cookie by the session proxy) and routes the Case
 * to a `stopped` terminal. Confirm dialog + inline operator login on 401.
 */
function StopAiControl({
  caseId,
  status,
  onStopped
}: {
  caseId: string;
  status: OrchestrationStatus;
  onStopped: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "confirm" | "login" | "working">(
    "idle"
  );
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Visible only while the AI could still act; hidden once stopped/terminal.
  const canStop =
    status === "assigned" ||
    status === "running" ||
    status === "waiting_approval" ||
    status === "done";

  const postStop = useCallback(async (): Promise<
    "ok" | "needs_login" | "error"
  > => {
    try {
      const res = await fetch(`/api/orchestrator/case/${caseId}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "manual takeover" })
      });
      if (res.status === 401) return "needs_login";
      return res.ok ? "ok" : "error";
    } catch {
      return "error";
    }
  }, [caseId]);

  if (!canStop) {
    return null;
  }

  const handleConfirm = async () => {
    setMode("working");
    setError(null);
    const result = await postStop();
    if (result === "ok") {
      setMode("idle");
      onStopped();
    } else if (result === "needs_login") {
      setMode("login");
    } else {
      setError("Could not stop AI orchestration. Try again.");
      setMode("confirm");
    }
  };

  const handleLogin = async () => {
    setMode("working");
    setError(null);
    try {
      const res = await fetch("/api/orchestrator/operator-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode })
      });
      if (!res.ok) {
        setError(
          res.status === 401 ? "Invalid access code." : "Login unavailable."
        );
        setMode("login");
        return;
      }
    } catch {
      setError("Login unavailable.");
      setMode("login");
      return;
    }
    const result = await postStop();
    if (result === "ok") {
      setAccessCode("");
      setMode("idle");
      onStopped();
    } else {
      setError("Could not stop AI orchestration. Try again.");
      setMode("confirm");
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode("confirm");
        }}
        disabled={mode === "working"}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
      >
        <Hand className="h-3.5 w-3.5" aria-hidden />
        Stop AI
      </button>

      {mode === "confirm" || mode === "working" ? (
        <div className="w-72 rounded-md border bg-card p-3 text-left text-xs shadow-sm">
          <p className="text-foreground">
            Stops future AI runs and pauses resume on this Case. Does{" "}
            <strong>not</strong> undo a Salesforce approval already pending, and
            does <strong>not</strong> close the Case.
          </p>
          {error ? <p className="mt-1.5 text-red-600">{error}</p> : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("idle")}
              disabled={mode === "working"}
              className="rounded border px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={mode === "working"}
              className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {mode === "working" ? "Stopping…" : "Confirm Stop AI"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "login" ? (
        <div className="w-72 rounded-md border bg-card p-3 text-left text-xs shadow-sm">
          <p className="text-foreground">
            Enter the operator access code to take over this Case.
          </p>
          <input
            type="password"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            placeholder="Operator access code"
            className="mt-2 w-full rounded border px-2 py-1"
          />
          {error ? <p className="mt-1.5 text-red-600">{error}</p> : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="rounded border px-2 py-1 text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={!accessCode.trim()}
              className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              Sign in &amp; Stop
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
        Loading orchestration console…
      </div>
    );
  }

  return (
    <OrchestrationPanel
      snapshot={snapshot}
      headerControl={
        caseId ? (
          <StopAiControl
            caseId={caseId}
            status={snapshot.status}
            onStopped={() => void load()}
          />
        ) : undefined
      }
    />
  );
}

/**
 * Stepped orchestration view model.
 *
 * Pure transform from the sanitized {@link OrchestrationSnapshot} read model
 * into the "spine" shape the stepped console renders (one node per stage, each
 * with a collapsed output line and an expandable detail accordion). This keeps
 * the React component free of field-mapping logic and makes the mapping unit
 * testable.
 *
 * Phase 1 (replay): the snapshot is produced by a real run; the UI reveals each
 * already-computed stage on demand. No field here is invented — every value
 * comes from the sanitized snapshot, so customer/operator-safe guarantees and
 * PII defenses from `sanitizeSnapshot` carry through unchanged.
 */
import type {
  OrchestrationCustomerContext,
  OrchestrationEvent,
  OrchestrationFinding,
  OrchestrationGuardrail,
  OrchestrationKnowledgeGuidance,
  OrchestrationNodeId,
  OrchestrationPartsLogistics,
  OrchestrationScheduling,
  OrchestrationSnapshot,
  OrchestrationStatus,
  OrchestrationTraceValue,
  OrchestrationTriage,
  OrchestrationVerdict
} from "./orchestration";

export type SteppedNodeIcon =
  | "search"
  | "user"
  | "book"
  | "box"
  | "cal"
  | "shield";

export interface SteppedField {
  k: string;
  v: string;
  h?: string;
}

export interface SteppedListItem {
  title: string;
  tags?: { t: string; tone?: "amber" | "ink" }[];
  meta?: string;
  desc?: string;
}

export interface SteppedTraceStep {
  label: string;
  status: string;
  fields: { k: string; v: string }[];
}

export type SteppedSection =
  | { type: "summary"; text: string }
  | { type: "fields"; items: SteppedField[] }
  | { type: "list"; title: string; items: SteppedListItem[] }
  | { type: "chips"; items: { k: string; v?: string }[] }
  | { type: "note"; text: string }
  | { type: "trace"; items: SteppedTraceStep[] };

export interface SteppedNode {
  id: OrchestrationNodeId;
  n: string;
  name: string;
  sub: string;
  icon: SteppedNodeIcon;
  /** True once the backend has actually produced this stage's result. */
  available: boolean;
  guardrail?: boolean;
  /** Collapsed one-line result; absent until available. */
  output?: string;
  latency?: string;
  detail: SteppedSection[];
}

export interface SteppedVerdict {
  headline: string;
  summary: string;
  meta?: string;
  chips: { k: string; v?: string }[];
  steps: string[];
}

export interface SteppedActivityEntry {
  seq: number;
  kind: "sys" | "out" | "in" | "warn";
  nodeId: OrchestrationNodeId;
  text: string;
}

export interface SteppedViewModel {
  workflowId: string;
  caseNumber?: string;
  status: OrchestrationStatus;
  nodes: SteppedNode[];
  verdict?: SteppedVerdict;
  activity: SteppedActivityEntry[];
  /** Guardrail stage available (or run reached a terminal state). */
  complete: boolean;
  /** Guardrail needs human approval and no decision has landed yet. */
  guardrailWaiting: boolean;
}

interface NodeDef {
  id: OrchestrationNodeId;
  n: string;
  name: string;
  sub: string;
  icon: SteppedNodeIcon;
  guardrail?: boolean;
}

const NODE_DEFS: NodeDef[] = [
  {
    id: "triage",
    n: "01",
    name: "Triage",
    sub: "priority · severity · write-back",
    icon: "search"
  },
  {
    id: "customer_history",
    n: "02",
    name: "Customer Context",
    sub: "account · warranty · incidents",
    icon: "user"
  },
  {
    id: "knowledge",
    n: "03",
    name: "Knowledge Base",
    sub: "RAG query · approved guidance",
    icon: "book"
  },
  {
    id: "parts_logistics",
    n: "04",
    name: "Parts & Logistics",
    sub: "warehouse · inventory · ETA",
    icon: "box"
  },
  {
    id: "scheduling",
    n: "05",
    name: "Scheduling",
    sub: "technician · skill · window",
    icon: "cal"
  },
  {
    id: "guardrail",
    n: "06",
    name: "Compliance & Guardrail",
    sub: "entitlement · policy · approval",
    icon: "shield",
    guardrail: true
  }
];

const NODE_SHORT: Record<OrchestrationNodeId, string> = {
  triage: "Triage",
  customer_history: "Customer Context",
  knowledge: "Knowledge Base",
  parts_logistics: "Parts & Logistics",
  scheduling: "Scheduling",
  guardrail: "Guardrail"
};

function yesNo(value: boolean | undefined): string {
  return value ? "Yes" : "No";
}

function ms(value: number | undefined): string | undefined {
  return typeof value === "number" ? `${value} ms` : undefined;
}

function findingValue(
  finding: OrchestrationFinding<OrchestrationTraceValue> | undefined
): string | undefined {
  if (!finding) return undefined;
  const v = finding.value;
  if (typeof v === "string") return v || undefined;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  return undefined;
}

function eventsForNode(
  events: OrchestrationEvent[],
  node: OrchestrationNodeId
): OrchestrationEvent[] {
  return events
    .filter((event) => event.node === node)
    .sort((a, b) => a.sequence - b.sequence);
}

function traceSection(events: OrchestrationEvent[]): SteppedSection | null {
  if (events.length === 0) return null;
  const items: SteppedTraceStep[] = events.map((event) => ({
    label: event.safeSummary ?? event.status,
    status: event.status,
    fields: (event.details ?? []).map((detail) => ({
      k: detail.label,
      v: detail.value
    }))
  }));
  return { type: "trace", items };
}

function buildTriage(
  triage: OrchestrationTriage | undefined,
  trace: SteppedSection | null
): { output?: string; latency?: string; detail: SteppedSection[] } {
  if (!triage) {
    return { detail: trace ? [trace] : [] };
  }
  const detail: SteppedSection[] = [
    {
      type: "summary",
      text: [
        triage.summary,
        triage.suggestedNextStep ? `Next: ${triage.suggestedNextStep}` : ""
      ]
        .filter(Boolean)
        .join(" ")
    },
    {
      type: "fields",
      items: [
        { k: "Priority", v: triage.recommendedPriority },
        { k: "Provider", v: triage.provider || "—" },
        { k: "Model", v: triage.model || "—" },
        { k: "Fallback", v: yesNo(triage.fallbackUsed) },
        { k: "Latency", v: ms(triage.latencyMs) ?? "—" }
      ]
    }
  ];
  if (trace) detail.push(trace);
  return {
    output: `${triage.recommendedPriority} priority`,
    latency: ms(triage.latencyMs),
    detail
  };
}

function buildCustomerContext(
  context: OrchestrationCustomerContext | undefined,
  trace: SteppedSection | null
): { output?: string; detail: SteppedSection[] } {
  if (!context) return { detail: trace ? [trace] : [] };
  const pkg = context.package;
  const risk = findingValue(pkg?.businessRisk);
  const repeat = pkg?.repeatIncident?.value;
  const detail: SteppedSection[] = [];

  if (!context.eligible) {
    detail.push({
      type: "summary",
      text: context.eligibilityReason ?? "Customer context lookup was skipped."
    });
  } else {
    detail.push({
      type: "summary",
      text: `Customer context package eligible.${risk ? ` Business risk graded ${risk}.` : ""}${
        repeat?.repeat
          ? ` Repeat failure triggered with ${repeat.count} incidents in ${repeat.windowDays} days.`
          : ""
      }`
    });
  }

  if (pkg) {
    const fields: SteppedField[] = [
      { k: "Eligible", v: yesNo(context.eligible) }
    ];
    const push = (
      k: string,
      finding: OrchestrationFinding<OrchestrationTraceValue> | undefined
    ) => {
      const v = findingValue(finding);
      if (v) fields.push({ k, v, h: finding?.evidenceBasis });
    };
    if (risk) {
      fields.push({
        k: "Business risk",
        v: risk,
        h: pkg.businessRisk.evidenceBasis
      });
    }
    if (repeat) {
      fields.push({
        k: "Repeat failure",
        v: repeat.repeat ? "Triggered" : "None",
        h: `${repeat.count} incidents in ${repeat.windowDays} days`
      });
    }
    push("Strategic account", pkg.strategicAccount);
    if (pkg.installedAssets) {
      fields.push({
        k: "Assets found",
        v: String(pkg.installedAssets.value.totalAssets),
        h: pkg.installedAssets.evidenceBasis
      });
    }
    if (pkg.openIncidentCount) {
      fields.push({
        k: "Open incidents",
        v: String(pkg.openIncidentCount.value),
        h: pkg.openIncidentCount.evidenceBasis
      });
    }
    if (pkg.escalationHistory) {
      fields.push({
        k: "Prior escalations",
        v: String(pkg.escalationHistory.value)
      });
    }
    push("Customer tier", pkg.customerTier);
    push("SLA", pkg.slaClass);
    push("Warranty", pkg.warrantyStatus);
    detail.push({ type: "fields", items: fields });
  }

  if (context.degraded && context.degradedSources?.length) {
    detail.push({
      type: "note",
      text: `Degraded sources: ${context.degradedSources.join(", ")}`
    });
  }
  if (trace) detail.push(trace);

  const output = context.eligible
    ? `${risk ?? "context"} business risk${repeat?.repeat ? ` · repeat ×${repeat.count}` : ""}`
    : "Skipped";
  return { output, detail };
}

function buildKnowledge(
  knowledge: OrchestrationKnowledgeGuidance | undefined,
  trace: SteppedSection | null
): { output?: string; latency?: string; detail: SteppedSection[] } {
  if (!knowledge) return { detail: trace ? [trace] : [] };
  const answer = knowledge.answer;
  const detail: SteppedSection[] = [
    {
      type: "summary",
      text:
        answer?.displaySummary ??
        answer?.safeSummary ??
        knowledge.eligibilityReason ??
        "Knowledge retrieval executed."
    }
  ];

  if (answer) {
    detail.push({
      type: "fields",
      items: [
        {
          k: "Status",
          v: knowledge.status ?? "—",
          h: `Degraded: ${yesNo(knowledge.degraded)}`
        },
        {
          k: "Sources found",
          v: String(answer.sources.length),
          h: answer.retrievalId
            ? `Retrieval id: ${answer.retrievalId}`
            : undefined
        },
        { k: "Guidance confidence", v: answer.guidanceConfidence ?? "—" },
        { k: "Provider", v: answer.provider ?? "—" },
        {
          k: "Latency",
          v: ms(answer.latencyMs) ?? "—",
          h: answer.embeddingProvider
            ? `Embeddings: ${answer.embeddingProvider}`
            : undefined
        }
      ]
    });
    if (answer.recommendedActions?.length) {
      detail.push({
        type: "list",
        title: "Recommended actions",
        items: answer.recommendedActions.map((action) => ({
          title: action.actionType,
          tags: [
            { t: action.confidence },
            ...(action.requiredApproval
              ? [{ t: "approval", tone: "amber" as const }]
              : [])
          ],
          desc: action.rationale
        }))
      });
    }
    if (answer.suggestedParts?.length) {
      detail.push({
        type: "list",
        title: "Suggested parts",
        items: answer.suggestedParts.map((part) => ({
          title: part.partNumber,
          tags: [{ t: part.confidence }],
          meta: part.description
        }))
      });
    }
    if (answer.safetyFlags?.length) {
      detail.push({
        type: "list",
        title: "Safety flags",
        items: answer.safetyFlags.map((flag) => ({
          title: flag.code,
          tags: [
            {
              t: flag.severity,
              tone: flag.severity === "info" ? undefined : ("amber" as const)
            }
          ],
          desc: flag.message
        }))
      });
    }
    detail.push({
      type: "list",
      title: `Sources (${answer.sources.length})`,
      items: answer.sources.map((source) => ({
        title: source.title,
        meta: [
          typeof source.retrievalScorePercentile === "number"
            ? `Score ${source.retrievalScorePercentile}`
            : "",
          source.version ? `Version ${source.version}` : ""
        ]
          .filter(Boolean)
          .join(" · ")
      }))
    });
  }
  if (trace) detail.push(trace);

  const output = `${knowledge.status ?? "—"} · ${answer?.sources.length ?? 0} sources${
    answer?.guidanceConfidence
      ? ` · ${answer.guidanceConfidence} confidence`
      : ""
  }`;
  return { output, latency: ms(answer?.latencyMs), detail };
}

function buildParts(
  parts: OrchestrationPartsLogistics | undefined,
  trace: SteppedSection | null
): { output?: string; detail: SteppedSection[] } {
  if (!parts) return { detail: trace ? [trace] : [] };
  const plans = parts.partPlans ?? [];
  const first = plans[0];
  const detail: SteppedSection[] = [
    {
      type: "summary",
      text: parts.eligible
        ? `Fulfillment planning executed.${
            first
              ? ` ${first.partNumber} ${first.availability}${
                  first.fulfillmentWarehouseReference
                    ? ` at ${first.fulfillmentWarehouseReference}`
                    : ""
                }.`
              : ""
          }`
        : (parts.eligibilityReason ?? "Parts planning skipped.")
    },
    {
      type: "fields",
      items: [
        {
          k: "Status",
          v: parts.status ?? "—",
          h: `Degraded: ${yesNo(parts.degraded)}`
        },
        { k: "Fulfillment readiness", v: parts.fulfillmentReadiness ?? "—" },
        { k: "Fulfillment confidence", v: parts.fulfillmentConfidence ?? "—" },
        { k: "Parts planned", v: String(plans.length) },
        ...(parts.kbCrossCheck
          ? [
              {
                k: "KB cross-check",
                v: parts.kbCrossCheck.status,
                h: `Aligned ${parts.kbCrossCheck.alignedCount} · Divergent ${parts.kbCrossCheck.divergentCount} · Undocumented ${parts.kbCrossCheck.undocumentedCount}`
              }
            ]
          : []),
        ...(parts.provider ? [{ k: "Provider", v: parts.provider }] : [])
      ]
    }
  ];
  if (plans.length) {
    detail.push({
      type: "list",
      title: `Part plans (${plans.length})`,
      items: plans.map((plan) => ({
        title: [plan.partNumber, plan.partName].filter(Boolean).join(" · "),
        tags: plan.kbWarehouseAlignment
          ? [{ t: `KB ${plan.kbWarehouseAlignment}` }]
          : undefined,
        meta: [
          `Availability: ${plan.availability}`,
          plan.estimatedArrivalWindow
            ? `ETA ${plan.estimatedArrivalWindow}`
            : "",
          plan.fulfillmentWarehouseReference
            ? `WH ${plan.fulfillmentWarehouseReference}`
            : ""
        ]
          .filter(Boolean)
          .join(" · "),
        desc: plan.rationale
      }))
    });
  }
  if (trace) detail.push(trace);

  const output = first
    ? `${first.partNumber} ${first.availability}${
        first.fulfillmentWarehouseReference
          ? ` · ${first.fulfillmentWarehouseReference}`
          : ""
      }`
    : (parts.status ?? "—");
  return { output, detail };
}

function buildScheduling(
  scheduling: OrchestrationScheduling | undefined,
  trace: SteppedSection | null
): { output?: string; detail: SteppedSection[] } {
  if (!scheduling) return { detail: trace ? [trace] : [] };
  const candidates = scheduling.candidates ?? [];
  const window = scheduling.proposedWindow;
  const detail: SteppedSection[] = [
    {
      type: "summary",
      text: scheduling.eligible
        ? `Technician ranking and service-window planning executed.${
            scheduling.recommendedResourceReference
              ? ` ${scheduling.recommendedResourceReference} proposed${
                  window?.displayWindow ? ` for ${window.displayWindow}` : ""
                }.`
              : ""
          }`
        : (scheduling.eligibilityReason ?? "Scheduling skipped.")
    },
    {
      type: "fields",
      items: [
        { k: "Readiness", v: scheduling.schedulingReadiness ?? "—" },
        {
          k: "Recommended technician",
          v: scheduling.recommendedResourceReference ?? "—"
        },
        {
          k: "Proposed window",
          v: window?.displayWindow ?? window?.proposedStart ?? "—",
          h: window?.partsEtaConstrained ? "gated on parts ETA" : undefined
        },
        {
          k: "Parts readiness seen",
          v: scheduling.partsReadinessSeen ?? "—",
          h: scheduling.partsEtaConsidered
            ? "Parts ETA considered in gating"
            : undefined
        },
        { k: "Status", v: scheduling.status ?? "—" }
      ]
    }
  ];
  if (candidates.length) {
    detail.push({
      type: "list",
      title: `Ranked technicians (${candidates.length})`,
      items: candidates.map((candidate) => ({
        title: [
          `#${candidate.rank}`,
          candidate.resourceReference,
          candidate.territoryMembership
            ? `${candidate.territoryReference ?? "territory"} (${candidate.territoryMembership})`
            : candidate.territoryReference
        ]
          .filter(Boolean)
          .join(" · "),
        tags: [{ t: `rank ${candidate.rankScore}` }],
        meta: [
          candidate.matchedSkills.length
            ? `Skills: ${candidate.matchedSkills.join(", ")}`
            : "",
          candidate.earliestAvailableAt
            ? `Earliest ${candidate.earliestAvailableAt}`
            : ""
        ]
          .filter(Boolean)
          .join(" · "),
        desc: candidate.rationale
      }))
    });
    detail.push({
      type: "note",
      text: "Point-in-time plan: readiness reflects parts availability as of this run. Technician identity is a sanitized reference, never a full name."
    });
  }
  if (trace) detail.push(trace);

  const output = scheduling.recommendedResourceReference
    ? `${scheduling.recommendedResourceReference}${
        window?.displayWindow ? ` · ${window.displayWindow}` : ""
      }`
    : (scheduling.status ?? "—");
  return { output, detail };
}

const GUARDRAIL_OUTCOME_LABEL: Record<string, string> = {
  autoApprove: "Auto-approved",
  requireHumanApproval: "Approval required",
  reject: "Rejected",
  escalate: "Escalated"
};

function buildGuardrail(
  guardrail: OrchestrationGuardrail | undefined,
  decided: boolean,
  trace: SteppedSection | null
): { output?: string; detail: SteppedSection[] } {
  if (!guardrail) return { detail: trace ? [trace] : [] };
  const outcomeLabel =
    GUARDRAIL_OUTCOME_LABEL[guardrail.outcome] ?? guardrail.outcome;
  const detail: SteppedSection[] = [
    {
      type: "summary",
      text: `Composite policy evaluated across upstream channels. ${outcomeLabel} (risk ${guardrail.riskScore}, ${guardrail.riskLevel}).${
        guardrail.requiresHumanApproval
          ? " Approvals happen out of band — this console is read-only."
          : ""
      }`
    },
    {
      type: "fields",
      items: [
        { k: "Outcome", v: outcomeLabel },
        { k: "Risk", v: `${guardrail.riskScore} / ${guardrail.riskLevel}` },
        {
          k: "Triggered rules",
          v: String(
            guardrail.policyRulesTriggered.filter((rule) => rule.triggered)
              .length
          ),
          h: guardrail.channelBasis.length
            ? `Channels: ${guardrail.channelBasis.join(", ")}`
            : undefined
        },
        { k: "Requires approval", v: yesNo(guardrail.requiresHumanApproval) }
      ]
    }
  ];
  const firedRules = guardrail.policyRulesTriggered.filter(
    (rule) => rule.triggered
  );
  if (firedRules.length) {
    detail.push({
      type: "chips",
      items: firedRules.map((rule) => ({ k: rule.ruleId }))
    });
  }
  if (guardrail.approvalReasons.length) {
    detail.push({
      type: "list",
      title: "Approval reasons",
      items: guardrail.approvalReasons.map((reason) => ({ title: reason }))
    });
  }
  if (trace) detail.push(trace);

  const output = `${outcomeLabel} · risk ${guardrail.riskScore}/${guardrail.riskLevel}`;
  void decided;
  return { output, detail };
}

function buildVerdict(
  verdict: OrchestrationVerdict | undefined
): SteppedVerdict | undefined {
  if (!verdict) return undefined;
  return {
    headline: verdict.headline,
    summary: verdict.summary,
    meta: verdict.generatedAt,
    chips: verdict.highlights.map((highlight) => ({
      k: highlight.label,
      v: highlight.value
    })),
    steps: verdict.recommendedSteps
  };
}

const ACTIVITY_KIND: Record<OrchestrationStatus, SteppedActivityEntry["kind"]> =
  {
    assigned: "sys",
    running: "out",
    awaiting_step: "sys",
    done: "in",
    waiting_approval: "warn",
    rejected: "warn",
    escalated: "warn",
    stopped: "warn",
    failed: "warn"
  };

function buildActivity(events: OrchestrationEvent[]): SteppedActivityEntry[] {
  return events
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-20)
    .map((event) => ({
      seq: event.sequence,
      kind: ACTIVITY_KIND[event.status] ?? "sys",
      nodeId: event.node ?? "triage",
      text: `${NODE_SHORT[event.node ?? "triage"]} · ${event.safeSummary ?? event.status}`
    }));
}

/**
 * True when this workflow was started in stepped mode (manual advance), not
 * the Salesforce auto-trigger full run.
 */
export function isSteppedSnapshot(
  snapshot: Pick<OrchestrationSnapshot, "status" | "events">
): boolean {
  if (snapshot.status === "awaiting_step") return true;
  return (snapshot.events ?? []).some((event) => event.status === "awaiting_step");
}

/**
 * How many spine stages should be visible for the current snapshot. On refresh
 * this re-hydrates client reveal state from real backend progress instead of
 * resetting to step one. Only applies to stepped-mode workflows.
 */
export function computeRevealedProgress(
  nodes: SteppedNode[],
  snapshot: Pick<OrchestrationSnapshot, "status" | "node" | "events">
): number {
  if (snapshot.status === "awaiting_step") {
    const awaitingIndex = nodes.findIndex((node) => node.id === snapshot.node);
    return awaitingIndex >= 0 ? awaitingIndex : 0;
  }

  if (
    (snapshot.status === "running" || snapshot.status === "assigned") &&
    snapshot.node === "triage"
  ) {
    return 0;
  }

  if (!isSteppedSnapshot(snapshot)) return 0;

  let count = 0;
  for (const node of nodes) {
    if (!node.available) break;
    count++;
  }
  return count;
}

/** Activity log entries for stages the spine has already revealed. */
export function filterActivityForRevealed(
  activity: SteppedActivityEntry[],
  nodes: SteppedNode[],
  revealed: number
): SteppedActivityEntry[] {
  const revealedIds = new Set(nodes.slice(0, revealed).map((node) => node.id));
  return activity.filter((entry) => revealedIds.has(entry.nodeId));
}

function isFrontierPauseEntry(entry: SteppedActivityEntry): boolean {
  return (
    entry.kind === "sys" && entry.text.includes("Stage complete — awaiting Run")
  );
}

function nextSyntheticSeq(
  activity: SteppedActivityEntry[],
  offset = 1
): number {
  const max = activity.reduce((highest, entry) => Math.max(highest, entry.seq), 0);
  return max + offset;
}

/**
 * Activity log aligned with the orchestrator frontier. When paused at
 * `awaiting_step`, collapse the just-finished stage to a completion line and
 * surface frontier pause + dispatch-ready entries instead of trailing in-flight
 * trace lines from that stage.
 */
export function buildVisibleActivity(
  activity: SteppedActivityEntry[],
  nodes: SteppedNode[],
  revealed: number,
  snapshot: Pick<OrchestrationSnapshot, "status" | "node">
): SteppedActivityEntry[] {
  if (snapshot.status === "awaiting_step" && snapshot.node) {
    const awaitingIndex = nodes.findIndex((node) => node.id === snapshot.node);
    if (awaitingIndex < 0) {
      return filterActivityForRevealed(activity, nodes, revealed);
    }

    const priorIds = new Set(
      nodes.slice(0, Math.max(0, awaitingIndex - 1)).map((node) => node.id)
    );
    const result = activity.filter((entry) => priorIds.has(entry.nodeId));

    const completedNode =
      awaitingIndex > 0 ? nodes[awaitingIndex - 1] : undefined;
    if (completedNode) {
      result.push({
        seq: nextSyntheticSeq(activity),
        kind: "in",
        nodeId: completedNode.id,
        text: `${NODE_SHORT[completedNode.id]} · complete`
      });
    }

    const frontierPauses = activity.filter(
      (entry) => entry.nodeId === snapshot.node && isFrontierPauseEntry(entry)
    );
    result.push(...frontierPauses);

    const frontierName = nodes[awaitingIndex]?.name ?? "next stage";
    result.push({
      seq: nextSyntheticSeq([...activity, ...result], 2),
      kind: "out",
      nodeId: snapshot.node,
      text: `Ready to dispatch → ${frontierName}`
    });

    return result.sort((a, b) => a.seq - b.seq);
  }

  if (
    (snapshot.status === "running" || snapshot.status === "assigned") &&
    snapshot.node
  ) {
    const activeIndex = nodes.findIndex((node) => node.id === snapshot.node);
    const visibleIds = new Set(
      nodes
        .slice(0, activeIndex >= 0 ? activeIndex + 1 : revealed)
        .map((node) => node.id)
    );
    return activity.filter((entry) => visibleIds.has(entry.nodeId));
  }

  return filterActivityForRevealed(activity, nodes, revealed);
}

/**
 * Transform a sanitized snapshot into the stepped console view model.
 */
export function buildSteppedViewModel(
  snapshot: OrchestrationSnapshot
): SteppedViewModel {
  const events = snapshot.events ?? [];
  const decided = Boolean(snapshot.approvalDecision);

  const builders: Record<
    OrchestrationNodeId,
    () => { output?: string; latency?: string; detail: SteppedSection[] }
  > = {
    triage: () =>
      buildTriage(
        snapshot.triage,
        traceSection(eventsForNode(events, "triage"))
      ),
    customer_history: () =>
      buildCustomerContext(
        snapshot.customerContext,
        traceSection(eventsForNode(events, "customer_history"))
      ),
    knowledge: () =>
      buildKnowledge(
        snapshot.knowledgeGuidance,
        traceSection(eventsForNode(events, "knowledge"))
      ),
    parts_logistics: () =>
      buildParts(
        snapshot.partsLogistics,
        traceSection(eventsForNode(events, "parts_logistics"))
      ),
    scheduling: () =>
      buildScheduling(
        snapshot.scheduling,
        traceSection(eventsForNode(events, "scheduling"))
      ),
    guardrail: () =>
      buildGuardrail(
        snapshot.guardrail,
        decided,
        traceSection(eventsForNode(events, "guardrail"))
      )
  };

  const payloadPresent: Record<OrchestrationNodeId, boolean> = {
    triage: Boolean(snapshot.triage),
    customer_history: Boolean(snapshot.customerContext),
    knowledge: Boolean(snapshot.knowledgeGuidance),
    parts_logistics: Boolean(snapshot.partsLogistics),
    scheduling: Boolean(snapshot.scheduling),
    guardrail: Boolean(snapshot.guardrail)
  };

  const nodes: SteppedNode[] = NODE_DEFS.map((def) => {
    const built = builders[def.id]();
    const eventDone = events.some(
      (event) => event.node === def.id && event.status === "done"
    );
    return {
      id: def.id,
      n: def.n,
      name: def.name,
      sub: def.sub,
      icon: def.icon,
      guardrail: def.guardrail,
      available: payloadPresent[def.id] || eventDone,
      output: built.output,
      latency: built.latency,
      detail: built.detail
    };
  });

  const guardrailWaiting =
    Boolean(snapshot.guardrail?.requiresHumanApproval) &&
    !decided &&
    snapshot.status === "waiting_approval";

  return {
    workflowId: snapshot.workflowId,
    caseNumber: snapshot.caseNumber,
    status: snapshot.status,
    nodes,
    verdict: buildVerdict(snapshot.orchestratorVerdict),
    activity: buildActivity(events),
    complete:
      payloadPresent.guardrail ||
      snapshot.status === "done" ||
      snapshot.status === "rejected" ||
      snapshot.status === "escalated",
    guardrailWaiting
  };
}

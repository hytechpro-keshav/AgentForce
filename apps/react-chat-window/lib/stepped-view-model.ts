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
  OrchestrationVerdict,
  TriagePriority,
  TriagePriorityFactor
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
  /** Stable ordering key from orchestration events (when present). */
  sequence?: number;
  fields: { k: string; v: string }[];
}

export type SteppedSection =
  | { type: "summary"; text: string }
  | { type: "fields"; items: SteppedField[] }
  | { type: "list"; title: string; items: SteppedListItem[] }
  | { type: "chips"; items: { k: string; v?: string }[] }
  | { type: "note"; text: string }
  | { type: "trace"; items: SteppedTraceStep[] };

export type TriageBadgeTone =
  | "critical"
  | "high"
  | "normal"
  | "low"
  | "mediumRisk"
  | "highRisk"
  | "repeatYes"
  | "repeatNo";

export interface TriageInsightBadge {
  label: string;
  tone: TriageBadgeTone;
}

export interface SteppedTriageInsight {
  priority: TriagePriority;
  summary: string;
  priorityRationale?: string;
  priorityFactors?: TriagePriorityFactor[];
  badges: TriageInsightBadge[];
}

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
  /** Priority badge shown on the Triage row header when done. */
  priorityBadge?: TriagePriority;
  /** Triage-only workflow completion confidence (0–100). */
  workflowConfidence?: number;
  confidenceFactors?: TriagePriorityFactor[];
  humanInterventionRecommended?: boolean;
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
  /** Renumbered 1…n for operator-facing ACTIVITY log (optional). */
  displaySeq?: number;
  kind: "sys" | "out" | "in" | "warn";
  nodeId: OrchestrationNodeId;
  text: string;
}

export interface SteppedViewModel {
  workflowId: string;
  caseNumber?: string;
  status: OrchestrationStatus;
  nodes: SteppedNode[];
  triageInsight?: SteppedTriageInsight;
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
    sub: "priority · case · customer context",
    icon: "search"
  },
  // customer_history removed from visible spine; kept in NODE_SHORT/builders/payloadPresent for enum exhaustiveness
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

/** UI-only denylist — backend payloads unchanged; hidden in stepped accordion/trace. */
export const HIDDEN_STEPPED_FIELD_LABELS = new Set([
  "Priority",
  "Recommended priority",
  "Provider",
  "Model",
  "Fallback",
  "Latency",
  "Business risk",
  "Repeat failure",
  "Customer tier",
  "SLA",
  "Warranty",
  "Strategic account",
  "Installed assets",
  "Assets found",
  "Open incidents",
  "Prior escalations"
]);

export function isHiddenSteppedUiField(label: string): boolean {
  return HIDDEN_STEPPED_FIELD_LABELS.has(label);
}

function filterVisibleFields(fields: SteppedField[]): SteppedField[] {
  return fields.filter((field) => !isHiddenSteppedUiField(field.k));
}

function filterTraceStepFields(
  fields: { k: string; v: string }[]
): { k: string; v: string }[] {
  return fields.filter((field) => !isHiddenSteppedUiField(field.k));
}

function finalizeDetail(
  sections: SteppedSection[],
  trace: SteppedSection | null
): SteppedSection[] {
  return trace ? [trace, ...sections] : sections;
}

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
  const progressEvents = events.filter((event) => event.status !== "awaiting_step");
  if (progressEvents.length === 0) return null;
  const items: SteppedTraceStep[] = progressEvents.map((event) => ({
    label: event.safeSummary ?? event.status,
    status: event.status,
    sequence: event.sequence,
    fields: filterTraceStepFields(
      (event.details ?? []).map((detail) => ({
        k: detail.label,
        v: detail.value
      }))
    )
  }));
  return { type: "trace", items };
}

function priorityBadgeTone(priority: TriagePriority): TriageBadgeTone {
  if (priority === "critical") return "critical";
  if (priority === "high") return "high";
  if (priority === "low") return "low";
  return "normal";
}

function businessRiskBadgeTone(risk: string): TriageBadgeTone {
  if (risk === "high") return "highRisk";
  if (risk === "medium") return "mediumRisk";
  return "normal";
}

function buildTriageInsight(
  triage: OrchestrationTriage | undefined,
  customerContext: OrchestrationCustomerContext | undefined
): SteppedTriageInsight | undefined {
  if (!triage) return undefined;

  const badges: TriageInsightBadge[] = [
    {
      label: triage.recommendedPriority.toUpperCase(),
      tone: priorityBadgeTone(triage.recommendedPriority)
    }
  ];

  const risk = findingValue(customerContext?.package?.businessRisk);
  if (risk) {
    badges.push({
      label: `${risk.toUpperCase()} RISK`,
      tone: businessRiskBadgeTone(risk)
    });
  }

  const repeat = customerContext?.package?.repeatIncident?.value;
  badges.push({
    label: repeat?.repeat ? "REPEAT" : "NO REPEAT",
    tone: repeat?.repeat ? "repeatYes" : "repeatNo"
  });

  return {
    priority: triage.recommendedPriority,
    summary: triage.summary,
    priorityRationale: triage.priorityRationale,
    priorityFactors: triage.priorityFactors,
    badges
  };
}

function buildTriage(
  triage: OrchestrationTriage | undefined,
  customerContext: OrchestrationCustomerContext | undefined,
  trace: SteppedSection | null
): {
  output?: string;
  latency?: string;
  priorityBadge?: TriagePriority;
  workflowConfidence?: number;
  confidenceFactors?: TriagePriorityFactor[];
  humanInterventionRecommended?: boolean;
  detail: SteppedSection[];
} {
  if (!triage) {
    return { detail: trace ? [trace] : [] };
  }
  const detail: SteppedSection[] = [
    {
      type: "summary",
      text: triage.summary
    }
  ];
  if (triage.priorityRationale) {
    detail.push({
      type: "note",
      text: triage.priorityRationale
    });
  }
  if (triage.suggestedNextStep) {
    detail.push({
      type: "note",
      text: `Next: ${triage.suggestedNextStep}`
    });
  } else if (customerContext && !customerContext.eligible) {
    detail.push({
      type: "note",
      text: customerContext.eligibilityReason ?? "Customer context lookup was skipped."
    });
  }

  const summaryOutput =
    triage.summary.length > 80
      ? `${triage.summary.slice(0, 77)}…`
      : triage.summary;
  return {
    output: summaryOutput,
    latency: ms(triage.latencyMs),
    priorityBadge: triage.recommendedPriority,
    workflowConfidence: triage.workflowConfidence,
    confidenceFactors: triage.confidenceFactors,
    humanInterventionRecommended: triage.humanInterventionRecommended,
    detail: finalizeDetail(detail, trace)
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
    const visible = filterVisibleFields(fields);
    if (visible.length) {
      detail.push({ type: "fields", items: visible });
    }
  }

  if (context.degraded && context.degradedSources?.length) {
    detail.push({
      type: "note",
      text: `Degraded sources: ${context.degradedSources.join(", ")}`
    });
  }

  const output = context.eligible
    ? `${risk ?? "context"} business risk${repeat?.repeat ? ` · repeat ×${repeat.count}` : ""}`
    : "Skipped";
  return { output, detail: finalizeDetail(detail, trace) };
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
    const knowledgeFields = filterVisibleFields([
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
    ]);
    if (knowledgeFields.length) {
      detail.push({ type: "fields", items: knowledgeFields });
    }
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

  const output = `${knowledge.status ?? "—"} · ${answer?.sources.length ?? 0} sources${
    answer?.guidanceConfidence
      ? ` · ${answer.guidanceConfidence} confidence`
      : ""
  }`;
  return {
    output,
    latency: ms(answer?.latencyMs),
    detail: finalizeDetail(detail, trace)
  };
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
      items: filterVisibleFields([
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
      ])
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

  const output = first
    ? `${first.partNumber} ${first.availability}${
        first.fulfillmentWarehouseReference
          ? ` · ${first.fulfillmentWarehouseReference}`
          : ""
      }`
    : (parts.status ?? "—");
  return { output, detail: finalizeDetail(detail, trace) };
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

  const output = scheduling.recommendedResourceReference
    ? `${scheduling.recommendedResourceReference}${
        window?.displayWindow ? ` · ${window.displayWindow}` : ""
      }`
    : (scheduling.status ?? "—");
  return { output, detail: finalizeDetail(detail, trace) };
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

  const output = `${outcomeLabel} · risk ${guardrail.riskScore}/${guardrail.riskLevel}`;
  void decided;
  return { output, detail: finalizeDetail(detail, trace) };
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
  return entry.kind === "sys" && isPauseEntry(entry);
}

/** Outbound trace line that is still in-flight (not a pause or completion). */
export function isInFlightTraceEntry(entry: SteppedActivityEntry): boolean {
  if (entry.kind !== "out") return false;
  if (entry.text.includes("· complete")) return false;
  if (entry.text.startsWith("Ready to dispatch")) return false;
  if (isPauseEntry(entry)) return false;
  return true;
}

export function isPauseEntry(entry: SteppedActivityEntry): boolean {
  if (entry.kind !== "sys") return false;
  return (
    entry.text.includes("Stage complete — awaiting Run") ||
    entry.text.includes("press Run for") ||
    entry.text.includes("Workflow ready")
  );
}

/** Tolerate legacy backend pause strings until ai-api deploys Phase E copy. */
export function normalizePauseActivityText(
  text: string,
  completedNode?: Pick<SteppedNode, "name">,
  frontierNode?: Pick<SteppedNode, "name">
): string {
  if (text.includes("awaiting Run for Triage")) {
    return "Workflow ready — press Run for Triage.";
  }
  const legacy = /^Stage complete — awaiting Run for (.+)\.$/.exec(text);
  if (legacy && completedNode && frontierNode) {
    return `${completedNode.name} complete — press Run for ${frontierNode.name}.`;
  }
  return text;
}

function withDisplaySeq(
  entries: SteppedActivityEntry[]
): SteppedActivityEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    displaySeq: index + 1
  }));
}

function collapseStageActivity(
  nodes: SteppedNode[],
  revealed: number
): SteppedActivityEntry[] {
  return nodes.slice(0, revealed).map((node, index) => ({
    seq: index + 1,
    kind: "in" as const,
    nodeId: node.id,
    text: `← ${NODE_SHORT[node.id]} · complete`
  }));
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
  if (
    snapshot.status === "done" ||
    snapshot.status === "rejected" ||
    snapshot.status === "escalated"
  ) {
    const summary = collapseStageActivity(nodes, revealed);
    const terminal = activity
      .filter(
        (entry) =>
          entry.kind === "warn" ||
          (entry.kind === "in" && !entry.text.includes("· complete"))
      )
      .filter((entry) => !isInFlightTraceEntry(entry))
      .slice(-1);
    return withDisplaySeq([...summary, ...terminal]);
  }

  if (snapshot.status === "awaiting_step" && snapshot.node) {
    const awaitingIndex = nodes.findIndex((node) => node.id === snapshot.node);
    if (awaitingIndex < 0) {
      return withDisplaySeq(
        filterActivityForRevealed(activity, nodes, revealed)
      );
    }

    // Spine still animating — don't leak future-stage dispatch lines.
    if (revealed < awaitingIndex) {
      return withDisplaySeq(
        filterActivityForRevealed(activity, nodes, revealed).filter(
          (entry) => !isInFlightTraceEntry(entry)
        )
      );
    }

    const priorIds = new Set(
      nodes.slice(0, Math.max(0, awaitingIndex - 1)).map((node) => node.id)
    );
    const result = activity.filter((entry) => {
      if (!priorIds.has(entry.nodeId)) return false;
      if (isInFlightTraceEntry(entry)) return false;
      return true;
    });

    const completedNode =
      awaitingIndex > 0 ? nodes[awaitingIndex - 1] : undefined;
    const frontierNode = nodes[awaitingIndex];
    if (completedNode) {
      result.push({
        seq: nextSyntheticSeq(activity),
        kind: "in",
        nodeId: completedNode.id,
        text: `← ${NODE_SHORT[completedNode.id]} · complete`
      });
    }

    const frontierPauses = activity
      .filter(
        (entry) => entry.nodeId === snapshot.node && isFrontierPauseEntry(entry)
      )
      .map((entry) => ({
        ...entry,
        text: normalizePauseActivityText(
          entry.text,
          completedNode,
          frontierNode
        )
      }));
    result.push(...frontierPauses);

    const frontierName = frontierNode?.name ?? "next stage";
    result.push({
      seq: nextSyntheticSeq([...activity, ...result], 2),
      kind: "out",
      nodeId: snapshot.node,
      text: `Ready to dispatch → ${frontierName}`
    });

    return withDisplaySeq(result.sort((a, b) => a.seq - b.seq));
  }

  if (
    (snapshot.status === "running" || snapshot.status === "assigned") &&
    snapshot.node
  ) {
    return withDisplaySeq(
      activity.filter((entry) => entry.nodeId === snapshot.node)
    );
  }

  return withDisplaySeq(
    filterActivityForRevealed(activity, nodes, revealed).filter(
      (entry) => !isInFlightTraceEntry(entry)
    )
  );
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
    () => {
      output?: string;
      latency?: string;
      priorityBadge?: TriagePriority;
      workflowConfidence?: number;
      confidenceFactors?: TriagePriorityFactor[];
      humanInterventionRecommended?: boolean;
      detail: SteppedSection[];
    }
  > = {
    triage: () =>
      buildTriage(
        snapshot.triage,
        snapshot.customerContext,
        traceSection(
          [
            ...eventsForNode(events, "triage"),
            ...eventsForNode(events, "customer_history")
          ].sort((a, b) => a.sequence - b.sequence)
        )
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
      priorityBadge: built.priorityBadge,
      workflowConfidence: built.workflowConfidence,
      confidenceFactors: built.confidenceFactors,
      humanInterventionRecommended: built.humanInterventionRecommended,
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
    triageInsight: buildTriageInsight(snapshot.triage, snapshot.customerContext),
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

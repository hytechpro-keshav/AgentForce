import type { CaseTriageStateType } from "./case-triage.graph";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type { SchedulingChannel } from "./dto/scheduling";
import type { GuardrailChannel } from "./dto/guardrail";
import type { SanitizedTriageResult } from "./dto/orchestration-status-event";

/** Five visible UI agents — matches stepped console spine (no Customer History). */
export type AgentNarrativeKey =
  | "triage"
  | "knowledge"
  | "parts"
  | "scheduling"
  | "guardrail";

/** Ordered spine for auto-approval batch posting. */
export const AGENT_NARRATIVE_KEYS: readonly AgentNarrativeKey[] = [
  "triage",
  "knowledge",
  "parts",
  "scheduling",
  "guardrail"
];

const AGENT_LABELS: Record<AgentNarrativeKey, string> = {
  triage: "Agent 1 – Triage",
  knowledge: "Agent 2 – Knowledge Base",
  parts: "Agent 3 – Parts & Logistics",
  scheduling: "Agent 4 – Scheduling",
  guardrail: "Agent 5 – Guardrail"
};

/**
 * Deterministic, non-PII Case comment body for one visible agent stage.
 * Returns `undefined` when there is nothing meaningful to post.
 */
export function buildAgentCaseNarrative(
  agentKey: AgentNarrativeKey,
  state: CaseTriageStateType
): string | undefined {
  switch (agentKey) {
    case "triage":
      return buildTriageNarrative(state.triage, state.customerContext);
    case "knowledge":
      return buildKnowledgeNarrative(state.knowledgeGuidance);
    case "parts":
      return buildPartsNarrative(state.partsLogistics);
    case "scheduling":
      return buildSchedulingNarrative(state.scheduling);
    case "guardrail":
      return buildGuardrailNarrative(state.guardrail);
    default:
      return undefined;
  }
}

function prefix(agentKey: AgentNarrativeKey, body: string): string {
  return `${AGENT_LABELS[agentKey]}: ${body}`.slice(0, 4000);
}

function buildTriageNarrative(
  triage: SanitizedTriageResult | undefined,
  customerContext: CustomerContextChannel | undefined
): string | undefined {
  if (!triage) {
    return undefined;
  }
  const priority = capitalize(triage.recommendedPriority);
  const parts: string[] = [
    `Case classified as ${priority} priority.`
  ];

  if (triage.summary?.trim()) {
    parts.push(clipSentence(triage.summary.trim()) + ".");
  }

  const pkg = customerContext?.package;
  if (pkg) {
    const risk = pkg.businessRisk?.value;
    const warranty = pkg.warrantyStatus?.value;
    const repeat = pkg.repeatIncident?.value;
    const contextBits: string[] = [];
    if (risk) {
      contextBits.push(`${capitalize(risk)} business risk`);
    }
    if (warranty) {
      contextBits.push(`warranty ${warranty}`);
    }
    if (repeat) {
      contextBits.push(
        repeat.repeat
          ? `repeat failure (${repeat.count} in recent window)`
          : "no repeat failure in the recent window"
      );
    }
    if (contextBits.length > 0) {
      parts.push(`Customer context reviewed: ${contextBits.join(", ")}.`);
    }
  } else if (customerContext?.eligible === false) {
    parts.push(
      "Customer context was not eligible for this case; triage used case details only."
    );
  }

  if (triage.suggestedNextStep?.trim()) {
    parts.push(`Next: ${clipSentence(triage.suggestedNextStep.trim())}.`);
  }

  return prefix("triage", parts.join(" "));
}

function buildKnowledgeNarrative(
  knowledge: KnowledgeGuidanceChannel | undefined
): string | undefined {
  if (!knowledge) {
    return undefined;
  }
  if (knowledge.eligible === false) {
    return prefix(
      "knowledge",
      `Knowledge retrieval skipped (${knowledge.eligibilityReason ?? "not eligible"}).`
    );
  }
  if (knowledge.degraded) {
    return prefix(
      "knowledge",
      "Knowledge base temporarily unavailable (degraded mode)."
    );
  }
  if (knowledge.status === "NO_SOURCE") {
    return prefix(
      "knowledge",
      "No approved knowledge sources matched this case; no defect conclusion available."
    );
  }
  if (knowledge.status !== "ANSWERED" || !knowledge.answer) {
    return undefined;
  }

  const sourceCount = knowledge.answer.sources?.length ?? 0;
  const conclusion = extractKnowledgeConclusion(knowledge.answer);
  const partRef = knowledge.answer.suggestedParts?.[0]?.partNumber;
  const confidence = knowledge.answer.guidanceConfidence;

  const sentences = [
    `Reviewed ${sourceCount} approved source${sourceCount === 1 ? "" : "s"}.`,
    `Conclusion: ${conclusion}.`
  ];
  if (partRef) {
    sentences.push(`Recommended replace part ${partRef}.`);
  }
  if (confidence) {
    sentences.push(`Guidance confidence: ${confidence}.`);
  } else {
    sentences.push("Technician visit may be required.");
  }

  return prefix("knowledge", sentences.join(" "));
}

function buildPartsNarrative(
  parts: PartsLogisticsChannel | undefined
): string | undefined {
  if (!parts) {
    return undefined;
  }
  if (parts.eligible === false) {
    return prefix(
      "parts",
      `Parts logistics skipped (${parts.eligibilityReason ?? "not eligible"}).`
    );
  }
  if (parts.degraded) {
    return prefix(
      "parts",
      "Inventory reads were incomplete (degraded mode)."
    );
  }

  const primary = parts.partPlans?.[0];
  if (!primary) {
    return prefix("parts", "No parts plan was produced for this case.");
  }

  const eta =
    primary.estimatedArrivalWindow ??
    (primary.estimatedDispatchHoursMin !== undefined &&
    primary.estimatedDispatchHoursMax !== undefined
      ? `${primary.estimatedDispatchHoursMin}–${primary.estimatedDispatchHoursMax} hours`
      : primary.estimatedDispatchHoursMax !== undefined
        ? `${primary.estimatedDispatchHoursMax} hours`
        : undefined);

  if (primary.transferRequired && primary.sourceWarehouseReference) {
    const dest = primary.fulfillmentWarehouseReference ?? "fulfillment warehouse";
    const etaClause = eta ? ` ETA ${eta}.` : "";
    return prefix(
      "parts",
      `Part ${primary.partNumber} requires inter-warehouse transfer from ${primary.sourceWarehouseReference} to ${dest}.${etaClause} Fulfillment status: ${parts.fulfillmentReadiness ?? parts.status ?? "partial"}.`
    );
  }

  if (primary.fulfillmentWarehouseReference) {
    return prefix(
      "parts",
      `Part ${primary.partNumber} is available at ${primary.fulfillmentWarehouseReference}. Fulfillment status: ${parts.fulfillmentReadiness ?? "ready"}.`
    );
  }

  return prefix(
    "parts",
    `Parts plan for ${primary.partNumber}; fulfillment status: ${parts.fulfillmentReadiness ?? parts.status ?? "unknown"}.`
  );
}

function buildSchedulingNarrative(
  scheduling: SchedulingChannel | undefined
): string | undefined {
  if (!scheduling) {
    return undefined;
  }
  if (scheduling.eligible === false) {
    return prefix(
      "scheduling",
      `Scheduling skipped (${scheduling.eligibilityReason ?? "not eligible"}).`
    );
  }
  if (scheduling.degraded) {
    return prefix(
      "scheduling",
      "Field Service reads were incomplete (degraded mode)."
    );
  }

  const ref = scheduling.recommendedResourceReference;
  const window = scheduling.proposedWindow?.displayWindow;
  const readiness = scheduling.schedulingReadiness ?? "unknown";

  if (scheduling.appointmentStatus === "booked" && ref && window) {
    return prefix(
      "scheduling",
      `Service appointment booked for ${ref}, ${window}. Status: confirmed.`
    );
  }
  if (readiness === "provisional" && ref && window) {
    return prefix(
      "scheduling",
      `Tentative appointment created for ${ref}, ${window}, pending parts arrival. Status: provisional.`
    );
  }
  if (readiness === "schedulable" && ref && window) {
    return prefix(
      "scheduling",
      `Appointment proposed for ${ref}, ${window}. Status: schedulable.`
    );
  }
  if (readiness === "deferred") {
    return prefix(
      "scheduling",
      ref
        ? `Scheduling deferred until parts are confirmed; ${ref} is the recommended technician.`
        : "Scheduling deferred until parts are confirmed."
    );
  }
  if (readiness === "unschedulable") {
    return prefix(
      "scheduling",
      "No qualified technician is currently available for this case."
    );
  }

  return prefix("scheduling", `Scheduling status: ${readiness}.`);
}

function buildGuardrailNarrative(
  guardrail: GuardrailChannel | undefined
): string | undefined {
  if (!guardrail || guardrail.eligible === false) {
    return undefined;
  }

  if (guardrail.outcome === "requireHumanApproval") {
    const policyReason =
      guardrail.approvalReasons[0]?.replace(/\.$/, "") ??
      "the composite policy threshold was exceeded";
    return prefix(
      "guardrail",
      `Account Manager approval is required because ${policyReason.toLowerCase()}. Risk score ${guardrail.riskScore} (${guardrail.riskLevel}). Workflow paused until approval in Salesforce.`
    );
  }

  if (guardrail.outcome === "autoApprove") {
    return prefix(
      "guardrail",
      `Case auto-approved (risk score ${guardrail.riskScore}, ${guardrail.riskLevel}); no Account Manager approval required.`
    );
  }
  if (guardrail.outcome === "reject") {
    return prefix(
      "guardrail",
      `Case rejected by compliance policy (risk score ${guardrail.riskScore}, ${guardrail.riskLevel}).`
    );
  }
  if (guardrail.outcome === "escalate") {
    return prefix(
      "guardrail",
      `Case escalated for supervisor review (risk score ${guardrail.riskScore}, ${guardrail.riskLevel}).`
    );
  }

  return undefined;
}

function extractKnowledgeConclusion(
  answer: NonNullable<KnowledgeGuidanceChannel["answer"]>
): string {
  const fromAction = answer.recommendedActions?.find(
    (a) => a.rationale?.trim()
  )?.rationale;
  if (fromAction) {
    return clipSentence(fromAction);
  }
  const raw = answer.safeSummary?.trim() ?? "";
  if (!raw) {
    return "review matched guidance for the likely defect and fix path";
  }
  // Prefer the first non-numbered line — avoid dumping multi-article safeSummary blobs.
  const firstLine = raw
    .split(/\n+/)
    .map((line) => line.replace(/^\[\d+\]\s*/, "").trim())
    .find((line) => line.length > 0);
  return clipSentence(firstLine ?? raw);
}

/** One short sentence for Case comments — no article dumps or multi-paragraph blobs. */
function clipSentence(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  const firstSentence = oneLine.split(/(?<=[.!?])\s+/)[0] ?? oneLine;
  const clipped = firstSentence.length > 220 ? `${firstSentence.slice(0, 217).trimEnd()}…` : firstSentence;
  return clipped.replace(/\.$/, "");
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

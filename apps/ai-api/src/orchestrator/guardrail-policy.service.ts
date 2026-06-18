import { Injectable } from "@nestjs/common";

import type { CaseTriageStateType } from "./case-triage.graph";
import type {
  GuardrailChannelSource,
  GuardrailDecision,
  GuardrailOutcome,
  GuardrailPolicyRule,
  GuardrailRiskLevel
} from "./dto/guardrail";

/**
 * Node 6 — composite, deterministic guardrail policy.
 *
 * `evaluate(state)` is PURE: no Salesforce access, no LLM, no randomness,
 * no clock reads, no throws. The same `state` always yields the same
 * `GuardrailDecision`. This is mandatory — the `evaluateGuardrail` node
 * re-runs its pre-interrupt code on every resume, so a non-deterministic
 * policy could flip the outcome on resume (phase plan §11 R1).
 *
 * The matrix reads TYPED FIELD VALUES AND BOOLEAN FLAGS ONLY — never
 * `safeSummary`, `displayWindow`, or any free-text field (phase plan
 * §3.2 "Critical rule"). Every rule is a named predicate so a rule can be
 * added, removed, or reweighted in one place with a unit test.
 *
 * Hard rules short-circuit the OUTCOME (reject / escalate); soft rules
 * accumulate a 0–100 risk score that maps to the remaining outcomes.
 */
@Injectable()
export class GuardrailPolicyService {
  evaluate(state: CaseTriageStateType): GuardrailDecision {
    // 1. Evaluate every rule for the audit trail (all are pure predicates).
    const hardRules = HARD_RULES.map((rule) =>
      toRecord(rule, rule.test(state))
    );
    const entitlementBreachFired = hardRules.some(
      (r) => r.ruleId === "ENTITLEMENT_BREACH" && r.triggered
    );
    const softRules = SOFT_RULES.map((rule) =>
      toRecord(rule, rule.test(state, { entitlementBreachFired }))
    );

    const allRules: GuardrailPolicyRule[] = [...hardRules, ...softRules];
    const triggeredRules = allRules.filter((r) => r.triggered);

    // 2. Soft score (capped at 100). Hard-rule rows never contribute points.
    const rawScore = softRules
      .filter((r) => r.triggered)
      .reduce((sum, r) => sum + r.riskPoints, 0);
    const riskScore = Math.min(rawScore, 100);

    // 3. Outcome — hard rules short-circuit; otherwise the score bands decide.
    const hardReject = hardRules.find(
      (r) => r.triggered && r.ruleId !== "SAFETY_CRITICAL_KB"
    );
    const hardEscalate = hardRules.find(
      (r) => r.triggered && r.ruleId === "SAFETY_CRITICAL_KB"
    );

    let outcome: GuardrailOutcome;
    let riskLevel: GuardrailRiskLevel;
    if (hardReject) {
      outcome = "reject";
      riskLevel = deriveRiskLevel(riskScore);
    } else if (hardEscalate) {
      outcome = "escalate";
      riskLevel = "critical";
    } else {
      riskLevel = deriveRiskLevel(riskScore);
      outcome = outcomeForLevel(riskLevel);
      // Conservative fallback (§3.5): a missing/degraded parts or scheduling
      // channel plus ANY approval flag floors an auto-approve up to human
      // review — we will not silently auto-approve on incomplete signals.
      if (outcome === "autoApprove" && shouldFloorToReview(state)) {
        outcome = "requireHumanApproval";
      }
    }

    // 4. Audit surfaces — non-PII rule labels only.
    const channelBasis = deriveChannelBasis(state);
    const approvalReasons =
      outcome === "autoApprove"
        ? []
        : dedupe(triggeredRules.map((r) => r.description));
    const autoApproveReason =
      outcome === "autoApprove"
        ? `Composite risk score ${riskScore} (${riskLevel}); no approval flags triggered.`
        : undefined;

    return {
      outcome,
      riskScore,
      riskLevel,
      allRules,
      triggeredRules,
      channelBasis,
      approvalReasons,
      autoApproveReason,
      // Pure service reports 0; the dep wrapper stamps real wall-clock time.
      latencyMs: 0
    };
  }
}

// --- Score → outcome mapping (phase plan §3.5) -------------------------------

function deriveRiskLevel(score: number): GuardrailRiskLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function outcomeForLevel(level: GuardrailRiskLevel): GuardrailOutcome {
  switch (level) {
    case "low":
      return "autoApprove";
    case "medium":
    case "high":
      return "requireHumanApproval";
    case "critical":
      return "escalate";
  }
}

/**
 * Conservative fallback condition: a parts or scheduling channel that is
 * absent or degraded, combined with any approval flag anywhere. Returns
 * true when the decision should be floored to human review.
 */
function shouldFloorToReview(state: CaseTriageStateType): boolean {
  const partsAbsentOrDegraded =
    state.partsLogistics === undefined ||
    state.partsLogistics.degraded === true;
  const schedulingAbsentOrDegraded =
    state.scheduling === undefined || state.scheduling.degraded === true;
  return (
    (partsAbsentOrDegraded || schedulingAbsentOrDegraded) &&
    anyApprovalFlag(state)
  );
}

function anyApprovalFlag(state: CaseTriageStateType): boolean {
  return (
    partsApprovalRequired(state) ||
    state.scheduling?.requiredApproval === true ||
    kbRequiredApproval(state)
  );
}

function deriveChannelBasis(
  state: CaseTriageStateType
): GuardrailChannelSource[] {
  const basis: GuardrailChannelSource[] = [];
  if (state.triage) basis.push("triage");
  if (state.customerContext) basis.push("customerContext");
  if (state.knowledgeGuidance) basis.push("knowledgeGuidance");
  if (state.partsLogistics) basis.push("partsLogistics");
  if (state.scheduling) basis.push("scheduling");
  return basis;
}

// --- Typed field accessors (values + flags only; never free-text) ------------

function priority(state: CaseTriageStateType): string | undefined {
  return state.triage?.recommendedPriority;
}

function businessRisk(state: CaseTriageStateType): string | undefined {
  // Widened to string: the matrix references a 'critical' tier the current
  // BusinessRiskLevel union does not yet model (forward-compatible read).
  return state.customerContext?.package?.businessRisk?.value;
}

function warrantyOut(state: CaseTriageStateType): boolean {
  // The DTO models out-of-warranty as 'expired'; accept the matrix label
  // 'out_of_warranty' too for forward compatibility.
  const value: string | undefined =
    state.customerContext?.package?.warrantyStatus?.value;
  return value === "expired" || value === "out_of_warranty";
}

function partsApprovalRequired(state: CaseTriageStateType): boolean {
  // PartsLogisticsChannel has no top-level flag; approval is per-plan.
  return (state.partsLogistics?.partPlans ?? []).some(
    (plan) => plan.requiredApproval === true
  );
}

function kbRequiredApproval(state: CaseTriageStateType): boolean {
  return (state.knowledgeGuidance?.answer?.recommendedActions ?? []).some(
    (action) => action.requiredApproval === true
  );
}

function kbSafetySeverity(
  state: CaseTriageStateType,
  severity: string
): boolean {
  return (state.knowledgeGuidance?.answer?.safetyFlags ?? []).some(
    (flag) => flag.severity === severity
  );
}

// --- Rule catalog ------------------------------------------------------------

interface SoftRuleDef {
  ruleId: string;
  channelSource: GuardrailChannelSource;
  fieldPath: string;
  riskPoints: number;
  description: string;
  test(
    state: CaseTriageStateType,
    ctx: { entitlementBreachFired: boolean }
  ): boolean;
}

interface HardRuleDef {
  ruleId: string;
  channelSource: GuardrailChannelSource;
  fieldPath: string;
  description: string;
  test(state: CaseTriageStateType): boolean;
}

/** Hard rules — short-circuit the outcome (reject / escalate); no score. */
const HARD_RULES: HardRuleDef[] = [
  {
    ruleId: "ENTITLEMENT_BREACH",
    channelSource: "partsLogistics",
    fieldPath: "customerContext.warrantyStatus + partsLogistics.status",
    description:
      "Out-of-warranty Case with unavailable parts — outside entitlement.",
    test: (state) =>
      warrantyOut(state) &&
      state.partsLogistics?.status === "UNAVAILABLE" &&
      state.partsLogistics?.eligible === true
  },
  {
    ruleId: "SAFETY_CRITICAL_KB",
    channelSource: "knowledgeGuidance",
    fieldPath: "knowledgeGuidance.answer.safetyFlags[].severity",
    description: "Knowledge base raised a safety-critical flag.",
    test: (state) => kbSafetySeverity(state, "critical")
  },
  {
    ruleId: "NO_ACCOUNT_LINKED",
    channelSource: "triage",
    fieldPath: "context.accountId + triage.recommendedPriority",
    description: "Critical Case with no linked Account.",
    test: (state) => !state.context?.accountId && priority(state) === "critical"
  }
];

/** Soft rules — accumulate the 0–100 composite risk score. */
const SOFT_RULES: SoftRuleDef[] = [
  {
    ruleId: "TRIAGE_CRITICAL",
    channelSource: "triage",
    fieldPath: "triage.recommendedPriority",
    riskPoints: 30,
    description: "Triage priority is Critical.",
    test: (state) => priority(state) === "critical"
  },
  {
    ruleId: "TRIAGE_HIGH",
    channelSource: "triage",
    fieldPath: "triage.recommendedPriority",
    riskPoints: 15,
    description: "Triage priority is High.",
    test: (state) => priority(state) === "high"
  },
  {
    ruleId: "CUSTOMER_RISK_CRITICAL",
    channelSource: "customerContext",
    fieldPath: "customerContext.package.businessRisk.value",
    riskPoints: 25,
    description: "Customer business risk is critical.",
    test: (state) => businessRisk(state) === "critical"
  },
  {
    ruleId: "CUSTOMER_RISK_HIGH",
    channelSource: "customerContext",
    fieldPath: "customerContext.package.businessRisk.value",
    riskPoints: 15,
    description: "Customer business risk is high.",
    test: (state) => businessRisk(state) === "high"
  },
  {
    ruleId: "STRATEGIC_ACCOUNT",
    channelSource: "customerContext",
    fieldPath: "customerContext.package.strategicAccount.value",
    riskPoints: 10,
    description: "Strategic account.",
    test: (state) =>
      state.customerContext?.package?.strategicAccount?.value === true
  },
  {
    ruleId: "WARRANTY_OUT",
    channelSource: "customerContext",
    fieldPath: "customerContext.package.warrantyStatus.value",
    riskPoints: 10,
    description: "Asset is out of warranty.",
    test: (state) => warrantyOut(state)
  },
  {
    ruleId: "REPEAT_INCIDENT",
    channelSource: "customerContext",
    fieldPath: "customerContext.package.repeatIncident.value.repeat",
    riskPoints: 10,
    description: "Repeat incident on this account.",
    test: (state) =>
      state.customerContext?.package?.repeatIncident?.value?.repeat === true
  },
  {
    ruleId: "PARTS_APPROVAL_REQUIRED",
    channelSource: "partsLogistics",
    fieldPath: "partsLogistics.partPlans[].requiredApproval",
    riskPoints: 20,
    description: "Parts plan requires approval.",
    test: (state) => partsApprovalRequired(state)
  },
  {
    ruleId: "PARTS_PARTIAL",
    channelSource: "partsLogistics",
    fieldPath: "partsLogistics.status",
    riskPoints: 10,
    description: "Parts fulfillment is partial.",
    test: (state) => state.partsLogistics?.status === "PARTIAL"
  },
  {
    ruleId: "PARTS_UNAVAILABLE",
    channelSource: "partsLogistics",
    fieldPath: "partsLogistics.status",
    riskPoints: 15,
    description: "Parts fulfillment is unavailable.",
    test: (state, ctx) =>
      state.partsLogistics?.status === "UNAVAILABLE" &&
      !ctx.entitlementBreachFired
  },
  {
    ruleId: "SCHEDULING_APPROVAL_REQUIRED",
    channelSource: "scheduling",
    fieldPath: "scheduling.requiredApproval",
    riskPoints: 15,
    description: "Scheduling plan requires approval.",
    test: (state) => state.scheduling?.requiredApproval === true
  },
  {
    ruleId: "SCHEDULING_SLA_BREACH",
    channelSource: "scheduling",
    fieldPath: "scheduling.approvalReason",
    riskPoints: 15,
    description: "Scheduling risks an SLA breach.",
    test: (state) => state.scheduling?.approvalReason === "sla_breach_risk"
  },
  {
    ruleId: "SCHEDULING_AFTER_HOURS",
    channelSource: "scheduling",
    fieldPath: "scheduling.approvalReason",
    riskPoints: 10,
    description: "Scheduling proposed an after-hours window.",
    test: (state) => state.scheduling?.approvalReason === "after_hours"
  },
  {
    ruleId: "SCHEDULING_CROSS_TERRITORY",
    channelSource: "scheduling",
    fieldPath: "scheduling.approvalReason",
    riskPoints: 10,
    description: "Scheduling crosses service territories.",
    test: (state) => state.scheduling?.approvalReason === "cross_territory"
  },
  {
    ruleId: "SCHEDULING_DEFERRED",
    channelSource: "scheduling",
    fieldPath: "scheduling.schedulingReadiness",
    riskPoints: 10,
    description: "Scheduling deferred pending parts.",
    test: (state) => state.scheduling?.schedulingReadiness === "deferred"
  },
  {
    ruleId: "KB_REQUIRED_APPROVAL",
    channelSource: "knowledgeGuidance",
    fieldPath: "knowledgeGuidance.answer.recommendedActions[].requiredApproval",
    riskPoints: 15,
    description: "Knowledge action requires approval.",
    test: (state) => kbRequiredApproval(state)
  },
  {
    ruleId: "KB_SAFETY_HIGH",
    channelSource: "knowledgeGuidance",
    fieldPath: "knowledgeGuidance.answer.safetyFlags[].severity",
    riskPoints: 20,
    description: "Knowledge base raised a high-severity safety flag.",
    test: (state) => kbSafetySeverity(state, "high")
  },
  {
    ruleId: "ALL_CHANNELS_DEGRADED",
    channelSource: "partsLogistics",
    fieldPath: "partsLogistics.degraded + scheduling.degraded",
    riskPoints: 15,
    description: "Parts and scheduling channels both ran degraded.",
    test: (state) =>
      state.partsLogistics?.degraded === true &&
      state.scheduling?.degraded === true
  }
];

function toRecord(
  def: SoftRuleDef | HardRuleDef,
  triggered: boolean
): GuardrailPolicyRule {
  const isHardRule = !("riskPoints" in def);
  return {
    ruleId: def.ruleId,
    channelSource: def.channelSource,
    fieldPath: def.fieldPath,
    triggered,
    riskPoints: isHardRule ? 0 : (def as SoftRuleDef).riskPoints,
    isHardRule,
    description: def.description
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

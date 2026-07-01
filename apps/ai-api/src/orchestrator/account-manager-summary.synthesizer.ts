import type { OrchestratorVerdictInput } from "./dto/orchestrator-verdict";
import type { GuardrailChannel } from "./dto/guardrail";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type { SchedulingChannel } from "./dto/scheduling";

/**
 * User-facing policy phrases for the Account Manager executive summary.
 * Maps triggered rule ids to plain-language reasons (non-PII).
 */
const POLICY_REASON_BY_RULE: Record<string, string> = {
  PARTS_APPROVAL_REQUIRED:
    "the parts transfer exceeds the configured approval policy",
  PARTS_PARTIAL: "the partial parts fulfillment exceeds the configured approval policy",
  SCHEDULING_APPROVAL_REQUIRED:
    "the scheduling plan exceeds the configured approval policy",
  SCHEDULING_SLA_BREACH:
    "the proposed scheduling window risks an SLA breach under the approval policy",
  SCHEDULING_AFTER_HOURS:
    "the after-hours scheduling window exceeds the configured approval policy",
  SCHEDULING_CROSS_TERRITORY:
    "the cross-territory scheduling plan exceeds the configured approval policy",
  KB_REQUIRED_APPROVAL:
    "the knowledge-guided repair plan exceeds the configured approval policy",
  TRIAGE_CRITICAL: "the critical priority classification exceeds the configured approval policy",
  TRIAGE_HIGH: "the high priority classification exceeds the configured approval policy",
  CUSTOMER_RISK_CRITICAL:
    "the critical business risk signals exceed the configured approval policy",
  CUSTOMER_RISK_HIGH:
    "the elevated business risk signals exceed the configured approval policy",
  STRATEGIC_ACCOUNT:
    "the strategic account classification requires Account Manager sign-off",
  REPEAT_INCIDENT:
    "the repeat-incident pattern requires Account Manager sign-off"
};

/**
 * Builds the plain-language executive paragraph surfaced on the Case
 * (`AI_Orchestrator_Verdict_Summary__c`), the Approval Process submitter
 * comment, and the operator console at `waiting_approval`. Deterministic —
 * no LLM, no PII. Optional `accountManagerName` may be supplied by Apex
 * when the Account Owner is resolvable (never logged from NestJS).
 */
export function buildAccountManagerExecutiveSummary(
  input: OrchestratorVerdictInput,
  options?: { accountManagerName?: string }
): string {
  const priority = input.triage?.recommendedPriority;
  const risk = input.customerContext?.package?.businessRisk.value;
  const guardrail = input.guardrail;

  const priorityLabel = priority
    ? `${capitalize(priority)} priority`
    : "Unclassified priority";
  const riskClause = risk
    ? ` with ${capitalize(risk)} business risk`
    : "";

  const recommendations = buildRecommendationClauses(
    input.partsLogistics,
    input.scheduling
  );
  const recommendationSentence =
    recommendations.length > 0
      ? ` The AI recommends ${recommendations.join(" and ")}.`
      : "";

  let sentence =
    `This is a ${priorityLabel} service request${riskClause}.${recommendationSentence}`;

  const approvalClause = buildApprovalClause(
    guardrail,
    input.approvalDecision,
    options?.accountManagerName
  );
  if (approvalClause) {
    sentence += ` ${approvalClause}`;
  } else if (guardrail?.outcome === "autoApprove") {
    sentence += " No Account Manager approval is required.";
  } else if (guardrail?.outcome === "reject") {
    sentence += " The compliance guardrail rejected automated action.";
  } else if (guardrail?.outcome === "escalate") {
    sentence += " The case was escalated for supervisor review.";
  }

  return sentence.trim();
}

function buildRecommendationClauses(
  parts: PartsLogisticsChannel | undefined,
  scheduling: SchedulingChannel | undefined
): string[] {
  const clauses: string[] = [];
  if (parts && parts.eligible !== false && !parts.degraded) {
    if (
      parts.fulfillmentReadiness === "partial" ||
      parts.partPlans?.some((p) => p.transferRequired)
    ) {
      clauses.push("transferring replacement parts");
    } else if (parts.fulfillmentReadiness === "ready") {
      clauses.push("dispatching available replacement parts");
    }
  }
  if (scheduling && scheduling.eligible !== false && !scheduling.degraded) {
    if (scheduling.schedulingReadiness === "provisional") {
      clauses.push("scheduling a provisional service visit");
    } else if (scheduling.schedulingReadiness === "schedulable") {
      clauses.push("scheduling a service visit");
    } else if (scheduling.schedulingReadiness === "deferred") {
      clauses.push("deferring scheduling until parts are confirmed");
    }
  }
  return clauses;
}

function buildApprovalClause(
  guardrail: GuardrailChannel | undefined,
  approvalDecision: OrchestratorVerdictInput["approvalDecision"],
  accountManagerName?: string
): string | undefined {
  if (!guardrail || guardrail.eligible === false) {
    return undefined;
  }
  if (guardrail.outcome === "requireHumanApproval" && approvalDecision) {
    if (approvalDecision === "approved") {
      return "Account Manager approval was granted.";
    }
    if (approvalDecision === "rejected") {
      return "Account Manager approval was rejected; automated write-back was not applied.";
    }
  }
  if (guardrail.outcome !== "requireHumanApproval") {
    return undefined;
  }

  const policyReason = resolvePolicyReason(guardrail);
  const approver =
    accountManagerName && accountManagerName.trim().length > 0
      ? accountManagerName.trim()
      : undefined;
  if (approver) {
    return `Account Manager approval is required from ${approver} because ${policyReason}.`;
  }
  return `Account Manager approval is required because ${policyReason}.`;
}

function resolvePolicyReason(guardrail: GuardrailChannel): string {
  for (const rule of guardrail.policyRulesTriggered) {
    const mapped = POLICY_REASON_BY_RULE[rule.ruleId];
    if (mapped) {
      return mapped;
    }
  }
  if (guardrail.approvalReasons.length > 0) {
    return guardrail.approvalReasons[0].replace(/\.$/, "").toLowerCase();
  }
  return "the composite risk score exceeds the configured approval policy";
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

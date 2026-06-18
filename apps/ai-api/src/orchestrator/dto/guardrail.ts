/**
 * Node 6 — Compliance & Guardrail contracts (Phase 6a).
 *
 * Node 6 is the SOLE interrupting node in the graph. It consumes the five
 * upstream typed channels (triage, customerContext, knowledgeGuidance,
 * partsLogistics, scheduling), runs a deterministic composite policy
 * matrix over TYPED FIELD VALUES ONLY (never free-text such as
 * `safeSummary` or `displayWindow`), and produces one of four outcomes:
 * `autoApprove`, `requireHumanApproval`, `reject`, or `escalate`.
 *
 * Everything surfaced here is sanitized and non-PII: rule ids, reason
 * labels, a numeric risk score, and the priority/status facts an
 * out-of-band approver needs — never raw Case text, account ids,
 * customer names, technician names, or chain-of-thought.
 *
 * The channel is the sole writer's output (Node 6). The policy that fills
 * it is pure and deterministic so the pre-interrupt code is safe to
 * re-run on every resume (Node 6 phase plan §3.5, §6, §7).
 */

import type { GUARDRAIL_NODE_ID as _GUARDRAIL_NODE_ID } from "./case-triage-lifecycle";

// Re-export the lifecycle node id so guardrail consumers import it from
// the channel module (single source of truth lives in the lifecycle DTO).
export { GUARDRAIL_NODE_ID } from "./case-triage-lifecycle";
export type GuardrailNodeId = typeof _GUARDRAIL_NODE_ID;

/** Four named outcomes — the only machine-consumable signal from Node 6. */
export type GuardrailOutcome =
  | "autoApprove" // low risk — proceeds without interrupt
  | "requireHumanApproval" // medium/high risk — interrupt, wait for approver
  | "reject" // hard policy rule fired — block immediately
  | "escalate"; // critical risk — supervisor path, no interrupt

export type GuardrailRiskLevel = "low" | "medium" | "high" | "critical";

/** The upstream channels a rule (and the decision) can read. */
export type GuardrailChannelSource =
  | "triage"
  | "customerContext"
  | "knowledgeGuidance"
  | "partsLogistics"
  | "scheduling";

/** One named policy rule evaluation record. */
export interface GuardrailPolicyRule {
  ruleId: string; // e.g. "PARTS_APPROVAL_REQUIRED"
  channelSource: GuardrailChannelSource;
  fieldPath: string; // e.g. "partsLogistics.requiredApproval"
  triggered: boolean;
  riskPoints: number; // contribution when triggered (0 for hard-rule rows)
  isHardRule: boolean; // true = short-circuit; false = scored
  description: string; // human-readable label for UI/audit (non-PII)
}

/** What the approval routing dep sent (6b+). Absent until 6b. */
export interface GuardrailApprovalRouting {
  method: "email" | "salesforce_approval" | "both" | "log_only";
  sentAt?: string; // ISO timestamp — used as idempotency guard on node re-run
  recipientRole?: string; // role label, never a full name/email
  externalRef?: string; // SF Approval Process record id
  /**
   * 6b: true when the routing was attempted but delivery failed (e.g. the
   * email provider errored). The graph still reaches `interrupt()` — routing
   * is degrade-safe — but the operator can see the notification did not land.
   */
  degraded?: boolean;
}

/** Node 6 output channel — sole writer: Node 6. */
export interface GuardrailChannel {
  eligible: boolean;
  eligibilityReason?: string;

  outcome: GuardrailOutcome;
  riskScore: number; // 0–100
  riskLevel: GuardrailRiskLevel;

  policyRulesEvaluated: GuardrailPolicyRule[]; // all rules checked
  policyRulesTriggered: GuardrailPolicyRule[]; // subset where triggered=true

  /** Which upstream channels informed the decision. */
  channelBasis: GuardrailChannelSource[];

  requiresHumanApproval: boolean; // true only when outcome = 'requireHumanApproval'
  approvalRequired: boolean; // alias for backward compat

  /** Human-readable approval reason labels (non-PII; no free-form text). */
  approvalReasons: string[];
  /** Reason outcome is autoApprove, for audit (e.g. "score 8, no flags"). */
  autoApproveReason?: string;

  /** 6b: routing metadata written before interrupt(), idempotency guard. */
  approvalRouting?: GuardrailApprovalRouting;

  degraded: boolean;
  confidence?: "high" | "medium" | "low";
  latencyMs?: number;
}

/**
 * The safe payload surfaced when the graph pauses for approval. Replaces
 * `TriageApprovalInterrupt`. No PII, no Case text, no chain-of-thought.
 * Carries all upstream approval reasons so the approver sees a complete
 * picture without opening the raw Case.
 */
export interface GuardrailApprovalInterrupt {
  action: "approve_case_workflow";
  workflowId: string;
  caseId: string;
  caseNumber?: string;
  guardrail: {
    riskScore: number;
    riskLevel: GuardrailRiskLevel;
    policyRulesTriggered: string[]; // ruleId strings only
    approvalReasons: string[];
  };
  /** Safe summary facts for the approver — no PII, no raw Case text. */
  context: {
    recommendedPriority: string; // e.g. "high"
    partsStatus?: string; // e.g. "PARTIAL"
    partsApprovalReasons?: string[]; // e.g. ["cross_region_transfer"]
    schedulingStatus?: string; // e.g. "PROVISIONAL"
    schedulingWindow?: string; // sanitized displayWindow, e.g. "Thu 09:00–11:00 PDT"
    schedulingApprovalReasons?: string[]; // e.g. ["after_hours"]
  };
}

/**
 * Operator-facing label for an outcome. Shared by the graph events, the
 * UI, and the Final Verdict so the wording (and the smoke assertion on
 * "Approval required") stays consistent across surfaces.
 */
export function guardrailOutcomeLabel(outcome: GuardrailOutcome): string {
  switch (outcome) {
    case "autoApprove":
      return "Auto-approved";
    case "requireHumanApproval":
      return "Approval required";
    case "reject":
      return "Rejected";
    case "escalate":
      return "Escalated";
  }
}

/** Internal: what GuardrailPolicyService.evaluate() returns before channel assembly. */
export interface GuardrailDecision {
  outcome: GuardrailOutcome;
  riskScore: number;
  riskLevel: GuardrailRiskLevel;
  allRules: GuardrailPolicyRule[];
  triggeredRules: GuardrailPolicyRule[];
  channelBasis: GuardrailChannelSource[];
  approvalReasons: string[];
  autoApproveReason?: string;
  latencyMs: number;
}

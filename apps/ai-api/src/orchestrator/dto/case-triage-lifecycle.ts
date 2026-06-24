/**
 * Shared lifecycle vocabulary for the case-triage orchestrator. These
 * names are the contract the read-only UI renders and the orchestrator
 * state machine transitions through.
 *
 * The slice now spans Node 1 (triage) and the non-interrupting Node 2
 * (customer history). Nodes 3-8 are intentionally not modelled here.
 */

export const NODE_LIFECYCLE_STATUSES = [
  "assigned",
  "running",
  "done",
  "waiting_approval",
  // Stepped run mode (Phase 2): the graph paused after a stage via
  // `interruptAfter` and is waiting for the operator's next `advance`. Like
  // `waiting_approval`, it is NON-terminal — the workflow resumes on demand.
  "awaiting_step",
  "rejected",
  "escalated",
  "stopped",
  "failed"
] as const;

export type NodeLifecycleStatus = (typeof NODE_LIFECYCLE_STATUSES)[number];

/**
 * Statuses from which a workflow can never transition again. `escalated`
 * is terminal like `rejected`: Node 6 routed the Case to a supervisor
 * path instead of the write-back, and the graph has reached END.
 * `stopped` (Node 6 6c / RC-1) is terminal too: an operator took the Case
 * over (Stop AI), so the guardrail settled without interrupt or write-back.
 * It is deliberately distinct from `rejected` — an operator takeover is not
 * a guardrail compliance rejection (Node 6 6c plan §1.1).
 */
export const TERMINAL_LIFECYCLE_STATUSES: ReadonlySet<NodeLifecycleStatus> =
  new Set<NodeLifecycleStatus>([
    "done",
    "rejected",
    "escalated",
    "stopped",
    "failed"
  ]);

export function isTerminalLifecycleStatus(
  status: NodeLifecycleStatus
): boolean {
  return TERMINAL_LIFECYCLE_STATUSES.has(status);
}

/** The orchestrator nodes implemented in this slice. */
export const TRIAGE_NODE_ID = "triage" as const;
export const CUSTOMER_HISTORY_NODE_ID = "customer_history" as const;
export const KNOWLEDGE_NODE_ID = "knowledge" as const;
export const PARTS_LOGISTICS_NODE_ID = "parts_logistics" as const;
export const SCHEDULING_NODE_ID = "scheduling" as const;
/** Node 6 — Compliance & Guardrail (the sole interrupting node). */
export const GUARDRAIL_NODE_ID = "guardrail" as const;
export type OrchestratorNodeId =
  | typeof TRIAGE_NODE_ID
  | typeof CUSTOMER_HISTORY_NODE_ID
  | typeof KNOWLEDGE_NODE_ID
  | typeof PARTS_LOGISTICS_NODE_ID
  | typeof SCHEDULING_NODE_ID
  | typeof GUARDRAIL_NODE_ID;

/**
 * The decisions an out-of-band approver may submit through the resume
 * endpoint. The decision is made via the account-manager email link or
 * Salesforce approval process, never in the read-only UI. `escalated`
 * is deliberately NOT in this set — it is a policy outcome set by Node 6,
 * not a value an approver can submit (Node 6 phase plan §3.7, R6).
 */
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApproverResumeDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * The approval resolution recorded in workflow state. Extends the
 * approver-submittable set with `escalated`, which the Node 6 guardrail
 * policy assigns when it routes the Case to the supervisor path. Every
 * `escalated` value originates from the policy, never from a resume call.
 */
export const APPROVAL_DECISION_STATES = [
  "approved",
  "rejected",
  "escalated"
] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISION_STATES)[number];

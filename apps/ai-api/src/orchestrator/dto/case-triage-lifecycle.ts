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
  "rejected",
  "failed"
] as const;

export type NodeLifecycleStatus = (typeof NODE_LIFECYCLE_STATUSES)[number];

/** Statuses from which a workflow can never transition again. */
export const TERMINAL_LIFECYCLE_STATUSES: ReadonlySet<NodeLifecycleStatus> =
  new Set<NodeLifecycleStatus>(["done", "rejected", "failed"]);

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
export type OrchestratorNodeId =
  | typeof TRIAGE_NODE_ID
  | typeof CUSTOMER_HISTORY_NODE_ID
  | typeof KNOWLEDGE_NODE_ID
  | typeof PARTS_LOGISTICS_NODE_ID
  | typeof SCHEDULING_NODE_ID;

/**
 * The approval resolution that gates the triage write-back. The
 * decision is made out-of-band (account-manager email or Salesforce),
 * never in the read-only UI.
 */
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

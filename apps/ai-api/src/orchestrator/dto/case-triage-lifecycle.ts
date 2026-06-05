/**
 * Shared lifecycle vocabulary for the Node 1 case-triage walking
 * skeleton. These names are the contract the read-only UI renders and
 * the orchestrator state machine transitions through.
 *
 * Only Node 1 (triage) exists in this slice. Nodes 2-8 are
 * intentionally not modelled here.
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

/** The only orchestrator node implemented in this slice. */
export const TRIAGE_NODE_ID = "triage" as const;
export type OrchestratorNodeId = typeof TRIAGE_NODE_ID;

/**
 * The approval resolution that gates the triage write-back. The
 * decision is made out-of-band (account-manager email or Salesforce),
 * never in the read-only UI.
 */
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

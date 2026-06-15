/**
 * Node 4 — Phase 4c gated fulfillment write contract.
 *
 * After the approval gate clears, the orchestrator asks Salesforce (the
 * action executor) to create the in-org fulfillment records for the
 * approved part plans: a `ProductTransfer` for an inter-warehouse
 * transfer, or a `ProductRequest` (+ line) for a network backorder. The
 * Apex `AgentforcePartsFulfillmentService` owns the DML and the
 * idempotency (keyed on `Orchestrator_Workflow_Id__c` + part code); this
 * is only the safe, non-PII command/result the NestJS gateway exchanges
 * with it over Apex REST.
 *
 * The orchestrator NEVER writes Salesforce records directly from Node 4
 * read/plan; these writes happen only in the post-approval write-back.
 */

/** A single part the executor should create a fulfillment record for. */
export interface PartsFulfillmentItemCommand {
  partNumber: string;
  quantity: number;
  /** Only transfer/backorder plans produce a write. */
  exceptionType: "inter_warehouse_transfer" | "backorder";
  /** Destination (fulfillment) warehouse — where the part must end up. */
  fulfillmentWarehouseReference?: string;
  /** Source warehouse for a transfer; absent for a backorder. */
  sourceWarehouseReference?: string;
  /** Safe approval reason carried for the executor's audit trail. */
  approvalReason?: string;
}

/** The approved fulfillment command sent to the Apex REST executor. */
export interface PartsFulfillmentCommand {
  /** Idempotency key stamped on every record (`Orchestrator_Workflow_Id__c`). */
  workflowId: string;
  caseId: string;
  items: PartsFulfillmentItemCommand[];
}

/** Per-part outcome returned by the executor. */
export interface PartsFulfillmentItemResult {
  partNumber: string;
  /** True when a new record was created this call. */
  created: boolean;
  /** True when an existing record matched (idempotent no-op). */
  idempotentSkip: boolean;
  recordType?: "ProductTransfer" | "ProductRequest";
  recordId?: string;
  /** Resulting reservation state for the plan. */
  reservationStatus: "transfer_pending" | "backorder_requested" | "planned";
  /** Safe, non-PII status message. */
  message?: string;
}

/** Aggregate result of a fulfillment write call. */
export interface PartsFulfillmentResult {
  /** True when the executor processed the command (vs. degraded/no-op). */
  applied: boolean;
  /** True when the call could not complete; the gateway never throws. */
  degraded: boolean;
  items: PartsFulfillmentItemResult[];
}

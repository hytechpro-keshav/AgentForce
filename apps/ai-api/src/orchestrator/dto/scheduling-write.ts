/**
 * Node 5 — Phase 5c gated scheduling write contract.
 *
 * After Node 6 (Compliance & Guardrail) approves the run, the orchestrator
 * asks Salesforce (the action executor) to BOOK the proposed plan: it
 * creates a `ServiceAppointment` (linked to the Case) plus an
 * `AssignedResource` for the recommended technician. The Apex
 * `AgentforceSchedulingService` owns the DML, FLS/CRUD checks, and the
 * idempotency (keyed on `Orchestrator_Workflow_Id__c`); this is only the
 * safe, non-PII command/result the NestJS gateway exchanges with it over
 * Apex REST. The JSON shape mirrors `AgentforceSchedulingService`'s
 * `SchedulingRequest` / `SchedulingResult`.
 *
 * Like Node 4's Phase 4c fulfillment write, the orchestrator NEVER creates
 * Salesforce records from the Node 5 read/plan; the write happens ONLY in
 * the post-approval write-back, AFTER a fresh parts + scheduling re-read
 * (RC-5) confirms the plan is still schedulable.
 *
 * Identity stays sanitized: the command carries the same non-PII
 * `resourceReference` (e.g. "SR-A2") the `scheduling` channel surfaced; the
 * Apex resolves it back to the real `ServiceResource` (by name prefix), so
 * no full technician name ever leaves the gateway. `resourceId` is an
 * optional fast-path for callers (e.g. an Agentforce Flow) that already
 * hold the Salesforce id; the orchestrator leaves it unset.
 */

/** The approved booking command sent to the Apex REST executor. */
export interface SchedulingWriteCommand {
  /** Idempotency key stamped on the appointment (`Orchestrator_Workflow_Id__c`). */
  workflowId: string;
  /** Case the appointment is booked for (`ServiceAppointment.ParentRecordId`). */
  caseId: string;
  /** Sanitized technician reference (e.g. "SR-A2"); Apex resolves to the resource. */
  resourceReference: string;
  /** Optional resolved Salesforce `ServiceResource` id (fast path; orchestrator omits it). */
  resourceId?: string;
  /** Target territory name (e.g. "North America"); sets `ServiceTerritoryId`. */
  territoryReference?: string;
  /** Scheduled window start (ISO-8601). */
  schedStart: string;
  /** Scheduled window end (ISO-8601). */
  schedEnd: string;
  /** Appointment duration in minutes (drives `Duration` + `DurationType`). */
  durationMinutes?: number;
  /** Sanitized appointment subject. */
  subject?: string;
  /** Safe, non-PII approval reason carried for the executor's audit trail. */
  approvalReason?: string;
}

/** Outcome of a scheduling write call (no PII, safe to persist + render). */
export interface SchedulingWriteResult {
  /** True when the executor processed the command (vs. degraded/no-op). */
  applied: boolean;
  /** True when the call could not complete; the gateway never throws. */
  degraded: boolean;
  /** True when an appointment exists after the call (created or reused). */
  booked: boolean;
  /** True when an existing appointment matched (idempotent no-op). */
  idempotentSkip: boolean;
  /** Resulting booking state. `booked` when an appointment exists, else `none`. */
  appointmentStatus: "none" | "booked";
  /** Non-PII appointment reference (`AppointmentNumber`, e.g. "SA-0007"). */
  appointmentReference?: string;
  /** Raw `ServiceAppointment` id (Salesforce id is not PII). */
  appointmentId?: string;
  /** Raw `AssignedResource` id when the technician link succeeded. */
  assignedResourceId?: string;
  /** Safe, non-PII status message. */
  message?: string;
}

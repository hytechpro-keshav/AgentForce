import type { TriagePriorityDto } from "../../agents/dto/triage-case.dto";

/**
 * Contract 3 of 4 — gated write-back command.
 *
 * The action the orchestrator asks Salesforce (action executor) to
 * apply to the same Case once the triage decision is ready and the
 * approval gate (if any) has cleared. Text fields are already
 * sanitized; the gateway applies them verbatim.
 */
export interface CaseTriageWriteBackCommand {
  caseId: string;
  recommendedPriority: TriagePriorityDto;
  /** Sanitized one-line triage summary, safe to persist on the Case. */
  triageSummary: string;
  /** Sanitized recommended next step. */
  suggestedNextStep: string;
}

/**
 * Outcome of applying the write-back, used for telemetry and the
 * read-only status feed. Carries no Case content.
 */
export interface CaseTriageWriteBackResult {
  applied: boolean;
  priorityUpdated: boolean;
  commentCreated: boolean;
}

/**
 * Optional Salesforce tracking write-back: stamps the AI triage
 * workflow id and current status onto the Case custom fields so the
 * historical orchestration view is resolvable from the Case itself
 * (not only the AI API's in-memory store). Best-effort and gated by
 * config; never blocks the Flow or the orchestration run.
 */
export interface CaseTriageTrackingCommand {
  caseId: string;
  workflowId: string;
  /** Lifecycle status string (assigned, running, done, ...). */
  status: string;
  /** ISO-8601 timestamp of this status update. */
  updatedAt: string;
  /** Optional deep link to the read-only orchestration view. */
  uiUrl?: string;
}

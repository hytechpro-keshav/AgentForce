import type { TriagePriorityDto } from "../../agents/dto/triage-case.dto";

/**
 * Contract 2 of 4 — Salesforce read-context response.
 *
 * The normalized Case shape the orchestrator reads from Salesforce
 * (system of record) before running triage. The gateway maps raw
 * Salesforce Case fields into this vendor-neutral shape; nodes never
 * touch raw HTTP or Named Credential wiring.
 */
export interface SalesforceCaseContext {
  caseId: string;
  caseNumber?: string;
  subject: string;
  description: string;
  status?: string;
  origin?: string;
  /** Salesforce Priority mapped to the triage priority vocabulary. */
  reportedPriority?: TriagePriorityDto;
  accountId?: string;
}

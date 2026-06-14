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
  /**
   * Node 4 (parts & logistics) read context. The installed Asset and
   * its product code anchor part compatibility; the service ship-to
   * drives fulfillment-warehouse selection. The asset serial number is
   * safe for orchestration use but must NOT reach UI status events.
   */
  assetId?: string;
  assetProductCode?: string;
  assetSerialNumber?: string;
  serviceShipToCity?: string;
  serviceShipToState?: string;
  serviceShipToCountry?: string;
}

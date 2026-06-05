import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

import { SAFE_CHAT_REQUEST_ID_PATTERN } from "../../chat/dto/chat-message.dto";
import type { NodeLifecycleStatus } from "./case-triage-lifecycle";

/**
 * Salesforce record ids are 15 (case-sensitive) or 18 (case-safe)
 * alphanumeric characters.
 */
export const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * Contract 1 of 4 — trigger signal.
 *
 * Fired fire-and-forget by the Salesforce record-triggered Flow /
 * Apex when a Case lands in the triage bucket. It carries only the
 * minimal identifiers needed to start orchestration; the orchestrator
 * reads the actual Case context from Salesforce itself.
 */
export class TriggerCaseTriageDto {
  @IsString()
  @Matches(SALESFORCE_ID_PATTERN, {
    message: "caseId must be a 15 or 18 character Salesforce id."
  })
  caseId!: string;

  /** Human-friendly Case number, safe to surface in the read-only UI. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d{1,20}$/, {
    message: "caseNumber must be digits only."
  })
  caseNumber?: string;

  /** Caller-supplied idempotency / correlation id. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(SAFE_CHAT_REQUEST_ID_PATTERN)
  correlationId?: string;
}

/**
 * Fast acknowledgement returned by the trigger endpoint. The Flow
 * does not wait for model work — it receives the workflow handle and
 * returns immediately.
 */
export interface TriggerCaseTriageAcceptedDto {
  workflowId: string;
  caseId: string;
  caseNumber?: string;
  status: NodeLifecycleStatus;
  acceptedAt: string;
}

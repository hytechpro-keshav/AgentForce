import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  MinLength
} from "class-validator";

import { SAFE_CHAT_REQUEST_ID_PATTERN } from "./chat-message.dto";

export const ESCALATION_URGENCIES = ["low", "normal", "high"] as const;
export type EscalationUrgency = (typeof ESCALATION_URGENCIES)[number];

export const ESCALATION_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

/**
 * Phase 6 customer-chat escalation contract.
 *
 * The browser does not call Salesforce directly. It posts a
 * minimal, customer-safe handoff descriptor to NestJS. NestJS
 * acknowledges and assigns an `escalationId`; downstream
 * Agentforce/Salesforce action wiring is intentionally out of
 * scope for this DTO-tested contract.
 */
export class ChatEscalationRequestDto {
  /** Free-text reason from the customer, redacted server-side before logging. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsIn(ESCALATION_URGENCIES)
  urgency?: EscalationUrgency;

  /** Optional customer-supplied conversation summary; not full transcript. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  conversationSummary?: string;

  /**
   * Optional case number / record reference the customer already has.
   * Must be a safe identifier shape — no free-form Salesforce IDs.
   */
  @IsOptional()
  @IsString()
  @Matches(ESCALATION_REF_PATTERN)
  caseReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(SAFE_CHAT_REQUEST_ID_PATTERN)
  requestId?: string;
}

export interface ChatEscalationResponseDto {
  escalationId: string;
  status: "received";
  urgency: EscalationUrgency;
  receivedAt: string;
  nextSteps: string;
  requestId?: string;
}

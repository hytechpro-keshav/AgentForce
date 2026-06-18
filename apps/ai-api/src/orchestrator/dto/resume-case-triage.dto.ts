import { IsIn, IsString, Matches, MaxLength } from "class-validator";

import { SAFE_CHAT_REQUEST_ID_PATTERN } from "../../chat/dto/chat-message.dto";
import {
  APPROVAL_DECISIONS,
  type ApproverResumeDecision
} from "./case-triage-lifecycle";

/**
 * Out-of-band approval resolution for the gated write-back.
 *
 * This is NOT a UI action. It is delivered by the account-manager
 * email link or Salesforce approval process and authenticated with a
 * dedicated approval scope. The `idempotencyKey` makes repeated
 * deliveries safe — resuming an already-resolved workflow is a no-op
 * that returns the existing terminal snapshot.
 *
 * Only `approved` | `rejected` are accepted. `escalated` is a Node 6
 * policy outcome, never an approver-submitted decision (phase plan R6).
 */
export class ResumeCaseTriageDto {
  @IsIn(APPROVAL_DECISIONS)
  decision!: ApproverResumeDecision;

  @IsString()
  @MaxLength(64)
  @Matches(SAFE_CHAT_REQUEST_ID_PATTERN)
  idempotencyKey!: string;
}

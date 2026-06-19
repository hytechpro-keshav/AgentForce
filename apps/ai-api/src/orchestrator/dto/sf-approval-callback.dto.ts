import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

import {
  APPROVAL_DECISIONS,
  type ApproverResumeDecision
} from "./case-triage-lifecycle";

/**
 * Body for the PUBLIC Salesforce-Approval callback (6b+). The Salesforce
 * approval-completion Flow POSTs here when an approver acts in the native
 * Approval UI.
 *
 * Authentication is the workflow-scoped `token` (verified server-side, with
 * a distinct audience from the email links). The `decision` IS trusted from
 * the body — it reflects the approver's actual action in Salesforce — but is
 * constrained to the approver-submittable set (`approved` | `rejected`);
 * `escalated` is a policy outcome, never an approver decision (R6). The
 * resume idempotency key is derived from the token `jti`, not the body, so a
 * duplicate Flow retry resolves the workflow exactly once. The global
 * ValidationPipe (`forbidNonWhitelisted`) rejects any other field.
 */
export class SalesforceApprovalCallbackDto {
  @IsIn(APPROVAL_DECISIONS)
  decision!: ApproverResumeDecision;

  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  token!: string;
}

import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * RC-1 (Node 6 6c) Stop-AI request body. Optional operator reason only — a
 * short, non-PII label ("manual takeover"), never customer text.
 *
 * Stop AI is NOT a guardrail approve/reject: it carries the dedicated
 * `agentforce:orchestrator-control` scope (the read-only view token cannot
 * call it) and routes the Case to a `stopped` terminal, never `rejected`.
 */
export class StopCaseTriageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[\w\s.,:;'"()?!-]*$/, {
    message: "reason must be a short, plain-text operator note."
  })
  reason?: string;
}

/**
 * Result of a Stop-AI request. `status` is the Case control flag
 * (`stopped_by_user`), distinct from the workflow lifecycle status
 * (`stopped`). `workflowId` is the latest workflow for the Case, if any.
 */
export interface StopCaseTriageResult {
  caseId: string;
  status: "stopped_by_user";
  workflowId?: string;
  stoppedAt: string;
}

import { IsString, MaxLength, MinLength } from "class-validator";

/**
 * Body for the PUBLIC guardrail approve/reject confirmation POST (6b).
 *
 * Carries ONLY the signed link token — the decision and the workflow are
 * bound inside the token and verified server-side, never trusted from the
 * request. The global ValidationPipe (`forbidNonWhitelisted`) rejects any
 * other field, so an attacker cannot smuggle a decision or workflow id.
 */
export class ApproveCaseTriageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  token!: string;
}

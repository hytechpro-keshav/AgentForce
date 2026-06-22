import { IsString, MaxLength, MinLength } from "class-validator";

/**
 * RC-8a (Node 6 6c) — operator console login request. A single shared access
 * code gates the console's Stop-AI control. No PII.
 */
export class OperatorOrchestrationSessionRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  accessCode!: string;
}

export interface OperatorOrchestrationSessionResponseDto {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  expiresInSeconds: number;
  subject: string;
  /** Space-separated granted scopes — read + control, never approval. */
  scope: string;
}

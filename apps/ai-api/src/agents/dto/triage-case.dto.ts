import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  MinLength
} from "class-validator";

import { SAFE_CHAT_REQUEST_ID_PATTERN } from "../../chat/dto/chat-message.dto";

export const TRIAGE_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type TriagePriorityDto = (typeof TRIAGE_PRIORITIES)[number];

export class TriageCaseRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @IsOptional()
  @IsIn(TRIAGE_PRIORITIES)
  reportedPriority?: TriagePriorityDto;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(SAFE_CHAT_REQUEST_ID_PATTERN)
  requestId?: string;
}

export interface TriageCaseResponseDto {
  recommendedPriority: TriagePriorityDto;
  summary: string;
  suggestedNextStep: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

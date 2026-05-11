import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

export const CHAT_ROLES = ["system", "user", "assistant"] as const;
export type ChatRoleDto = (typeof CHAT_ROLES)[number];

export class ChatMessageItemDto {
  @IsIn(CHAT_ROLES)
  role!: ChatRoleDto;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;
}

export class ChatMessageRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageItemDto)
  messages!: ChatMessageItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  maxTokens?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;
}

export interface ChatMessageResponseDto {
  content: string;
  finishReason?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
  fallbackUsed: boolean;
  attemptedProviders: string[];
  latencyMs: number;
  responseId?: string;
}

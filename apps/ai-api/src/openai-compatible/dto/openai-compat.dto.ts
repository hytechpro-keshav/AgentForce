import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

export const OPENAI_COMPAT_ROLES = [
  "system",
  "user",
  "assistant",
  "tool"
] as const;
export type OpenAiCompatRole = (typeof OPENAI_COMPAT_ROLES)[number];

export class OpenAiCompatMessageDto {
  @IsIn(OPENAI_COMPAT_ROLES)
  role!: OpenAiCompatRole;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}

export class OpenAiCompatChatRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  model!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => OpenAiCompatMessageDto)
  messages!: OpenAiCompatMessageDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  max_tokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  max_completion_tokens?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  top_p?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(-2)
  @Max(2)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  presence_penalty?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(-2)
  @Max(2)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  frequency_penalty?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(1)
  n?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  seed?: number;

  @IsOptional()
  stop?: string | string[];

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/naming-convention
  logit_bias?: Record<string, number>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  tools?: unknown[];

  @IsOptional()
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tool_choice?: unknown;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/naming-convention
  response_format?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/naming-convention
  stream_options?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  user?: string;
}

export interface OpenAiCompatModelsResponse {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    owned_by: string;
  }>;
}

export interface OpenAiCompatChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

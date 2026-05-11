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
  @Min(0)
  @Max(2)
  temperature?: number;

  // Streaming is intentionally not supported in this phase; if a
  // client sends stream=true we will respond with a non-streamed
  // payload and let observability flag the mismatch.
  @IsOptional()
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

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested
} from "class-validator";

export class IntakeTurnMessageDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;
}

export class IntakeTurnRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => IntakeTurnMessageDto)
  messages!: IntakeTurnMessageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;
}

export interface IntakeTurnExtractedDto {
  subject?: string;
  description?: string;
  priority?: "Low" | "Medium" | "High";
}

export interface IntakeTurnResponseDto {
  reply: string;
  extracted: IntakeTurnExtractedDto;
  /** True once the customer has described the issue (the required detail). */
  issueCaptured: boolean;
}

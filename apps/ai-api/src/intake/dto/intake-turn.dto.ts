import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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

/**
 * Live chat-UI state forwarded with each turn so the model never asks for
 * something the interface already answered. This is a conversational hint
 * only — identity stays bound to the JWT, and the assetId is resolved against
 * the server-side device catalog before it ever reaches the prompt.
 */
export class IntakeTurnUiStateDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  selectedAssetId?: string;

  /**
   * How many troubleshooting suggestions the assistant has already offered in
   * this conversation (client-counted from server-declared `offeredSuggestion`
   * flags). The server hard-caps suggestions at 2 based on this value.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  troubleshootingCount?: number;
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

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IntakeTurnUiStateDto)
  uiState?: IntakeTurnUiStateDto;
}

export interface IntakeTurnExtractedDto {
  subject?: string;
  description?: string;
  priority?: "Low" | "Medium" | "High";
  /** Set only when the customer asks for service somewhere other than the on-file ship-to. */
  serviceAddress?: string;
  /** Set only when the customer gives a different email for case updates. */
  contactEmail?: string;
  /** Set only when the customer gives a phone number for this case. */
  contactPhone?: string;
}

export type IntakeTurnUiAction =
  | "none"
  | "showDevicePicker"
  | "suggestDevice"
  /** Deprecated review-card cue; accepted for compat but mapped to "none". */
  | "showReview"
  /** Customer confirmed in chat — the client should create the Case now. */
  | "createCase"
  /** Customer asked about an existing ticket — the client shows live status. */
  | "showTicketStatus";

/** Widget cue chosen by the model (validated server-side) for this turn. */
export interface IntakeTurnUiDirectiveDto {
  action: IntakeTurnUiAction;
  /** Set with `suggestDevice`; resolved server-side from the model's 1-based device index. */
  suggestedAssetId?: string;
}

export interface IntakeTurnResponseDto {
  reply: string;
  extracted: IntakeTurnExtractedDto;
  /** True once the customer has described the issue (the required detail). */
  issueCaptured: boolean;
  ui: IntakeTurnUiDirectiveDto;
  /** Model's judgment (plus an anti-trap fallback) that the case is ready for review. */
  readyToSubmit: boolean;
  /**
   * True when this reply offers a troubleshooting suggestion to try. The
   * client counts these into `uiState.troubleshootingCount`; the server
   * clamps the flag to false once the 2-suggestion cap is reached.
   */
  offeredSuggestion: boolean;
}

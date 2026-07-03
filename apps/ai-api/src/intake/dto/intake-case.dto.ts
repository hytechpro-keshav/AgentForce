import { Type } from "class-transformer";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested
} from "class-validator";

/** Salesforce 15/18-char id — mirrors the gateway's SF_ID_PATTERN. */
const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export class IntakeShipToDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  country?: string;
}

export class IntakeCaseCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32000)
  issueDescription!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsOptional()
  @IsIn(["Low", "Medium", "High"])
  priority?: "Low" | "Medium" | "High";

  // The device chosen from the picker; ownership is re-checked server-side.
  @IsOptional()
  @IsString()
  @Matches(SF_ID)
  assetId?: string;

  /** Picker label fallback when the client omits assetId. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceLabel?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntakeShipToDto)
  shipTo?: IntakeShipToDto;
}

export interface IntakeCaseResponseDto {
  caseId: string;
  caseNumber?: string;
}

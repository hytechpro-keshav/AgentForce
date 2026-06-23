import { Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested
} from "class-validator";

export class DemoCaseShipToDto {
  @IsString()
  @MaxLength(80)
  city!: string;

  @IsString()
  @MaxLength(40)
  state!: string;

  @IsString()
  @MaxLength(40)
  country!: string;
}

export class DemoCaseAccountLookupDto {
  @IsString()
  @MaxLength(255)
  name!: string;
}

export class DemoCaseContactLookupDto {
  @IsString()
  @MaxLength(255)
  email!: string;
}

export class DemoCaseAssetLookupDto {
  @IsString()
  @MaxLength(80)
  serialNumber!: string;
}

export class DemoCaseFormDto {
  @IsString()
  @MaxLength(255)
  subject!: string;

  @IsString()
  @MaxLength(32000)
  description!: string;

  @IsString()
  @MaxLength(40)
  status!: string;

  @IsString()
  @MaxLength(40)
  origin!: string;

  @IsIn(["Low", "Medium", "High"])
  priority!: string;

  @ValidateNested()
  @Type(() => DemoCaseAccountLookupDto)
  accountLookup!: DemoCaseAccountLookupDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DemoCaseContactLookupDto)
  contactLookup?: DemoCaseContactLookupDto;

  @ValidateNested()
  @Type(() => DemoCaseAssetLookupDto)
  assetLookup!: DemoCaseAssetLookupDto;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  suppliedName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  suppliedEmail?: string;

  @ValidateNested()
  @Type(() => DemoCaseShipToDto)
  shipTo!: DemoCaseShipToDto;
}

export class DemoCaseCreateDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  scenarioId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DemoCaseFormDto)
  overrides?: Partial<DemoCaseFormDto>;

  @IsOptional()
  @ValidateNested()
  @Type(() => DemoCaseFormDto)
  form?: DemoCaseFormDto;
}

export class DemoCaseCreateResponseDto {
  caseId!: string;
  caseNumber?: string;
  orchestrationUrl!: string;
}

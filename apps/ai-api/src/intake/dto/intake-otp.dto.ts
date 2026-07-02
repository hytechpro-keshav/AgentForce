import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength
} from "class-validator";

export class OtpRequestDto {
  @IsString()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;
}

export class OtpVerifyDto {
  @IsString()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  // Numeric one-time code; length bounded to defend the verify path.
  @IsString()
  @Matches(/^[0-9]{4,8}$/)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;
}

export interface OtpRequestResponseDto {
  status: "sent";
  message: string;
}

export interface IntakeSessionResponseDto {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  expiresInSeconds: number;
  subject: string;
}

import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CustomerChatSessionRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  accessCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}

export interface CustomerChatSessionResponseDto {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  expiresInSeconds: number;
  subject: string;
}

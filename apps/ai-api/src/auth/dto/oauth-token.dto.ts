import { Transform } from "class-transformer";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength
} from "class-validator";

const OAUTH_SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const OAUTH_SCOPE_PATTERN = /^[A-Za-z0-9_.:-]+(?: [A-Za-z0-9_.:-]+)*$/;

class OAuthTokenGrantDto {
  @IsString()
  @IsIn(["client_credentials"])
  grant_type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value
  )
  @Matches(OAUTH_SCOPE_PATTERN)
  scope?: string;
}

export class OAuthTokenBodyDto extends OAuthTokenGrantDto {
  @IsOptional()
  @IsString()
  @Matches(OAUTH_SAFE_IDENTIFIER_PATTERN)
  client_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  client_secret?: string;
}

export class OAuthTokenRequestDto extends OAuthTokenGrantDto {
  @IsString()
  @Matches(OAUTH_SAFE_IDENTIFIER_PATTERN)
  client_id!: string;

  @IsString()
  @MaxLength(2048)
  client_secret!: string;
}

export interface OAuthTokenResponseDto {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

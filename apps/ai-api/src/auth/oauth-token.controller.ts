import { Body, Controller, Post, Req } from "@nestjs/common";

import {
  OAuthTokenRequestDto,
  type OAuthTokenResponseDto
} from "./dto/oauth-token.dto";
import { OAuthTokenService } from "./oauth-token.service";
import { Public } from "./public.decorator";

interface OAuthRequest {
  ip?: string;
  headers?: Record<string, unknown>;
}

@Controller("oauth")
export class OAuthTokenController {
  constructor(private readonly tokens: OAuthTokenService) {}

  @Public()
  @Post("token")
  issueToken(
    @Body() body: OAuthTokenRequestDto,
    @Req() request: OAuthRequest
  ): OAuthTokenResponseDto {
    return this.tokens.issueToken(body, this.clientKey(request));
  }

  private clientKey(request: OAuthRequest): string {
    const forwardedFor = request.headers?.["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0]?.trim() ?? "ip-unknown";
    }
    return request.ip ?? "ip-unknown";
  }
}

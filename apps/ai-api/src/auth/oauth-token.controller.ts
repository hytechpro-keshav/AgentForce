import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req
} from "@nestjs/common";
import type { IncomingHttpHeaders } from "http";

import {
  OAuthTokenBodyDto,
  OAuthTokenRequestDto,
  type OAuthTokenResponseDto
} from "./dto/oauth-token.dto";
import { OAuthTokenService } from "./oauth-token.service";
import { Public } from "./public.decorator";

interface OAuthRequest {
  ip?: string;
  headers?: IncomingHttpHeaders;
}

@Controller("oauth")
export class OAuthTokenController {
  constructor(private readonly tokens: OAuthTokenService) {}

  @Public()
  @Post("token")
  issueToken(
    @Body() body: OAuthTokenBodyDto,
    @Req() request: OAuthRequest
  ): Promise<OAuthTokenResponseDto> {
    return this.tokens.issueToken(
      this.normalizeRequest(body, request),
      this.clientKey(request)
    );
  }

  private normalizeRequest(
    body: OAuthTokenBodyDto,
    request: OAuthRequest
  ): OAuthTokenRequestDto {
    const basicCredentials = this.parseBasicAuthorization(
      request.headers?.authorization
    );

    const clientId = body.client_id ?? basicCredentials?.clientId;
    const clientSecret = body.client_secret ?? basicCredentials?.clientSecret;
    if (!clientId || !clientSecret) {
      throw new BadRequestException({
        error: "invalid_request",
        message: "Client credentials are required."
      });
    }

    return {
      grant_type: body.grant_type,
      client_id: clientId,
      client_secret: clientSecret,
      ...(body.scope ? { scope: body.scope } : {})
    };
  }

  private clientKey(request: OAuthRequest): string {
    const forwardedFor = this.firstHeaderValue(
      request.headers?.["x-forwarded-for"]
    );
    if (forwardedFor?.trim()) {
      return forwardedFor.split(",")[0]?.trim() ?? "ip-unknown";
    }
    return request.ip ?? "ip-unknown";
  }

  private parseBasicAuthorization(
    authorizationHeader: string | string[] | undefined
  ): { clientId: string; clientSecret: string } | null {
    const headerValue = this.firstHeaderValue(authorizationHeader);
    if (!headerValue) {
      return null;
    }

    const [scheme, encodedCredentials] = headerValue.split(" ", 2);
    if (scheme?.toLowerCase() !== "basic" || !encodedCredentials) {
      return null;
    }

    try {
      const decoded = Buffer.from(encodedCredentials, "base64").toString(
        "utf8"
      );
      const separatorIndex = decoded.indexOf(":");
      if (separatorIndex <= 0) {
        return null;
      }

      const clientId = decoded.slice(0, separatorIndex);
      const clientSecret = decoded.slice(separatorIndex + 1);
      if (!clientId || !clientSecret) {
        return null;
      }

      return { clientId, clientSecret };
    } catch {
      return null;
    }
  }

  private firstHeaderValue(
    value: string | string[] | undefined
  ): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}

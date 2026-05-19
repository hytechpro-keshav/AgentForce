import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "crypto";
import * as jwt from "jsonwebtoken";

import type { OAuthClientConfig } from "../config/app-config.service";
import { AppConfigService } from "../config/app-config.service";
import type {
  OAuthTokenRequestDto,
  OAuthTokenResponseDto
} from "./dto/oauth-token.dto";

@Injectable()
export class OAuthTokenService {
  private readonly logger = new Logger(OAuthTokenService.name);

  constructor(private readonly config: AppConfigService) {}

  issueToken(
    request: OAuthTokenRequestDto,
    clientKey: string
  ): OAuthTokenResponseDto {
    const { secret, issuer, audience } = this.config.jwt;
    if (!secret) {
      throw new ServiceUnavailableException({
        error: "oauth_unavailable",
        message: "OAuth token issuance is not configured."
      });
    }

    const client = this.config.oauth.clients.find(
      (candidate) => candidate.clientId === request.client_id
    );
    if (!client || client.status !== "active") {
      this.warnRejected("client_unavailable", request.client_id, clientKey);
      throw new UnauthorizedException({
        error: "invalid_client",
        message: "Client authentication failed."
      });
    }

    if (!OAuthTokenService.matchesSecret(request.client_secret, client)) {
      this.warnRejected("secret_mismatch", request.client_id, clientKey);
      throw new UnauthorizedException({
        error: "invalid_client",
        message: "Client authentication failed."
      });
    }

    const scopes = OAuthTokenService.resolveScopes(request.scope, client);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds =
      nowSeconds + this.config.oauth.accessTokenTtlSeconds;
    const payload: jwt.JwtPayload = {
      sub: client.subject,
      scope: scopes.join(" "),
      tenant: client.tenantId,
      sf_org_id: client.salesforceOrgId,
      client_id: client.clientId,
      rag_namespace: client.ragNamespace,
      roles: client.roles,
      iat: nowSeconds,
      exp: expiresAtSeconds
    };

    const accessToken = jwt.sign(payload, secret, {
      algorithm: "HS256",
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {})
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.config.oauth.accessTokenTtlSeconds,
      scope: scopes.join(" ")
    };
  }

  private static resolveScopes(
    requestedScope: string | undefined,
    client: OAuthClientConfig
  ): string[] {
    const requestedScopes = requestedScope
      ? requestedScope
          .split(" ")
          .map((scope) => scope.trim())
          .filter(Boolean)
      : client.scopes;
    const allowedScopes = new Set(client.scopes);
    const deniedScope = requestedScopes.find(
      (scope) => !allowedScopes.has(scope)
    );
    if (!requestedScopes.length || deniedScope) {
      throw new BadRequestException({
        error: "invalid_scope",
        message: "Requested scope is not allowed for this client."
      });
    }
    return Array.from(new Set(requestedScopes));
  }

  private static matchesSecret(
    clientSecret: string,
    client: OAuthClientConfig
  ): boolean {
    const actual = createHash("sha256").update(clientSecret).digest("hex");
    const left = Buffer.from(actual, "hex");
    const right = Buffer.from(client.clientSecretSha256, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private warnRejected(
    reason: string,
    clientId: string,
    clientKey: string
  ): void {
    this.logger.warn(
      `OAuth token request rejected reason=${reason} clientHash=${this.safeHash(clientId)} sourceHash=${this.safeHash(clientKey)}`
    );
  }

  private safeHash(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
  }
}

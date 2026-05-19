import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import type {
  OAuthTokenRequestDto,
  OAuthTokenResponseDto
} from "./dto/oauth-token.dto";
import {
  TenantRegistryService,
  type OAuthClientGrant
} from "./tenant-registry.service";

@Injectable()
export class OAuthTokenService {
  private readonly logger = new Logger(OAuthTokenService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly tenantRegistry: TenantRegistryService
  ) {}

  async issueToken(
    request: OAuthTokenRequestDto,
    clientKey: string
  ): Promise<OAuthTokenResponseDto> {
    const { secret, issuer, audience } = this.config.jwt;
    if (!secret) {
      throw new ServiceUnavailableException({
        error: "oauth_unavailable",
        message: "OAuth token issuance is not configured."
      });
    }

    const client = await this.tenantRegistry.findOAuthClient(request.client_id);
    if (
      !client ||
      client.status !== "active" ||
      client.tenantStatus !== "active"
    ) {
      await this.warnRejected(
        "client_unavailable",
        request.client_id,
        clientKey
      );
      throw new UnauthorizedException({
        error: "invalid_client",
        message: "Client authentication failed."
      });
    }

    if (!this.matchesSecret(request.client_secret, client)) {
      await this.warnRejected("secret_mismatch", request.client_id, clientKey);
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

    const tokenResponse: OAuthTokenResponseDto = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.config.oauth.accessTokenTtlSeconds,
      scope: scopes.join(" ")
    };

    await Promise.all([
      this.tenantRegistry.recordOAuthClientUsed(client.clientId),
      this.tenantRegistry.recordAuditEvent({
        eventType: "token_issued",
        clientId: client.clientId,
        tenantId: client.tenantId,
        outcome: "success",
        clientHash: this.safeHash(client.clientId),
        sourceHash: this.safeHash(clientKey)
      })
    ]);

    return tokenResponse;
  }

  private static resolveScopes(
    requestedScope: string | undefined,
    client: OAuthClientGrant
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

  private matchesSecret(
    clientSecret: string,
    client: OAuthClientGrant
  ): boolean {
    const actual = this.hashClientSecret(clientSecret);
    if (OAuthTokenService.safeEqualHex(actual, client.clientSecretSha256)) {
      return true;
    }

    if (!client.pendingClientSecretSha256) {
      return false;
    }
    if (
      client.pendingSecretExpiresAt &&
      client.pendingSecretExpiresAt.getTime() <= Date.now()
    ) {
      return false;
    }
    return OAuthTokenService.safeEqualHex(
      actual,
      client.pendingClientSecretSha256
    );
  }

  private hashClientSecret(clientSecret: string): string {
    const pepper = this.config.oauth.clientSecretHashPepper;
    if (pepper) {
      return createHmac("sha256", pepper).update(clientSecret).digest("hex");
    }
    return createHash("sha256").update(clientSecret).digest("hex");
  }

  private static safeEqualHex(leftHex: string, rightHex: string): boolean {
    const left = Buffer.from(leftHex, "hex");
    const right = Buffer.from(rightHex, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private async warnRejected(
    reason: string,
    clientId: string,
    clientKey: string
  ): Promise<void> {
    this.logger.warn(
      `OAuth token request rejected reason=${reason} clientHash=${this.safeHash(clientId)} sourceHash=${this.safeHash(clientKey)}`
    );
    await this.tenantRegistry.recordAuditEvent({
      eventType: "token_rejected",
      clientId,
      outcome: "error",
      reason,
      clientHash: this.safeHash(clientId),
      sourceHash: this.safeHash(clientKey)
    });
  }

  private safeHash(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
  }
}

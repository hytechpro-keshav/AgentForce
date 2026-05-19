import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, timingSafeEqual } from "crypto";
import * as jwt from "jsonwebtoken";

import type { AgentforceServiceBearerConfig } from "../config/app-config.service";
import { AppConfigService } from "../config/app-config.service";
import { PUBLIC_ROUTE_KEY } from "./public.decorator";
import { REQUIRED_SCOPES_KEY } from "./require-scopes.decorator";
import { TenantRegistryService } from "./tenant-registry.service";

export interface AuthenticatedRequest {
  authPrincipal?: AuthPrincipal;
}

export interface AuthPrincipal {
  subject: string;
  scopes: string[];
  tenantId?: string;
  raw: jwt.JwtPayload;
}

/**
 * Minimal JWT bearer auth guard for the AI API.
 *
 * Verification policy:
 * - When `AI_API_AUTH_DISABLED=true`, the guard allows all routes
 *   (intended for local development and tests only).
 * - Otherwise an `AI_API_JWT_SECRET` is required and the
 *   `Authorization: Bearer <token>` header must verify with HS256.
 * - Public routes (`@Public()`) bypass the guard.
 *
 * The health bridge controller is intentionally not wired behind
 * this guard — it keeps its own pre-shared key check so the
 * Phase 1 Salesforce Named Credential path remains unchanged.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
    private readonly tenantRegistry: TenantRegistryService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (isPublic) {
      return true;
    }

    const {
      disabled,
      secret,
      issuer,
      audience,
      agentforceServiceBearer,
      agentforceServiceBearers = []
    } = this.config.jwt;
    const configuredServiceBearers = agentforceServiceBearers.length
      ? agentforceServiceBearers
      : agentforceServiceBearer
        ? [agentforceServiceBearer]
        : [];
    if (disabled) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<
        { headers?: Record<string, unknown> } & AuthenticatedRequest
      >();
    const token = JwtAuthGuard.extractBearer(request.headers);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const servicePrincipal = JwtAuthGuard.authenticateAgentforceServiceBearer(
      token,
      configuredServiceBearers
    );
    if (servicePrincipal) {
      this.assertRequiredScopes(context, servicePrincipal.scopes);
      request.authPrincipal = servicePrincipal;
      return true;
    }

    if (!secret) {
      if (configuredServiceBearers.length) {
        throw new UnauthorizedException("Invalid bearer token.");
      }
      // Fail closed rather than silently allowing traffic.
      throw new ServiceUnavailableException("AI API auth is not configured.");
    }

    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        ...(issuer ? { issuer } : {}),
        ...(audience ? { audience } : {})
      });
      if (typeof verified === "string") {
        throw new UnauthorizedException("Invalid bearer token.");
      }
      payload = verified;
    } catch (err) {
      // Do not log the token; log only the error class.
      this.logger.warn(
        `JWT verification failed: ${(err as Error).name ?? "unknown"}`
      );
      throw new UnauthorizedException("Invalid bearer token.");
    }

    const subject = typeof payload.sub === "string" ? payload.sub : "anonymous";
    const rawScopes = payload["scope"];
    const scopes =
      typeof rawScopes === "string"
        ? rawScopes.split(" ").filter(Boolean)
        : Array.isArray(payload["scopes"])
          ? (payload["scopes"] as string[])
          : [];
    const tenantId =
      typeof payload["tenant"] === "string"
        ? (payload["tenant"] as string)
        : undefined;

    await this.assertOAuthTenantActive(payload, scopes, tenantId);
    this.assertRequiredScopes(context, scopes);

    request.authPrincipal = { subject, scopes, tenantId, raw: payload };
    return true;
  }

  private async assertOAuthTenantActive(
    payload: jwt.JwtPayload,
    scopes: string[],
    tokenTenantId: string | undefined
  ): Promise<void> {
    const clientId = payload["client_id"];
    if (typeof clientId !== "string") {
      return;
    }

    let client;
    try {
      client = await this.tenantRegistry.findOAuthClient(clientId);
    } catch (err) {
      this.logger.warn(
        `OAuth tenant registry lookup failed: ${(err as Error).name}`
      );
      throw new ServiceUnavailableException(
        "AI API tenant registry is unavailable."
      );
    }
    if (
      !client ||
      client.status !== "active" ||
      client.tenantStatus !== "active" ||
      (tokenTenantId && tokenTenantId !== client.tenantId)
    ) {
      throw new UnauthorizedException("Bearer token tenant is not active.");
    }

    const allowedScopes = new Set(client.scopes);
    if (scopes.some((scope) => !allowedScopes.has(scope))) {
      throw new ForbiddenException(
        "Bearer token includes a scope that is no longer allowed."
      );
    }
  }

  private assertRequiredScopes(
    context: ExecutionContext,
    scopes: string[]
  ): void {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (
      requiredScopes?.length &&
      !requiredScopes.every((requiredScope) => scopes.includes(requiredScope))
    ) {
      throw new ForbiddenException("Bearer token is missing a required scope.");
    }
  }

  private static authenticateAgentforceServiceBearer(
    token: string,
    configs: AgentforceServiceBearerConfig[]
  ): AuthPrincipal | undefined {
    const tokenSha256 = createHash("sha256").update(token).digest("hex");
    const config = configs.find((candidate) =>
      JwtAuthGuard.safeEqualHex(tokenSha256, candidate.tokenSha256)
    );
    if (!config) {
      return undefined;
    }
    const raw: jwt.JwtPayload = {
      sub: config.subject,
      scope: config.scopes.join(" "),
      tenant: config.tenantId,
      rag_namespace: config.ragNamespace,
      roles: config.roles
    };
    return {
      subject: config.subject,
      scopes: config.scopes,
      tenantId: config.tenantId,
      raw
    };
  }

  private static safeEqualHex(a: string, b: string): boolean {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private static extractBearer(
    headers: Record<string, unknown> | undefined
  ): string | undefined {
    if (!headers) return undefined;
    const raw = headers["authorization"] ?? headers["Authorization"];
    if (typeof raw !== "string") return undefined;
    const [scheme, token] = raw.split(" ");
    if (!token || scheme?.toLowerCase() !== "bearer") return undefined;
    return token.trim() || undefined;
  }
}

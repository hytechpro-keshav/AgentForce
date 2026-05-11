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
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import { PUBLIC_ROUTE_KEY } from "./public.decorator";
import { REQUIRED_SCOPES_KEY } from "./require-scopes.decorator";

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
    private readonly config: AppConfigService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (isPublic) {
      return true;
    }

    const { disabled, secret, issuer, audience } = this.config.jwt;
    if (disabled) {
      return true;
    }
    if (!secret) {
      // Fail closed rather than silently allowing traffic.
      throw new ServiceUnavailableException("AI API auth is not configured.");
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

    request.authPrincipal = { subject, scopes, tenantId, raw: payload };
    return true;
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

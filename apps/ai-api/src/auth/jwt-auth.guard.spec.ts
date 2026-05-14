import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { PUBLIC_ROUTE_KEY } from "./public.decorator";
import { REQUIRED_SCOPES_KEY } from "./require-scopes.decorator";

function makeContext(
  headers: Record<string, string> = {},
  isPublic = false,
  requiredScopes: string[] = []
): {
  ctx: ExecutionContext;
  reflector: Reflector;
  req: { headers: Record<string, string>; authPrincipal?: unknown };
} {
  const req: { headers: Record<string, string>; authPrincipal?: unknown } = {
    headers
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {}
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === PUBLIC_ROUTE_KEY) return isPublic;
      if (key === REQUIRED_SCOPES_KEY) return requiredScopes;
      return undefined;
    })
  } as unknown as Reflector;
  return { ctx, reflector, req };
}

function makeGuard(
  jwtConfig: Partial<AppConfigService["jwt"]> = {},
  reflector?: Reflector
): JwtAuthGuard {
  const config = {
    jwt: { disabled: false, ...jwtConfig }
  } as unknown as AppConfigService;
  return new JwtAuthGuard(reflector ?? ({} as Reflector), config);
}

describe("JwtAuthGuard", () => {
  it("allows requests when AI_API_AUTH_DISABLED=true", () => {
    const { ctx, reflector } = makeContext({});
    const guard = makeGuard({ disabled: true }, reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("allows public routes without a token", () => {
    const { ctx, reflector } = makeContext({}, true);
    const guard = makeGuard({}, reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("fails closed when no secret is configured", () => {
    const { ctx, reflector } = makeContext({ authorization: "Bearer x" });
    const guard = makeGuard({}, reflector);
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });

  it("rejects missing bearer token", () => {
    const { ctx, reflector } = makeContext({});
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects an invalid bearer token", () => {
    const { ctx, reflector } = makeContext({
      authorization: "Bearer not-a-jwt"
    });
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("accepts a valid HS256 token and stores the principal", () => {
    const token = jwt.sign(
      { sub: "service-account", scope: "chat:write", tenant: "tenant-a" },
      "test-secret",
      { algorithm: "HS256" }
    );
    const { ctx, reflector, req } = makeContext({
      authorization: `Bearer ${token}`
    });
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.authPrincipal).toMatchObject({
      subject: "service-account",
      scopes: ["chat:write"],
      tenantId: "tenant-a"
    });
  });

  it("rejects a valid token missing a required scope", () => {
    const token = jwt.sign(
      { sub: "service-account", scope: "chat:write" },
      "test-secret",
      { algorithm: "HS256" }
    );
    const { ctx, reflector } = makeContext(
      { authorization: `Bearer ${token}` },
      false,
      ["agentforce:support-triage"]
    );
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("accepts a valid token with all required scopes", () => {
    const token = jwt.sign(
      { sub: "service-account", scope: "chat:write agentforce:support-triage" },
      "test-secret",
      { algorithm: "HS256" }
    );
    const { ctx, reflector } = makeContext(
      { authorization: `Bearer ${token}` },
      false,
      ["agentforce:support-triage"]
    );
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("accepts a configured Agentforce service bearer without a JWT secret", () => {
    const token = "opaque-agentforce-service-token";
    const { ctx, reflector, req } = makeContext(
      { authorization: `Bearer ${token}` },
      false,
      ["agentforce:knowledge-rag"]
    );
    const guard = makeGuard(
      {
        agentforceServiceBearer: {
          tokenSha256: sha256(token),
          subject: "salesforce-agentforce",
          tenantId: "tenant-demo",
          ragNamespace: "customer-self-service",
          scopes: [
            "agentforce:support-triage",
            "agentforce:case-analysis",
            "agentforce:knowledge-rag"
          ],
          roles: ["support-agent"]
        }
      },
      reflector
    );

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.authPrincipal).toMatchObject({
      subject: "salesforce-agentforce",
      scopes: [
        "agentforce:support-triage",
        "agentforce:case-analysis",
        "agentforce:knowledge-rag"
      ],
      tenantId: "tenant-demo",
      raw: {
        rag_namespace: "customer-self-service",
        roles: ["support-agent"]
      }
    });
  });

  it("rejects a configured Agentforce service bearer missing a required scope", () => {
    const token = "opaque-agentforce-service-token";
    const { ctx, reflector } = makeContext(
      { authorization: `Bearer ${token}` },
      false,
      ["agentforce:knowledge-rag"]
    );
    const guard = makeGuard(
      {
        agentforceServiceBearer: {
          tokenSha256: sha256(token),
          subject: "salesforce-agentforce",
          tenantId: "tenant-demo",
          ragNamespace: "customer-self-service",
          scopes: ["agentforce:support-triage"],
          roles: ["support-agent"]
        }
      },
      reflector
    );

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("rejects an invalid service bearer when no JWT secret is configured", () => {
    const { ctx, reflector } = makeContext({ authorization: "Bearer wrong" });
    const guard = makeGuard(
      {
        agentforceServiceBearer: {
          tokenSha256: sha256("expected"),
          subject: "salesforce-agentforce",
          tenantId: "tenant-demo",
          ragNamespace: "customer-self-service",
          scopes: ["agentforce:knowledge-rag"],
          roles: ["support-agent"]
        }
      },
      reflector
    );

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

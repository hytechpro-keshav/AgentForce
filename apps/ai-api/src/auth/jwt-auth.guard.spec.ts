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
import type { OAuthClientGrant } from "./tenant-registry.service";
import { TenantRegistryService } from "./tenant-registry.service";

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
  reflector?: Reflector,
  tenantRegistry: Partial<TenantRegistryService> = {
    findOAuthClient: jest.fn(async () => undefined)
  }
): JwtAuthGuard {
  const config = {
    jwt: { disabled: false, ...jwtConfig }
  } as unknown as AppConfigService;
  return new JwtAuthGuard(
    reflector ?? ({} as Reflector),
    config,
    tenantRegistry as TenantRegistryService
  );
}

describe("JwtAuthGuard", () => {
  it("allows requests when AI_API_AUTH_DISABLED=true", async () => {
    const { ctx, reflector } = makeContext({});
    const guard = makeGuard({ disabled: true }, reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("allows public routes without a token", async () => {
    const { ctx, reflector } = makeContext({}, true);
    const guard = makeGuard({}, reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("fails closed when no secret is configured", async () => {
    const { ctx, reflector } = makeContext({ authorization: "Bearer x" });
    const guard = makeGuard({}, reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      ServiceUnavailableException
    );
  });

  it("rejects missing bearer token", async () => {
    const { ctx, reflector } = makeContext({});
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an invalid bearer token", async () => {
    const { ctx, reflector } = makeContext({
      authorization: "Bearer not-a-jwt"
    });
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("accepts a valid HS256 token and stores the principal", async () => {
    const token = jwt.sign(
      { sub: "service-account", scope: "chat:write", tenant: "tenant-a" },
      "test-secret",
      { algorithm: "HS256" }
    );
    const { ctx, reflector, req } = makeContext({
      authorization: `Bearer ${token}`
    });
    const guard = makeGuard({ secret: "test-secret" }, reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.authPrincipal).toMatchObject({
      subject: "service-account",
      scopes: ["chat:write"],
      tenantId: "tenant-a"
    });
  });

  it("rejects a valid token missing a required scope", async () => {
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
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("accepts a valid token with all required scopes", async () => {
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
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("checks durable tenant status for OAuth-issued access tokens", async () => {
    const client = baseClientGrant();
    const token = jwt.sign(
      {
        sub: client.subject,
        scope: "agentforce:services-project-health",
        tenant: client.tenantId,
        client_id: client.clientId
      },
      "test-secret",
      { algorithm: "HS256" }
    );
    const { ctx, reflector } = makeContext(
      { authorization: `Bearer ${token}` },
      false,
      ["agentforce:services-project-health"]
    );
    const tenantRegistry = {
      findOAuthClient: jest.fn(async () => client)
    };
    const guard = makeGuard(
      { secret: "test-secret" },
      reflector,
      tenantRegistry
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tenantRegistry.findOAuthClient).toHaveBeenCalledWith(
      "certinia-phase8-oauth"
    );
  });

  it("rejects OAuth-issued tokens for suspended tenants", async () => {
    const client = baseClientGrant({ tenantStatus: "suspended" });
    const token = jwt.sign(
      {
        sub: client.subject,
        scope: "agentforce:services-project-health",
        tenant: client.tenantId,
        client_id: client.clientId
      },
      "test-secret",
      { algorithm: "HS256" }
    );
    const { ctx, reflector } = makeContext({
      authorization: `Bearer ${token}`
    });
    const guard = makeGuard({ secret: "test-secret" }, reflector, {
      findOAuthClient: jest.fn(async () => client)
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("fails closed when OAuth tenant registry lookup fails", async () => {
    const client = baseClientGrant();
    const token = jwt.sign(
      {
        sub: client.subject,
        scope: "agentforce:services-project-health",
        tenant: client.tenantId,
        client_id: client.clientId
      },
      "test-secret",
      { algorithm: "HS256" }
    );
    const { ctx, reflector } = makeContext({
      authorization: `Bearer ${token}`
    });
    const guard = makeGuard({ secret: "test-secret" }, reflector, {
      findOAuthClient: jest.fn(async () => {
        throw new Error("database unavailable");
      })
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      ServiceUnavailableException
    );
  });

  it("accepts a configured Agentforce service bearer without a JWT secret", async () => {
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

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
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

  it("accepts one of multiple isolated Agentforce service bearers", async () => {
    const phase8Token = "phase8-agentforce-token";
    const otherOrgToken = "other-org-agentforce-token";
    const { ctx, reflector, req } = makeContext(
      { authorization: `Bearer ${otherOrgToken}` },
      false,
      ["agentforce:case-analysis"]
    );
    const guard = makeGuard(
      {
        agentforceServiceBearers: [
          {
            tokenSha256: sha256(phase8Token),
            subject: "certinia-phase8-agentforce",
            tenantId: "certinia-phase8",
            ragNamespace: "phase8-rag",
            scopes: ["agentforce:services-project-health"],
            roles: ["services-org-intelligence"]
          },
          {
            tokenSha256: sha256(otherOrgToken),
            subject: "other-org-agentforce",
            tenantId: "other-org",
            ragNamespace: "other-rag",
            scopes: ["agentforce:support-triage", "agentforce:case-analysis"],
            roles: ["support-agent"]
          }
        ]
      },
      reflector
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.authPrincipal).toMatchObject({
      subject: "other-org-agentforce",
      tenantId: "other-org",
      scopes: ["agentforce:support-triage", "agentforce:case-analysis"],
      raw: {
        rag_namespace: "other-rag",
        roles: ["support-agent"]
      }
    });
  });

  it("rejects a configured Agentforce service bearer missing a required scope", async () => {
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

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("rejects an invalid service bearer when no JWT secret is configured", async () => {
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

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});

function baseClientGrant(
  overrides: Partial<OAuthClientGrant> = {}
): OAuthClientGrant {
  return {
    clientId: "certinia-phase8-oauth",
    clientSecretSha256: sha256("phase8-secret"),
    subject: "salesforce-org:00D000000000001",
    tenantId: "certinia-phase8",
    salesforceOrgId: "00D000000000001",
    ragNamespace: "certinia-phase8",
    scopes: ["agentforce:services-project-health"],
    roles: ["services-org-intelligence"],
    status: "active",
    tenantStatus: "active",
    ...overrides
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

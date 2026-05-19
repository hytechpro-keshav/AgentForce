import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, createHmac } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import { OAuthTokenService } from "./oauth-token.service";
import type {
  OAuthAuditEvent,
  OAuthClientGrant
} from "./tenant-registry.service";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

function baseClient(
  overrides: Partial<OAuthClientGrant> = {}
): OAuthClientGrant {
  return {
    clientId: "certinia-phase8-oauth",
    clientSecretSha256: sha256("phase8-secret"),
    subject: "salesforce-org:00D000000000001",
    tenantId: "certinia-phase8",
    salesforceOrgId: "00D000000000001",
    ragNamespace: "certinia-phase8",
    scopes: ["agentforce:support-triage", "agentforce:services-project-health"],
    roles: ["services-org-intelligence"],
    status: "active",
    tenantStatus: "active",
    ...overrides
  };
}

function buildService(
  options: {
    client?: OAuthClientGrant;
    jwtSecret?: string;
    clientSecretHashPepper?: string;
  } = {}
): {
  service: OAuthTokenService;
  registry: {
    findOAuthClient: jest.Mock<Promise<OAuthClientGrant | undefined>, [string]>;
    recordOAuthClientUsed: jest.Mock<Promise<void>, [string]>;
    recordAuditEvent: jest.Mock<Promise<void>, [OAuthAuditEvent]>;
  };
} {
  const config = {
    jwt: {
      secret: options.jwtSecret ?? "oauth-test-secret",
      issuer: "https://api.example.test",
      audience: "agentforce-ai-api",
      disabled: false,
      agentforceServiceBearers: []
    },
    oauth: {
      accessTokenTtlSeconds: 900,
      clientSecretHashPepper: options.clientSecretHashPepper
    }
  } as unknown as AppConfigService;
  if (options.jwtSecret === undefined) {
    config.jwt.secret = undefined;
  }
  const registry = {
    findOAuthClient: jest.fn(
      async (_clientId: string) => options.client ?? baseClient()
    ),
    recordOAuthClientUsed: jest.fn(async (_clientId: string) => undefined),
    recordAuditEvent: jest.fn(async (_event: OAuthAuditEvent) => undefined)
  };
  return {
    service: new OAuthTokenService(config, registry as never),
    registry
  };
}

describe("OAuthTokenService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("issues a scoped token for valid client credentials", async () => {
    const { service, registry } = buildService({
      jwtSecret: "oauth-test-secret"
    });

    const response = await service.issueToken(
      {
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: "phase8-secret",
        scope: "agentforce:services-project-health"
      },
      "127.0.0.1"
    );

    expect(response).toMatchObject({
      token_type: "Bearer",
      expires_in: 900,
      scope: "agentforce:services-project-health"
    });
    const payload = jwt.verify(response.access_token, "oauth-test-secret", {
      issuer: "https://api.example.test",
      audience: "agentforce-ai-api"
    }) as jwt.JwtPayload;
    expect(payload).toMatchObject({
      sub: "salesforce-org:00D000000000001",
      tenant: "certinia-phase8",
      sf_org_id: "00D000000000001",
      client_id: "certinia-phase8-oauth",
      rag_namespace: "certinia-phase8",
      scope: "agentforce:services-project-health",
      roles: ["services-org-intelligence"]
    });
    expect(registry.recordOAuthClientUsed).toHaveBeenCalledWith(
      "certinia-phase8-oauth"
    );
    expect(registry.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "token_issued",
        tenantId: "certinia-phase8",
        outcome: "success"
      })
    );
  });

  it("accepts a pending rotation secret before expiry", async () => {
    const { service } = buildService({
      jwtSecret: "oauth-test-secret",
      client: baseClient({
        pendingClientSecretSha256: sha256("next-secret"),
        pendingSecretExpiresAt: new Date(Date.now() + 60000)
      })
    });

    const response = await service.issueToken(
      {
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: "next-secret"
      },
      "127.0.0.1"
    );

    expect(response.access_token).toBeTruthy();
  });

  it("supports HMAC-SHA256 client secret hashes with a pepper", async () => {
    const { service } = buildService({
      jwtSecret: "oauth-test-secret",
      clientSecretHashPepper: "phase2-pepper",
      client: baseClient({
        clientSecretSha256: hmacSha256("phase8-secret", "phase2-pepper")
      })
    });

    const response = await service.issueToken(
      {
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: "phase8-secret"
      },
      "127.0.0.1"
    );

    expect(response.access_token).toBeTruthy();
  });

  it("rejects expired pending rotation secrets", async () => {
    const { service } = buildService({
      jwtSecret: "oauth-test-secret",
      client: baseClient({
        pendingClientSecretSha256: sha256("next-secret"),
        pendingSecretExpiresAt: new Date(Date.now() - 60000)
      })
    });

    await expect(
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "next-secret"
        },
        "127.0.0.1"
      )
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects invalid secrets without logging the raw secret", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const { service, registry } = buildService({
      jwtSecret: "oauth-test-secret"
    });

    await expect(
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "wrong-secret",
          scope: "agentforce:services-project-health"
        },
        "127.0.0.1"
      )
    ).rejects.toThrow(UnauthorizedException);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("wrong-secret");
    expect(registry.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "token_rejected",
        reason: "secret_mismatch"
      })
    );
  });

  it("rejects suspended clients and tenants", async () => {
    await expect(
      buildService({
        jwtSecret: "oauth-test-secret",
        client: baseClient({ status: "suspended" })
      }).service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "phase8-secret"
        },
        "127.0.0.1"
      )
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      buildService({
        jwtSecret: "oauth-test-secret",
        client: baseClient({ tenantStatus: "suspended" })
      }).service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "phase8-secret"
        },
        "127.0.0.1"
      )
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects scopes outside the client grant", async () => {
    const { service } = buildService({ jwtSecret: "oauth-test-secret" });

    await expect(
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "phase8-secret",
          scope: "rag:ingest"
        },
        "127.0.0.1"
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("fails closed when token signing is not configured", async () => {
    const { service } = buildService();

    await expect(
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "phase8-secret"
        },
        "127.0.0.1"
      )
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

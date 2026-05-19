import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import { OAuthTokenService } from "./oauth-token.service";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildService(
  overrides: Partial<AppConfigService> = {}
): OAuthTokenService {
  const config = {
    jwt: {
      secret: "oauth-test-secret",
      issuer: "https://api.example.test",
      audience: "agentforce-ai-api",
      disabled: false,
      agentforceServiceBearers: []
    },
    oauth: {
      accessTokenTtlSeconds: 900,
      clients: [
        {
          clientId: "certinia-phase8-oauth",
          clientSecretSha256: sha256("phase8-secret"),
          subject: "salesforce-org:00D000000000001",
          tenantId: "certinia-phase8",
          salesforceOrgId: "00D000000000001",
          ragNamespace: "certinia-phase8",
          scopes: [
            "agentforce:support-triage",
            "agentforce:services-project-health"
          ],
          roles: ["services-org-intelligence"],
          status: "active" as const
        }
      ]
    },
    ...overrides
  } as unknown as AppConfigService;
  return new OAuthTokenService(config);
}

describe("OAuthTokenService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("issues a scoped token for valid client credentials", () => {
    const service = buildService();

    const response = service.issueToken(
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
  });

  it("rejects invalid secrets without logging the raw secret", () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const service = buildService();

    expect(() =>
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "wrong-secret",
          scope: "agentforce:services-project-health"
        },
        "127.0.0.1"
      )
    ).toThrow(UnauthorizedException);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("wrong-secret");
  });

  it("rejects suspended clients", () => {
    const service = buildService({
      oauth: {
        accessTokenTtlSeconds: 900,
        clients: [
          {
            clientId: "certinia-phase8-oauth",
            clientSecretSha256: sha256("phase8-secret"),
            subject: "salesforce-org:00D000000000001",
            tenantId: "certinia-phase8",
            salesforceOrgId: "00D000000000001",
            ragNamespace: "certinia-phase8",
            scopes: ["agentforce:services-project-health"],
            roles: ["services-org-intelligence"],
            status: "suspended"
          }
        ]
      }
    } as unknown as Partial<AppConfigService>);

    expect(() =>
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "phase8-secret"
        },
        "127.0.0.1"
      )
    ).toThrow(UnauthorizedException);
  });

  it("rejects scopes outside the client grant", () => {
    const service = buildService();

    expect(() =>
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "phase8-secret",
          scope: "rag:ingest"
        },
        "127.0.0.1"
      )
    ).toThrow(BadRequestException);
  });

  it("fails closed when token signing is not configured", () => {
    const service = buildService({
      jwt: {
        disabled: false,
        agentforceServiceBearers: []
      }
    } as unknown as Partial<AppConfigService>);

    expect(() =>
      service.issueToken(
        {
          grant_type: "client_credentials",
          client_id: "certinia-phase8-oauth",
          client_secret: "phase8-secret"
        },
        "127.0.0.1"
      )
    ).toThrow(ServiceUnavailableException);
  });
});

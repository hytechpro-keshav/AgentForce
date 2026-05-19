import { createHash } from "crypto";

import { AppConfigService } from "../config/app-config.service";
import { TenantRegistryService } from "./tenant-registry.service";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildConfig(
  overrides: Partial<AppConfigService> = {}
): AppConfigService {
  return {
    oauth: {
      accessTokenTtlSeconds: 900,
      clients: [
        {
          clientId: "certinia-phase8-oauth",
          clientSecretSha256: sha256("phase8-secret"),
          pendingClientSecretSha256: sha256("phase8-secret-next"),
          pendingSecretExpiresAt: "2026-01-02T03:04:05.000Z",
          subject: "salesforce-org:00D000000000001",
          tenantId: "certinia-phase8",
          salesforceOrgId: "00D000000000001",
          salesforceInstanceUrl: "https://certinia.example.my.salesforce.com",
          ragNamespace: "certinia-phase8",
          scopes: [
            "agentforce:services-project-health",
            "agentforce:case-analysis"
          ],
          roles: ["services-org-intelligence"],
          status: "active"
        }
      ],
      tenantRegistry: {
        provider: "config",
        autoMigrate: true,
        ssl: false,
        maxPoolSize: 5
      }
    },
    ...overrides
  } as unknown as AppConfigService;
}

function setPool(service: TenantRegistryService, pool: unknown): void {
  (service as unknown as { pool: unknown }).pool = pool;
}

describe("TenantRegistryService", () => {
  it("maps config-backed OAuth clients into tenant grants", async () => {
    const service = new TenantRegistryService(buildConfig());

    const client = await service.findOAuthClient("certinia-phase8-oauth");

    expect(client).toEqual({
      clientId: "certinia-phase8-oauth",
      clientSecretSha256: sha256("phase8-secret"),
      pendingClientSecretSha256: sha256("phase8-secret-next"),
      pendingSecretExpiresAt: new Date("2026-01-02T03:04:05.000Z"),
      subject: "salesforce-org:00D000000000001",
      tenantId: "certinia-phase8",
      salesforceOrgId: "00D000000000001",
      salesforceInstanceUrl: "https://certinia.example.my.salesforce.com",
      ragNamespace: "certinia-phase8",
      scopes: [
        "agentforce:services-project-health",
        "agentforce:case-analysis"
      ],
      roles: ["services-org-intelligence"],
      status: "active",
      tenantStatus: "active"
    });
  });

  it("returns undefined for unknown config-backed clients", async () => {
    const service = new TenantRegistryService(buildConfig());

    await expect(
      service.findOAuthClient("missing-client")
    ).resolves.toBeUndefined();
  });

  it("maps Postgres rows and intersects tenant/client scopes", async () => {
    const query = jest.fn(async () => ({
      rows: [
        {
          client_id: "certinia-phase8-oauth",
          client_secret_sha256: sha256("phase8-secret"),
          pending_client_secret_sha256: sha256("phase8-secret-next"),
          pending_secret_expires_at: new Date("2026-01-02T03:04:05.000Z"),
          subject: "salesforce-org:00D000000000001",
          tenant_id: "certinia-phase8",
          salesforce_org_id: "00D000000000001",
          salesforce_instance_url: "https://certinia.example.my.salesforce.com",
          rag_namespace: "certinia-phase8",
          client_scopes: [
            "agentforce:services-project-health",
            "agentforce:case-analysis"
          ],
          tenant_scopes: ["agentforce:services-project-health"],
          client_roles: [],
          tenant_roles: ["services-org-intelligence"],
          client_status: "active",
          tenant_status: "active"
        }
      ]
    }));
    const service = new TenantRegistryService(
      buildConfig({
        oauth: {
          ...buildConfig().oauth,
          tenantRegistry: {
            provider: "postgres",
            databaseUrl:
              "postgres://agentforce:secret@localhost:5432/agentforce",
            autoMigrate: true,
            ssl: false,
            maxPoolSize: 5
          }
        }
      } as unknown as Partial<AppConfigService>)
    );
    setPool(service, { query });

    const client = await service.findOAuthClient("certinia-phase8-oauth");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM ai_api_oauth_clients"),
      ["certinia-phase8-oauth"]
    );
    expect(client).toEqual(
      expect.objectContaining({
        clientId: "certinia-phase8-oauth",
        scopes: ["agentforce:services-project-health"],
        roles: ["services-org-intelligence"],
        tenantStatus: "active"
      })
    );
  });

  it("records Postgres last-used and audit events without raw secrets", async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const service = new TenantRegistryService(
      buildConfig({
        oauth: {
          ...buildConfig().oauth,
          tenantRegistry: {
            provider: "postgres",
            databaseUrl:
              "postgres://agentforce:secret@localhost:5432/agentforce",
            autoMigrate: true,
            ssl: false,
            maxPoolSize: 5
          }
        }
      } as unknown as Partial<AppConfigService>)
    );
    setPool(service, { query });

    await service.recordOAuthClientUsed("certinia-phase8-oauth");
    await service.recordAuditEvent({
      eventType: "token_rejected",
      clientId: "certinia-phase8-oauth",
      tenantId: "certinia-phase8",
      outcome: "error",
      reason: "secret_mismatch",
      clientHash: "abc123",
      sourceHash: "def456"
    });

    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining("UPDATE ai_api_oauth_clients"),
      ["certinia-phase8-oauth"]
    ]);
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining("INSERT INTO ai_api_oauth_audit_events"),
      [
        "token_rejected",
        "certinia-phase8-oauth",
        "certinia-phase8",
        "error",
        "secret_mismatch",
        "abc123",
        "def456"
      ]
    ]);
  });
});

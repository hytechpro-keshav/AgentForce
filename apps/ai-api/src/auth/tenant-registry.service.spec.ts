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

function postgresService(query: jest.Mock): TenantRegistryService {
  const service = new TenantRegistryService(
    buildConfig({
      oauth: {
        ...buildConfig().oauth,
        tenantRegistry: {
          provider: "postgres",
          databaseUrl: "postgres://agentforce:secret@localhost:5432/agentforce",
          autoMigrate: true,
          ssl: false,
          maxPoolSize: 5
        }
      }
    } as unknown as Partial<AppConfigService>)
  );
  setPool(service, { query });
  return service;
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
    const service = postgresService(query);

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
    const service = postgresService(query);

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

  it("blocks token issuance when durable quotas are exhausted", async () => {
    const query = jest.fn(async () => ({
      rows: [{ daily_issued: "10", monthly_issued: "11" }]
    }));
    const service = postgresService(query);

    const decision = await service.checkOAuthTokenQuota({
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
      dailyTokenQuota: 10,
      monthlyTokenQuota: 50
    });

    expect(decision).toEqual({
      allowed: false,
      reason: "daily_token_quota_exceeded",
      dailyIssued: 10,
      monthlyIssued: 11,
      dailyTokenQuota: 10,
      monthlyTokenQuota: 50
    });
  });

  it("builds operations reports with readiness and alerts", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: "certinia-phase8",
            salesforce_org_id: "00D000000000001",
            salesforce_instance_url:
              "https://certinia.example.my.salesforce.com",
            tenant_status: "active",
            rag_namespace: "certinia-phase8",
            tenant_scopes: ["agentforce:services-project-health"],
            tenant_roles: ["services-org-intelligence"],
            model_routing_profile: "services-default",
            rate_limit_profile: "standard",
            alert_policy: "ops-default",
            daily_token_quota: 10,
            monthly_token_quota: 100,
            monthly_cost_limit_cents: 2500,
            client_id: "certinia-phase8-oauth",
            client_status: "active",
            client_scopes: ["agentforce:services-project-health"],
            client_roles: ["services-org-intelligence"],
            last_used_at: new Date(),
            pending_secret_expires_at: null,
            rotation_due_at: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: "certinia-phase8",
            client_id: "certinia-phase8-oauth",
            event_type: "token_issued",
            total_count: "4",
            count_24h: "2"
          }
        ]
      });
    const service = postgresService(query);

    const report = await service.getTenantOperationsReport("certinia-phase8");

    expect(report).toMatchObject({
      tenantId: "certinia-phase8",
      quotas: {
        dailyTokenQuota: 10,
        monthlyTokenQuota: 100,
        monthlyCostLimitCents: 2500
      },
      audit: {
        tokenIssued24h: 2,
        tokenIssuedTotal: 4
      },
      readiness: expect.arrayContaining([
        "tenant_active",
        "project_health_scope_granted",
        "active_oauth_client_present",
        "model_policy_configured",
        "rate_or_quota_policy_configured"
      ]),
      clients: [expect.objectContaining({ clientId: "certinia-phase8-oauth" })]
    });
    expect(report?.alerts).not.toContain("token_quota_not_configured");
  });
});

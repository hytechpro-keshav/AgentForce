import { NotFoundException } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { TenantOperationsService } from "./tenant-operations.service";
import type {
  TenantOperationsReport,
  TenantRegistryService
} from "./tenant-registry.service";

const report: TenantOperationsReport = {
  tenantId: "certinia-phase8",
  salesforceOrgId: "00D000000000001",
  salesforceInstanceUrl: "https://certinia.example.my.salesforce.com",
  status: "active",
  ragNamespace: "certinia-phase8",
  scopes: ["agentforce:services-project-health"],
  roles: ["services-org-intelligence"],
  modelRoutingProfile: "services-default",
  rateLimitProfile: "standard",
  alertPolicy: "ops-default",
  quotas: {
    dailyTokenQuota: 100,
    monthlyTokenQuota: 1000,
    monthlyCostLimitCents: 2500
  },
  clients: [
    {
      clientId: "certinia-phase8-oauth",
      status: "active",
      scopes: ["agentforce:services-project-health"],
      roles: ["services-org-intelligence"]
    }
  ],
  audit: {
    tokenIssued24h: 2,
    tokenIssuedTotal: 8,
    tokenRejected24h: 0,
    tokenRejectedTotal: 0,
    quotaExceeded24h: 0
  },
  readiness: [
    "tenant_active",
    "project_health_scope_granted",
    "active_oauth_client_present"
  ],
  alerts: []
};

function buildService(
  tenantReport: TenantOperationsReport | null = report
): TenantOperationsService {
  const config = {
    salesforceOnboarding: {
      publicBaseUrl: "https://ai-api.example.test",
      namedCredentialApiName: "Agentforce_AI_API_Phase2",
      externalCredentialApiName: "Agentforce_AI_API_Phase2",
      principalApiName: "Agentforce_AI_API_Phase2_Principal",
      permissionSetApiName: "Services_Org_Intelligence_Agent",
      secureClientIdField: "AI_API_OAUTH_CLIENT_ID",
      secureClientSecretField: "AI_API_OAUTH_CLIENT_SECRET",
      tokenEndpointPath: "/oauth/token",
      projectHealthPath: "/agent/services/project-health",
      setupGuidePath: "docs/deployment/salesforce-oauth-onboarding-phase3.md"
    }
  } as unknown as AppConfigService;
  const registry = {
    getTenantOperationsReport: jest.fn(async () => tenantReport),
    listTenantOperationsReports: jest.fn(async () =>
      tenantReport ? [tenantReport] : []
    )
  } as unknown as TenantRegistryService;

  return new TenantOperationsService(config, registry);
}

describe("TenantOperationsService", () => {
  it("returns Salesforce setup instructions without exposing secrets", async () => {
    const service = buildService();

    const setup =
      await service.getSalesforceSetupInstructions("certinia-phase8");

    expect(setup).toMatchObject({
      tenant: {
        tenantId: "certinia-phase8",
        status: "active",
        salesforceOrgId: "00D000000000001"
      },
      oauthClient: {
        clientId: "certinia-phase8-oauth",
        secretHandling: {
          valuePrinted: false
        }
      },
      aiApi: {
        tokenEndpoint: "https://ai-api.example.test/oauth/token",
        protectedSmokeEndpoint:
          "https://ai-api.example.test/agent/services/project-health"
      },
      salesforce: {
        namedCredentialApiName: "Agentforce_AI_API_Phase2",
        secureClientSecretField: "AI_API_OAUTH_CLIENT_SECRET"
      },
      validation: {
        requiredScope: "agentforce:services-project-health"
      }
    });
    expect(JSON.stringify(setup)).not.toContain("client_secret");
    expect(JSON.stringify(setup)).not.toContain("phase8-secret");
  });

  it("throws a safe not-found response for unknown tenants", async () => {
    const service = buildService(null);

    await expect(service.getTenantReport("missing-tenant")).rejects.toThrow(
      NotFoundException
    );
  });
});

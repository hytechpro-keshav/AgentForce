import { Injectable, NotFoundException } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import {
  TenantRegistryService,
  type TenantOperationsReport
} from "./tenant-registry.service";

export interface SalesforceSetupInstructions {
  tenant: {
    tenantId: string;
    salesforceOrgId: string;
    salesforceInstanceUrl?: string;
    status: string;
    ragNamespace: string;
  };
  oauthClient?: {
    clientId: string;
    scopes: string[];
    status: string;
    secretHandling: {
      valuePrinted: false;
      storage: string;
      rotation: string;
    };
  };
  aiApi: {
    baseUrl: string;
    tokenEndpoint: string;
    protectedSmokeEndpoint: string;
  };
  salesforce: {
    namedCredentialApiName: string;
    externalCredentialApiName: string;
    principalApiName: string;
    permissionSetApiName: string;
    secureClientIdField: string;
    secureClientSecretField: string;
    deployableMetadata: string[];
  };
  setupSteps: string[];
  validation: {
    apexActionClass: string;
    smokeRoute: string;
    expectedSuccessStatus: number;
    requiredScope: string;
  };
  customerSafeErrorMap: Array<{
    condition: string;
    httpStatus: number;
    safeMessage: string;
    operatorAction: string;
  }>;
  rollbackSteps: string[];
}

@Injectable()
export class TenantOperationsService {
  constructor(
    private readonly config: AppConfigService,
    private readonly tenantRegistry: TenantRegistryService
  ) {}

  async getSalesforceSetupInstructions(
    tenantId: string
  ): Promise<SalesforceSetupInstructions> {
    const report = await this.getTenantReport(tenantId);
    const onboarding = this.config.salesforceOnboarding;
    const baseUrl = onboarding.publicBaseUrl ?? "https://<ai-api-public-host>";
    const client =
      report.clients.find((candidate) => candidate.status === "active") ??
      report.clients[0];
    const scopes = client?.scopes.length ? client.scopes : report.scopes;

    return {
      tenant: {
        tenantId: report.tenantId,
        salesforceOrgId: report.salesforceOrgId,
        salesforceInstanceUrl: report.salesforceInstanceUrl,
        status: report.status,
        ragNamespace: report.ragNamespace
      },
      oauthClient: client
        ? {
            clientId: client.clientId,
            scopes,
            status: client.status,
            secretHandling: {
              valuePrinted: false,
              storage:
                "Store the client secret only as a Salesforce External Credential secure value.",
              rotation:
                "Register a pending secret in the tenant registry, update Salesforce secure storage, smoke test, then promote or revoke the old secret."
            }
          }
        : undefined,
      aiApi: {
        baseUrl,
        tokenEndpoint: `${baseUrl}${onboarding.tokenEndpointPath}`,
        protectedSmokeEndpoint: `${baseUrl}${onboarding.projectHealthPath}`
      },
      salesforce: {
        namedCredentialApiName: onboarding.namedCredentialApiName,
        externalCredentialApiName: onboarding.externalCredentialApiName,
        principalApiName: onboarding.principalApiName,
        permissionSetApiName: onboarding.permissionSetApiName,
        secureClientIdField: onboarding.secureClientIdField,
        secureClientSecretField: onboarding.secureClientSecretField,
        deployableMetadata: [
          "force-app/main/default/namedCredentials/Agentforce_AI_API_Phase2.namedCredential-meta.xml",
          "force-app/main/default/externalCredentials/Agentforce_AI_API_Phase2.externalCredential-meta.xml",
          "force-app/main/default/permissionsets/Services_Org_Intelligence_Agent.permissionset-meta.xml",
          "force-app/main/default/classes/AgentforceAiApiProjectHealth.cls"
        ]
      },
      setupSteps: [
        "Deploy or confirm the Named Credential, External Credential, permission set, Apex action, and Agentforce function metadata in the target Salesforce org.",
        "Configure the External Credential to use OAuth 2.0 client credentials against the AI API token endpoint.",
        `Store ${onboarding.secureClientIdField} as the OAuth client id in Salesforce secure credential storage.`,
        `Store ${onboarding.secureClientSecretField} as the OAuth client secret in Salesforce secure credential storage.`,
        "Assign the permission set to the Agentforce runtime user or integration user that performs the callout.",
        "Run the Apex or Agentforce project-health smoke and confirm the tenant claim in AI API audit records."
      ],
      validation: {
        apexActionClass: "AgentforceAiApiProjectHealth",
        smokeRoute: onboarding.projectHealthPath,
        expectedSuccessStatus: 201,
        requiredScope: "agentforce:services-project-health"
      },
      customerSafeErrorMap: [
        {
          condition: "Unknown OAuth client or suspended tenant/client",
          httpStatus: 401,
          safeMessage: "Client authentication failed.",
          operatorAction:
            "Confirm the Salesforce org is registered as an active tenant and the OAuth client status is active."
        },
        {
          condition: "Invalid OAuth client secret",
          httpStatus: 401,
          safeMessage: "Client authentication failed.",
          operatorAction:
            "Replace the Salesforce secure client secret value with the current registry secret."
        },
        {
          condition: "Missing project-health scope",
          httpStatus: 403,
          safeMessage: "Bearer token is missing a required scope.",
          operatorAction:
            "Grant agentforce:services-project-health to the tenant and OAuth client."
        },
        {
          condition: "Tenant token quota exceeded",
          httpStatus: 429,
          safeMessage: "OAuth token quota has been exceeded for this tenant.",
          operatorAction:
            "Review tenant usage, raise the quota, or wait for the quota window to reset."
        }
      ],
      rollbackSteps: [
        "Set the OAuth client or tenant status to suspended in the tenant registry.",
        "Remove or deactivate the Salesforce permission set assignment for the affected integration user.",
        "Revert the Named Credential to the prior known-good credential only for the affected org if an emergency rollback is required.",
        "Keep other active tenants unchanged."
      ]
    };
  }

  async getTenantReport(tenantId: string): Promise<TenantOperationsReport> {
    const report =
      await this.tenantRegistry.getTenantOperationsReport(tenantId);
    if (!report) {
      throw new NotFoundException({
        error: "tenant_not_found",
        message: "Tenant was not found."
      });
    }
    return report;
  }

  async listTenantReports(): Promise<{ tenants: TenantOperationsReport[] }> {
    return { tenants: await this.tenantRegistry.listTenantOperationsReports() };
  }
}

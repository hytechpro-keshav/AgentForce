import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

/** Salesforce 15- or 18-char record id. Guards against SOQL injection. */
const SF_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export interface DemoCaseCreateFields {
  subject: string;
  description: string;
  status: string;
  origin: string;
  priority: string;
  accountId: string;
  contactId?: string;
  assetId?: string;
  suppliedName?: string;
  suppliedEmail?: string;
  serviceShipToCity: string;
  serviceShipToState: string;
  serviceShipToCountry: string;
}

export interface DemoCaseCreateResult {
  caseId: string;
  caseNumber?: string;
}

/**
 * Outbound Salesforce gateway for demo Case creation: resolves Account,
 * Contact, and Asset lookups and inserts a Case via REST.
 */
@Injectable()
export class SalesforceCaseWriteGateway {
  private readonly logger = new Logger(SalesforceCaseWriteGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  async resolveAccountByName(name: string): Promise<string | undefined> {
    const records = await this.runQuery(
      `SELECT Id FROM Account WHERE Name = ${SalesforceCaseWriteGateway.soqlString(
        name
      )} LIMIT 1`
    );
    return SalesforceCaseWriteGateway.str(records[0], "Id");
  }

  async resolveContactByEmail(
    accountId: string,
    email: string
  ): Promise<string | undefined> {
    this.requireId(accountId);
    const records = await this.runQuery(
      `SELECT Id FROM Contact WHERE AccountId = '${accountId}' AND Email = ${SalesforceCaseWriteGateway.soqlString(
        email
      )} LIMIT 1`
    );
    return SalesforceCaseWriteGateway.str(records[0], "Id");
  }

  async resolveAssetBySerial(
    serialNumber: string
  ): Promise<{ assetId: string; accountId?: string } | undefined> {
    const records = await this.runQuery(
      `SELECT Id, AccountId FROM Asset WHERE SerialNumber = ${SalesforceCaseWriteGateway.soqlString(
        serialNumber
      )} LIMIT 1`
    );
    const row = records[0];
    const assetId = SalesforceCaseWriteGateway.str(row, "Id");
    if (!assetId) {
      return undefined;
    }
    return {
      assetId,
      accountId: SalesforceCaseWriteGateway.str(row, "AccountId")
    };
  }

  async createCase(
    fields: DemoCaseCreateFields
  ): Promise<DemoCaseCreateResult> {
    const path = `/services/data/v${this.apiVersion()}/sobjects/Case`;
    const body: Record<string, unknown> = {
      Subject: fields.subject,
      Description: fields.description,
      Status: fields.status,
      Origin: fields.origin,
      Priority: fields.priority,
      AccountId: fields.accountId,
      Service_Ship_To_City__c: fields.serviceShipToCity,
      Service_Ship_To_State__c: fields.serviceShipToState,
      Service_Ship_To_Country__c: fields.serviceShipToCountry,
      // Stepped-console demo Cases: suppress the auto handoff Flow so the
      // operator controls each stage via /cases/:id/stepped (no premature SF
      // agent comments from a full auto-graph run).
      AI_Orchestration_Status__c: "suppressed"
    };
    if (fields.contactId) {
      body.ContactId = fields.contactId;
    }
    if (fields.assetId) {
      body.AssetId = fields.assetId;
    }
    if (fields.suppliedName) {
      body.SuppliedName = fields.suppliedName;
    }
    if (fields.suppliedEmail) {
      body.SuppliedEmail = fields.suppliedEmail;
    }

    const response = await this.authedRequest("POST", path, body);
    this.assertOk(response, "write");
    const json = await readJsonObject(response);
    const caseId = typeof json.id === "string" ? json.id : undefined;
    if (!caseId) {
      throw new SalesforceGatewayError(
        "malformed",
        "Case insert returned no id."
      );
    }

    const readPath = `/services/data/v${this.apiVersion()}/sobjects/Case/${encodeURIComponent(
      caseId
    )}?fields=CaseNumber`;
    const readResponse = await this.authedRequest("GET", readPath);
    this.assertOk(readResponse, "read");
    const readJson = await readJsonObject(readResponse);
    return {
      caseId,
      caseNumber: SalesforceCaseWriteGateway.str(readJson, "CaseNumber")
    };
  }

  private apiVersion(): string {
    return this.config.salesforceConnection.apiVersion;
  }

  private async runQuery(
    soql: string
  ): Promise<Array<Record<string, unknown>>> {
    const path = `/services/data/v${this.apiVersion()}/query?q=${encodeURIComponent(
      soql
    )}`;
    const response = await this.authedRequest("GET", path);
    this.assertOk(response, "read");
    const json = await readJsonObject(response);
    const records = json["records"];
    return Array.isArray(records)
      ? (records as Array<Record<string, unknown>>)
      : [];
  }

  private async authedRequest(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const { accessToken, instanceUrl } = await this.auth.getAccessContext();
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      };
      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }
      return fetchWithTimeout(
        `${instanceUrl}${path}`,
        {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        },
        this.config.salesforceConnection.timeoutMs
      );
    };

    const first = await attempt();
    if (first.status !== 401) {
      return first;
    }
    this.auth.invalidate();
    return attempt();
  }

  private assertOk(response: Response, op: "read" | "write"): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    if (response.status === 401 || response.status === 403) {
      throw new SalesforceGatewayError(
        "auth",
        "Salesforce rejected the demo Case create credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Salesforce lookup returned not found."
      );
    }
    this.logger.warn(
      `Salesforce demo Case ${op} call failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the demo Case operation."
    );
  }

  private requireId(id: string): void {
    if (!SF_ID_PATTERN.test(id)) {
      throw new SalesforceGatewayError(
        "malformed",
        "Invalid Salesforce record id for lookup."
      );
    }
  }

  private static soqlString(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }

  private static str(
    row: Record<string, unknown> | undefined,
    key: string
  ): string | undefined {
    const value = row?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
}

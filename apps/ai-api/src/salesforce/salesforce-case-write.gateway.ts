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
 * Result of resolving a customer by email for OTP-gated intake. `ambiguous`
 * (more than one Contact shares the email) is rejected rather than guessed so
 * identity can never bind to the wrong Account.
 */
export type ContactResolution =
  | {
      status: "found";
      contactId: string;
      accountId: string;
      name?: string;
      email?: string;
    }
  | { status: "not_found" }
  | { status: "ambiguous" };

/** A customer device (Asset) offered in the intake device picker. */
export interface IntakeDevice {
  assetId: string;
  label: string;
  product?: string;
  serialNumber?: string;
}

/** Account-derived defaults for a chat-created Case. */
export interface AccountContext {
  accountName?: string;
  shipToCity?: string;
  shipToState?: string;
  shipToCountry?: string;
  billingCity?: string;
  billingState?: string;
  billingCountry?: string;
}

/** Verified Contact summary used for the greeting and Case supplied fields. */
export interface ContactSummary {
  name?: string;
  email?: string;
}

/**
 * Fields for an OTP-verified, chat-driven Case create. Account/Contact come
 * from the verified token; ship-to is optional (defaulted from the Account).
 */
export interface ChatCaseCreateFields {
  subject: string;
  description: string;
  priority: string;
  accountId: string;
  contactId?: string;
  assetId?: string;
  suppliedName?: string;
  suppliedEmail?: string;
  suppliedPhone?: string;
  serviceShipToCity?: string;
  serviceShipToState?: string;
  serviceShipToCountry?: string;
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

  /**
   * Resolves a customer Contact from an email for OTP-gated identity. Email is
   * untrusted input so it is escaped via {@link soqlString}. Returns
   * `not_found` when no Contact (or no owning Account) matches, and
   * `ambiguous` when more than one Contact shares the email.
   */
  async resolveContactByEmailGlobal(email: string): Promise<ContactResolution> {
    const records = await this.runQuery(
      `SELECT Id, AccountId, Name FROM Contact WHERE Email = ${SalesforceCaseWriteGateway.soqlString(
        email
      )} LIMIT 2`
    );
    if (records.length === 0) {
      return { status: "not_found" };
    }
    if (records.length > 1) {
      return { status: "ambiguous" };
    }
    const row = records[0];
    const contactId = SalesforceCaseWriteGateway.str(row, "Id");
    const accountId = SalesforceCaseWriteGateway.str(row, "AccountId");
    if (!contactId || !accountId) {
      return { status: "not_found" };
    }
    return {
      status: "found",
      contactId,
      accountId,
      name: SalesforceCaseWriteGateway.str(row, "Name")
    };
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

  /**
   * Lists the verified customer's devices (Assets) for the intake device
   * picker. Account-scoped: the id is validated before it is interpolated.
   */
  async listAccountAssets(accountId: string): Promise<IntakeDevice[]> {
    this.requireId(accountId);
    const records = await this.runQuery(
      `SELECT Id, Name, SerialNumber, Product2.Name FROM Asset WHERE AccountId = '${accountId}' ORDER BY CreatedDate DESC LIMIT 50`
    );
    return records
      .map((row): IntakeDevice | undefined => {
        const assetId = SalesforceCaseWriteGateway.str(row, "Id");
        if (!assetId) {
          return undefined;
        }
        const product = SalesforceCaseWriteGateway.nestedStr(
          row,
          "Product2",
          "Name"
        );
        const serialNumber = SalesforceCaseWriteGateway.str(
          row,
          "SerialNumber"
        );
        const name = SalesforceCaseWriteGateway.str(row, "Name");
        const label = name ?? product ?? "Device";
        return { assetId, label, product, serialNumber };
      })
      .filter((device): device is IntakeDevice => device !== undefined);
  }

  /** Reads Account name + shipping address defaults for a chat Case. */
  async readAccountContext(accountId: string): Promise<AccountContext> {
    this.requireId(accountId);
    const records = await this.runQuery(
      `SELECT Name, ShippingCity, ShippingState, ShippingCountry, BillingCity, BillingState, BillingCountry FROM Account WHERE Id = '${accountId}' LIMIT 1`
    );
    const row = records[0];
    return {
      accountName: SalesforceCaseWriteGateway.str(row, "Name"),
      shipToCity: SalesforceCaseWriteGateway.str(row, "ShippingCity"),
      shipToState: SalesforceCaseWriteGateway.str(row, "ShippingState"),
      shipToCountry: SalesforceCaseWriteGateway.str(row, "ShippingCountry"),
      billingCity: SalesforceCaseWriteGateway.str(row, "BillingCity"),
      billingState: SalesforceCaseWriteGateway.str(row, "BillingState"),
      billingCountry: SalesforceCaseWriteGateway.str(row, "BillingCountry")
    };
  }

  /**
   * Picks a Contact on the Account for dev/bootstrap intake when OTP is
   * disabled. Prefers a Contact with an email address.
   */
  async resolvePrimaryContactForAccount(
    accountId: string
  ): Promise<ContactResolution> {
    this.requireId(accountId);
    const withEmail = await this.runQuery(
      `SELECT Id, AccountId, Name, Email FROM Contact WHERE AccountId = '${accountId}' AND Email != null ORDER BY CreatedDate DESC LIMIT 1`
    );
    const row =
      withEmail[0] ??
      (
        await this.runQuery(
          `SELECT Id, AccountId, Name, Email FROM Contact WHERE AccountId = '${accountId}' ORDER BY CreatedDate DESC LIMIT 1`
        )
      )[0];
    const contactId = SalesforceCaseWriteGateway.str(row, "Id");
    const resolvedAccountId = SalesforceCaseWriteGateway.str(row, "AccountId");
    if (!contactId || !resolvedAccountId) {
      return { status: "not_found" };
    }
    return {
      status: "found",
      contactId,
      accountId: resolvedAccountId,
      name: SalesforceCaseWriteGateway.str(row, "Name"),
      email: SalesforceCaseWriteGateway.str(row, "Email")
    };
  }

  /** Reads the verified Contact's display name and email. */
  async readContactSummary(contactId: string): Promise<ContactSummary> {
    this.requireId(contactId);
    const records = await this.runQuery(
      `SELECT Name, Email FROM Contact WHERE Id = '${contactId}' LIMIT 1`
    );
    const row = records[0];
    return {
      name: SalesforceCaseWriteGateway.str(row, "Name"),
      email: SalesforceCaseWriteGateway.str(row, "Email")
    };
  }

  /**
   * Confirms the chosen Asset belongs to the verified Account, so a tampered
   * client cannot attach another customer's device to the Case.
   */
  async assetBelongsToAccount(
    assetId: string,
    accountId: string
  ): Promise<boolean> {
    this.requireId(assetId);
    this.requireId(accountId);
    const records = await this.runQuery(
      `SELECT Id FROM Asset WHERE Id = '${assetId}' AND AccountId = '${accountId}' LIMIT 1`
    );
    return records.length > 0;
  }

  /**
   * Creates a Case from OTP-verified chat intake. Sets Origin='Chat' and
   * stamps AI_Orchestration_Status__c='stopped_by_user' so the org's
   * Case_Triage_Orchestrator_Handoff Flow skips it (no triage hand-off, per
   * product decision). Ship-to is optional (defaulted from the Account).
   */
  async createChatCase(
    fields: ChatCaseCreateFields
  ): Promise<DemoCaseCreateResult> {
    this.requireId(fields.accountId);
    const path = `/services/data/v${this.apiVersion()}/sobjects/Case`;
    const body: Record<string, unknown> = {
      Subject: fields.subject,
      Description: fields.description,
      Status: "New",
      Origin: "Chat",
      Priority: fields.priority,
      AccountId: fields.accountId,
      AI_Orchestration_Status__c: "stopped_by_user"
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
    if (fields.suppliedPhone) {
      body.SuppliedPhone = fields.suppliedPhone;
    }
    if (fields.serviceShipToCity) {
      body.Service_Ship_To_City__c = fields.serviceShipToCity;
    }
    if (fields.serviceShipToState) {
      body.Service_Ship_To_State__c = fields.serviceShipToState;
    }
    if (fields.serviceShipToCountry) {
      body.Service_Ship_To_Country__c = fields.serviceShipToCountry;
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

  /** Reads a value from a nested relationship object (e.g. Product2.Name). */
  private static nestedStr(
    row: Record<string, unknown> | undefined,
    outerKey: string,
    innerKey: string
  ): string | undefined {
    const outer = row?.[outerKey];
    if (!outer || typeof outer !== "object") {
      return undefined;
    }
    return SalesforceCaseWriteGateway.str(
      outer as Record<string, unknown>,
      innerKey
    );
  }
}

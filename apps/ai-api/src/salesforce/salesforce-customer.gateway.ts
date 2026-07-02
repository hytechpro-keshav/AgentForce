import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type {
  CustomerAccountProfile,
  CustomerEntitlementSla,
  CustomerReadBundle,
  CustomerReadScope,
  CustomerServiceHistory,
  CustomerTier,
  CustomerWarranty,
  InstalledAssetSummary,
  SlaClass,
  WarrantyStatus
} from "../orchestrator/dto/customer-context";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

/** Salesforce 15- or 18-char record id. Guards against SOQL injection. */
const SF_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/** Window (days) used to detect a recurring failure on the same account. */
const REPEAT_WINDOW_DAYS = 30;

/**
 * Node 2 read-only customer gateway — the single seam where the
 * Customer History Agent reads the authoritative customer graph from
 * Salesforce. It is the analogue of {@link SalesforceCaseGateway} with
 * a critical difference: it has NO write methods at all.
 *
 * Every read is tenant- AND Account-scoped: the Case's `AccountId` is
 * the required anchor and is embedded only after id-pattern validation,
 * so no cross-account (cross-customer) query can ever be issued. Reads
 * are idempotent and side-effect-free, so the orchestrator can retry
 * the node freely.
 */
@Injectable()
export class SalesforceCustomerGateway {
  private readonly logger = new Logger(SalesforceCustomerGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  /** True when the optional Data 360 customer-360 path is enabled. */
  isDataCloudConfigured(): boolean {
    return (
      this.config.salesforceConnection.enabled &&
      this.config.orchestrator.customerHistory.dataCloud.enabled
    );
  }

  /**
   * Assembles the full customer bundle from the granular reads,
   * isolating per-source failures into `missingSources` so a single
   * unavailable object (e.g. Entitlement not enabled) degrades the
   * finding rather than failing the node. Returns an empty bundle when
   * the Account anchor is missing/invalid — it never issues an
   * unscoped query.
   */
  async readCustomerBundle(
    scope: CustomerReadScope
  ): Promise<CustomerReadBundle> {
    if (!SalesforceCustomerGateway.hasValidAccount(scope)) {
      return {
        source: "none",
        missingSources: [
          "account",
          "entitlement",
          "warranty",
          "installed_assets",
          "service_history"
        ]
      };
    }

    const bundle: CustomerReadBundle = { source: "soql", missingSources: [] };

    bundle.accountProfile = await this.readOrMiss(bundle, "account", () =>
      this.readAccountProfile(scope)
    );
    bundle.entitlement = await this.readOrMiss(bundle, "entitlement", () =>
      this.readEntitlementsAndSla(scope)
    );
    bundle.warranty = await this.readOrMiss(bundle, "warranty", () =>
      this.readWarranty(scope)
    );
    bundle.installedAssets = await this.readOrMiss(
      bundle,
      "installed_assets",
      () => this.readInstalledAssets(scope)
    );
    bundle.serviceHistory = await this.readOrMiss(
      bundle,
      "service_history",
      () => this.readServiceHistory(scope)
    );

    return bundle;
  }

  /**
   * Optional single Data 360 Data Graph / Calculated Insights call for
   * the customer-360 bundle. One governed query is cheaper and lower
   * latency than N runtime SOQL reads. Gated by `isDataCloudConfigured`
   * so it degrades gracefully (returns `undefined`) when Data Cloud is
   * absent, letting the caller fall back to the scoped per-object reads.
   */
  async readCustomer360Bundle(
    scope: CustomerReadScope
  ): Promise<CustomerReadBundle | undefined> {
    if (
      !this.isDataCloudConfigured() ||
      !SalesforceCustomerGateway.hasValidAccount(scope)
    ) {
      return undefined;
    }
    // The concrete Data Graph DLO/Calculated-Insight names are org and
    // tenant specific; until a real Data Cloud connection is wired this
    // returns undefined so the caller uses the SOQL fallback. The seam
    // exists so enabling Data Cloud is a config change, not a rewrite.
    return undefined;
  }

  async readAccountProfile(
    scope: CustomerReadScope
  ): Promise<CustomerAccountProfile> {
    const accountId = this.requireScoped(scope);
    const records = await this.runQuery(
      `SELECT Id, Type, Rating FROM Account WHERE Id = '${accountId}' LIMIT 1`
    );
    const row = records[0];
    return {
      tier: SalesforceCustomerGateway.mapTier(
        SalesforceCustomerGateway.str(row, "Type")
      ),
      strategic: SalesforceCustomerGateway.mapStrategic(
        SalesforceCustomerGateway.str(row, "Rating")
      )
    };
  }

  async readEntitlementsAndSla(
    scope: CustomerReadScope
  ): Promise<CustomerEntitlementSla> {
    const accountId = this.requireScoped(scope);
    const records = await this.runQuery(
      `SELECT Id, Name FROM Entitlement WHERE AccountId = '${accountId}' ORDER BY EndDate DESC NULLS LAST LIMIT 1`
    );
    const row = records[0];
    if (!row) {
      // Evidenced absence: we queried and the account has no entitlement.
      return { hasEntitlement: false, slaClass: "none" };
    }
    return {
      hasEntitlement: true,
      slaClass: SalesforceCustomerGateway.mapSlaClass(
        SalesforceCustomerGateway.str(row, "Name")
      )
    };
  }

  async readWarranty(scope: CustomerReadScope): Promise<CustomerWarranty> {
    const accountId = this.requireScoped(scope);
    const records = await this.runQuery(
      `SELECT Id, Status, UsageEndDate FROM Asset WHERE AccountId = '${accountId}' AND UsageEndDate != null ORDER BY UsageEndDate DESC LIMIT 1`
    );
    const row = records[0];
    return {
      status: SalesforceCustomerGateway.mapWarranty(
        SalesforceCustomerGateway.str(row, "UsageEndDate")
      )
    };
  }

  async readInstalledAssets(
    scope: CustomerReadScope
  ): Promise<InstalledAssetSummary> {
    const accountId = this.requireScoped(scope);
    const records = await this.runQuery(
      `SELECT Product2.Name pname, COUNT(Id) total FROM Asset WHERE AccountId = '${accountId}' GROUP BY Product2.Name ORDER BY COUNT(Id) DESC`
    );
    let totalAssets = 0;
    let primaryModel: string | undefined;
    for (const row of records) {
      const count = SalesforceCustomerGateway.num(row, "total");
      totalAssets += count;
      if (primaryModel === undefined) {
        primaryModel = SalesforceCustomerGateway.str(row, "pname") ?? undefined;
      }
    }
    return {
      totalAssets,
      modelCount: records.length,
      primaryModel
    };
  }

  async readServiceHistory(
    scope: CustomerReadScope
  ): Promise<CustomerServiceHistory> {
    const accountId = this.requireScoped(scope);
    const contactFilter = scope.verifiedContactId
      ? ` AND ContactId = '${this.requireId(scope.verifiedContactId)}'`
      : "";
    const assetFilter = scope.assetId
      ? ` AND AssetId = '${this.requireId(scope.assetId)}'`
      : "";
    const excludeFilter = scope.excludeCaseId
      ? ` AND Id != '${this.requireId(scope.excludeCaseId)}'`
      : "";
    const records = await this.runQuery(
      `SELECT Id, Status, IsEscalated, IsClosed, CreatedDate FROM Case WHERE AccountId = '${accountId}'${contactFilter}${assetFilter}${excludeFilter} ORDER BY CreatedDate DESC LIMIT 200`
    );
    const windowStart = Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    let repeatIncidentCount = 0;
    let priorEscalations = 0;
    let openIncidentCount = 0;
    for (const row of records) {
      if (SalesforceCustomerGateway.bool(row, "IsEscalated")) {
        priorEscalations += 1;
      }
      if (!SalesforceCustomerGateway.bool(row, "IsClosed")) {
        openIncidentCount += 1;
      }
      const created = Date.parse(
        SalesforceCustomerGateway.str(row, "CreatedDate") ?? ""
      );
      if (!Number.isNaN(created) && created >= windowStart) {
        repeatIncidentCount += 1;
      }
    }
    return {
      priorCaseCount: records.length,
      repeatIncidentCount,
      repeatWindowDays: REPEAT_WINDOW_DAYS,
      priorEscalations,
      openIncidentCount,
      repeatScope: scope.assetId ? "asset" : "account",
      currentCaseExcluded: Boolean(scope.excludeCaseId)
    };
  }

  private async readOrMiss<T>(
    bundle: CustomerReadBundle,
    source: string,
    read: () => Promise<T>
  ): Promise<T | undefined> {
    try {
      return await read();
    } catch (err) {
      // Degrade, never fail the node: a single unavailable source (e.g.
      // an object not enabled in the org) lowers confidence on that
      // finding. Safe classification only — no raw payload, no PII.
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Customer read degraded: source=${source} kind=${kind}`);
      bundle.missingSources.push(source);
      return undefined;
    }
  }

  /**
   * Runs a read-only SOQL query through the scoped, authenticated
   * request path and returns the records. The query string is always
   * Account-anchored by the caller.
   */
  private async runQuery(
    soql: string
  ): Promise<Array<Record<string, unknown>>> {
    const path = `/services/data/v${this.apiVersion()}/query?q=${encodeURIComponent(
      soql
    )}`;
    const response = await this.authedRequest("GET", path);
    this.assertOk(response);
    const json = await readJsonObject(response);
    const records = json["records"];
    return Array.isArray(records)
      ? (records as Array<Record<string, unknown>>)
      : [];
  }

  private apiVersion(): string {
    return this.config.salesforceConnection.apiVersion;
  }

  /**
   * Returns the validated, Account-scoped id or throws. Calling this
   * first guarantees a read can never be issued without the Account
   * anchor — the primary control against cross-customer contamination.
   */
  private requireScoped(scope: CustomerReadScope): string {
    if (!scope.accountId) {
      throw new SalesforceGatewayError(
        "not_configured",
        "Customer read requires an Account scope; refusing an unscoped query."
      );
    }
    return this.requireId(scope.accountId);
  }

  private requireId(id: string): string {
    if (!SF_ID_PATTERN.test(id)) {
      throw new SalesforceGatewayError(
        "malformed",
        "Customer read received an invalid Salesforce id."
      );
    }
    return id;
  }

  /** GET with a single 401 retry after invalidating the cached token. */
  private async authedRequest(method: "GET", path: string): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const { accessToken, instanceUrl } = await this.auth.getAccessContext();
      return fetchWithTimeout(
        `${instanceUrl}${path}`,
        {
          method,
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json"
          }
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

  private assertOk(response: Response): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    if (response.status === 401 || response.status === 403) {
      throw new SalesforceGatewayError(
        "auth",
        "Salesforce rejected the customer-read credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Salesforce customer record not found."
      );
    }
    this.logger.warn(
      `Salesforce customer read failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the customer read."
    );
  }

  private static hasValidAccount(scope: CustomerReadScope): boolean {
    return Boolean(scope.accountId && SF_ID_PATTERN.test(scope.accountId));
  }

  private static str(
    row: Record<string, unknown> | undefined,
    key: string
  ): string | undefined {
    if (!row) {
      return undefined;
    }
    const value = row[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private static num(
    row: Record<string, unknown> | undefined,
    key: string
  ): number {
    if (!row) {
      return 0;
    }
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private static bool(
    row: Record<string, unknown> | undefined,
    key: string
  ): boolean {
    return Boolean(row?.[key]);
  }

  /** Account.Type -> tier vocabulary. Unrecognized/absent -> undefined. */
  private static mapTier(raw: string | undefined): CustomerTier | undefined {
    if (!raw) {
      return undefined;
    }
    if (/premier|premium|enterprise|strategic/i.test(raw)) {
      return "premium";
    }
    if (/basic|smb|small/i.test(raw)) {
      return "basic";
    }
    return "standard";
  }

  /**
   * Strategic-account flag from the explicit Account.Rating field only —
   * never guessed. `Hot` -> strategic; another rating -> not strategic;
   * absent -> undefined (abstain).
   */
  private static mapStrategic(raw: string | undefined): boolean | undefined {
    if (!raw) {
      return undefined;
    }
    return /hot/i.test(raw);
  }

  private static mapSlaClass(raw: string | undefined): SlaClass {
    if (!raw) {
      return "standard";
    }
    if (/premium|gold|platinum/i.test(raw)) {
      return "premium";
    }
    return "standard";
  }

  /** UsageEndDate vs now -> covered/expired. Absent -> unknown (abstain). */
  private static mapWarranty(rawEndDate: string | undefined): WarrantyStatus {
    if (!rawEndDate) {
      return "unknown";
    }
    const end = Date.parse(rawEndDate);
    if (Number.isNaN(end)) {
      return "unknown";
    }
    return end >= Date.now() ? "covered" : "expired";
  }
}

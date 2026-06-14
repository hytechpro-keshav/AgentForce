import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

/** Salesforce 15- or 18-char record id. Guards against SOQL injection. */
const SF_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/** A product code is a stable external key (e.g. "SP-BATT-15X"). */
const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Live stock row for one part at one inventory location, keyed by the
 * stable external identifiers. NEVER keyed on `Product2.Id` — duplicate
 * catalog rows exist for the same `ProductCode` (§2.1).
 */
export interface InventoryStockRow {
  productCode: string;
  productName?: string;
  compatibleProductCode?: string;
  isUniversalPart: boolean;
  quantityOnHand: number;
  warehouseReference: string;
  warehouseName?: string;
  warehouseRegion?: string;
  outboundLeadTimeHours?: number;
  supportsExpedite: boolean;
}

export interface InventoryReadResult {
  /** Read source: "soql" when live, "none" when not configured/empty. */
  source: "soql" | "none";
  rows: InventoryStockRow[];
  /** True when the read could not complete (degrade, never throw). */
  degraded: boolean;
}

/**
 * Node 4 read-only inventory gateway — the single seam where the Parts
 * & Logistics planner reads live `ProductItem` stock from Salesforce.
 * Like {@link SalesforceCustomerGateway}, it has NO write methods.
 *
 * All reads are keyed on `Product2.ProductCode` and
 * `Location.ExternalReference`; the planner never sees a `Product2.Id`.
 * A read failure degrades the plan (returns `degraded: true`) rather
 * than throwing, so Node 4 can never break the graph (§7.4).
 */
@Injectable()
export class SalesforceInventoryGateway {
  private readonly logger = new Logger(SalesforceInventoryGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  /**
   * Bulk reads on-hand stock for the supplied part codes across every
   * inventory location. Bulk-safe: a single keyed SOQL `IN` query, not
   * N per-part reads. Returns an empty result for an empty/invalid code
   * list and a degraded result if the read fails.
   */
  async readStockForParts(partCodes: string[]): Promise<InventoryReadResult> {
    const safeCodes = Array.from(
      new Set(partCodes.filter((code) => PRODUCT_CODE_PATTERN.test(code)))
    );
    if (safeCodes.length === 0) {
      return { source: "none", rows: [], degraded: false };
    }
    try {
      const inList = safeCodes.map((code) => `'${code}'`).join(", ");
      const soql =
        "SELECT Product2.ProductCode, Product2.Name, " +
        "Product2.Compatible_Product_Code__c, Product2.Is_Universal_Part__c, " +
        "QuantityOnHand, Location.ExternalReference, Location.Name, " +
        "Location.Region__c, Location.Outbound_Lead_Time_Hours__c, " +
        "Location.Supports_Expedite__c " +
        `FROM ProductItem WHERE Product2.ProductCode IN (${inList})`;
      const records = await this.runQuery(soql);
      const rows = records
        .map((row) => SalesforceInventoryGateway.mapStockRow(row))
        .filter((row): row is InventoryStockRow => row !== undefined);
      return { source: "soql", rows, degraded: false };
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Inventory read degraded: kind=${kind}`);
      return { source: "none", rows: [], degraded: true };
    }
  }

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
        "Salesforce rejected the inventory-read credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Salesforce inventory object not found."
      );
    }
    this.logger.warn(
      `Salesforce inventory read failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the inventory read."
    );
  }

  private static mapStockRow(
    row: Record<string, unknown>
  ): InventoryStockRow | undefined {
    const product2 =
      row["Product2"] && typeof row["Product2"] === "object"
        ? (row["Product2"] as Record<string, unknown>)
        : undefined;
    const location =
      row["Location"] && typeof row["Location"] === "object"
        ? (row["Location"] as Record<string, unknown>)
        : undefined;
    const productCode = SalesforceInventoryGateway.str(product2, "ProductCode");
    const warehouseReference = SalesforceInventoryGateway.str(
      location,
      "ExternalReference"
    );
    // Both stable keys are required; a row missing either cannot be
    // planned against (never fall back to Product2.Id / Location.Id).
    if (!productCode || !warehouseReference) {
      return undefined;
    }
    return {
      productCode,
      productName: SalesforceInventoryGateway.str(product2, "Name"),
      compatibleProductCode: SalesforceInventoryGateway.str(
        product2,
        "Compatible_Product_Code__c"
      ),
      isUniversalPart: SalesforceInventoryGateway.bool(
        product2,
        "Is_Universal_Part__c"
      ),
      quantityOnHand: SalesforceInventoryGateway.num(row, "QuantityOnHand"),
      warehouseReference,
      warehouseName: SalesforceInventoryGateway.str(location, "Name"),
      warehouseRegion: SalesforceInventoryGateway.str(location, "Region__c"),
      outboundLeadTimeHours: SalesforceInventoryGateway.optionalNum(
        location,
        "Outbound_Lead_Time_Hours__c"
      ),
      supportsExpedite: SalesforceInventoryGateway.bool(
        location,
        "Supports_Expedite__c"
      )
    };
  }

  private static str(
    row: Record<string, unknown> | undefined,
    key: string
  ): string | undefined {
    if (!row) return undefined;
    const value = row[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private static num(
    row: Record<string, unknown> | undefined,
    key: string
  ): number {
    if (!row) return 0;
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private static optionalNum(
    row: Record<string, unknown> | undefined,
    key: string
  ): number | undefined {
    if (!row) return undefined;
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  private static bool(
    row: Record<string, unknown> | undefined,
    key: string
  ): boolean {
    return Boolean(row?.[key]);
  }

  /** Exposed for parity with other gateways; validates an SF id. */
  static isValidId(id: string): boolean {
    return SF_ID_PATTERN.test(id);
  }
}

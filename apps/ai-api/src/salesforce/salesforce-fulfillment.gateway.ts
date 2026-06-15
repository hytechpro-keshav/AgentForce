import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type {
  PartsFulfillmentCommand,
  PartsFulfillmentItemResult,
  PartsFulfillmentResult
} from "../orchestrator/dto/parts-fulfillment";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

/** Apex REST entry point that owns the fulfillment DML + idempotency. */
const FULFILLMENT_APEX_PATH = "/services/apexrest/agentforce/parts-fulfillment";

const RESERVATION_STATES = new Set<
  PartsFulfillmentItemResult["reservationStatus"]
>(["transfer_pending", "backorder_requested", "planned"]);

const RECORD_TYPES = new Set<NonNullable<PartsFulfillmentItemResult["recordType"]>>(
  ["ProductTransfer", "ProductRequest"]
);

/**
 * Node 4 — Phase 4c write seam. Calls the Apex
 * `AgentforcePartsFulfillmentService` (via its `@RestResource`) to create
 * the gated `ProductTransfer` / `ProductRequest` records AFTER the
 * approval gate clears. Salesforce owns the DML, FLS, bulk-safety, and
 * idempotency (keyed on `Orchestrator_Workflow_Id__c` + part code); this
 * gateway only marshals the safe command/result and degrades (never
 * throws) so a write failure can never break the graph.
 */
@Injectable()
export class SalesforceFulfillmentGateway {
  private readonly logger = new Logger(SalesforceFulfillmentGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  /**
   * Applies the approved fulfillment command. Returns a degraded result
   * (with every item left `planned`) instead of throwing when the call
   * cannot complete, so the post-approval write-back never fails the run.
   */
  async applyFulfillment(
    command: PartsFulfillmentCommand
  ): Promise<PartsFulfillmentResult> {
    if (command.items.length === 0) {
      return { applied: false, degraded: false, items: [] };
    }
    try {
      const response = await this.authedRequest(FULFILLMENT_APEX_PATH, command);
      this.assertOk(response);
      const json = await readJsonObject(response);
      return SalesforceFulfillmentGateway.mapResult(json, command);
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Fulfillment write degraded: kind=${kind}`);
      return SalesforceFulfillmentGateway.degradedResult(command);
    }
  }

  /** POST with a single 401 retry after invalidating the cached token. */
  private async authedRequest(
    path: string,
    body: PartsFulfillmentCommand
  ): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const { accessToken, instanceUrl } = await this.auth.getAccessContext();
      return fetchWithTimeout(
        `${instanceUrl}${path}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
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
        "Salesforce rejected the fulfillment-write credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Fulfillment Apex REST resource not found."
      );
    }
    this.logger.warn(
      `Salesforce fulfillment write failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the fulfillment write."
    );
  }

  private static mapResult(
    json: Record<string, unknown>,
    command: PartsFulfillmentCommand
  ): PartsFulfillmentResult {
    const rawItems = Array.isArray(json["items"]) ? json["items"] : [];
    const items = rawItems
      .map((item) => SalesforceFulfillmentGateway.mapItem(item))
      .filter((item): item is PartsFulfillmentItemResult => item !== undefined);
    // A malformed/empty body for a non-empty command is treated as
    // degraded rather than a silent success.
    if (items.length === 0) {
      return SalesforceFulfillmentGateway.degradedResult(command);
    }
    return {
      applied: json["applied"] === true,
      degraded: json["degraded"] === true,
      items
    };
  }

  private static mapItem(
    value: unknown
  ): PartsFulfillmentItemResult | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const row = value as Record<string, unknown>;
    const partNumber =
      typeof row["partNumber"] === "string" ? row["partNumber"] : undefined;
    if (!partNumber) {
      return undefined;
    }
    const reservationStatus =
      typeof row["reservationStatus"] === "string" &&
      RESERVATION_STATES.has(
        row["reservationStatus"] as PartsFulfillmentItemResult["reservationStatus"]
      )
        ? (row[
            "reservationStatus"
          ] as PartsFulfillmentItemResult["reservationStatus"])
        : "planned";
    const recordType =
      typeof row["recordType"] === "string" &&
      RECORD_TYPES.has(
        row["recordType"] as NonNullable<
          PartsFulfillmentItemResult["recordType"]
        >
      )
        ? (row["recordType"] as PartsFulfillmentItemResult["recordType"])
        : undefined;
    return {
      partNumber,
      created: row["created"] === true,
      idempotentSkip: row["idempotentSkip"] === true,
      recordType,
      recordId:
        typeof row["recordId"] === "string" ? row["recordId"] : undefined,
      reservationStatus,
      message: typeof row["message"] === "string" ? row["message"] : undefined
    };
  }

  private static degradedResult(
    command: PartsFulfillmentCommand
  ): PartsFulfillmentResult {
    return {
      applied: false,
      degraded: true,
      items: command.items.map((item) => ({
        partNumber: item.partNumber,
        created: false,
        idempotentSkip: false,
        reservationStatus: "planned",
        message: "Fulfillment write unavailable; reservation left planned."
      }))
    };
  }
}

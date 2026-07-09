import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

export type CaseConfirmationStatus = "SENT" | "INVALID_REQUEST" | "DEGRADED";

export interface CaseConfirmationRequest {
  email: string;
  caseNumber: string;
  customerName?: string;
  subject?: string;
  correlationId?: string;
}

export interface CaseConfirmationResult {
  sent: boolean;
  status: CaseConfirmationStatus;
}

const CONFIRMATION_STATES = new Set<CaseConfirmationStatus>([
  "SENT",
  "INVALID_REQUEST",
  "DEGRADED"
]);

/**
 * Outbound gateway for the Salesforce-owned chat-case confirmation email.
 * Calls the Apex `AgentforceCaseNotifyRest` endpoint (`/confirmation`) via
 * the same client-credentials auth + single-401-retry convention as the
 * other gateways; Salesforce owns the email content and delivery.
 *
 * Degrade-not-throw: any transport/backend error returns `DEGRADED`, so a
 * mail or Salesforce outage can never fail the case create it follows.
 */
@Injectable()
export class SalesforceCaseNotifyGateway {
  private readonly logger = new Logger(SalesforceCaseNotifyGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  async sendCaseConfirmation(
    request: CaseConfirmationRequest
  ): Promise<CaseConfirmationResult> {
    const path = `${this.config.customerIntake.caseNotifyApexBasePath}/confirmation`;
    try {
      const response = await this.authedRequest(path, {
        email: request.email,
        caseNumber: request.caseNumber,
        customerName: request.customerName,
        subject: request.subject,
        correlationId: request.correlationId
      });
      this.assertOk(response);
      const json = await readJsonObject(response);
      const status =
        typeof json["status"] === "string" &&
        CONFIRMATION_STATES.has(json["status"] as CaseConfirmationStatus)
          ? (json["status"] as CaseConfirmationStatus)
          : "DEGRADED";
      return { sent: json["sent"] === true && status === "SENT", status };
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Case confirmation email degraded: kind=${kind}`);
      return { sent: false, status: "DEGRADED" };
    }
  }

  /** POST with a single 401 retry after invalidating the cached token. */
  private async authedRequest(
    path: string,
    body: Record<string, unknown>
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
        "Salesforce rejected the case-notify credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Case-notify Apex REST resource not found."
      );
    }
    this.logger.warn(
      `Salesforce case-notify call failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the case-notify operation."
    );
  }
}

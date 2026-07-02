import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

export type OtpGenerateStatus =
  | "SENT"
  | "RATE_LIMITED"
  | "INVALID_EMAIL"
  | "DEGRADED";

export type OtpVerifyStatus =
  | "VERIFIED"
  | "INVALID_CODE"
  | "EXPIRED"
  | "TOO_MANY_ATTEMPTS"
  | "NOT_FOUND"
  | "DEGRADED";

export interface OtpGenerateResult {
  status: OtpGenerateStatus;
  expiresInSeconds: number;
}

export interface OtpVerifyResult {
  valid: boolean;
  status: OtpVerifyStatus;
}

const GENERATE_STATES = new Set<OtpGenerateStatus>([
  "SENT",
  "RATE_LIMITED",
  "INVALID_EMAIL",
  "DEGRADED"
]);

const VERIFY_STATES = new Set<OtpVerifyStatus>([
  "VERIFIED",
  "INVALID_CODE",
  "EXPIRED",
  "TOO_MANY_ATTEMPTS",
  "NOT_FOUND",
  "DEGRADED"
]);

const OTP_PURPOSE = "chat_intake";

/**
 * Outbound gateway for the Salesforce-owned email OTP flow. Calls the Apex
 * `AgentforceOtpRest` endpoints (`/generate`, `/verify`) via the same
 * client-credentials auth + single-401-retry convention as the other
 * gateways. Salesforce owns code generation, hashing, delivery, expiry, and
 * attempt/rate limiting; this gateway only marshals the safe request/result.
 *
 * Degrade-not-throw: on any transport/backend error, generate returns
 * `DEGRADED` and verify fails CLOSED (`valid: false`), so a Salesforce or
 * email outage can never accidentally verify a customer or hard-fail chat.
 */
@Injectable()
export class SalesforceOtpGateway {
  private readonly logger = new Logger(SalesforceOtpGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  async generate(
    email: string,
    correlationId?: string
  ): Promise<OtpGenerateResult> {
    const path = `${this.config.customerIntake.otpApexBasePath}/generate`;
    try {
      const response = await this.authedRequest(path, {
        email,
        purpose: OTP_PURPOSE,
        correlationId
      });
      this.assertOk(response);
      const json = await readJsonObject(response);
      const status =
        typeof json["status"] === "string" &&
        GENERATE_STATES.has(json["status"] as OtpGenerateStatus)
          ? (json["status"] as OtpGenerateStatus)
          : "DEGRADED";
      const expiresInSeconds =
        typeof json["expiresInSeconds"] === "number" &&
        Number.isFinite(json["expiresInSeconds"])
          ? (json["expiresInSeconds"] as number)
          : 0;
      return { status, expiresInSeconds };
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`OTP generate degraded: kind=${kind}`);
      return { status: "DEGRADED", expiresInSeconds: 0 };
    }
  }

  async verify(
    email: string,
    code: string,
    correlationId?: string
  ): Promise<OtpVerifyResult> {
    const path = `${this.config.customerIntake.otpApexBasePath}/verify`;
    try {
      const response = await this.authedRequest(path, {
        email,
        code,
        purpose: OTP_PURPOSE,
        correlationId
      });
      this.assertOk(response);
      const json = await readJsonObject(response);
      const valid = json["valid"] === true;
      const status =
        typeof json["status"] === "string" &&
        VERIFY_STATES.has(json["status"] as OtpVerifyStatus)
          ? (json["status"] as OtpVerifyStatus)
          : valid
            ? "VERIFIED"
            : "INVALID_CODE";
      // Never treat a non-VERIFIED status as valid, whatever the body claims.
      return { valid: valid && status === "VERIFIED", status };
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`OTP verify degraded: kind=${kind}`);
      return { valid: false, status: "DEGRADED" };
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
        "Salesforce rejected the OTP credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "OTP Apex REST resource not found."
      );
    }
    this.logger.warn(`Salesforce OTP call failed (status=${response.status}).`);
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the OTP operation."
    );
  }
}

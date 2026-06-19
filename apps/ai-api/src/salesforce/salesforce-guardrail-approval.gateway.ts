import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type {
  GuardrailApprovalSubmitCommand,
  GuardrailApprovalSubmitResult
} from "../orchestrator/dto/guardrail";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

/** Apex REST entry point that stamps the Case + submits the Approval Process. */
const GUARDRAIL_APPROVAL_APEX_PATH =
  "/services/apexrest/agentforce/guardrail-approval/submit";

/**
 * Node 6 — Phase 6b+ Salesforce Approval submit seam. Calls the Apex
 * `AgentforceGuardrailApprovalService` (via its `@RestResource`) to stamp the
 * Orchestrator Verdict + callback token on the Case and submit the native
 * Salesforce Approval Process. Salesforce owns the DML, FLS, approver
 * assignment, and idempotency (keyed on the workflow id); this gateway only
 * marshals the safe command/result and degrades — it NEVER throws — so a
 * submit failure can never stop the graph from reaching `interrupt()`
 * (phase plan §5.4).
 */
@Injectable()
export class SalesforceGuardrailApprovalGateway {
  private readonly logger = new Logger(SalesforceGuardrailApprovalGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  /**
   * Submits the Case Approval Process for a held workflow. Returns a degraded
   * result (`{ submitted: false, degraded: true }`) instead of throwing when
   * the call cannot complete, so the pre-interrupt routing stays degrade-safe.
   */
  async submitApproval(
    command: GuardrailApprovalSubmitCommand
  ): Promise<GuardrailApprovalSubmitResult> {
    if (!this.isConfigured()) {
      return { submitted: false, degraded: true };
    }
    try {
      const response = await this.authedRequest(
        GUARDRAIL_APPROVAL_APEX_PATH,
        command
      );
      this.assertOk(response);
      const json = await readJsonObject(response);
      return SalesforceGuardrailApprovalGateway.mapResult(json);
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Guardrail approval submit degraded: kind=${kind}`);
      return { submitted: false, degraded: true };
    }
  }

  /** POST with a single 401 retry after invalidating the cached token. */
  private async authedRequest(
    path: string,
    body: GuardrailApprovalSubmitCommand
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
        "Salesforce rejected the guardrail-approval credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Guardrail approval Apex REST resource not found."
      );
    }
    this.logger.warn(
      `Salesforce guardrail approval submit failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the guardrail approval submit."
    );
  }

  private static mapResult(
    json: Record<string, unknown>
  ): GuardrailApprovalSubmitResult {
    const processInstanceId =
      typeof json["processInstanceId"] === "string"
        ? json["processInstanceId"]
        : undefined;
    return {
      submitted: json["submitted"] === true,
      processInstanceId,
      alreadyPending: json["alreadyPending"] === true,
      degraded: json["degraded"] === true
    };
  }
}

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type {
  SchedulingWriteCommand,
  SchedulingWriteResult
} from "../orchestrator/dto/scheduling-write";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

/** Apex REST entry point that owns the appointment DML + idempotency. */
const SCHEDULING_APEX_PATH =
  "/services/apexrest/agentforce/scheduling-appointment";

/**
 * Node 5 — Phase 5c write seam. Calls the Apex `AgentforceSchedulingService`
 * (via `AgentforceSchedulingRest`'s `@RestResource`) to
 * book the approved plan — a `ServiceAppointment` (+ `AssignedResource`)
 * for the recommended technician/window — AFTER Node 6 approval clears.
 * Salesforce owns the DML, FLS, bulk-safety, and idempotency (keyed on
 * `Orchestrator_Workflow_Id__c` + Case); this gateway only marshals the
 * safe command/result and degrades (never throws) so a write failure can
 * never break the graph. Like the read gateway, it carries only the
 * sanitized `resourceReference` — the full technician name never leaves it.
 */
@Injectable()
export class SalesforceSchedulingWriteGateway {
  private readonly logger = new Logger(SalesforceSchedulingWriteGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  /**
   * Applies the approved booking command. Returns a degraded result (left
   * `proposed`, no appointment) instead of throwing when the call cannot
   * complete, so the post-approval write-back never fails the run.
   */
  async applyAppointment(
    command: SchedulingWriteCommand
  ): Promise<SchedulingWriteResult> {
    if (
      !command.workflowId ||
      !command.caseId ||
      !command.resourceReference ||
      !command.schedStart ||
      !command.schedEnd
    ) {
      return SalesforceSchedulingWriteGateway.degradedResult(
        "Incomplete scheduling write command."
      );
    }
    try {
      const response = await this.authedRequest(SCHEDULING_APEX_PATH, command);
      this.assertOk(response);
      const json = await readJsonObject(response);
      return SalesforceSchedulingWriteGateway.mapResult(json);
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Scheduling write degraded: kind=${kind}`);
      return SalesforceSchedulingWriteGateway.degradedResult(
        "Scheduling write unavailable; appointment left proposed."
      );
    }
  }

  /** POST with a single 401 retry after invalidating the cached token. */
  private async authedRequest(
    path: string,
    body: SchedulingWriteCommand
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
        "Salesforce rejected the scheduling-write credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Scheduling Apex REST resource not found."
      );
    }
    this.logger.warn(
      `Salesforce scheduling write failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the scheduling write."
    );
  }

  private static mapResult(
    json: Record<string, unknown>
  ): SchedulingWriteResult {
    const idempotentSkip = json["idempotentSkip"] === true;
    const appointmentReference =
      typeof json["appointmentReference"] === "string"
        ? json["appointmentReference"]
        : undefined;
    // A booking must carry a reference; otherwise treat as degraded so a
    // malformed/empty body never silently flips the plan to "booked".
    const booked = json["booked"] === true && Boolean(appointmentReference);
    if (json["applied"] === true && json["booked"] === true && !booked) {
      return SalesforceSchedulingWriteGateway.degradedResult(
        "Scheduling write returned no appointment reference."
      );
    }
    return {
      applied: json["applied"] === true,
      degraded: json["degraded"] === true,
      booked,
      idempotentSkip,
      appointmentStatus: booked ? "booked" : "none",
      appointmentReference,
      appointmentId:
        typeof json["appointmentId"] === "string"
          ? json["appointmentId"]
          : undefined,
      assignedResourceId:
        typeof json["assignedResourceId"] === "string"
          ? json["assignedResourceId"]
          : undefined,
      message: typeof json["message"] === "string" ? json["message"] : undefined
    };
  }

  private static degradedResult(message: string): SchedulingWriteResult {
    return {
      applied: false,
      degraded: true,
      booked: false,
      idempotentSkip: false,
      appointmentStatus: "none",
      message
    };
  }
}

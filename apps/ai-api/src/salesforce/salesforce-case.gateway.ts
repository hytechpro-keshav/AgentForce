import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type { TriagePriorityDto } from "../agents/dto/triage-case.dto";
import type {
  CaseTriageTrackingCommand,
  CaseTriageWriteBackCommand,
  CaseTriageWriteBackResult
} from "../orchestrator/dto/case-triage-write-back";
import type { SalesforceCaseContext } from "../orchestrator/dto/salesforce-case-context";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

const CASE_FIELDS =
  "Id,CaseNumber,Subject,Description,Priority,Status,Origin,AccountId";

/**
 * Outbound Salesforce gateway: reads Case context and applies the
 * gated triage write-back. This is the single seam where the
 * orchestrator touches Salesforce as data source and action executor.
 * Orchestrator nodes depend on this service, never on raw HTTP.
 */
@Injectable()
export class SalesforceCaseGateway {
  private readonly logger = new Logger(SalesforceCaseGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  async readCaseContext(caseId: string): Promise<SalesforceCaseContext> {
    const path = `/services/data/v${this.apiVersion()}/sobjects/Case/${encodeURIComponent(
      caseId
    )}?fields=${CASE_FIELDS}`;
    const response = await this.authedRequest("GET", path);
    this.assertOk(response, "read");
    const json = await readJsonObject(response);
    return SalesforceCaseGateway.mapCase(caseId, json);
  }

  async applyWriteBack(
    command: CaseTriageWriteBackCommand
  ): Promise<CaseTriageWriteBackResult> {
    const version = this.apiVersion();
    const patchPath = `/services/data/v${version}/sobjects/Case/${encodeURIComponent(
      command.caseId
    )}`;
    const patchResponse = await this.authedRequest("PATCH", patchPath, {
      Priority: SalesforceCaseGateway.toSalesforcePriority(
        command.recommendedPriority
      )
    });
    this.assertOk(patchResponse, "write");

    const commentBody = SalesforceCaseGateway.buildCommentBody(command);
    const commentPath = `/services/data/v${version}/sobjects/CaseComment`;
    const commentResponse = await this.authedRequest("POST", commentPath, {
      ParentId: command.caseId,
      CommentBody: commentBody,
      IsPublished: false
    });
    this.assertOk(commentResponse, "write");

    return { applied: true, priorityUpdated: true, commentCreated: true };
  }

  /**
   * Best-effort tracking write-back: stamps the AI triage workflow id
   * and status onto the Case custom fields. The orchestrator calls this
   * behind a config flag and wraps it so a failure (e.g. the fields are
   * not deployed) never breaks the run. Truncates to the field lengths.
   */
  async writeTriageTracking(command: CaseTriageTrackingCommand): Promise<void> {
    const path = `/services/data/v${this.apiVersion()}/sobjects/Case/${encodeURIComponent(
      command.caseId
    )}`;
    const body: Record<string, unknown> = {
      AI_Triage_Workflow_Id__c: command.workflowId.slice(0, 64),
      AI_Triage_Status__c: command.status.slice(0, 40),
      AI_Triage_Updated_At__c: command.updatedAt
    };
    if (command.uiUrl) {
      body.AI_Triage_UI_URL__c = command.uiUrl.slice(0, 255);
    }
    const response = await this.authedRequest("PATCH", path, body);
    this.assertOk(response, "write");
  }

  private apiVersion(): string {
    return this.config.salesforceConnection.apiVersion;
  }

  /**
   * Acquires a token, issues the request, and retries once on a 401
   * after invalidating the cached token. The caller classifies the
   * resulting status code.
   */
  private async authedRequest(
    method: "GET" | "PATCH" | "POST",
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
        "Salesforce rejected the orchestrator credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Salesforce Case not found."
      );
    }
    this.logger.warn(
      `Salesforce ${op} call failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the Case operation."
    );
  }

  private static buildCommentBody(command: CaseTriageWriteBackCommand): string {
    return `AI Triage (Node 1) — priority ${command.recommendedPriority}. ${command.triageSummary} Next step: ${command.suggestedNextStep}`.slice(
      0,
      4000
    );
  }

  private static mapCase(
    caseId: string,
    json: Record<string, unknown>
  ): SalesforceCaseContext {
    const str = (key: string): string | undefined =>
      typeof json[key] === "string" ? (json[key] as string) : undefined;
    return {
      caseId: str("Id") ?? caseId,
      caseNumber: str("CaseNumber"),
      subject: str("Subject") ?? "",
      description: str("Description") ?? "",
      status: str("Status"),
      origin: str("Origin"),
      reportedPriority: SalesforceCaseGateway.fromSalesforcePriority(
        str("Priority")
      ),
      accountId: str("AccountId")
    };
  }

  /** Salesforce standard Priority picklist -> triage vocabulary. */
  private static fromSalesforcePriority(
    raw: string | undefined
  ): TriagePriorityDto | undefined {
    switch ((raw ?? "").toLowerCase()) {
      case "critical":
        return "critical";
      case "high":
        return "high";
      case "medium":
        return "normal";
      case "low":
        return "low";
      default:
        return undefined;
    }
  }

  /**
   * Triage vocabulary -> Salesforce standard Priority picklist. The
   * standard picklist has no "Critical", so critical maps to High to
   * avoid picklist validation failures on stock orgs.
   */
  private static toSalesforcePriority(priority: TriagePriorityDto): string {
    switch (priority) {
      case "critical":
      case "high":
        return "High";
      case "normal":
        return "Medium";
      case "low":
      default:
        return "Low";
    }
  }
}

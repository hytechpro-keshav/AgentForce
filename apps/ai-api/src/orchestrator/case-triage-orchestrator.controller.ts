import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { Public } from "../auth/public.decorator";
import { RequireScopes } from "../auth/require-scopes.decorator";
import { CaseTriageOrchestratorService } from "./case-triage-orchestrator.service";
import { GuardrailApprovalTokenService } from "./guardrail-approval-token.service";
import { OrchestratorApprovalRateLimitGuard } from "./orchestrator-approval-rate-limit.guard";
import { ApproveCaseTriageDto } from "./dto/approve-case-triage.dto";
import type { CaseTriageWorkflowSnapshot } from "./dto/orchestration-status-event";
import type { ApproverResumeDecision } from "./dto/case-triage-lifecycle";
import { ResumeCaseTriageDto } from "./dto/resume-case-triage.dto";
import { SalesforceApprovalCallbackDto } from "./dto/sf-approval-callback.dto";
import { StopCaseTriageDto } from "./dto/stop-case-triage.dto";
import type { StopCaseTriageResult } from "./dto/stop-case-triage.dto";
import {
  TriggerCaseTriageDto,
  type TriggerCaseTriageAcceptedDto
} from "./dto/trigger-case-triage.dto";

const WORKFLOW_ID_PATTERN =
  /^wf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * Node 1 case-triage orchestrator boundary.
 *
 * - `POST triggers` is the async, fire-and-forget handoff from the
 *   Salesforce record-triggered Flow.
 * - `GET :workflowId` is the read-only status feed the UI renders.
 * - `POST :workflowId/resume` is the OUT-OF-BAND approval channel
 *   (email / Salesforce), never the UI. It carries its own scope.
 */
@Controller("orchestrator/case-triage")
export class CaseTriageOrchestratorController {
  private readonly logger = new Logger(CaseTriageOrchestratorController.name);

  constructor(
    private readonly orchestrator: CaseTriageOrchestratorService,
    private readonly approvalTokens: GuardrailApprovalTokenService
  ) {}

  @RequireScopes("agentforce:orchestrator-triage")
  @Post("triggers")
  @HttpCode(202)
  async triggerTriage(
    @Body() body: TriggerCaseTriageDto,
    @Req() request: AuthenticatedRequest
  ): Promise<TriggerCaseTriageAcceptedDto> {
    if (!this.orchestrator.isReady()) {
      // Honest fast-fail rather than accepting work that cannot
      // possibly read or write the real Case.
      throw new ServiceUnavailableException({
        error: "orchestrator_salesforce_not_configured",
        message:
          "Outbound Salesforce connectivity is not configured on the AI API."
      });
    }
    return this.orchestrator.trigger(body, request.authPrincipal);
  }

  @RequireScopes("agentforce:orchestrator-read")
  @Get("cases/:caseId/latest")
  async getLatestForCase(
    @Param("caseId") caseId: string
  ): Promise<CaseTriageWorkflowSnapshot> {
    return this.orchestrator.getLatestSnapshotForCase(
      this.assertCaseId(caseId)
    );
  }

  @RequireScopes("agentforce:orchestrator-read")
  @Get(":workflowId")
  async getStatus(
    @Param("workflowId") workflowId: string
  ): Promise<CaseTriageWorkflowSnapshot> {
    return this.orchestrator.getSnapshot(this.assertWorkflowId(workflowId));
  }

  @RequireScopes("agentforce:orchestrator-approval")
  @Post(":workflowId/resume")
  async resume(
    @Param("workflowId") workflowId: string,
    @Body() body: ResumeCaseTriageDto
  ): Promise<CaseTriageWorkflowSnapshot> {
    return this.orchestrator.resume(this.assertWorkflowId(workflowId), body);
  }

  /**
   * RC-1 (Node 6 6c) — operator Stop-AI takeover. The ONLY console-originated
   * mutation. Distinct from guardrail approve/reject: it carries the dedicated
   * `agentforce:orchestrator-control` scope — the read-only view token
   * (`agentforce:orchestrator-read`) and the approval scope CANNOT call it —
   * and routes the Case to a `stopped` terminal, never `rejected`. Flips the
   * Case control flag and settles the latest workflow so future AI work is
   * refused and a late SF approve no-ops.
   */
  @RequireScopes("agentforce:orchestrator-control")
  @Post("cases/:caseId/stop")
  async stop(
    @Param("caseId") caseId: string,
    @Body() body: StopCaseTriageDto
  ): Promise<StopCaseTriageResult> {
    return this.orchestrator.stop(this.assertCaseId(caseId), body);
  }

  /**
   * Phase 2 — start a STEPPED run from the console. Async like `/triggers`,
   * but the graph pauses after each stage (Triage runs automatically). Carries
   * the dedicated `agentforce:orchestrator-step` scope — neither the read view
   * token nor the approval scope can start a stepped run.
   */
  @RequireScopes("agentforce:orchestrator-step")
  @Post("cases/:caseId/stepped")
  @HttpCode(202)
  async triggerStepped(
    @Param("caseId") caseId: string,
    @Body() body: TriggerCaseTriageDto,
    @Req() request: AuthenticatedRequest
  ): Promise<TriggerCaseTriageAcceptedDto> {
    if (!this.orchestrator.isReady()) {
      throw new ServiceUnavailableException({
        error: "orchestrator_salesforce_not_configured",
        message:
          "Outbound Salesforce connectivity is not configured on the AI API."
      });
    }
    // The Case id comes from the path; the body carries the id + optional
    // case number. Guard that they agree so the path stays authoritative.
    const id = this.assertCaseId(caseId);
    if (body.caseId !== id) {
      throw new BadRequestException({ error: "case_id_mismatch" });
    }
    return this.orchestrator.triggerStepped(body, request.authPrincipal);
  }

  /**
   * Phase 2 — advance a paused stepped workflow by exactly one stage. Same
   * `agentforce:orchestrator-step` scope. Returns the updated snapshot.
   */
  @RequireScopes("agentforce:orchestrator-step")
  @Post(":workflowId/advance")
  async advance(
    @Param("workflowId") workflowId: string,
    @Req() request: AuthenticatedRequest
  ): Promise<CaseTriageWorkflowSnapshot> {
    return this.orchestrator.advance(
      this.assertWorkflowId(workflowId),
      request.authPrincipal
    );
  }

  /**
   * PUBLIC approve/reject confirmation page (6b). The guardrail approval email
   * links land here. The page renders ONLY after the scoped token verifies; it
   * then shows a single Confirm button that POSTs back. The deliberate
   * two-step (GET shows, POST acts) stops email-scanner / link-prefetch from
   * auto-approving — a GET never mutates state. Token-gated + rate-limited;
   * no API scope (it is `@Public()`).
   */
  @Public()
  @UseGuards(OrchestratorApprovalRateLimitGuard)
  @Header("content-type", "text/html; charset=utf-8")
  @Get(":workflowId/approve")
  approvePage(
    @Param("workflowId") workflowId: string,
    @Query("token") token: string,
    @Req() request: { originalUrl?: string; url?: string }
  ): string {
    const id = this.assertWorkflowId(workflowId);
    let decision: ApproverResumeDecision;
    try {
      const claims = this.approvalTokens.verify(token ?? "");
      if (claims.workflowId !== id) {
        throw new Error("workflow_mismatch");
      }
      decision = claims.decision;
    } catch {
      return CaseTriageOrchestratorController.htmlPage(
        "Link unavailable",
        "<p>This approval link is invalid or has expired. Ask for a fresh notification.</p>"
      );
    }
    const action = (request.originalUrl ?? request.url ?? "").split("?")[0];
    return CaseTriageOrchestratorController.confirmPage(
      action,
      token,
      decision
    );
  }

  /**
   * PUBLIC approve/reject action (6b). Invoked by the confirmation form. The
   * decision + workflow come ONLY from the verified token, never the request
   * body; the token's `jti` is the resume idempotency key, so a re-submit (or
   * a prefetch + confirm) resolves the workflow exactly once. Token-gated +
   * rate-limited.
   */
  @Public()
  @UseGuards(OrchestratorApprovalRateLimitGuard)
  @Header("content-type", "text/html; charset=utf-8")
  @HttpCode(200)
  @Post(":workflowId/approve")
  async approveAction(
    @Param("workflowId") workflowId: string,
    @Body() body: ApproveCaseTriageDto
  ): Promise<string> {
    const id = this.assertWorkflowId(workflowId);
    let decision: ApproverResumeDecision;
    let idempotencyKey: string;
    try {
      const claims = this.approvalTokens.verify(body.token);
      if (claims.workflowId !== id) {
        throw new Error("workflow_mismatch");
      }
      decision = claims.decision;
      idempotencyKey = claims.jti;
    } catch {
      return CaseTriageOrchestratorController.htmlPage(
        "Link unavailable",
        "<p>This approval link is invalid or has expired. Ask for a fresh notification.</p>"
      );
    }
    try {
      const snapshot = await this.orchestrator.resume(id, {
        decision,
        idempotencyKey
      });
      return CaseTriageOrchestratorController.resultPage(
        decision,
        snapshot.status
      );
    } catch (err) {
      // The link is valid but the workflow is no longer resumable (e.g. it
      // moved out of waiting_approval by another path). Friendly, generic.
      this.logger.warn(
        `Approval link resume not applied: workflow=${id} kind=${
          (err as Error).name ?? "unknown"
        }`
      );
      return CaseTriageOrchestratorController.htmlPage(
        "Already resolved",
        "<p>This case is no longer awaiting approval. No action was taken.</p>"
      );
    }
  }

  /**
   * PUBLIC Salesforce-Approval callback (6b+). The native Approval Process's
   * completion Flow POSTs here when an approver approves/rejects in Salesforce.
   * The workflow + idempotency key come ONLY from the verified, workflow-scoped
   * token (separate audience from the email links, so an email token cannot be
   * replayed here); the decision is taken from the body (the approver's actual
   * SF action) but constrained to `approved`/`rejected`. The token `jti` is the
   * resume idempotency key, so a duplicate Flow retry resolves once. Returns a
   * compact JSON ack the Apex callout can log. Token-gated + rate-limited.
   */
  @Public()
  @UseGuards(OrchestratorApprovalRateLimitGuard)
  @HttpCode(200)
  @Post(":workflowId/sf-approval-callback")
  async salesforceApprovalCallback(
    @Param("workflowId") workflowId: string,
    @Body() body: SalesforceApprovalCallbackDto
  ): Promise<{ status: string; applied: boolean }> {
    const id = this.assertWorkflowId(workflowId);
    let idempotencyKey: string;
    try {
      const claims = this.approvalTokens.verifyForSalesforce(body.token);
      if (claims.workflowId !== id) {
        throw new BadRequestException({ error: "workflow_mismatch" });
      }
      idempotencyKey = claims.jti;
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      // verifyForSalesforce throws UnauthorizedException — surface as-is.
      throw err;
    }
    try {
      const snapshot = await this.orchestrator.resume(id, {
        decision: body.decision,
        idempotencyKey
      });
      return { status: snapshot.status, applied: true };
    } catch (err) {
      // The token is valid but the workflow is no longer resumable (e.g. it
      // already moved out of waiting_approval). Acknowledge without error so
      // a retrying Flow does not loop.
      this.logger.warn(
        `SF approval callback resume not applied: workflow=${id} kind=${
          (err as Error).name ?? "unknown"
        }`
      );
      return { status: "not_applied", applied: false };
    }
  }

  private assertWorkflowId(workflowId: string): string {
    if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
      throw new BadRequestException({ error: "invalid_workflow_id" });
    }
    return workflowId;
  }

  private assertCaseId(caseId: string): string {
    const trimmed = caseId.trim();
    if (!CASE_ID_PATTERN.test(trimmed)) {
      throw new BadRequestException({ error: "invalid_case_id" });
    }
    return trimmed;
  }

  /** Minimal, no-index HTML shell. `title`/`body` come from trusted literals. */
  private static htmlPage(title: string, body: string): string {
    return (
      `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"/>` +
      `<meta name="robots" content="noindex"/><title>${title}</title></head>` +
      `<body style="font-family:system-ui,-apple-system,sans-serif;max-width:34rem;` +
      `margin:3rem auto;padding:0 1rem;color:#111;line-height:1.5;">` +
      `<h1 style="font-size:1.25rem;">${title}</h1>${body}</body></html>`
    );
  }

  private static confirmPage(
    action: string,
    token: string,
    decision: ApproverResumeDecision
  ): string {
    const verb = decision === "approved" ? "Approve" : "Reject";
    const color = decision === "approved" ? "#16a34a" : "#6b7280";
    const safeAction = CaseTriageOrchestratorController.escapeAttr(action);
    const safeToken = CaseTriageOrchestratorController.escapeAttr(token);
    return CaseTriageOrchestratorController.htmlPage(
      `${verb} this service case?`,
      `<p>Confirm to ${verb.toLowerCase()} the orchestrated write-back for this ` +
        `case. Nothing changes until you confirm.</p>` +
        `<form method="post" action="${safeAction}">` +
        `<input type="hidden" name="token" value="${safeToken}"/>` +
        `<button type="submit" style="background:${color};color:#fff;border:0;` +
        `padding:12px 22px;border-radius:6px;font-size:1rem;cursor:pointer;">` +
        `Confirm ${verb}</button></form>`
    );
  }

  private static resultPage(
    decision: ApproverResumeDecision,
    status: string
  ): string {
    return CaseTriageOrchestratorController.htmlPage(
      `Case ${decision}`,
      `<p>Thank you — the case was <strong>${decision}</strong>.</p>` +
        `<p style="color:#6b7280;">Workflow status: ` +
        `${CaseTriageOrchestratorController.escapeAttr(status)}.</p>`
    );
  }

  private static escapeAttr(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceGuardrailApprovalGateway } from "../salesforce/salesforce-guardrail-approval.gateway";
import {
  APPROVAL_EMAIL_SENDER,
  type ApprovalEmailMessage,
  type ApprovalEmailSender
} from "./approval-email-sender";
import { GuardrailApprovalTokenService } from "./guardrail-approval-token.service";
import type {
  GuardrailApprovalInterrupt,
  GuardrailApprovalRouting,
  GuardrailApprovalSubmitCommand,
  GuardrailApprovalVerdict,
  GuardrailSalesforceApprovalContext
} from "./dto/guardrail";

/** Escapes the few characters that matter inside an HTML text node/attr. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Phase 6b — guardrail approval routing dep. Replaces the 6a log-only stub
 * with real email delivery: an approval email carrying scoped approve/reject
 * links (each a one-decision token), and an optional supervisor escalation
 * notice. It keeps the two contracts the graph relies on: **idempotent** and
 * **degrade-safe** (never throws into the graph).
 *
 * Idempotency (phase plan §11 R2 — the critical 6b fix): the
 * `evaluateGuardrail` node re-runs ALL of its pre-`interrupt()` code on every
 * resume, and the `guardrail.approvalRouting.sentAt` it returns is NOT
 * committed to the checkpoint before `interrupt()` suspends — so the graph
 * guard (`!state.guardrail?.approvalRouting?.sentAt`) cannot, by itself, stop
 * a second send on the first resume. This service therefore keys an in-memory
 * map on `workflowId`: a re-entry returns the routing already recorded WITHOUT
 * re-sending. Its lifetime matches the in-memory checkpointer
 * ({@link MemorySaver}); if the process restarts, the paused thread and this
 * map die together, so there is nothing to resume and no duplicate send.
 */
@Injectable()
export class GuardrailApprovalNotificationService {
  private readonly logger = new Logger(
    GuardrailApprovalNotificationService.name
  );
  /** workflowId -> routing already sent (idempotency guard across resume). */
  private readonly sentByWorkflow = new Map<string, GuardrailApprovalRouting>();
  /** workflowId set for which an escalation notice was already sent. */
  private readonly escalatedWorkflows = new Set<string>();

  constructor(
    private readonly config: AppConfigService,
    private readonly tokens: GuardrailApprovalTokenService,
    @Inject(APPROVAL_EMAIL_SENDER)
    private readonly emailSender: ApprovalEmailSender,
    private readonly sfApproval: SalesforceGuardrailApprovalGateway
  ) {}

  /**
   * Notifies the approver that a workflow is held for Account Manager approval, and
   * returns the routing record the `evaluateGuardrail` node stamps on the
   * guardrail channel. Idempotent per workflow and degrade-safe.
   *
   * - Salesforce approval on (6b+, primary): submits the Case Approval
   *   Process via Apex REST, returns `{ method: "salesforce_approval",
   *   sentAt, externalRef }` (with `degraded: true` if submit failed).
   * - Email on: sends the approve/reject email, returns
   *   `{ method: "email", sentAt, recipientRole }` (with `degraded: true` if
   *   delivery failed — the graph still reaches `interrupt()`).
   * - Both off (6a parity): records a safe log line, returns `log_only`.
   */
  async notifyApprovalRequired(
    workflowId: string,
    caseId: string,
    payload: GuardrailApprovalInterrupt,
    context?: GuardrailSalesforceApprovalContext
  ): Promise<GuardrailApprovalRouting> {
    const existing = this.sentByWorkflow.get(workflowId);
    if (existing) {
      return existing;
    }

    const approval = this.config.orchestrator.guardrailApproval;

    // 6b+ — Salesforce Approval Process is the primary out-of-band channel
    // when enabled. Submit is degrade-safe (the gateway never throws); a
    // failed submit still records routing so the graph reaches interrupt()
    // and the operator can fall back to a manual resume.
    if (approval.salesforceApprovalEnabled) {
      const routing = await this.routeSalesforceApproval(
        workflowId,
        caseId,
        payload,
        context
      );
      this.sentByWorkflow.set(workflowId, routing);
      return routing;
    }

    if (!approval.emailEnabled) {
      this.logger.log(
        `Guardrail approval required: workflow=${workflowId} ` +
          `risk=${payload.guardrail.riskScore} (${payload.guardrail.riskLevel}); ` +
          "awaiting out-of-band approval (log_only)."
      );
      const routing: GuardrailApprovalRouting = { method: "log_only" };
      this.sentByWorkflow.set(workflowId, routing);
      return routing;
    }

    const routing: GuardrailApprovalRouting = {
      method: "email",
      sentAt: new Date().toISOString(),
      recipientRole: approval.recipientRole
    };
    try {
      await this.emailSender.send(this.buildApprovalEmail(workflowId, payload));
    } catch (err) {
      // Degrade-safe: a delivery failure must never stop the graph from
      // reaching interrupt(). Record the attempt (so a resume does not
      // retry-spam) and mark it degraded for the operator.
      this.logger.warn(
        `Guardrail approval email degraded: workflow=${workflowId} ` +
          `reason=${(err as Error).name ?? "unknown"}`
      );
      routing.degraded = true;
    }
    this.sentByWorkflow.set(workflowId, routing);
    return routing;
  }

  /**
   * Submits the native Salesforce Approval Process for a held workflow and
   * returns the routing record. The callback token is minted here (separate
   * audience, decision-agnostic) and stamped on the Case by Apex so the
   * approval-completion Flow can authenticate its resume callout. Degrade-safe:
   * a failed submit returns `{ method: "salesforce_approval", sentAt,
   * degraded: true }` so the graph still reaches `interrupt()`.
   */
  private async routeSalesforceApproval(
    workflowId: string,
    caseId: string,
    payload: GuardrailApprovalInterrupt,
    context?: GuardrailSalesforceApprovalContext
  ): Promise<GuardrailApprovalRouting> {
    const approval = this.config.orchestrator.guardrailApproval;
    const routing: GuardrailApprovalRouting = {
      method: "salesforce_approval",
      sentAt: new Date().toISOString(),
      recipientRole: approval.recipientRole
    };
    try {
      const command: GuardrailApprovalSubmitCommand = {
        workflowId,
        caseId,
        riskScore: payload.guardrail.riskScore,
        riskLevel: payload.guardrail.riskLevel,
        policyRulesTriggered: payload.guardrail.policyRulesTriggered,
        approvalReasons: payload.guardrail.approvalReasons,
        resumeToken: this.tokens.mintForSalesforce(workflowId),
        verdict:
          context?.verdict ??
          GuardrailApprovalNotificationService.fallbackVerdict(payload),
        orchestrationConsoleUrl: context?.orchestrationConsoleUrl
      };
      const result = await this.sfApproval.submitApproval(command);
      if (result.processInstanceId) {
        routing.externalRef = result.processInstanceId;
      }
      if (!result.submitted || result.degraded) {
        routing.degraded = true;
      }
    } catch (err) {
      // Defensive: the gateway is already degrade-safe, but never let an
      // unexpected error escape into the graph (it must reach interrupt()).
      this.logger.warn(
        `Guardrail SF approval submit degraded: workflow=${workflowId} ` +
          `reason=${(err as Error).name ?? "unknown"}`
      );
      routing.degraded = true;
    }
    return routing;
  }

  /**
   * Minimal verdict built from the interrupt payload when the full synthesized
   * verdict is unavailable — so the Case still shows the approver the core
   * facts. Non-PII: scores, priority, statuses, and reason labels only.
   */
  private static fallbackVerdict(
    payload: GuardrailApprovalInterrupt
  ): GuardrailApprovalVerdict {
    const g = payload.guardrail;
    const ctx = payload.context;
    const highlights = [
      { label: "Risk", value: `${g.riskScore} (${g.riskLevel})` },
      { label: "Recommended priority", value: ctx.recommendedPriority },
      ctx.partsStatus ? { label: "Parts", value: ctx.partsStatus } : undefined,
      ctx.schedulingStatus
        ? { label: "Scheduling", value: ctx.schedulingStatus }
        : undefined
    ].filter((h): h is { label: string; value: string } => h !== undefined);
    return {
      headline: `Account Manager approval required — risk ${g.riskScore} (${g.riskLevel})`,
      summary:
        "This service case is held for Account Manager approval by the compliance " +
        "guardrail. Review the triggered policy rules and approve or reject " +
        "in Salesforce.",
      recommendedSteps: g.approvalReasons.length
        ? g.approvalReasons
        : ["Review the case and approve or reject."],
      highlights
    };
  }

  /**
   * Optional supervisor escalation notice for the terminal `escalate`
   * outcome (no interrupt). Idempotent per workflow and degrade-safe; a no-op
   * when escalation email is disabled. Returns nothing — escalation is a
   * terminal path, not a routing the channel needs to carry for resume.
   */
  async notifyEscalation(
    workflowId: string,
    _caseId: string,
    payload: GuardrailApprovalInterrupt
  ): Promise<void> {
    const approval = this.config.orchestrator.guardrailApproval;
    if (!approval.emailEnabled || !approval.escalationEmailEnabled) {
      return;
    }
    if (this.escalatedWorkflows.has(workflowId)) {
      return;
    }
    this.escalatedWorkflows.add(workflowId);
    try {
      await this.emailSender.send(
        this.buildEscalationEmail(workflowId, payload)
      );
    } catch (err) {
      this.logger.warn(
        `Guardrail escalation email degraded: workflow=${workflowId} ` +
          `reason=${(err as Error).name ?? "unknown"}`
      );
    }
  }

  /** Builds the approve/reject email. Body is non-PII (labels + ids only). */
  private buildApprovalEmail(
    workflowId: string,
    payload: GuardrailApprovalInterrupt
  ): ApprovalEmailMessage {
    const approval = this.config.orchestrator.guardrailApproval;
    const base = (approval.linkBaseUrl ?? "").replace(/\/+$/, "");
    const link = (decision: "approved" | "rejected"): string =>
      `${base}/orchestrator/case-triage/${encodeURIComponent(workflowId)}` +
      `/approve?token=${encodeURIComponent(this.tokens.mint(workflowId, decision))}`;
    const approveUrl = link("approved");
    const rejectUrl = link("rejected");
    const caseRef = GuardrailApprovalNotificationService.caseRef(payload);
    const facts = GuardrailApprovalNotificationService.factLines(payload);
    const subject = `Action required: approve or reject service case ${caseRef}`;

    const text = [
      `A service case (${caseRef}, workflow ${workflowId}) is held for your approval.`,
      "",
      ...facts,
      "",
      `Approve: ${approveUrl}`,
      `Reject:  ${rejectUrl}`,
      "",
      "Each link opens a confirmation page before any action is taken, and expires shortly."
    ].join("\n");

    const factsHtml = facts
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("");
    const html = [
      `<p>A service case (<strong>${escapeHtml(caseRef)}</strong>, workflow`,
      ` <code>${escapeHtml(workflowId)}</code>) is held for your approval.</p>`,
      `<ul>${factsHtml}</ul>`,
      `<p>`,
      `<a href="${escapeHtml(approveUrl)}" style="background:#16a34a;color:#fff;`,
      `padding:10px 18px;border-radius:6px;text-decoration:none;margin-right:8px;">Approve</a>`,
      `<a href="${escapeHtml(rejectUrl)}" style="background:#6b7280;color:#fff;`,
      `padding:10px 18px;border-radius:6px;text-decoration:none;">Reject</a>`,
      `</p>`,
      `<p style="color:#6b7280;font-size:12px;">Each link opens a confirmation`,
      ` page before any action is taken, and expires shortly.</p>`
    ].join("");

    return {
      to: approval.emailTo!,
      from: approval.emailFrom!,
      subject,
      text,
      html
    };
  }

  /** Builds the terminal supervisor escalation notice (no action links). */
  private buildEscalationEmail(
    workflowId: string,
    payload: GuardrailApprovalInterrupt
  ): ApprovalEmailMessage {
    const approval = this.config.orchestrator.guardrailApproval;
    const caseRef = GuardrailApprovalNotificationService.caseRef(payload);
    const facts = GuardrailApprovalNotificationService.factLines(payload);
    const subject = `Service case ${caseRef} escalated — supervisor review`;
    const text = [
      `A service case (${caseRef}, workflow ${workflowId}) was escalated by the`,
      "compliance guardrail and needs supervisor review. It will not proceed",
      "automatically.",
      "",
      ...facts
    ].join("\n");
    const factsHtml = facts
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("");
    const html = [
      `<p>A service case (<strong>${escapeHtml(caseRef)}</strong>, workflow`,
      ` <code>${escapeHtml(workflowId)}</code>) was escalated by the compliance`,
      ` guardrail and needs supervisor review. It will not proceed automatically.</p>`,
      `<ul>${factsHtml}</ul>`
    ].join("");
    return {
      to: approval.emailTo!,
      from: approval.emailFrom!,
      subject,
      text,
      html
    };
  }

  /** Last-4 reference only — never the full case id/number (no PII leak). */
  private static caseRef(payload: GuardrailApprovalInterrupt): string {
    if (payload.caseNumber) {
      return `#…${payload.caseNumber.slice(-4)}`;
    }
    return `…${payload.caseId.slice(-4)}`;
  }

  /** Safe, non-PII fact lines: scores, labels, statuses, and rule ids only. */
  private static factLines(payload: GuardrailApprovalInterrupt): string[] {
    const g = payload.guardrail;
    const ctx = payload.context;
    return [
      `Risk score: ${g.riskScore} (${g.riskLevel})`,
      `Recommended priority: ${ctx.recommendedPriority}`,
      ctx.partsStatus ? `Parts: ${ctx.partsStatus}` : undefined,
      ctx.schedulingStatus ? `Scheduling: ${ctx.schedulingStatus}` : undefined,
      g.approvalReasons.length
        ? `Reasons: ${g.approvalReasons.join("; ")}`
        : undefined,
      g.policyRulesTriggered.length
        ? `Triggered rules: ${g.policyRulesTriggered.join(", ")}`
        : undefined
    ].filter((line): line is string => Boolean(line));
  }
}

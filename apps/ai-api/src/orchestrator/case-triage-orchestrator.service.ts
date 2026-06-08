import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { MemorySaver } from "@langchain/langgraph";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { TelemetryService } from "../observability/telemetry.service";
import { SalesforceCaseGateway } from "../salesforce/salesforce-case.gateway";
import { SalesforceCustomerGateway } from "../salesforce/salesforce-customer.gateway";
import { SalesforceGatewayError } from "../salesforce/salesforce-gateway.error";
import { SupportTriageService } from "../agents/support-triage.service";
import { CustomerHistorySynthesisService } from "../agents/customer-history.service";
import type { TriageCaseRequestDto } from "../agents/dto/triage-case.dto";
import { ExternalContextAdapterRegistry } from "./adapters/external-context.adapter";
import { evaluateCustomerHistoryEligibility } from "./customer-history.eligibility";
import {
  buildCaseTriageGraph,
  Command,
  type CaseTriageStateType,
  type CaseTriageTriageInput,
  type CompiledCaseTriageGraph
} from "./case-triage.graph";
import {
  isTerminalLifecycleStatus,
  type NodeLifecycleStatus
} from "./dto/case-triage-lifecycle";
import type {
  CustomerContextChannel,
  CustomerHistoryEligibilityResult,
  CustomerHistoryReadResult,
  CustomerReadBundle,
  CustomerReadScope
} from "./dto/customer-context";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type { TriagePriorityDto } from "../agents/dto/triage-case.dto";
import type {
  CaseTriageWorkflowSnapshot,
  OrchestrationExecutionTrace,
  OrchestrationEventDetail,
  OrchestrationTraceValue,
  SanitizedTriageResult
} from "./dto/orchestration-status-event";
import type { ResumeCaseTriageDto } from "./dto/resume-case-triage.dto";
import type {
  TriggerCaseTriageAcceptedDto,
  TriggerCaseTriageDto
} from "./dto/trigger-case-triage.dto";
import { OrchestrationStatusStore } from "./orchestration-status.store";

/**
 * Owns the case-triage LangGraph: trigger handoff, read, triage (via
 * the existing support triage seam), the non-interrupting Node 2
 * customer-history enrichment, the gated write-back, status events, and
 * idempotent approval resume.
 *
 * Salesforce stays the system of record and action executor; this
 * service only orchestrates and calls `ModelRouter` indirectly through
 * {@link SupportTriageService} and {@link CustomerHistorySynthesisService}.
 * It never imports a vendor SDK.
 */
@Injectable()
export class CaseTriageOrchestratorService {
  private readonly logger = new Logger(CaseTriageOrchestratorService.name);
  private readonly checkpointer = new MemorySaver();
  private readonly graph: CompiledCaseTriageGraph;
  private readonly processedResumeKeys = new Map<string, string>();

  constructor(
    private readonly gateway: SalesforceCaseGateway,
    private readonly customerGateway: SalesforceCustomerGateway,
    private readonly supportTriage: SupportTriageService,
    private readonly customerHistory: CustomerHistorySynthesisService,
    private readonly externalAdapters: ExternalContextAdapterRegistry,
    private readonly store: OrchestrationStatusStore,
    private readonly telemetry: TelemetryService,
    private readonly config: AppConfigService
  ) {
    this.graph = buildCaseTriageGraph({
      readContext: (caseId) => this.gateway.readCaseContext(caseId),
      runTriage: (input) => this.runTriage(input),
      applyWriteBack: (triage, caseId) => this.applyWriteBack(triage, caseId),
      requiresApproval: (triage) => this.requiresApproval(triage),
      isCustomerHistoryEligible: (context, triagePriority) =>
        this.isCustomerHistoryEligible(context, triagePriority),
      readCustomerContext: (scope) => this.readCustomerContext(scope),
      synthesizeCustomerHistory: (input) =>
        this.customerHistory.synthesize(input),
      emitRunning: (workflowId, summary, details, node, trace) =>
        this.store.appendEvent(
          workflowId,
          "running",
          summary,
          details,
          node,
          trace
        ),
      checkpointer: this.checkpointer
    });
  }

  /** True when outbound Salesforce connectivity is configured. */
  isReady(): boolean {
    return this.gateway.isConfigured();
  }

  /**
   * Trigger handoff. Durably persists the assigned workflow, returns
   * immediately, and runs the graph fire-and-forget. The Salesforce
   * Flow never waits for model work.
   */
  async trigger(
    dto: TriggerCaseTriageDto,
    principal?: AuthPrincipal
  ): Promise<TriggerCaseTriageAcceptedDto> {
    const workflowId = `wf-${randomUUID()}`;
    // Await create so the assigned snapshot is written through to the
    // durable store before the 202 — the Case is resolvable by id
    // immediately, even if this instance restarts mid-run.
    await this.store.createAssigned({
      workflowId,
      caseId: dto.caseId,
      caseNumber: dto.caseNumber
    });
    // Best-effort: stamp the workflow id + status on the Case so the
    // history is resolvable from Salesforce too. Fire-and-forget so the
    // 202 is not delayed and the Flow never waits.
    void this.trackOnSalesforce(dto.caseId, workflowId, "assigned");
    void this.run(workflowId, dto, principal).catch(() => {
      // run() already records failures into the read model; this guard
      // only prevents an unhandled rejection from escaping.
      this.logger.error(
        `Unhandled orchestrator run rejection: workflow=${workflowId}`
      );
    });
    return {
      workflowId,
      caseId: dto.caseId,
      caseNumber: dto.caseNumber,
      status: "assigned",
      acceptedAt: new Date().toISOString()
    };
  }

  async getSnapshot(workflowId: string): Promise<CaseTriageWorkflowSnapshot> {
    const snapshot = await this.store.get(workflowId);
    if (!snapshot) {
      throw new NotFoundException({ error: "workflow_not_found" });
    }
    return snapshot;
  }

  async getLatestSnapshotForCase(
    caseId: string
  ): Promise<CaseTriageWorkflowSnapshot> {
    const snapshot = await this.store.getLatestForCase(caseId);
    if (!snapshot) {
      throw new NotFoundException({ error: "workflow_not_found_for_case" });
    }
    return snapshot;
  }

  /**
   * Out-of-band approval resume. Idempotent: replaying the same
   * decision key, or resuming an already-terminal workflow, returns
   * the existing snapshot without re-applying the write-back.
   */
  async resume(
    workflowId: string,
    dto: ResumeCaseTriageDto
  ): Promise<CaseTriageWorkflowSnapshot> {
    const existing = await this.store.get(workflowId);
    if (!existing) {
      throw new NotFoundException({ error: "workflow_not_found" });
    }
    if (this.processedResumeKeys.get(workflowId) === dto.idempotencyKey) {
      return existing;
    }
    if (isTerminalLifecycleStatus(existing.status)) {
      return existing;
    }
    if (existing.status !== "waiting_approval") {
      throw new ConflictException({
        error: "not_awaiting_approval",
        status: existing.status
      });
    }

    const startedAt = Date.now();
    try {
      const result = (await this.graph.invoke(
        new Command({ resume: dto.decision }),
        { configurable: { thread_id: workflowId } }
      )) as CaseTriageStateType;
      await this.settleAfterInvoke(workflowId, result, startedAt);
      this.processedResumeKeys.set(workflowId, dto.idempotencyKey);
    } catch (err) {
      await this.fail(workflowId, err);
    }
    return this.getSnapshot(workflowId);
  }

  private async run(
    workflowId: string,
    dto: TriggerCaseTriageDto,
    principal?: AuthPrincipal
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = (await this.graph.invoke(
        {
          workflowId,
          caseId: dto.caseId,
          caseNumber: dto.caseNumber,
          tenantId: principal?.tenantId,
          principalSubject: principal?.subject ?? "orchestrator",
          approvalRequired: false,
          writeBackApplied: false,
          status: "running"
        },
        { configurable: { thread_id: workflowId } }
      )) as CaseTriageStateType;
      await this.settleAfterInvoke(workflowId, result, startedAt);
    } catch (err) {
      await this.fail(workflowId, err);
    }
  }

  private async settleAfterInvoke(
    workflowId: string,
    result: CaseTriageStateType,
    startedAt: number
  ): Promise<void> {
    if (CaseTriageOrchestratorService.isInterrupted(result)) {
      await this.store.update(workflowId, {
        approvalRequired: true,
        triage: result.triage,
        customerContext: result.customerContext
      });
      await this.store.appendEvent(
        workflowId,
        "waiting_approval",
        "Awaiting approval — request sent to email / Salesforce.",
        undefined,
        undefined,
        CaseTriageOrchestratorService.buildWaitingApprovalTrace(result)
      );
      await this.trackOnSalesforce(
        result.caseId,
        workflowId,
        "waiting_approval"
      );
      this.logTelemetry(
        "waiting_approval",
        workflowId,
        result.triage,
        startedAt
      );
      this.logCustomerHistoryTelemetry(workflowId, result.customerContext);
      return;
    }

    if (result.status === "rejected") {
      await this.store.update(workflowId, {
        triage: result.triage,
        customerContext: result.customerContext,
        approvalRequired: result.approvalRequired,
        approvalDecision: result.approvalDecision
      });
      await this.store.appendEvent(
        workflowId,
        "rejected",
        "Triage write-back rejected; Case left unchanged.",
        undefined,
        undefined,
        CaseTriageOrchestratorService.buildRejectedTrace(result)
      );
      await this.trackOnSalesforce(result.caseId, workflowId, "rejected");
      this.logTelemetry("rejected", workflowId, result.triage, startedAt);
      this.logCustomerHistoryTelemetry(workflowId, result.customerContext);
      return;
    }

    await this.store.update(workflowId, {
      triage: result.triage,
      customerContext: result.customerContext,
      writeBackApplied: Boolean(result.writeBackApplied),
      approvalRequired: result.approvalRequired,
      approvalDecision: result.approvalDecision
    });
    await this.store.appendEvent(
      workflowId,
      "done",
      result.triage
        ? `Triage applied: priority ${result.triage.recommendedPriority}.`
        : "Triage complete.",
      CaseTriageOrchestratorService.buildDoneDetails(result),
      undefined,
      CaseTriageOrchestratorService.buildDoneTrace(result)
    );
    await this.trackOnSalesforce(result.caseId, workflowId, "done");
    this.logTelemetry("done", workflowId, result.triage, startedAt);
    this.logCustomerHistoryTelemetry(workflowId, result.customerContext);
  }

  private async fail(workflowId: string, err: unknown): Promise<void> {
    const kind = CaseTriageOrchestratorService.failureKindOf(err);
    await this.store.update(workflowId, { failureKind: kind });
    await this.store.appendEvent(
      workflowId,
      "failed",
      "Triage failed.",
      undefined,
      undefined,
      CaseTriageOrchestratorService.buildFailureTrace(kind)
    );
    const caseId = (await this.store.get(workflowId))?.caseId;
    if (caseId) {
      await this.trackOnSalesforce(caseId, workflowId, "failed");
    }
    this.logTelemetry("failed", workflowId, undefined, Date.now(), kind);
    this.logger.warn(
      `Case-triage workflow failed: workflow=${workflowId} kind=${kind}`
    );
  }

  /**
   * Best-effort Salesforce tracking write-back. Gated by config and
   * fully guarded: a failure (fields not deployed, FLS, transient
   * error) is logged with a safe message and swallowed so it can never
   * break the orchestration run or the Flow.
   */
  private async trackOnSalesforce(
    caseId: string,
    workflowId: string,
    status: NodeLifecycleStatus
  ): Promise<void> {
    const writeBack = this.config.orchestrator.salesforceWriteBack;
    if (!writeBack?.enabled) {
      return;
    }
    try {
      await this.gateway.writeTriageTracking({
        caseId,
        workflowId,
        status,
        updatedAt: new Date().toISOString(),
        uiUrl: writeBack.uiBaseUrl
          ? `${writeBack.uiBaseUrl.replace(/\/+$/, "")}/orchestration?caseId=${encodeURIComponent(
              caseId
            )}`
          : undefined
      });
    } catch {
      this.logger.warn(
        `Salesforce triage tracking write-back skipped: workflow=${workflowId} status=${status}`
      );
    }
  }

  private async runTriage(
    input: CaseTriageTriageInput
  ): Promise<SanitizedTriageResult> {
    const request: TriageCaseRequestDto = {
      subject: input.context.subject.slice(0, 200),
      description: input.context.description.slice(0, 4000),
      reportedPriority: input.context.reportedPriority,
      caseId: input.context.caseId,
      requestId: input.workflowId
    };
    const principal: AuthPrincipal = {
      subject: input.principalSubject,
      scopes: [],
      tenantId: input.tenantId,
      raw: {}
    };
    const response = await this.supportTriage.triage(request, principal);
    return {
      recommendedPriority: response.recommendedPriority,
      summary: response.summary,
      suggestedNextStep: response.suggestedNextStep,
      provider: response.provider,
      model: response.model,
      fallbackUsed: response.fallbackUsed,
      latencyMs: response.latencyMs
    };
  }

  private async applyWriteBack(
    triage: SanitizedTriageResult,
    caseId: string
  ): Promise<void> {
    await this.gateway.applyWriteBack({
      caseId,
      recommendedPriority: triage.recommendedPriority,
      triageSummary: triage.summary,
      suggestedNextStep: triage.suggestedNextStep
    });
  }

  private requiresApproval(triage: SanitizedTriageResult): boolean {
    switch (this.config.orchestrator.triageApprovalMode) {
      case "always":
        return true;
      case "high_risk":
        return (
          triage.recommendedPriority === "high" ||
          triage.recommendedPriority === "critical"
        );
      case "auto":
      default:
        return false;
    }
  }

  /**
   * Node 2 eligibility — pure, config-driven, no Salesforce access.
   * Gates the expensive reads + model call so low-value Cases skip the
   * customer-history enrichment.
   */
  private isCustomerHistoryEligible(
    context: SalesforceCaseContext,
    triagePriority: TriagePriorityDto | undefined
  ): CustomerHistoryEligibilityResult {
    return evaluateCustomerHistoryEligibility(
      context,
      triagePriority,
      this.config.orchestrator.customerHistory.eligibility
    );
  }

  /**
   * Node 2 read seam. Prefers the single governed Data 360 call and
   * falls back to the scoped per-object reads; then layers any enabled
   * external adapter signals. Every read is tenant- and Account-scoped
   * and read-only. Per-source failures degrade rather than fail the
   * node (carried in `bundle.missingSources` / `degradedSources`).
   */
  private async readCustomerContext(
    scope: CustomerReadScope
  ): Promise<CustomerHistoryReadResult> {
    const startedAt = Date.now();
    let bundle: CustomerReadBundle | undefined;
    try {
      bundle = await this.customerGateway.readCustomer360Bundle(scope);
    } catch {
      // Data Cloud miss: fall back to the scoped SOQL reads below.
      bundle = undefined;
    }
    if (!bundle) {
      bundle = await this.customerGateway.readCustomerBundle(scope);
    }
    const external = await this.externalAdapters.readAll(scope);
    // One telemetry span for the customer read (no PII; counts only).
    this.telemetry.recordAgentWorkflow({
      operation: "orchestrator.customer_history.read",
      useCase: "agentforce_customer_history",
      latencyMs: Date.now() - startedAt,
      healthStatus:
        bundle.missingSources.length + external.degradedSources.length > 0
          ? "degraded"
          : "ok",
      outcome: "success"
    });
    return {
      bundle,
      externalSignals: external.signals,
      degradedSources: external.degradedSources
    };
  }

  /** One sanitized telemetry span for the Node 2 enrichment. */
  private logCustomerHistoryTelemetry(
    workflowId: string,
    channel: CustomerContextChannel | undefined
  ): void {
    if (!channel) {
      return;
    }
    this.telemetry.recordAgentWorkflow({
      operation: "orchestrator.customer_history",
      useCase: "agentforce_customer_history",
      requestId: workflowId,
      provider: channel.provider,
      model: channel.model,
      latencyMs: channel.latencyMs ?? 0,
      fallbackUsed: channel.fallbackUsed,
      // Safe, non-PII workflow facts only: eligibility, risk grade, and
      // whether the read degraded — never customer records.
      healthStatus: channel.eligible
        ? channel.degraded
          ? "degraded"
          : "ok"
        : "skipped",
      riskLevel: channel.package?.businessRisk.value,
      outcome: "success"
    });
  }

  private logTelemetry(
    status: NodeLifecycleStatus,
    workflowId: string,
    triage: SanitizedTriageResult | undefined,
    startedAt: number,
    errorKind?: string
  ): void {
    // No raw Case text, prompts, or reasoning — safe metadata only.
    // recordAgentWorkflow respects the telemetry-enabled flag and is
    // internally no-op safe (never throws into the workflow).
    this.telemetry.recordAgentWorkflow({
      operation: "orchestrator.case_triage",
      useCase: "agentforce_support_triage",
      requestId: workflowId,
      provider: triage?.provider,
      model: triage?.model,
      latencyMs: Date.now() - startedAt,
      fallbackUsed: triage?.fallbackUsed,
      healthStatus: status,
      outcome: status === "failed" ? "error" : "success",
      errorKind
    });
  }

  private static isInterrupted(result: CaseTriageStateType): boolean {
    const interrupts = (result as { __interrupt__?: unknown }).__interrupt__;
    return Array.isArray(interrupts) && interrupts.length > 0;
  }
  private static failureKindOf(err: unknown): string {
    if (err instanceof SalesforceGatewayError) {
      return `salesforce_${err.kind}`;
    }
    if (err instanceof LlmProviderError) {
      return `llm_${err.kind}`;
    }
    return "unexpected";
  }

  /** Safe, non-PII facts about the completed write-back step. */
  private static buildDoneDetails(
    result: CaseTriageStateType
  ): OrchestrationEventDetail[] {
    const details: OrchestrationEventDetail[] = [];
    if (result.triage) {
      details.push({
        label: "Priority applied",
        value: result.triage.recommendedPriority
      });
    }
    details.push({
      label: "Write-back",
      value: result.writeBackApplied ? "Applied" : "Skipped"
    });
    if (result.approvalRequired) {
      details.push({
        label: "Approval",
        value: result.approvalDecision ?? "approved"
      });
    }
    return details;
  }

  private static buildWaitingApprovalTrace(
    result: CaseTriageStateType
  ): OrchestrationExecutionTrace {
    return {
      stepKey: "awaiting_approval",
      sections: [
        {
          key: "inputs",
          title: "Inputs",
          data: {
            recommendedPriority:
              result.triage?.recommendedPriority ?? "unknown",
            writeBackRequested: true
          }
        },
        {
          key: "outputs",
          title: "Outputs",
          data: {
            workflowStatus: "waiting_approval",
            approvalRequired: true,
            writeBackApplied: false
          }
        },
        {
          key: "state_before",
          title: "State before step",
          data: {
            approvalRequired: false,
            writeBackApplied: false
          }
        },
        {
          key: "state_after",
          title: "State after step",
          data: {
            approvalRequired: true,
            writeBackApplied: false,
            approvalDecision: null
          }
        },
        {
          key: "state_changes",
          title: "State changes",
          data: [
            {
              path: "approvalRequired",
              change: "modified",
              before: false,
              after: true
            }
          ]
        }
      ]
    };
  }

  private static buildRejectedTrace(
    result: CaseTriageStateType
  ): OrchestrationExecutionTrace {
    return {
      stepKey: "reject_write_back",
      sections: [
        {
          key: "inputs",
          title: "Inputs",
          data: {
            recommendedPriority:
              result.triage?.recommendedPriority ?? "unknown",
            approvalDecision: result.approvalDecision ?? "rejected"
          }
        },
        {
          key: "outputs",
          title: "Outputs",
          data: {
            workflowStatus: "rejected",
            writeBackApplied: false,
            caseUpdated: false
          }
        },
        {
          key: "state_before",
          title: "State before step",
          data: {
            approvalRequired: true,
            writeBackApplied: false
          }
        },
        {
          key: "state_after",
          title: "State after step",
          data: {
            approvalRequired: true,
            approvalDecision: result.approvalDecision ?? "rejected",
            writeBackApplied: false,
            workflowStatus: "rejected"
          }
        },
        {
          key: "state_changes",
          title: "State changes",
          data: [
            {
              path: "approvalDecision",
              change: "added",
              after: result.approvalDecision ?? "rejected"
            },
            {
              path: "status",
              change: "modified",
              before: "waiting_approval",
              after: "rejected"
            }
          ]
        }
      ]
    };
  }

  private static buildDoneTrace(
    result: CaseTriageStateType
  ): OrchestrationExecutionTrace {
    const triage = result.triage
      ? {
          recommendedPriority: result.triage.recommendedPriority,
          summary: result.triage.summary,
          suggestedNextStep: result.triage.suggestedNextStep,
          provider: result.triage.provider,
          model: result.triage.model,
          fallbackUsed: result.triage.fallbackUsed,
          latencyMs: result.triage.latencyMs
        }
      : null;
    const customerContext = result.customerContext
      ? CaseTriageOrchestratorService.buildCustomerContextState(
          result.customerContext
        )
      : null;
    return {
      stepKey: "complete_workflow",
      sections: [
        {
          key: "tool_calls",
          title: "Tool calls",
          data: [
            {
              tool: "SalesforceCaseGateway.applyWriteBack",
              outcome: result.writeBackApplied ? "success" : "skipped"
            }
          ]
        },
        {
          key: "inputs",
          title: "Inputs",
          data: {
            triage,
            approvalRequired: result.approvalRequired,
            approvalDecision: result.approvalDecision ?? null
          }
        },
        {
          key: "outputs",
          title: "Final node outputs",
          data: {
            workflowStatus: "done",
            writeBackApplied: result.writeBackApplied,
            triage,
            customerContext
          }
        },
        {
          key: "state_before",
          title: "State before step",
          data: {
            status: result.approvalRequired ? "waiting_approval" : "running",
            writeBackApplied: false
          }
        },
        {
          key: "state_after",
          title: "State after step",
          data: {
            status: "done",
            writeBackApplied: result.writeBackApplied,
            approvalDecision: result.approvalDecision ?? null
          }
        },
        {
          key: "state_changes",
          title: "State changes",
          data: [
            {
              path: "status",
              change: "modified",
              before: result.approvalRequired ? "waiting_approval" : "running",
              after: "done"
            },
            {
              path: "writeBackApplied",
              change: result.writeBackApplied ? "modified" : "added",
              before: false,
              after: result.writeBackApplied
            }
          ]
        }
      ]
    };
  }

  private static buildFailureTrace(
    failureKind: string
  ): OrchestrationExecutionTrace {
    return {
      stepKey: "workflow_failed",
      sections: [
        {
          key: "outputs",
          title: "Outputs",
          data: {
            workflowStatus: "failed",
            failureKind
          }
        },
        {
          key: "state_after",
          title: "State after step",
          data: {
            status: "failed",
            failureKind
          }
        },
        {
          key: "state_changes",
          title: "State changes",
          data: [
            {
              path: "status",
              change: "modified",
              before: "running",
              after: "failed"
            },
            {
              path: "failureKind",
              change: "added",
              after: failureKind
            }
          ]
        }
      ]
    };
  }

  private static buildCustomerContextState(
    channel: CustomerContextChannel
  ): OrchestrationTraceValue {
    return {
      eligible: channel.eligible,
      eligibilityReason: channel.eligibilityReason ?? null,
      degraded: channel.degraded,
      degradedSources: channel.degradedSources ?? [],
      package: channel.package
        ? {
            customerTier: channel.package.customerTier.value,
            slaClass: channel.package.slaClass.value,
            warrantyStatus: channel.package.warrantyStatus.value,
            repeatIncident: channel.package.repeatIncident.value,
            strategicAccount: channel.package.strategicAccount.value,
            installedAssets: channel.package.installedAssets.value,
            openIncidentCount: channel.package.openIncidentCount.value,
            escalationHistory: channel.package.escalationHistory.value,
            businessRisk: {
              value: channel.package.businessRisk.value,
              confidence: channel.package.businessRisk.confidence,
              evidenceBasis: channel.package.businessRisk.evidenceBasis
            }
          }
        : null,
      provider: channel.provider ?? null,
      model: channel.model ?? null,
      fallbackUsed: channel.fallbackUsed ?? false,
      latencyMs: channel.latencyMs ?? 0
    };
  }
}

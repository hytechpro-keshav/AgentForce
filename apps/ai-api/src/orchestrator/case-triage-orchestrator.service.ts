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
import { SalesforceInventoryGateway } from "../salesforce/salesforce-inventory.gateway";
import { SalesforceSchedulingGateway } from "../salesforce/salesforce-scheduling.gateway";
import { SalesforceSchedulingWriteGateway } from "../salesforce/salesforce-scheduling-write.gateway";
import { SalesforceFulfillmentGateway } from "../salesforce/salesforce-fulfillment.gateway";
import { SalesforceGatewayError } from "../salesforce/salesforce-gateway.error";
import { SupportTriageService } from "../agents/support-triage.service";
import { CustomerHistorySynthesisService } from "../agents/customer-history.service";
import type { TriageCaseRequestDto } from "../agents/dto/triage-case.dto";
import { RagAnswerService } from "../rag/rag-answer.service";
import { RagRetrievalService } from "../rag/rag-retrieval.service";
import {
  resolveTrustedRagContext,
  type TrustedRagContext
} from "../rag/trusted-rag-context";
import type { VectorSearchMatch } from "../vector-db/vector-db.types";
import { ExternalContextAdapterRegistry } from "./adapters/external-context.adapter";
import { evaluateCustomerHistoryEligibility } from "./customer-history.eligibility";
import { KnowledgeQueryBuilder } from "./knowledge-query.builder";
import {
  buildCaseTriageGraph,
  Command,
  STEP_NEXT_NODE_TO_UI,
  type CaseTriageGraphDeps,
  type CaseTriageStateType,
  type CaseTriageTriageInput,
  type CompiledCaseTriageGraph
} from "./case-triage.graph";
import {
  GUARDRAIL_NODE_ID,
  isTerminalLifecycleStatus,
  type NodeLifecycleStatus,
  type OrchestratorNodeId
} from "./dto/case-triage-lifecycle";
import type {
  GuardrailApprovalInterrupt,
  GuardrailApprovalRouting,
  GuardrailDecision,
  GuardrailSalesforceApprovalContext
} from "./dto/guardrail";
import type {
  CustomerContextChannel,
  CustomerHistoryEligibilityResult,
  CustomerHistoryReadResult,
  CustomerReadBundle,
  CustomerReadScope
} from "./dto/customer-context";
import type {
  KnowledgeGuidanceChannel,
  KnowledgeEligibilityResult,
  KnowledgeQueryInput
} from "./dto/knowledge-guidance";
import { deriveGuidanceConfidence } from "./knowledge-confidence";
import { KnowledgeGuidanceExtractor } from "./knowledge-guidance-extractor.service";
import { PartsLogisticsPlannerService } from "./parts-logistics-planner.service";
import { SchedulingPlannerService } from "./scheduling-planner.service";
import { GuardrailPolicyService } from "./guardrail-policy.service";
import { GuardrailApprovalNotificationService } from "./guardrail-approval-notification.service";
import {
  kbDurationHintMinutes,
  regionForShipTo,
  requiredSkillsForCase,
  territoryForRegion
} from "./scheduling-rules";
import type {
  PartLogisticsPlan,
  PartsLogisticsChannel,
  PartsLogisticsEligibilityResult,
  PartsWriteOutcome
} from "./dto/parts-logistics";
import type {
  SchedulingChannel,
  SchedulingEligibilityResult
} from "./dto/scheduling";
import type {
  PartsFulfillmentCommand,
  PartsFulfillmentItemCommand,
  PartsFulfillmentResult
} from "./dto/parts-fulfillment";
import type {
  SchedulingWriteCommand,
  SchedulingWriteResult
} from "./dto/scheduling-write";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type { TriagePriorityDto } from "../agents/dto/triage-case.dto";
import type {
  CaseTriageWorkflowSnapshot,
  OrchestrationExecutionTrace,
  OrchestrationEventDetail,
  OrchestrationTraceValue,
  SanitizedTriageResult
} from "./dto/orchestration-status-event";
import type { OrchestratorVerdict } from "./dto/orchestrator-verdict";
import { synthesizeOrchestratorVerdict } from "./orchestrator-verdict.synthesizer";
import type { ResumeCaseTriageDto } from "./dto/resume-case-triage.dto";
import type {
  StopCaseTriageDto,
  StopCaseTriageResult
} from "./dto/stop-case-triage.dto";
import type {
  TriggerCaseTriageAcceptedDto,
  TriggerCaseTriageDto
} from "./dto/trigger-case-triage.dto";
import { OrchestrationStatusStore } from "./orchestration-status.store";

/**
 * Owns the case-triage LangGraph: trigger handoff, read, triage (via
 * the existing support triage seam), the non-interrupting Node 2
 * customer-history enrichment, the non-interrupting Node 3 knowledge
 * retrieval, the gated write-back, status events, and idempotent
 * approval resume.
 *
 * Salesforce stays the system of record and action executor; this
 * service only orchestrates and calls `ModelRouter` indirectly through
 * {@link SupportTriageService}, {@link CustomerHistorySynthesisService},
 * and RAG services. It never imports a vendor SDK.
 */
@Injectable()
export class CaseTriageOrchestratorService {
  private readonly logger = new Logger(CaseTriageOrchestratorService.name);
  private readonly checkpointer = new MemorySaver();
  private readonly graph: CompiledCaseTriageGraph;
  /**
   * Stepped variant (Phase 2): same nodes + checkpointer, but pauses after
   * each upstream stage so an operator can advance one stage at a time. The
   * set tracks which workflows are stepped so `advance`/`resume` drive the
   * matching graph; it is in-memory (a stepped run cannot outlive a restart).
   */
  private readonly steppedGraph: CompiledCaseTriageGraph;
  private readonly steppedWorkflows = new Set<string>();
  private readonly processedResumeKeys = new Map<string, string>();
  private principalForRag: AuthPrincipal | undefined;

  constructor(
    private readonly gateway: SalesforceCaseGateway,
    private readonly customerGateway: SalesforceCustomerGateway,
    private readonly supportTriage: SupportTriageService,
    private readonly customerHistory: CustomerHistorySynthesisService,
    private readonly ragRetrieval: RagRetrievalService,
    private readonly ragAnswer: RagAnswerService,
    private readonly knowledgeQueryBuilder: KnowledgeQueryBuilder,
    private readonly externalAdapters: ExternalContextAdapterRegistry,
    private readonly store: OrchestrationStatusStore,
    private readonly telemetry: TelemetryService,
    private readonly config: AppConfigService,
    private readonly knowledgeExtractor: KnowledgeGuidanceExtractor,
    private readonly inventoryGateway: SalesforceInventoryGateway,
    private readonly partsPlanner: PartsLogisticsPlannerService,
    private readonly fulfillmentGateway: SalesforceFulfillmentGateway,
    private readonly schedulingGateway: SalesforceSchedulingGateway,
    private readonly schedulingWriteGateway: SalesforceSchedulingWriteGateway,
    private readonly schedulingPlanner: SchedulingPlannerService,
    private readonly guardrailPolicy: GuardrailPolicyService,
    private readonly approvalNotifications: GuardrailApprovalNotificationService
  ) {
    const graphDeps: CaseTriageGraphDeps = {
      readContext: (caseId) => this.gateway.readCaseContext(caseId),
      runTriage: (input) => this.runTriage(input),
      applyWriteBack: (triage, caseId) => this.applyWriteBack(triage, caseId),
      evaluateGuardrailPolicy: (state) => this.evaluateGuardrailPolicy(state),
      sendApprovalNotification: (workflowId, caseId, payload, context) =>
        this.sendApprovalNotification(workflowId, caseId, payload, context),
      buildApprovalContext: (state) => this.buildApprovalContext(state),
      sendEscalationNotification: (workflowId, caseId, payload) =>
        this.sendEscalationNotification(workflowId, caseId, payload),
      applyPartsFulfillment: (workflowId, caseId, partsLogistics) =>
        this.applyPartsFulfillment(workflowId, caseId, partsLogistics),
      applySchedulingWrite: (
        workflowId,
        caseId,
        context,
        scheduling,
        customerContext,
        triagePriority,
        knowledgeGuidance
      ) =>
        this.applySchedulingWrite(
          workflowId,
          caseId,
          context,
          scheduling,
          customerContext,
          triagePriority,
          knowledgeGuidance
        ),
      isCustomerHistoryEligible: (context, triagePriority) =>
        this.isCustomerHistoryEligible(context, triagePriority),
      readCustomerContext: (scope) => this.readCustomerContext(scope),
      synthesizeCustomerHistory: (input) =>
        this.customerHistory.synthesize(input),
      isKnowledgeEligible: (context, triagePriority, customerContext) =>
        this.isKnowledgeEligible(context, triagePriority, customerContext),
      retrieveKnowledge: (workflowId, queryInput, tenantId, principalSubject) =>
        this.retrieveKnowledge(
          workflowId,
          queryInput,
          tenantId,
          principalSubject
        ),
      isPartsLogisticsEligible: (context, triagePriority) =>
        this.isPartsLogisticsEligible(context, triagePriority),
      planPartsLogistics: (
        workflowId,
        context,
        knowledgeGuidance,
        triagePriority
      ) =>
        this.planPartsLogistics(
          workflowId,
          context,
          knowledgeGuidance,
          triagePriority
        ),
      isSchedulingEligible: (context, triagePriority, partsLogistics) =>
        this.isSchedulingEligible(context, triagePriority, partsLogistics),
      planScheduling: (
        workflowId,
        context,
        partsLogistics,
        customerContext,
        triagePriority,
        knowledgeGuidance
      ) =>
        this.planScheduling(
          workflowId,
          context,
          partsLogistics,
          customerContext,
          triagePriority,
          knowledgeGuidance
        ),
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
    };
    this.graph = buildCaseTriageGraph(graphDeps);
    // Same nodes + checkpointer; pauses after each upstream stage so the
    // operator can advance one stage at a time. The auto graph is untouched.
    this.steppedGraph = buildCaseTriageGraph(graphDeps, { stepped: true });
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
    // Node 6 6c / RC-1 — refuse a new workflow when an operator has taken
    // the Case over (Stop AI). Degrade-safe: a missing field / failed read
    // returns undefined (treated as active), so only an explicit
    // `stopped_by_user` blocks. No snapshot is created on refusal.
    const orchestrationStatus = await this.gateway.readOrchestrationStatus(
      dto.caseId
    );
    if (orchestrationStatus === "stopped_by_user") {
      throw new ConflictException({
        error: "orchestration_stopped",
        caseId: dto.caseId
      });
    }

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

  /**
   * Stepped-mode trigger (Phase 2). Like {@link trigger}, but the graph pauses
   * after each upstream stage: Triage runs automatically, then the operator
   * advances one stage at a time via {@link advance}. The paused checkpoint
   * lives in the in-process MemorySaver, so a stepped run cannot survive an
   * ai-api restart (single-instance / demo scope — see the stepped phase plan).
   */
  async triggerStepped(
    dto: TriggerCaseTriageDto,
    principal?: AuthPrincipal
  ): Promise<TriggerCaseTriageAcceptedDto> {
    const orchestrationStatus = await this.gateway.readOrchestrationStatus(
      dto.caseId
    );
    if (orchestrationStatus === "stopped_by_user") {
      throw new ConflictException({
        error: "orchestration_stopped",
        caseId: dto.caseId
      });
    }
    const workflowId = `wf-${randomUUID()}`;
    await this.store.createAssigned({
      workflowId,
      caseId: dto.caseId,
      caseNumber: dto.caseNumber
    });
    this.steppedWorkflows.add(workflowId);
    void this.trackOnSalesforce(dto.caseId, workflowId, "assigned");
    // Auto-run Triage, then pause. Fire-and-forget so the 202 is immediate.
    void this.runStep(workflowId, dto, principal).catch(() => {
      this.logger.error(
        `Unhandled stepped run rejection: workflow=${workflowId}`
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

  /**
   * Advance a paused stepped workflow by exactly one stage. Idempotent at the
   * edges: a terminal workflow returns its snapshot unchanged; a workflow not
   * paused for a step is a conflict. The guardrail stage either reaches a
   * terminal outcome or pauses for out-of-band approval (resolved via
   * {@link resume}, never here).
   */
  async advance(workflowId: string): Promise<CaseTriageWorkflowSnapshot> {
    const existing = await this.store.get(workflowId);
    if (!existing) {
      throw new NotFoundException({ error: "workflow_not_found" });
    }
    if (isTerminalLifecycleStatus(existing.status)) {
      return existing;
    }
    if (existing.status === "waiting_approval") {
      throw new ConflictException({
        error: "awaiting_approval",
        status: existing.status
      });
    }
    if (existing.status !== "awaiting_step") {
      throw new ConflictException({
        error: "not_awaiting_step",
        status: existing.status
      });
    }
    if (!this.steppedWorkflows.has(workflowId)) {
      // The paused checkpoint is gone (ai-api restart) or this was never a
      // stepped run — the graph thread cannot be resumed.
      throw new ConflictException({ error: "step_state_unavailable" });
    }
    const startedAt = Date.now();
    try {
      // `null` input resumes the thread from its static `interruptAfter` pause.
      const result = (await this.steppedGraph.invoke(null, {
        configurable: { thread_id: workflowId }
      })) as CaseTriageStateType;
      await this.settleStep(workflowId, result, startedAt);
    } catch (err) {
      await this.fail(workflowId, err);
    }
    return this.getSnapshot(workflowId);
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
      // A stepped workflow's guardrail pause lives in the stepped graph's
      // checkpoint, so resume it there; auto workflows use the auto graph.
      const graph = this.steppedWorkflows.has(workflowId)
        ? this.steppedGraph
        : this.graph;
      const result = (await graph.invoke(
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

  /**
   * RC-1 (Node 6 6c) — operator Stop-AI takeover. NOT a guardrail
   * approve/reject: it carries the dedicated `agentforce:orchestrator-control`
   * scope and routes the Case to a `stopped` terminal, never `rejected`.
   *
   * Two effects: (1) flip the Case control flag so the Apex callback guard +
   * the `/triggers` refuse path stop future AI work and a late SF approve
   * no-ops; (2) settle the latest workflow snapshot — flip a non-terminal one
   * to `stopped` (which blocks any later resume, since `stopped` is terminal),
   * or just stamp `stoppedAt` on an already-terminal one. The paused LangGraph
   * thread is left orphaned (harmless); the terminal snapshot short-circuits a
   * late resume(). Does NOT recall a pending SF ProcessInstance (v1 — §7).
   */
  async stop(
    caseId: string,
    dto: StopCaseTriageDto
  ): Promise<StopCaseTriageResult> {
    const stoppedAt = new Date().toISOString();
    // Best-effort Case flag write; the snapshot stop below is authoritative
    // for blocking resume even if the Salesforce write degrades.
    await this.markCaseStoppedOnSalesforce(caseId);

    const latest = await this.store.getLatestForCase(caseId);
    let workflowId: string | undefined;
    if (latest) {
      workflowId = latest.workflowId;
      const wasTerminal = isTerminalLifecycleStatus(latest.status);
      await this.store.update(latest.workflowId, {
        stoppedAt,
        stopReason: dto.reason,
        ...(wasTerminal
          ? {}
          : {
              approvalRequired: false,
              orchestratorVerdict:
                CaseTriageOrchestratorService.buildStopVerdict(latest)
            })
      });
      if (!wasTerminal) {
        // appendEvent flips snapshot.status → stopped (terminal) and tags the
        // guardrail node so the UI stage reflects the takeover.
        await this.store.appendEvent(
          latest.workflowId,
          "stopped",
          "AI orchestration stopped by operator — manual takeover.",
          undefined,
          GUARDRAIL_NODE_ID,
          CaseTriageOrchestratorService.buildStopRequestTrace(
            latest,
            dto.reason
          )
        );
        await this.trackOnSalesforce(caseId, latest.workflowId, "stopped");
      }
    }
    this.logger.log(
      `Stop AI applied: case=${caseId} workflow=${workflowId ?? "none"}`
    );
    return { caseId, status: "stopped_by_user", workflowId, stoppedAt };
  }

  /** Best-effort Case Stop-AI flag write; soft-fails like `trackOnSalesforce`. */
  private async markCaseStoppedOnSalesforce(caseId: string): Promise<void> {
    try {
      await this.gateway.writeOrchestrationStop(caseId);
    } catch {
      this.logger.warn(
        `Stop-AI flag write skipped for case ${caseId}; snapshot stop remains authoritative.`
      );
    }
  }

  private async run(
    workflowId: string,
    dto: TriggerCaseTriageDto,
    principal?: AuthPrincipal
  ): Promise<void> {
    const startedAt = Date.now();
    this.principalForRag = principal;
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
    } finally {
      this.principalForRag = undefined;
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
        customerContext: result.customerContext,
        knowledgeGuidance: result.knowledgeGuidance,
        partsLogistics: result.partsLogistics,
        scheduling: result.scheduling,
        guardrail: result.guardrail,
        orchestratorVerdict: CaseTriageOrchestratorService.buildVerdict(
          result,
          "waiting_approval"
        )
      });
      await this.store.appendEvent(
        workflowId,
        "waiting_approval",
        "Awaiting human approval — guardrail flagged the case for review.",
        undefined,
        // Node 6 is the only interrupting node, so tag the pause with the
        // guardrail node id — that lights up the Node 6 stage in the UI.
        GUARDRAIL_NODE_ID,
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
        knowledgeGuidance: result.knowledgeGuidance,
        partsLogistics: result.partsLogistics,
        scheduling: result.scheduling,
        guardrail: result.guardrail,
        approvalRequired: result.approvalRequired,
        approvalDecision: result.approvalDecision,
        orchestratorVerdict: CaseTriageOrchestratorService.buildVerdict(
          result,
          "rejected"
        )
      });
      await this.store.appendEvent(
        workflowId,
        "rejected",
        "Write-back rejected; Case left unchanged.",
        undefined,
        GUARDRAIL_NODE_ID,
        CaseTriageOrchestratorService.buildRejectedTrace(result)
      );
      await this.trackOnSalesforce(result.caseId, workflowId, "rejected");
      this.logTelemetry("rejected", workflowId, result.triage, startedAt);
      this.logCustomerHistoryTelemetry(workflowId, result.customerContext);
      return;
    }

    if (result.status === "escalated") {
      // Node 6 supervisor path. Terminal like `rejected` (no write-back),
      // but a distinct lifecycle state so the verdict and UI surface it.
      await this.store.update(workflowId, {
        triage: result.triage,
        customerContext: result.customerContext,
        knowledgeGuidance: result.knowledgeGuidance,
        partsLogistics: result.partsLogistics,
        scheduling: result.scheduling,
        guardrail: result.guardrail,
        approvalRequired: result.approvalRequired,
        approvalDecision: result.approvalDecision,
        orchestratorVerdict: CaseTriageOrchestratorService.buildVerdict(
          result,
          "escalated"
        )
      });
      await this.store.appendEvent(
        workflowId,
        "escalated",
        "Escalated to supervisor — critical guardrail risk.",
        undefined,
        GUARDRAIL_NODE_ID,
        CaseTriageOrchestratorService.buildEscalatedTrace(result)
      );
      await this.trackOnSalesforce(result.caseId, workflowId, "escalated");
      this.logTelemetry("escalated", workflowId, result.triage, startedAt);
      this.logCustomerHistoryTelemetry(workflowId, result.customerContext);
      return;
    }

    if (result.status === "stopped") {
      // Node 6 6c / RC-1 — operator Stop-AI takeover. Terminal like
      // `escalated` (no write-back), but a distinct lifecycle state so the
      // verdict + UI surface a manual takeover, not a guardrail rejection.
      await this.store.update(workflowId, {
        triage: result.triage,
        customerContext: result.customerContext,
        knowledgeGuidance: result.knowledgeGuidance,
        partsLogistics: result.partsLogistics,
        scheduling: result.scheduling,
        guardrail: result.guardrail,
        approvalRequired: result.approvalRequired,
        approvalDecision: result.approvalDecision,
        orchestratorVerdict: CaseTriageOrchestratorService.buildVerdict(
          result,
          "stopped"
        )
      });
      await this.store.appendEvent(
        workflowId,
        "stopped",
        "AI orchestration stopped — operator is handling the Case manually.",
        undefined,
        GUARDRAIL_NODE_ID,
        CaseTriageOrchestratorService.buildStoppedTrace(result)
      );
      await this.trackOnSalesforce(result.caseId, workflowId, "stopped");
      this.logTelemetry("stopped", workflowId, result.triage, startedAt);
      this.logCustomerHistoryTelemetry(workflowId, result.customerContext);
      return;
    }

    await this.store.update(workflowId, {
      triage: result.triage,
      customerContext: result.customerContext,
      knowledgeGuidance: result.knowledgeGuidance,
      partsLogistics: result.partsLogistics,
      scheduling: result.scheduling,
      guardrail: result.guardrail,
      writeBackApplied: Boolean(result.writeBackApplied),
      approvalRequired: result.approvalRequired,
      approvalDecision: result.approvalDecision,
      orchestratorVerdict: CaseTriageOrchestratorService.buildVerdict(
        result,
        "done"
      )
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

  /**
   * Stepped-mode initial invoke: runs Triage (readContext + runTriage, which
   * now includes customer context read + synthesis before the triage LLM)
   * then pauses at the first `interruptAfter` before knowledge. Mirrors
   * {@link run} but settles a stepped pause instead of a terminal/approval
   * outcome.
   */
  private async runStep(
    workflowId: string,
    dto: TriggerCaseTriageDto,
    principal?: AuthPrincipal
  ): Promise<void> {
    const startedAt = Date.now();
    this.principalForRag = principal;
    try {
      const result = (await this.steppedGraph.invoke(
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
      await this.settleStep(workflowId, result, startedAt);
    } catch (err) {
      await this.fail(workflowId, err);
    } finally {
      this.principalForRag = undefined;
    }
  }

  /**
   * Settle a stepped invoke: a guardrail approval pause (dynamic interrupt) or
   * a terminal outcome routes through {@link settleAfterInvoke} exactly like
   * the auto run; a static `interruptAfter` pause (more stages to run) records
   * `awaiting_step` and names the next stage.
   */
  private async settleStep(
    workflowId: string,
    result: CaseTriageStateType,
    startedAt: number
  ): Promise<void> {
    if (CaseTriageOrchestratorService.isInterrupted(result)) {
      await this.settleAfterInvoke(workflowId, result, startedAt);
      return;
    }
    const state = await this.steppedGraph.getState({
      configurable: { thread_id: workflowId }
    });
    const nextNode = state.next?.[0];
    if (nextNode) {
      await this.settleStepPause(workflowId, result, nextNode);
      return;
    }
    // No pending tasks — the graph reached a terminal node.
    await this.settleAfterInvoke(workflowId, result, startedAt);
  }

  /**
   * Persist the channels produced so far and park the workflow at
   * `awaiting_step`, naming the stage that will run on the next `advance`.
   */
  private async settleStepPause(
    workflowId: string,
    result: CaseTriageStateType,
    nextGraphNode: string
  ): Promise<void> {
    const awaitingNode =
      STEP_NEXT_NODE_TO_UI[nextGraphNode] ?? GUARDRAIL_NODE_ID;
    // `update` only writes fields that are set, so undefined channels (stages
    // not yet run) are left untouched.
    await this.store.update(workflowId, {
      triage: result.triage,
      customerContext: result.customerContext,
      knowledgeGuidance: result.knowledgeGuidance,
      partsLogistics: result.partsLogistics,
      scheduling: result.scheduling,
      guardrail: result.guardrail
    });
    await this.store.appendEvent(
      workflowId,
      "awaiting_step",
      `Stage complete — awaiting Run for ${CaseTriageOrchestratorService.stepNodeLabel(
        awaitingNode
      )}.`,
      undefined,
      awaitingNode,
      {
        stepKey: `awaiting_${awaitingNode}`,
        sections: [
          {
            key: "outputs",
            title: "Outputs",
            data: { status: "awaiting_step", awaitingNode }
          }
        ]
      }
    );
  }

  private static stepNodeLabel(node: OrchestratorNodeId): string {
    const labels: Record<OrchestratorNodeId, string> = {
      triage: "Triage",
      customer_history: "Customer Context",
      knowledge: "Knowledge Base",
      parts_logistics: "Parts & Logistics",
      scheduling: "Scheduling",
      guardrail: "Compliance & Guardrail"
    };
    return labels[node] ?? node;
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

  /**
   * Node 6 dep — measures wall-clock around the PURE policy evaluation and
   * stamps it on the decision. The policy stays deterministic over state;
   * only the observability `latencyMs` is added at this impure seam (it
   * never affects the outcome, so resume re-execution remains safe).
   */
  private evaluateGuardrailPolicy(
    state: CaseTriageStateType
  ): GuardrailDecision {
    const startedAt = Date.now();
    const decision = this.guardrailPolicy.evaluate(state);
    return { ...decision, latencyMs: Date.now() - startedAt };
  }

  /**
   * Node 6 dep — approval notification. Delegates to
   * {@link GuardrailApprovalNotificationService}, which is idempotent per
   * workflow (a resume re-run never re-sends — phase plan §11 R2) and
   * degrade-safe (never throws into the graph). When email routing is off it
   * preserves 6a parity: a safe, non-PII log line and a `log_only` routing
   * record. The `evaluateGuardrail` node also guards on a prior `sentAt`.
   */
  private sendApprovalNotification(
    workflowId: string,
    caseId: string,
    payload: GuardrailApprovalInterrupt,
    context?: GuardrailSalesforceApprovalContext
  ): Promise<GuardrailApprovalRouting> {
    return this.approvalNotifications.notifyApprovalRequired(
      workflowId,
      caseId,
      payload,
      context
    );
  }

  /**
   * Node 6 dep — builds the 6b+ Salesforce-Approval context: the synthesized
   * Orchestrator Verdict (same four fields as the read-only console panel)
   * plus a deep link back to the console. Pure over `state` and re-run safe
   * (the synthesizer is deterministic, no I/O). Computed BEFORE `interrupt()`
   * so the approver sees the full AI story on the Case record without opening
   * the console.
   */
  private buildApprovalContext(
    state: CaseTriageStateType
  ): GuardrailSalesforceApprovalContext {
    const verdict = synthesizeOrchestratorVerdict({
      status: "waiting_approval",
      approvalRequired: true,
      triage: state.triage,
      customerContext: state.customerContext,
      knowledgeGuidance: state.knowledgeGuidance,
      partsLogistics: state.partsLogistics,
      scheduling: state.scheduling,
      guardrail: state.guardrail
    });
    const uiBaseUrl = this.config.orchestrator.salesforceWriteBack.uiBaseUrl;
    const orchestrationConsoleUrl = uiBaseUrl
      ? `${uiBaseUrl.replace(/\/+$/, "")}/orchestration?caseId=${encodeURIComponent(
          state.caseId
        )}`
      : undefined;
    return {
      verdict: {
        headline: verdict.headline,
        summary: verdict.summary,
        recommendedSteps: verdict.recommendedSteps,
        highlights: verdict.highlights
      },
      orchestrationConsoleUrl
    };
  }

  /**
   * Node 6 dep — terminal supervisor escalation notice. Delegates to the
   * notification service; degrade-safe and a no-op unless escalation email is
   * enabled.
   */
  private sendEscalationNotification(
    workflowId: string,
    caseId: string,
    payload: GuardrailApprovalInterrupt
  ): Promise<void> {
    return this.approvalNotifications.notifyEscalation(
      workflowId,
      caseId,
      payload
    );
  }

  /**
   * Node 4 — Phase 4c gated fulfillment writes. Runs only in the
   * post-approval write-back. For each approved transfer/backorder plan
   * it asks the Apex executor (via {@link SalesforceFulfillmentGateway})
   * to create the `ProductTransfer` / `ProductRequest` record, then folds
   * the reservation transitions + record ids back into a cloned channel.
   * Config-gated (`partsLogistics.writesEnabled`) and degrade-safe — a
   * write failure leaves the plans `planned` and never throws.
   */
  private async applyPartsFulfillment(
    workflowId: string,
    caseId: string,
    partsLogistics: PartsLogisticsChannel | undefined
  ): Promise<PartsLogisticsChannel | undefined> {
    if (
      !this.config.orchestrator.partsLogistics.writesEnabled ||
      !partsLogistics ||
      partsLogistics.degraded ||
      !partsLogistics.partPlans?.length
    ) {
      return undefined;
    }

    const writablePlans = partsLogistics.partPlans.filter((plan) =>
      CaseTriageOrchestratorService.isWritablePlan(plan)
    );
    if (writablePlans.length === 0) {
      return undefined;
    }

    const command: PartsFulfillmentCommand = {
      workflowId,
      caseId,
      items: writablePlans.map(
        (plan): PartsFulfillmentItemCommand => ({
          partNumber: plan.partNumber,
          quantity: plan.requestedQuantity,
          exceptionType:
            plan.exceptionType === "inter_warehouse_transfer"
              ? "inter_warehouse_transfer"
              : "backorder",
          fulfillmentWarehouseReference: plan.fulfillmentWarehouseReference,
          sourceWarehouseReference: plan.sourceWarehouseReference,
          approvalReason: plan.approvalReason
        })
      )
    };

    const result = await this.fulfillmentGateway.applyFulfillment(command);
    return CaseTriageOrchestratorService.mergeFulfillmentResult(
      partsLogistics,
      result
    );
  }

  /** Plans that produce a Salesforce fulfillment record in Phase 4c. */
  private static isWritablePlan(plan: PartLogisticsPlan): boolean {
    return (
      plan.exceptionType === "inter_warehouse_transfer" ||
      plan.exceptionType === "backorder"
    );
  }

  /** Folds the executor result back into a cloned, sanitized channel. */
  private static mergeFulfillmentResult(
    channel: PartsLogisticsChannel,
    result: PartsFulfillmentResult
  ): PartsLogisticsChannel {
    const byPart = new Map(result.items.map((item) => [item.partNumber, item]));
    const partPlans = (channel.partPlans ?? []).map((plan) => {
      const outcome = byPart.get(plan.partNumber);
      if (!outcome) {
        return plan;
      }
      return {
        ...plan,
        reservationStatus: outcome.reservationStatus,
        fulfillmentRecordType: outcome.recordType,
        fulfillmentRecordId: outcome.recordId
      };
    });
    const createdCount = result.items.filter((item) => item.created).length;
    const idempotentSkipCount = result.items.filter(
      (item) => item.idempotentSkip
    ).length;
    const writeOutcome: PartsWriteOutcome = {
      applied: result.applied,
      degraded: result.degraded,
      createdCount,
      idempotentSkipCount
    };
    return { ...channel, partPlans, writeOutcome };
  }

  /**
   * Node 5 — Phase 5c gated scheduling write. Runs only in the
   * post-approval write-back, after {@link applyPartsFulfillment}. It books
   * the approved plan as a `ServiceAppointment` (via
   * {@link SalesforceSchedulingWriteGateway}) ONLY when a fresh parts +
   * scheduling re-read (RC-5) still resolves to a committed `schedulable`
   * window; otherwise it surfaces the honest fresh channel and writes
   * nothing. Config-gated (`scheduling.writesEnabled`) and degrade-safe —
   * a read or write failure leaves the appointment `proposed` and never
   * throws. Salesforce owns the DML + idempotency (workflow id + Case).
   */
  private async applySchedulingWrite(
    workflowId: string,
    caseId: string,
    context: SalesforceCaseContext,
    scheduling: SchedulingChannel | undefined,
    customerContext: CustomerContextChannel | undefined,
    triagePriority: TriagePriorityDto | undefined,
    knowledgeGuidance: KnowledgeGuidanceChannel | undefined
  ): Promise<SchedulingChannel | undefined> {
    // Only an eligible, non-degraded, committed (`schedulable`) plan with a
    // ranked technician + window is bookable; everything else is a no-op so
    // the approved channel is left untouched (still `proposed`).
    if (
      !this.config.orchestrator.scheduling.writesEnabled ||
      !scheduling ||
      !scheduling.eligible ||
      scheduling.degraded ||
      scheduling.schedulingReadiness !== "schedulable" ||
      scheduling.appointmentStatus === "booked" ||
      !scheduling.recommendedResourceReference ||
      !scheduling.proposedWindow?.proposedStart ||
      !scheduling.proposedWindow?.proposedEnd
    ) {
      return undefined;
    }

    const startedAt = Date.now();
    try {
      // RC-5 — fresh parts + scheduling re-read at write time. Inventory and
      // availability can move between the planning run and the approval; book
      // only what is still true now. The parts re-read also reflects any
      // transfer/backorder just created by applyPartsFulfillment. Mirror the
      // graph's parts node: re-read inventory only when parts is eligible;
      // a no-parts Case stays `skipped` (re-planning it would invent a parts
      // dependency Node 5 never saw).
      const freshParts: PartsLogisticsChannel | undefined =
        this.isPartsLogisticsEligible(context, triagePriority).eligible
          ? await this.planPartsLogistics(
              workflowId,
              context,
              knowledgeGuidance,
              triagePriority
            )
          : { eligible: false, degraded: false };
      const freshScheduling = await this.planScheduling(
        workflowId,
        context,
        freshParts,
        customerContext,
        triagePriority,
        knowledgeGuidance
      );

      const window = freshScheduling.proposedWindow;
      const bookable =
        !freshScheduling.degraded &&
        freshScheduling.schedulingReadiness === "schedulable" &&
        Boolean(freshScheduling.recommendedResourceReference) &&
        Boolean(window?.proposedStart) &&
        Boolean(window?.proposedEnd);

      // RC-5 abort: parts/availability regressed since approval — surface the
      // honest fresh state (provisional/deferred/degraded) and book nothing.
      if (!bookable || !window) {
        this.logSchedulingWriteTelemetry(workflowId, startedAt, "skipped");
        return freshScheduling;
      }

      const command: SchedulingWriteCommand = {
        workflowId,
        caseId,
        resourceReference: freshScheduling.recommendedResourceReference!,
        territoryReference: freshScheduling.candidates?.[0]?.territoryReference,
        schedStart: window.proposedStart!,
        schedEnd: window.proposedEnd!,
        durationMinutes: window.durationMinutes,
        approvalReason:
          freshScheduling.approvalReason &&
          freshScheduling.approvalReason !== "none"
            ? freshScheduling.approvalReason
            : undefined
      };

      const result =
        await this.schedulingWriteGateway.applyAppointment(command);
      const merged = CaseTriageOrchestratorService.mergeSchedulingWriteResult(
        freshScheduling,
        result
      );
      this.logSchedulingWriteTelemetry(
        workflowId,
        startedAt,
        result.degraded ? "degraded" : "ok"
      );
      return merged;
    } catch (err) {
      // Degrade-safe: a fresh-read or write failure must never fail the run.
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Scheduling write degraded: kind=${kind}`);
      this.logSchedulingWriteTelemetry(workflowId, startedAt, "degraded");
      return undefined;
    }
  }

  /**
   * Folds the appointment-write result into the fresh channel. Only a
   * completed booking flips `appointmentStatus` to `booked`; a degraded or
   * empty write leaves the plan `proposed`.
   */
  private static mergeSchedulingWriteResult(
    channel: SchedulingChannel,
    result: SchedulingWriteResult
  ): SchedulingChannel {
    if (
      !result.applied ||
      result.degraded ||
      result.appointmentStatus !== "booked" ||
      !result.appointmentReference
    ) {
      return channel;
    }
    return {
      ...channel,
      appointmentStatus: "booked",
      appointmentReference: result.appointmentReference
    };
  }

  private logSchedulingWriteTelemetry(
    workflowId: string,
    startedAt: number,
    healthStatus: "ok" | "degraded" | "skipped"
  ): void {
    this.telemetry.recordAgentWorkflow({
      operation: "orchestrator.scheduling_write",
      useCase: "agentforce_scheduling",
      requestId: workflowId,
      latencyMs: Date.now() - startedAt,
      healthStatus,
      outcome: "success"
    });
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

  /**
   * Final Verdict synthesis — the post-knowledge observability step.
   * Deterministically assembles an operator-facing recommendation from
   * the sanitized typed channels. Observability-only: never parsed by
   * any downstream node.
   */
  private static buildVerdict(
    result: CaseTriageStateType,
    status: NodeLifecycleStatus
  ): OrchestratorVerdict {
    return synthesizeOrchestratorVerdict({
      status,
      writeBackApplied: Boolean(result.writeBackApplied),
      approvalRequired: result.approvalRequired,
      approvalDecision: result.approvalDecision,
      triage: result.triage,
      customerContext: result.customerContext,
      knowledgeGuidance: result.knowledgeGuidance,
      partsLogistics: result.partsLogistics,
      scheduling: result.scheduling,
      guardrail: result.guardrail
    });
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

  private static buildEscalatedTrace(
    result: CaseTriageStateType
  ): OrchestrationExecutionTrace {
    const guardrail = result.guardrail;
    return {
      stepKey: "escalate_to_supervisor",
      sections: [
        {
          key: "inputs",
          title: "Inputs",
          data: {
            recommendedPriority:
              result.triage?.recommendedPriority ?? "unknown",
            riskScore: guardrail?.riskScore ?? null,
            riskLevel: guardrail?.riskLevel ?? null,
            triggeredRules:
              guardrail?.policyRulesTriggered.map((rule) => rule.ruleId) ?? []
          }
        },
        {
          key: "outputs",
          title: "Outputs",
          data: {
            workflowStatus: "escalated",
            writeBackApplied: false,
            caseUpdated: false
          }
        },
        {
          key: "state_changes",
          title: "State changes",
          data: [
            {
              path: "approvalDecision",
              change: "added",
              after: result.approvalDecision ?? "escalated"
            },
            {
              path: "status",
              change: "modified",
              before: "running",
              after: "escalated"
            }
          ]
        }
      ]
    };
  }

  /** Node 6 6c / RC-1 — Stop-AI takeover terminal trace. No policy ran. */
  private static buildStoppedTrace(
    result: CaseTriageStateType
  ): OrchestrationExecutionTrace {
    return {
      stepKey: "stopped_by_operator",
      sections: [
        {
          key: "inputs",
          title: "Inputs",
          data: {
            orchestrationStatus:
              result.context?.orchestrationStatus ?? "active",
            recommendedPriority: result.triage?.recommendedPriority ?? "unknown"
          }
        },
        {
          key: "outputs",
          title: "Outputs",
          data: {
            workflowStatus: "stopped",
            writeBackApplied: false,
            caseUpdated: false
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
              after: "stopped"
            }
          ]
        }
      ]
    };
  }

  /**
   * RC-1 — verdict for a Stop-AI takeover synthesized from the latest
   * snapshot's channels (the paused graph state is not available out of band).
   */
  private static buildStopVerdict(
    snapshot: CaseTriageWorkflowSnapshot
  ): OrchestratorVerdict {
    return synthesizeOrchestratorVerdict({
      status: "stopped",
      writeBackApplied: false,
      approvalRequired: false,
      approvalDecision: snapshot.approvalDecision,
      triage: snapshot.triage,
      customerContext: snapshot.customerContext,
      knowledgeGuidance: snapshot.knowledgeGuidance,
      partsLogistics: snapshot.partsLogistics,
      scheduling: snapshot.scheduling,
      guardrail: snapshot.guardrail
    });
  }

  /** RC-1 — trace for an out-of-band Stop-AI request. Reason kept as a flag (no raw text). */
  private static buildStopRequestTrace(
    snapshot: CaseTriageWorkflowSnapshot,
    reason?: string
  ): OrchestrationExecutionTrace {
    return {
      stepKey: "stop_ai_takeover",
      sections: [
        {
          key: "inputs",
          title: "Inputs",
          data: {
            previousStatus: snapshot.status,
            reasonProvided: Boolean(reason)
          }
        },
        {
          key: "outputs",
          title: "Outputs",
          data: {
            workflowStatus: "stopped",
            controlScope: "agentforce:orchestrator-control",
            writeBackApplied: false
          }
        },
        {
          key: "state_changes",
          title: "State changes",
          data: [
            {
              path: "status",
              change: "modified",
              before: snapshot.status,
              after: "stopped"
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

  private isKnowledgeEligible(
    context: SalesforceCaseContext,
    triagePriority: TriagePriorityDto | undefined,
    customerContext: CustomerContextChannel | undefined
  ): KnowledgeEligibilityResult {
    // Node 3 is eligible when:
    // 1. Knowledge is enabled in config.
    // 2. Tenant is available (for RAG namespace scoping).
    // 3. RAG is configured and ready.
    if (!this.config.orchestrator.knowledge.enabled) {
      return {
        eligible: false,
        reason: "Knowledge retrieval disabled by config"
      };
    }
    if (!this.config.rag.enabled) {
      return {
        eligible: false,
        reason: "RAG disabled by config"
      };
    }
    // Both eligibility requirements passed.
    return {
      eligible: true,
      reason:
        "namespace=" +
        (this.config.orchestrator.knowledge.namespace ||
          this.config.rag.defaultNamespace)
    };
  }

  /**
   * Node 3 retrieval seam. Builds a redacted query from the supplied
   * KnowledgeQueryInput, calls RAG retrieval, and returns a knowledge
   * guidance channel. Handles RAG failures gracefully (degraded flag,
   * no throw).
   *
   * Auth: prefers the JWT principal from the triggering HTTP call. When
   * the orchestrator runs without a JWT (dev/internal), falls back to a
   * minimal trusted context using the workflow's tenantId + config
   * defaults — the HTTP auth gate has already been satisfied upstream.
   */
  private async retrieveKnowledge(
    workflowId: string,
    queryInput: KnowledgeQueryInput,
    tenantId: string | undefined,
    principalSubject: string
  ): Promise<KnowledgeGuidanceChannel> {
    const startedAt = Date.now();
    try {
      const namespace =
        this.config.orchestrator.knowledge.namespace ||
        this.config.rag.defaultNamespace;

      let trustedContext: TrustedRagContext;
      if (this.principalForRag?.tenantId) {
        trustedContext = resolveTrustedRagContext(
          this.principalForRag,
          this.config.orchestrator.knowledge.namespace,
          this.config
        );
      } else if (tenantId) {
        // Dev/internal fallback: build context directly from state tenantId.
        // The HTTP auth gate was already satisfied at the trigger call site.
        trustedContext = {
          tenantId,
          namespace,
          subject: principalSubject,
          scopes: ["rag:search"],
          roles: []
        };
      } else {
        return {
          eligible: false,
          eligibilityReason: "Missing tenant ID for RAG context",
          degraded: false
        };
      }

      // Build a redacted query from case + customer context signals.
      const query = this.knowledgeQueryBuilder.build(queryInput);
      this.logger.debug(
        `Node 3 RAG query: "${query}" (workflow=${workflowId})`
      );

      const retrieval = await this.ragRetrieval.search(
        {
          query,
          namespace: trustedContext.namespace,
          topK: this.config.orchestrator.knowledge.retrievalTopK,
          scoreThreshold: this.config.orchestrator.knowledge.scoreThreshold,
          includeStale: false,
          requestId: workflowId
        },
        trustedContext
      );

      if (retrieval.rawMatches.length === 0) {
        const channel: KnowledgeGuidanceChannel = {
          eligible: true,
          degraded: false,
          status: "NO_SOURCE"
        };
        this.logKnowledgeTelemetry(workflowId, channel, startedAt);
        return channel;
      }

      const guidanceConfidence = deriveGuidanceConfidence(
        retrieval.rawMatches.map((m) => m.score)
      );
      const answer: KnowledgeGuidanceChannel["answer"] = {
        safeSummary: this.buildKnowledgeSafeSummary(retrieval.rawMatches),
        guidanceConfidence,
        sources: retrieval.rawMatches.map((m) => ({
          sourceId: m.metadata.sourceId,
          title: m.metadata.title,
          version: m.metadata.documentVersion,
          chunkId: m.metadata.chunkId,
          retrievalScorePercentile:
            m.score != null ? Math.round(m.score * 100) : undefined
        })),
        provider: "openai",
        embeddingProvider: "openai",
        retrievalId: retrieval.retrievalId,
        latencyMs: Date.now() - startedAt,
        fallbackUsed: false
      };

      // Node 3 answer-extraction: distill typed actions/parts/flags from the
      // grounded chunks. Best-effort — failures leave the deterministic,
      // score-based guidance untouched (see KnowledgeGuidanceExtractor).
      if (this.config.orchestrator.knowledge.extractionEnabled) {
        const extracted = await this.knowledgeExtractor.extract({
          requestId: workflowId,
          query,
          tenantId: trustedContext.tenantId,
          matches: retrieval.rawMatches.map((m) => ({
            text: m.text,
            metadata: {
              sourceId: m.metadata.sourceId,
              title: m.metadata.title,
              chunkId: m.metadata.chunkId
            }
          })),
          useCase: "knowledge_rag"
        });
        if (extracted.displaySummary) {
          answer.displaySummary = extracted.displaySummary;
        }
        if (extracted.recommendedActions.length > 0) {
          answer.recommendedActions = extracted.recommendedActions.map(
            (action) => ({ ...action, confidence: guidanceConfidence })
          );
        }
        if (extracted.suggestedParts.length > 0) {
          answer.suggestedParts = extracted.suggestedParts.map((part) => ({
            ...part,
            confidence: guidanceConfidence
          }));
        }
        if (extracted.safetyFlags.length > 0) {
          answer.safetyFlags = extracted.safetyFlags;
        }
        if (extracted.fallbackUsed) {
          answer.fallbackUsed = true;
        }
      }

      const channel: KnowledgeGuidanceChannel = {
        eligible: true,
        degraded: false,
        status: "ANSWERED",
        answer
      };
      this.logKnowledgeTelemetry(workflowId, channel, startedAt);
      return channel;
    } catch (err) {
      this.logger.warn(`Knowledge retrieval failed: ${workflowId}`, err);
      const channel: KnowledgeGuidanceChannel = {
        eligible: true,
        degraded: true,
        degradedSources: ["rag"],
        status: undefined
      };
      this.logKnowledgeTelemetry(workflowId, channel, startedAt, true);
      return channel;
    }
  }

  /**
   * Builds a safe, non-PII summary from raw retrieval matches.
   * Uses only the article title and a truncated content snippet —
   * never raw chunk text verbatim (per Node 3 design contract).
   */
  private buildKnowledgeSafeSummary(matches: VectorSearchMatch[]): string {
    return matches
      .slice(0, 3)
      .map(
        (m, i) =>
          `[${i + 1}] ${m.metadata.title}: ${m.text.substring(0, 280).trimEnd()}…`
      )
      .join("\n\n");
  }

  private logKnowledgeTelemetry(
    workflowId: string,
    channel: KnowledgeGuidanceChannel,
    startedAt: number,
    error?: boolean
  ): void {
    this.telemetry.recordAgentWorkflow({
      operation: "orchestrator.knowledge",
      useCase: "knowledge_rag",
      requestId: workflowId,
      latencyMs: Date.now() - startedAt,
      healthStatus: channel.degraded
        ? "degraded"
        : channel.eligible
          ? "ok"
          : "skipped",
      outcome: error ? "error" : "success"
    });
  }

  /**
   * Node 4 eligibility — pure, config-driven, no Salesforce access.
   * Gates the inventory reads + planner. Requires the feature flag and
   * an installed asset (the compatibility + fulfillment anchor).
   */
  private isPartsLogisticsEligible(
    context: SalesforceCaseContext,
    _triagePriority: TriagePriorityDto | undefined
  ): PartsLogisticsEligibilityResult {
    if (!this.config.orchestrator.partsLogistics.enabled) {
      return {
        eligible: false,
        reason: "Parts logistics disabled by config"
      };
    }
    if (!context.assetId && !context.assetProductCode) {
      return {
        eligible: false,
        reason: "Case has no installed asset; parts logistics skipped"
      };
    }
    return { eligible: true, reason: "Parts logistics enabled" };
  }

  /**
   * Node 4 plan seam. Collects part candidates (knowledge first, case
   * text fallback), reads live `ProductItem` stock keyed on ProductCode
   * + ExternalReference, then runs the deterministic
   * fulfillment-location-first planner. Inventory failures degrade the
   * plan (never throw, never block the graph — §7.4 / B7).
   */
  private async planPartsLogistics(
    workflowId: string,
    context: SalesforceCaseContext,
    knowledgeGuidance: KnowledgeGuidanceChannel | undefined,
    triagePriority: TriagePriorityDto | undefined
  ): Promise<PartsLogisticsChannel> {
    const startedAt = Date.now();
    const candidates = this.partsPlanner.collectCandidates(
      context,
      knowledgeGuidance
    );
    if (candidates.codes.length === 0) {
      const channel: PartsLogisticsChannel = {
        eligible: true,
        degraded: false,
        status: "SKIPPED",
        fulfillmentReadiness: "unknown",
        candidateSources: candidates.sources,
        provider: "deterministic",
        partPlans: []
      };
      this.logPartsTelemetry(workflowId, channel, startedAt);
      return channel;
    }

    const inventory = await this.inventoryGateway.readStockForParts(
      candidates.codes
    );
    const channel = this.partsPlanner.plan({
      context,
      candidates,
      inventory,
      triagePriority
    });
    channel.latencyMs = Date.now() - startedAt;
    this.logPartsTelemetry(workflowId, channel, startedAt);
    return channel;
  }

  private logPartsTelemetry(
    workflowId: string,
    channel: PartsLogisticsChannel,
    startedAt: number
  ): void {
    this.telemetry.recordAgentWorkflow({
      operation: "orchestrator.parts_logistics",
      useCase: "agentforce_parts_logistics",
      requestId: workflowId,
      latencyMs: Date.now() - startedAt,
      healthStatus: channel.degraded
        ? "degraded"
        : channel.eligible
          ? "ok"
          : "skipped",
      outcome: "success"
    });
  }

  /**
   * Node 5 eligibility — pure, config-driven, no Salesforce access. Gates
   * the Field Service reads + planner on the feature flag only; the
   * planner degrades gracefully when territory/skill data is thin, so the
   * node never over-gates a serviceable Case (B11).
   */
  private isSchedulingEligible(
    _context: SalesforceCaseContext,
    _triagePriority: TriagePriorityDto | undefined,
    _partsLogistics: PartsLogisticsChannel | undefined
  ): SchedulingEligibilityResult {
    if (!this.config.orchestrator.scheduling.enabled) {
      return {
        eligible: false,
        reason: "Scheduling disabled by config"
      };
    }
    return { eligible: true, reason: "Scheduling enabled" };
  }

  /**
   * Node 5 plan seam. Derives the target territory from the Case ship-to
   * region (Node 4 parity), reads Field Service technicians/skills/
   * availability, and runs the deterministic, parts-ETA-gated planner.
   * Field Service failures degrade the plan (never throw, never block the
   * graph — §8.4 step 8 / B8).
   */
  private async planScheduling(
    workflowId: string,
    context: SalesforceCaseContext,
    partsLogistics: PartsLogisticsChannel | undefined,
    customerContext: CustomerContextChannel | undefined,
    triagePriority: TriagePriorityDto | undefined,
    knowledgeGuidance: KnowledgeGuidanceChannel | undefined
  ): Promise<SchedulingChannel> {
    const startedAt = Date.now();
    const now = new Date();
    const territoryName = territoryForRegion(
      regionForShipTo(context.serviceShipToCountry)
    );
    const windowStartIso = now.toISOString();
    const windowEndIso = new Date(
      now.getTime() + 21 * 24 * 60 * 60 * 1000
    ).toISOString();

    // 5b: target the WorkType-duration + candidate reads at the Case's
    // required skills, and read a typed repair-effort hint from knowledge.
    const requiredSkills = requiredSkillsForCase({
      partNumbers: (partsLogistics?.partPlans ?? []).map((p) => p.partNumber),
      caseText: `${context.subject ?? ""} ${context.description ?? ""}`
    });
    const kbDurationMinutesHint = kbDurationHintMinutes(
      knowledgeGuidance?.answer?.recommendedActions
    );

    const read = await this.schedulingGateway.readSchedulingContext({
      territoryName,
      windowStartIso,
      windowEndIso,
      requiredSkills,
      candidatesApiEnabled:
        this.config.orchestrator.scheduling.candidatesApiEnabled
    });
    const channel = this.schedulingPlanner.plan({
      context,
      partsLogistics,
      customerContext,
      triagePriority,
      read,
      kbDurationMinutesHint,
      now
    });
    channel.latencyMs = Date.now() - startedAt;
    this.logSchedulingTelemetry(workflowId, channel, startedAt);
    return channel;
  }

  private logSchedulingTelemetry(
    workflowId: string,
    channel: SchedulingChannel,
    startedAt: number
  ): void {
    this.telemetry.recordAgentWorkflow({
      operation: "orchestrator.scheduling",
      useCase: "agentforce_scheduling",
      requestId: workflowId,
      latencyMs: Date.now() - startedAt,
      healthStatus: channel.degraded
        ? "degraded"
        : channel.eligible
          ? "ok"
          : "skipped",
      outcome: "success"
    });
  }
}

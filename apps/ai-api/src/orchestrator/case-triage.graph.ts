import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver
} from "@langchain/langgraph";

import {
  CUSTOMER_HISTORY_NODE_ID,
  GUARDRAIL_NODE_ID,
  KNOWLEDGE_NODE_ID,
  PARTS_LOGISTICS_NODE_ID,
  SCHEDULING_NODE_ID,
  TRIAGE_NODE_ID,
  type ApprovalDecision,
  type NodeLifecycleStatus,
  type OrchestratorNodeId
} from "./dto/case-triage-lifecycle";
import { guardrailOutcomeLabel } from "./dto/guardrail";
import type {
  GuardrailApprovalInterrupt,
  GuardrailApprovalRouting,
  GuardrailChannel,
  GuardrailDecision,
  GuardrailSalesforceApprovalContext
} from "./dto/guardrail";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type {
  CustomerContextChannel,
  CustomerContextSynthesis,
  CustomerHistoryEligibilityResult,
  CustomerHistoryReadResult,
  CustomerHistorySynthesisInput,
  CustomerReadScope
} from "./dto/customer-context";
import type {
  KnowledgeGuidanceChannel,
  KnowledgeEligibilityResult,
  KnowledgeQueryInput
} from "./dto/knowledge-guidance";
import type {
  PartsLogisticsChannel,
  PartsLogisticsEligibilityResult
} from "./dto/parts-logistics";
import type {
  SchedulingChannel,
  SchedulingEligibilityResult
} from "./dto/scheduling";
import type {
  OrchestrationExecutionTrace,
  OrchestrationEventDetail,
  OrchestrationStateChange,
  OrchestrationTraceSection,
  OrchestrationTraceValue,
  SanitizedTriageResult
} from "./dto/orchestration-status-event";
import type {
  TriageCustomerSignals,
  TriagePriorityDto
} from "../agents/dto/triage-case.dto";
import { customerContextToTriageSignals } from "./customer-context-to-triage-signals";

/**
 * LangGraph state for the case-triage orchestrator slice.
 *
 * The chain spans Node 1 (triage, which now includes customer history
 * read before the LLM) and Node 3 (knowledge), with one
 * human-in-the-loop interrupt at the write-back gate:
 *
 *   START -> readContext -> runTriage -> knowledge -> gate
 *                                                      |  \
 *                                        (approved) writeBack -> END
 *                                        (rejected) rejected -> END
 *
 * The state evolves the Node-1-only shape toward a multi-node
 * `ServiceWorkflowState`: `runTriage` writes both `triage` and
 * `customerContext`; Node 3 writes ONLY `knowledgeGuidance`. The
 * `customerContext` channel shape is unchanged — Nodes 3-8 read it
 * without modification. Nodes 4-8 are intentionally absent.
 */
export const CaseTriageState = Annotation.Root({
  workflowId: Annotation<string>(),
  caseId: Annotation<string>(),
  caseNumber: Annotation<string | undefined>(),
  tenantId: Annotation<string | undefined>(),
  principalSubject: Annotation<string>(),
  context: Annotation<SalesforceCaseContext | undefined>(),
  triage: Annotation<SanitizedTriageResult | undefined>(),
  /** Node 2's own channel. Node 2 is the only writer. */
  customerContext: Annotation<CustomerContextChannel | undefined>(),
  /** Node 3's own channel. Node 3 is the only writer. */
  knowledgeGuidance: Annotation<KnowledgeGuidanceChannel | undefined>(),
  /** Node 4's own channel. Node 4 is the only writer. */
  partsLogistics: Annotation<PartsLogisticsChannel | undefined>(),
  /** Node 5's own channel. Node 5 is the only writer. */
  scheduling: Annotation<SchedulingChannel | undefined>(),
  /** Node 6's own channel (Compliance & Guardrail). Node 6 is the only writer. */
  guardrail: Annotation<GuardrailChannel | undefined>(),
  approvalRequired: Annotation<boolean>(),
  approvalDecision: Annotation<ApprovalDecision | undefined>(),
  writeBackApplied: Annotation<boolean>(),
  status: Annotation<NodeLifecycleStatus>()
});

export type CaseTriageStateType = typeof CaseTriageState.State;

export interface CaseTriageTriageInput {
  context: SalesforceCaseContext;
  workflowId: string;
  tenantId?: string;
  principalSubject: string;
  /**
   * Phase B — sanitized customer signals derived from the `customerContext`
   * package (read earlier in the same merged Triage node). Absent when the
   * customer read was skipped/ineligible/degraded-to-no-package, so triage
   * runs case-only. Never carries raw records, names, or account ids.
   */
  customerSignals?: TriageCustomerSignals;
}

/**
 * Side-effecting dependencies the graph needs. Kept as a plain
 * interface so the graph can be unit-tested with fakes, with no
 * NestJS or Salesforce coupling.
 */
export interface CaseTriageGraphDeps {
  readContext(caseId: string): Promise<SalesforceCaseContext>;
  runTriage(input: CaseTriageTriageInput): Promise<SanitizedTriageResult>;
  applyWriteBack(triage: SanitizedTriageResult, caseId: string): Promise<void>;
  /**
   * Node 6 — composite deterministic policy evaluation over all typed
   * channels. Pure (no Salesforce access, no LLM, no throws); returns a
   * GuardrailDecision the `evaluateGuardrail` node uses to set the channel
   * and decide whether to interrupt. Injected from GuardrailPolicyService.
   * Because the node re-runs its pre-interrupt code on every resume, this
   * MUST be deterministic over `state`.
   */
  evaluateGuardrailPolicy(state: CaseTriageStateType): GuardrailDecision;
  /**
   * Node 6 — optional approval notification (idempotent; 6b+). The
   * `evaluateGuardrail` node guards on `state.guardrail?.approvalRouting?.sentAt`
   * before calling this. Degrade-safe, never throws; returns the routing
   * record stamped on the guardrail channel. 6a default: log only and
   * return `{ method: 'log_only' }`.
   */
  sendApprovalNotification(
    workflowId: string,
    caseId: string,
    payload: GuardrailApprovalInterrupt,
    /**
     * 6b+ — optional Salesforce-Approval context (synthesized verdict +
     * console deep link) used only by the SF routing path. Built from the
     * full graph state before `interrupt()` via {@link buildApprovalContext};
     * the email/log paths ignore it.
     */
    context?: GuardrailSalesforceApprovalContext
  ): Promise<GuardrailApprovalRouting>;
  /**
   * Node 6 — optional builder for the 6b+ Salesforce-Approval context
   * (synthesized Orchestrator Verdict + console deep link). Pure over
   * `state` (re-run safe); injected from the orchestrator service. Absent in
   * graph unit tests that do not exercise SF routing.
   */
  buildApprovalContext?(
    state: CaseTriageStateType
  ): GuardrailSalesforceApprovalContext;
  /**
   * Node 6 — optional supervisor escalation notice for the terminal
   * `escalate` outcome (no interrupt). Degrade-safe and never throws; a no-op
   * unless escalation email is enabled. Phase 6b.
   */
  sendEscalationNotification(
    workflowId: string,
    caseId: string,
    payload: GuardrailApprovalInterrupt
  ): Promise<void>;
  /**
   * Node 4 — Phase 4c gated fulfillment writes, applied ONLY in the
   * post-approval write-back. Creates `ProductTransfer` / `ProductRequest`
   * for approved transfer/backorder plans (config-gated, idempotent).
   * Returns an updated channel reflecting reservation transitions, or
   * `undefined` to leave the channel unchanged. Never throws.
   */
  applyPartsFulfillment(
    workflowId: string,
    caseId: string,
    partsLogistics: PartsLogisticsChannel | undefined
  ): Promise<PartsLogisticsChannel | undefined>;
  /**
   * Node 5 — Phase 5c gated scheduling write, applied ONLY in the
   * post-approval write-back (after {@link applyPartsFulfillment}). Does a
   * fresh parts + scheduling re-read at write time (RC-5) and books a
   * `ServiceAppointment` only for a still-`schedulable` plan; otherwise it
   * returns the honest fresh channel without writing. Config-gated and
   * idempotent. Returns an updated `scheduling` channel (with
   * `appointmentStatus: "booked"` + `appointmentReference` on success), or
   * `undefined` to leave the channel unchanged. Never throws.
   */
  applySchedulingWrite(
    workflowId: string,
    caseId: string,
    context: SalesforceCaseContext,
    scheduling: SchedulingChannel | undefined,
    customerContext: CustomerContextChannel | undefined,
    triagePriority: TriagePriorityDto | undefined,
    knowledgeGuidance: KnowledgeGuidanceChannel | undefined
  ): Promise<SchedulingChannel | undefined>;
  /**
   * Node 2 — cheap, config-driven eligibility check. Pure over Case
   * criteria plus the optional triage hint; runs before any read.
   */
  isCustomerHistoryEligible(
    context: SalesforceCaseContext,
    triagePriority: TriagePriorityDto | undefined
  ): CustomerHistoryEligibilityResult;
  /**
   * Node 2 — tenant- and Account-scoped read of the customer graph plus
   * any enabled external adapter signals. Read-only and idempotent.
   */
  readCustomerContext(
    scope: CustomerReadScope
  ): Promise<CustomerHistoryReadResult>;
  /** Node 2 — evidence-first synthesis of the Customer Context Package. */
  synthesizeCustomerHistory(
    input: CustomerHistorySynthesisInput
  ): Promise<CustomerContextSynthesis>;
  /**
   * Node 3 — cheap, config-driven eligibility check. Confirms that
   * RAG is enabled and namespace is configured; runs before retrieval.
   */
  isKnowledgeEligible(
    context: SalesforceCaseContext,
    triagePriority: TriagePriorityDto | undefined,
    customerContext: CustomerContextChannel | undefined
  ): KnowledgeEligibilityResult;
  /**
   * Node 3 — retrieves knowledge guidance from RAG. Must handle
   * retrieval failures gracefully (no throw).
   */
  retrieveKnowledge(
    workflowId: string,
    queryInput: KnowledgeQueryInput,
    tenantId: string | undefined,
    principalSubject: string
  ): Promise<KnowledgeGuidanceChannel>;
  /**
   * Node 4 — cheap, config-driven eligibility check. Confirms parts
   * logistics is enabled; runs before any inventory read.
   */
  isPartsLogisticsEligible(
    context: SalesforceCaseContext,
    triagePriority: TriagePriorityDto | undefined
  ): PartsLogisticsEligibilityResult;
  /**
   * Node 4 — collects part candidates, reads live inventory, and runs
   * the deterministic fulfillment-location-first planner. Must handle
   * inventory-read failures gracefully (degraded flag, no throw).
   */
  planPartsLogistics(
    workflowId: string,
    context: SalesforceCaseContext,
    knowledgeGuidance: KnowledgeGuidanceChannel | undefined,
    triagePriority: TriagePriorityDto | undefined
  ): Promise<PartsLogisticsChannel>;
  /**
   * Node 5 — cheap, config-driven eligibility check. Confirms scheduling
   * is enabled; runs before any Field Service read.
   */
  isSchedulingEligible(
    context: SalesforceCaseContext,
    triagePriority: TriagePriorityDto | undefined,
    partsLogistics: PartsLogisticsChannel | undefined
  ): SchedulingEligibilityResult;
  /**
   * Node 5 — reads Field Service signals and runs the deterministic,
   * parts-ETA-gated scheduling planner. Must handle Field Service read
   * failures gracefully (degraded flag, no throw).
   */
  planScheduling(
    workflowId: string,
    context: SalesforceCaseContext,
    partsLogistics: PartsLogisticsChannel | undefined,
    customerContext: CustomerContextChannel | undefined,
    triagePriority: TriagePriorityDto | undefined,
    knowledgeGuidance: KnowledgeGuidanceChannel | undefined
  ): Promise<SchedulingChannel>;
  /**
   * Emits a sanitized `running` progress line into the read model.
   * `node` defaults to the triage node so existing call sites are
   * unchanged; Node 2 and Node 3 pass their node id.
   */
  emitRunning(
    workflowId: string,
    safeSummary: string,
    details?: OrchestrationEventDetail[],
    node?: OrchestratorNodeId,
    trace?: OrchestrationExecutionTrace
  ): void | Promise<void>;
  checkpointer: BaseCheckpointSaver;
}

export interface CaseTriageGraphCompileOptions {
  /**
   * Compile the stepped variant: pause after each upstream stage
   * ({@link STEP_PAUSE_NODES}) so an operator can advance one stage at a time.
   * The auto graph omits this and runs end-to-end (pausing only at the
   * guardrail's own approval interrupt).
   */
  stepped?: boolean;
}

export function buildCaseTriageGraph(
  deps: CaseTriageGraphDeps,
  options?: CaseTriageGraphCompileOptions
) {
  return new StateGraph(CaseTriageState)
    .addNode("readContext", async (state) => {
      const context = await deps.readContext(state.caseId);
      // Emit after the read so the step can carry safe, non-PII facts
      // about the Case (no subject, description, account id, or names).
      await deps.emitRunning(
        state.workflowId,
        "Reading and understanding the case, customer priority and next best action.",
        buildContextDetails(context),
        TRIAGE_NODE_ID,
        buildContextTrace(state, context)
      );
      return {
        context,
        caseNumber: state.caseNumber ?? context.caseNumber,
        status: "running" as NodeLifecycleStatus
      };
    })
    .addNode("runTriage", async (state) => {
      // Customer context read runs BEFORE the triage LLM (Phase A merge).
      // Uses context.reportedPriority as the triagePriority surrogate —
      // no AI priority exists yet pre-triage; this value is for
      // businessRisk grading metadata only.
      const reportedPriority = state.context?.reportedPriority;
      const eligibility = deps.isCustomerHistoryEligible(
        state.context!,
        reportedPriority
      );

      let customerContext: CustomerContextChannel;

      if (!eligibility.eligible) {
        await deps.emitRunning(
          state.workflowId,
          "Customer history skipped (not eligible).",
          [
            { label: "Eligible", value: "No" },
            { label: "Reason", value: eligibility.reason }
          ],
          CUSTOMER_HISTORY_NODE_ID,
          buildEligibilitySkipTrace(state, eligibility)
        );
        customerContext = {
          eligible: false,
          eligibilityReason: eligibility.reason,
          degraded: false
        } satisfies CustomerContextChannel;
      } else {
        const scope: CustomerReadScope = {
          accountId: state.context?.accountId ?? "",
          tenantId: state.tenantId,
          assetId: state.context?.assetId,
          excludeCaseId: state.caseId
        };

        const read = await deps.readCustomerContext(scope);

        await deps.emitRunning(
          state.workflowId,
          "Checking what the customer reported, which channel the case came from and what issue needs attention.",
          buildProfileEntitlementDetails(read),
          CUSTOMER_HISTORY_NODE_ID,
          buildProfileEntitlementTrace(state, read, reportedPriority)
        );

        await deps.emitRunning(
          state.workflowId,
          "Checking which asset is linked to this case and reviewing the installed product, past service visits, previous failures and open issues.",
          buildReadDetails(read),
          CUSTOMER_HISTORY_NODE_ID,
          buildAssetHistoryTrace(read)
        );

        const synthesis = await deps.synthesizeCustomerHistory({
          bundle: read.bundle,
          triagePriority: reportedPriority,
          externalSignals: read.externalSignals,
          requestId: state.workflowId,
          tenantId: state.tenantId,
          clientId: state.tenantId ?? state.principalSubject
        });

        await deps.emitRunning(
          state.workflowId,
          "Studying the customer's past cases and checking whether this issue has happened before and whether the customer has any repeated service concerns.",
          buildAnalysisDetails(synthesis),
          CUSTOMER_HISTORY_NODE_ID,
          buildAnalysisTrace(read, reportedPriority, synthesis)
        );

        const degradedSources = [
          ...read.bundle.missingSources,
          ...read.degradedSources
        ];
        customerContext = {
          eligible: true,
          eligibilityReason: eligibility.reason,
          degraded: degradedSources.length > 0,
          degradedSources:
            degradedSources.length > 0 ? degradedSources : undefined,
          package: synthesis.package,
          provider: synthesis.provider,
          model: synthesis.model,
          fallbackUsed: synthesis.fallbackUsed,
          latencyMs: synthesis.latencyMs
        };

        await deps.emitRunning(
          state.workflowId,
          "Creating a complete customer context package and includes the customer profile, entitlement status, asset details, service history and known risks.",
          buildPackageSummaryDetails(customerContext),
          CUSTOMER_HISTORY_NODE_ID,
          buildPackageAssemblyTrace(customerContext)
        );

        await deps.emitRunning(
          state.workflowId,
          "Saving its findings into the case state and making the information available for the Orchestrator and the next agents in the workflow.",
          buildPackageDetails(customerContext),
          CUSTOMER_HISTORY_NODE_ID,
          buildCustomerContextWriteTrace(customerContext)
        );
      }

      // Context-informed triage LLM (Phase B): derive sanitized customer
      // signals from the package just assembled and pass them alongside the
      // case text. `undefined` when the customer read was skipped/ineligible
      // or produced no package — triage then runs case-only (degrade-safe).
      const customerSignals = customerContextToTriageSignals(customerContext);
      const triage = await deps.runTriage({
        context: state.context!,
        workflowId: state.workflowId,
        tenantId: state.tenantId,
        principalSubject: state.principalSubject,
        customerSignals
      });
      await deps.emitRunning(
        state.workflowId,
        "Sending the output back to the Orchestrator for the next action.",
        buildTriageDetails(triage),
        TRIAGE_NODE_ID,
        buildTriageTrace(state, triage)
      );
      return { triage, customerContext };
    })
    .addNode("knowledge", async (state) => {
      // Node 3 is READ-ONLY to Salesforce and NON-interrupting. It reads
      // the case + triage + customer context slices, runs an eligibility
      // check, builds a redacted query, retrieves from RAG, and writes
      // ONLY its own `knowledgeGuidance` channel. If RAG fails, it
      // writes a degraded outcome and continues without blocking.
      const triagePriority = state.triage?.recommendedPriority;
      const eligibility = deps.isKnowledgeEligible(
        state.context!,
        triagePriority,
        state.customerContext
      );
      if (!eligibility.eligible) {
        await deps.emitRunning(
          state.workflowId,
          "Knowledge base skipped (not eligible).",
          [
            { label: "Eligible", value: "No" },
            { label: "Reason", value: eligibility.reason }
          ],
          KNOWLEDGE_NODE_ID,
          buildKnowledgeEligibilitySkipTrace(state, eligibility)
        );
        return {
          knowledgeGuidance: {
            eligible: false,
            eligibilityReason: eligibility.reason,
            degraded: false
          } satisfies KnowledgeGuidanceChannel
        };
      }

      await deps.emitRunning(
        state.workflowId,
        "Constructing a targeted knowledge query using the case details, error information, asset type and customer history shared by the Triage Agent.",
        buildKnowledgeQueryDetails(state),
        KNOWLEDGE_NODE_ID,
        buildKnowledgeQueryTrace(state)
      );

      await deps.emitRunning(
        state.workflowId,
        "Searching the approved knowledge base to find relevant troubleshooting guides, service manuals, SOPs and previously resolved case patterns.",
        buildKnowledgeSearchDetails(state),
        KNOWLEDGE_NODE_ID,
        buildKnowledgeSearchTrace(state)
      );

      const queryInput: KnowledgeQueryInput = {
        caseSubject: state.context?.subject,
        caseDescription: state.context?.description,
        triagePriority: state.triage?.recommendedPriority,
        customerTier: state.customerContext?.package?.customerTier.value,
        productModel:
          state.customerContext?.package?.installedAssets.value.primaryModel,
        warrantyStatus: state.customerContext?.package?.warrantyStatus.value,
        repeatIncidentCount:
          state.customerContext?.package?.repeatIncident.value.count
      };
      const guidance = await deps.retrieveKnowledge(
        state.workflowId,
        queryInput,
        state.tenantId,
        state.principalSubject
      );

      if (guidance.status === "ANSWERED") {
        await deps.emitRunning(
          state.workflowId,
          formatKnowledgeFoundSummary(
            guidance.answer?.sources?.length ?? 0
          ),
          buildKnowledgeAnswerDetails(guidance),
          KNOWLEDGE_NODE_ID,
          buildKnowledgeAnswerTrace(guidance)
        );
        await deps.emitRunning(
          state.workflowId,
          "Reviewing the matched guide to identify the likely cause, recommended fix, required steps and any spare-part requirement.",
          buildKnowledgeReviewDetails(guidance),
          KNOWLEDGE_NODE_ID,
          buildKnowledgeReviewTrace(guidance)
        );
      } else if (guidance.status === "NO_SOURCE") {
        await deps.emitRunning(
          state.workflowId,
          "No matching knowledge articles found.",
          buildKnowledgeNoSourceDetails(guidance),
          KNOWLEDGE_NODE_ID,
          buildKnowledgeNoSourceTrace(guidance)
        );
      }

      if (guidance.degraded) {
        await deps.emitRunning(
          state.workflowId,
          "Knowledge base temporarily unavailable (degraded mode).",
          buildKnowledgeDegradedDetails(guidance),
          KNOWLEDGE_NODE_ID,
          buildKnowledgeDegradedTrace(guidance)
        );
      }

      await deps.emitRunning(
        state.workflowId,
        "Saving the knowledge findings into the case state and making the diagnosis available for the Orchestrator and the next agents in the workflow.",
        buildKnowledgeWriteDetails(guidance),
        KNOWLEDGE_NODE_ID,
        buildKnowledgeWriteTrace(guidance)
      );

      await deps.emitRunning(
        state.workflowId,
        "Sending the output back to the Orchestrator for the next action.",
        buildKnowledgeDispatchDetails(guidance),
        KNOWLEDGE_NODE_ID,
        buildKnowledgeDispatchTrace(guidance)
      );

      return { knowledgeGuidance: guidance };
    })
    .addNode("parts", async (state) => {
      // Node 4 is READ-ONLY to Salesforce and NON-interrupting. It reads
      // the case asset + ship-to and the upstream knowledge guidance,
      // checks eligibility, plans fulfillment against live inventory, and
      // writes ONLY its own `partsLogistics` channel. If inventory reads
      // fail it writes a degraded outcome and continues without blocking.
      const triagePriority = state.triage?.recommendedPriority;
      const eligibility = deps.isPartsLogisticsEligible(
        state.context!,
        triagePriority
      );
      if (!eligibility.eligible) {
        await deps.emitRunning(
          state.workflowId,
          "Parts & logistics skipped (not eligible).",
          [
            { label: "Eligible", value: "No" },
            { label: "Reason", value: eligibility.reason }
          ],
          PARTS_LOGISTICS_NODE_ID,
          buildPartsEligibilitySkipTrace(state, eligibility)
        );
        return {
          partsLogistics: {
            eligible: false,
            eligibilityReason: eligibility.reason,
            degraded: false
          } satisfies PartsLogisticsChannel
        };
      }

      await deps.emitRunning(
        state.workflowId,
        "Selecting the best fulfillment warehouse based on customer location, part availability and delivery timeline.",
        buildPartsReadDetails(state),
        PARTS_LOGISTICS_NODE_ID,
        buildPartsReadTrace(state)
      );

      await deps.emitRunning(
        state.workflowId,
        "Reading live inventory to check whether the required spare part is available and ready for dispatch.",
        buildPartsInventoryReadDetails(state),
        PARTS_LOGISTICS_NODE_ID,
        buildPartsInventoryReadTrace(state)
      );

      const parts = await deps.planPartsLogistics(
        state.workflowId,
        state.context!,
        state.knowledgeGuidance,
        triagePriority
      );

      if (parts.degraded) {
        await deps.emitRunning(
          state.workflowId,
          "Inventory temporarily unavailable (degraded mode).",
          [
            { label: "Degraded", value: "Yes" },
            {
              label: "Sources",
              value: (parts.degradedSources ?? []).join(", ") || "inventory"
            }
          ],
          PARTS_LOGISTICS_NODE_ID,
          buildPartsDegradedTrace(parts)
        );
      } else {
        await deps.emitRunning(
          state.workflowId,
          formatPartsIdentifiedSummary(parts),
          buildPartsPlanDetails(parts),
          PARTS_LOGISTICS_NODE_ID,
          buildPartsPlanTrace(parts)
        );
        await deps.emitRunning(
          state.workflowId,
          "Checking that the selected part is compatible with the customer's installed asset.",
          buildPartsCompatibilityDetails(parts),
          PARTS_LOGISTICS_NODE_ID,
          buildPartsCompatibilityTrace(parts)
        );
        await deps.emitRunning(
          state.workflowId,
          formatPartsFulfillmentReadinessSummary(parts),
          buildPartsReadinessDetails(parts),
          PARTS_LOGISTICS_NODE_ID,
          buildPartsReadinessTrace(parts)
        );
      }

      await deps.emitRunning(
        state.workflowId,
        "Saving the parts and logistics plan into the case state so the Orchestrator and Scheduling Agent can use it for the next step.",
        buildPartsWriteDetails(parts),
        PARTS_LOGISTICS_NODE_ID,
        buildPartsWriteTrace(parts)
      );

      await deps.emitRunning(
        state.workflowId,
        "Sending the output back to the Orchestrator for the next action.",
        buildPartsDispatchDetails(parts),
        PARTS_LOGISTICS_NODE_ID,
        buildPartsDispatchTrace(parts)
      );

      return { partsLogistics: parts };
    })
    .addNode("schedule", async (state) => {
      // Node 5 is READ-ONLY to Salesforce and NON-interrupting. It reads
      // the case asset + ship-to and the upstream parts readiness/ETA,
      // checks eligibility, ranks technicians against live Field Service
      // signals, and writes ONLY its own `scheduling` channel. The window
      // is gated on parts ETA (§3.5); a Field Service read failure writes a
      // degraded outcome and continues without blocking. Node 6 owns human
      // approval — Node 5 never interrupts.
      const triagePriority = state.triage?.recommendedPriority;
      const eligibility = deps.isSchedulingEligible(
        state.context!,
        triagePriority,
        state.partsLogistics
      );
      if (!eligibility.eligible) {
        await deps.emitRunning(
          state.workflowId,
          "Scheduling skipped (not eligible).",
          [
            { label: "Eligible", value: "No" },
            { label: "Reason", value: eligibility.reason }
          ],
          SCHEDULING_NODE_ID,
          buildSchedulingEligibilitySkipTrace(state, eligibility)
        );
        return {
          scheduling: {
            eligible: false,
            eligibilityReason: eligibility.reason,
            degraded: false,
            partsEtaConsidered: false,
            requiredApproval: false
          } satisfies SchedulingChannel
        };
      }

      await deps.emitRunning(
        state.workflowId,
        "Ranking available technicians based on required skill, location, service experience and case priority.",
        buildSchedulingReadDetails(state),
        SCHEDULING_NODE_ID,
        buildSchedulingReadTrace(state)
      );

      await deps.emitRunning(
        state.workflowId,
        "Reading Field Service availability to check which technician can take the visit after the required part arrives.",
        buildSchedulingAvailabilityReadDetails(state),
        SCHEDULING_NODE_ID,
        buildSchedulingAvailabilityReadTrace(state)
      );

      const scheduling = await deps.planScheduling(
        state.workflowId,
        state.context!,
        state.partsLogistics,
        state.customerContext,
        triagePriority,
        state.knowledgeGuidance
      );

      if (scheduling.degraded) {
        await deps.emitRunning(
          state.workflowId,
          "Field Service temporarily unavailable (degraded mode).",
          [
            { label: "Degraded", value: "Yes" },
            {
              label: "Sources",
              value:
                (scheduling.degradedSources ?? []).join(", ") || "field_service"
            }
          ],
          SCHEDULING_NODE_ID,
          buildSchedulingDegradedTrace(scheduling)
        );
      } else {
        await deps.emitRunning(
          state.workflowId,
          "Checking the earliest schedulable slot that aligns with part readiness, technician availability and customer urgency.",
          buildSchedulingSlotCheckDetails(scheduling),
          SCHEDULING_NODE_ID,
          buildSchedulingSlotCheckTrace(scheduling)
        );
        if (scheduling.recommendedResourceReference) {
          await deps.emitRunning(
            state.workflowId,
            formatSchedulingResourceSummary(scheduling),
            buildSchedulingResourceDetails(scheduling),
            SCHEDULING_NODE_ID,
            buildSchedulingResourceTrace(scheduling)
          );
        }
        if (scheduling.proposedWindow?.displayWindow) {
          await deps.emitRunning(
            state.workflowId,
            formatSchedulingWindowSummary(scheduling),
            buildSchedulingWindowDetails(scheduling),
            SCHEDULING_NODE_ID,
            buildSchedulingWindowTrace(scheduling)
          );
        }
        await deps.emitRunning(
          state.workflowId,
          "Confirming that the visit can be scheduled without creating a parts delay or technician conflict.",
          buildSchedulingConflictCheckDetails(scheduling),
          SCHEDULING_NODE_ID,
          buildSchedulingConflictCheckTrace(scheduling)
        );
      }

      await deps.emitRunning(
        state.workflowId,
        "Saving the scheduling plan into the case state so the Orchestrator can prepare the next action.",
        buildSchedulingWriteDetails(scheduling),
        SCHEDULING_NODE_ID,
        buildSchedulingWriteTrace(scheduling)
      );

      await deps.emitRunning(
        state.workflowId,
        "Sending the output back to the Orchestrator for approval and final scheduling.",
        buildSchedulingDispatchDetails(scheduling),
        SCHEDULING_NODE_ID,
        buildSchedulingDispatchTrace(scheduling)
      );

      return { scheduling };
    })
    .addNode("evaluateGuardrail", async (state) => {
      // Node 6 — Compliance & Guardrail: the SOLE interrupting node. It
      // runs the deterministic composite policy over all five upstream
      // channels and produces one of four outcomes. Only
      // `requireHumanApproval` calls `interrupt()`.

      // Phase 0 — Stop-AI takeover (Node 6 6c / RC-1, Flow A). Checked BEFORE
      // the policy so a Case an operator has taken over never submits an SF
      // Approval, never calls interrupt(), and never writes back. Degrade-safe:
      // only an explicit `stopped_by_user` stops; a missing field (read as
      // undefined / `active`) lets orchestration proceed normally.
      if (state.context?.orchestrationStatus === "stopped_by_user") {
        await deps.emitRunning(
          state.workflowId,
          "AI orchestration stopped — operator took over the Case.",
          [{ label: "Orchestration", value: "stopped_by_user" }],
          GUARDRAIL_NODE_ID,
          buildGuardrailStoppedTrace(state)
        );
        return {
          approvalRequired: false,
          status: "stopped" as NodeLifecycleStatus
        };
      }

      // Phase 1 — deterministic policy. Pure and idempotent: this re-runs
      // on every resume, so it must branch on `state` alone.
      const decision = deps.evaluateGuardrailPolicy(state);
      const guardrail = buildGuardrailChannel(decision);
      const details = buildGuardrailDecisionDetails(guardrail);

      // Phase 2 — deterministic outcomes route WITHOUT interrupt().
      if (decision.outcome === "autoApprove") {
        await deps.emitRunning(
          state.workflowId,
          "Auto-approved — low composite risk.",
          details,
          GUARDRAIL_NODE_ID,
          buildGuardrailTrace(guardrail, "auto_approved")
        );
        return {
          guardrail,
          approvalRequired: false,
          approvalDecision: "approved" as ApprovalDecision
        };
      }
      if (decision.outcome === "reject") {
        await deps.emitRunning(
          state.workflowId,
          "Rejected — policy rule triggered.",
          details,
          GUARDRAIL_NODE_ID,
          buildGuardrailTrace(guardrail, "rejected")
        );
        return {
          guardrail,
          approvalRequired: false,
          approvalDecision: "rejected" as ApprovalDecision
        };
      }
      if (decision.outcome === "escalate") {
        await deps.emitRunning(
          state.workflowId,
          "Escalated — critical risk signals.",
          details,
          GUARDRAIL_NODE_ID,
          buildGuardrailTrace(guardrail, "escalated")
        );
        // 6b — supervisor escalation notice (terminal path, no interrupt).
        // Degrade-safe; the dep swallows its own failures and never throws.
        await deps.sendEscalationNotification(
          state.workflowId,
          state.caseId,
          buildGuardrailApprovalPayload(state, decision)
        );
        return {
          guardrail,
          approvalRequired: false,
          approvalDecision: "escalated" as ApprovalDecision
        };
      }

      // Phase 3 — requireHumanApproval: the ONLY interrupt path. Every
      // line here re-runs on resume, so it stays idempotent: the
      // notification is guarded on a prior `sentAt`, and the
      // waiting_approval timeline event is emitted once by the
      // orchestrator (settleAfterInvoke), not appended here (which would
      // duplicate on each resume).
      const payload = buildGuardrailApprovalPayload(state, decision);
      let routedGuardrail = guardrail;
      if (!state.guardrail?.approvalRouting?.sentAt) {
        // Build the SF-Approval context (verdict + console link) from the
        // full state BEFORE interrupt(). Pure + idempotent; only the SF
        // routing path reads it.
        const approvalContext = deps.buildApprovalContext?.(state);
        const routing = await deps.sendApprovalNotification(
          state.workflowId,
          state.caseId,
          payload,
          approvalContext
        );
        routedGuardrail = { ...guardrail, approvalRouting: routing };
      }
      const resolved = interrupt(payload) as "approved" | "rejected";
      return {
        guardrail: routedGuardrail,
        approvalRequired: true,
        approvalDecision: resolved as ApprovalDecision
      };
    })
    .addNode("writeBack", async (state) => {
      await deps.applyWriteBack(state.triage!, state.caseId);
      // Phase 4c — apply gated parts fulfillment writes alongside the
      // triage write-back, now that approval has cleared. Config-gated
      // and degrade-safe; returns an updated channel or undefined.
      const updatedParts = await deps.applyPartsFulfillment(
        state.workflowId,
        state.caseId,
        state.partsLogistics
      );
      // Phase 5c — book the approved ServiceAppointment after parts. Runs a
      // fresh parts + scheduling re-read (RC-5) and writes only a still-
      // schedulable plan; config-gated, idempotent, and degrade-safe.
      const updatedScheduling = await deps.applySchedulingWrite(
        state.workflowId,
        state.caseId,
        state.context!,
        state.scheduling,
        state.customerContext,
        state.triage?.recommendedPriority,
        state.knowledgeGuidance
      );
      return {
        writeBackApplied: true,
        status: "done" as NodeLifecycleStatus,
        ...(updatedParts ? { partsLogistics: updatedParts } : {}),
        ...(updatedScheduling ? { scheduling: updatedScheduling } : {})
      };
    })
    .addNode("rejected", () => {
      return { status: "rejected" as NodeLifecycleStatus };
    })
    .addNode("escalated", () => {
      // Node 6 supervisor path. Terminal like `rejected` — no write-back —
      // but distinct so the verdict and UI can surface the escalation.
      return { status: "escalated" as NodeLifecycleStatus };
    })
    .addNode("stopped", () => {
      // Node 6 6c / RC-1 — operator Stop-AI takeover terminal. Like
      // `escalated`: no interrupt, no write-back, but a distinct lifecycle
      // state so the verdict + UI surface a manual takeover, not a guardrail
      // rejection (Node 6 6c plan §1.1).
      return { status: "stopped" as NodeLifecycleStatus };
    })
    .addEdge(START, "readContext")
    .addEdge("readContext", "runTriage")
    .addEdge("runTriage", "knowledge")
    .addEdge("knowledge", "parts")
    .addEdge("parts", "schedule")
    .addEdge("schedule", "evaluateGuardrail")
    .addConditionalEdges(
      "evaluateGuardrail",
      (state) => {
        // Node 6 6c — the Stop-AI takeover sets `status: "stopped"` directly
        // (it is not an ApprovalDecision), so route on it first.
        if (state.status === "stopped") return "stopped";
        if (state.approvalDecision === "approved") return "writeBack";
        if (state.approvalDecision === "escalated") return "escalated";
        return "rejected";
      },
      {
        writeBack: "writeBack",
        rejected: "rejected",
        escalated: "escalated",
        stopped: "stopped"
      }
    )
    .addEdge("writeBack", END)
    .addEdge("rejected", END)
    .addEdge("escalated", END)
    .addEdge("stopped", END)
    .compile({
      checkpointer: deps.checkpointer,
      ...(options?.stepped ? { interruptAfter: [...STEP_PAUSE_NODES] } : {})
    });
}

export type CompiledCaseTriageGraph = ReturnType<typeof buildCaseTriageGraph>;

/**
 * Stepped run mode (Phase 2): the graph nodes after which the stepped graph
 * variant pauses (`interruptAfter`) so an operator can advance one UI stage at
 * a time. Each entry is the LAST graph node of a UI stage (Triage ends at
 * `runTriage`). Node 6 (`evaluateGuardrail`) is intentionally NOT listed — it
 * keeps its own dynamic human-approval `interrupt()` and terminal routing.
 */
export const STEP_PAUSE_NODES = [
  "runTriage",
  "knowledge",
  "parts",
  "schedule"
] as const;

/**
 * Maps the graph node that is *next to run* after a stepped pause (read from
 * the checkpoint's `next`) to its UI node id, so the read model can name the
 * stage awaiting the operator's `advance`.
 */
export const STEP_NEXT_NODE_TO_UI: Record<string, OrchestratorNodeId> = {
  knowledge: KNOWLEDGE_NODE_ID,
  parts: PARTS_LOGISTICS_NODE_ID,
  schedule: SCHEDULING_NODE_ID,
  evaluateGuardrail: GUARDRAIL_NODE_ID
};

/** Graph node that will run next → UI node id that just finished on stepped pause. */
export const STEP_FINISHED_NODE_FROM_NEXT: Record<string, OrchestratorNodeId> = {
  knowledge: TRIAGE_NODE_ID,
  parts: KNOWLEDGE_NODE_ID,
  schedule: PARTS_LOGISTICS_NODE_ID,
  evaluateGuardrail: SCHEDULING_NODE_ID
};

/**
 * Safe, non-PII facts about the Case context read. Deliberately omits
 * subject, description, account id, and any names so nothing sensitive
 * reaches the read-only UI.
 */
function buildContextDetails(
  context: SalesforceCaseContext
): OrchestrationEventDetail[] {
  const details: OrchestrationEventDetail[] = [];
  if (context.caseNumber) {
    details.push({ label: "Case number", value: context.caseNumber });
  }
  if (context.reportedPriority) {
    details.push({
      label: "Reported priority",
      value: context.reportedPriority
    });
  }
  if (context.status) {
    details.push({ label: "Status", value: context.status });
  }
  if (context.origin) {
    details.push({ label: "Origin", value: context.origin });
  }
  details.push({
    label: "Account linked",
    value: context.accountId ? "Yes" : "No"
  });
  return details;
}

/** Safe facts about the triage decision (same data as the result card). */
function buildTriageDetails(
  triage: SanitizedTriageResult | undefined
): OrchestrationEventDetail[] {
  if (!triage) {
    return [];
  }
  return [
    { label: "Recommended priority", value: triage.recommendedPriority },
    { label: "Provider", value: triage.provider },
    { label: "Model", value: triage.model },
    { label: "Latency", value: `${Math.round(triage.latencyMs)} ms` },
    { label: "Fallback", value: triage.fallbackUsed ? "Yes" : "No" }
  ];
}

/**
 * Safe, non-PII facts about the customer read stage. Only counts,
 * source kind, and model names cross into the read model — never names,
 * account ids, contact details, or raw records.
 */
function buildReadDetails(
  read: CustomerHistoryReadResult
): OrchestrationEventDetail[] {
  const details: OrchestrationEventDetail[] = [
    { label: "Read source", value: read.bundle.source }
  ];
  if (read.bundle.installedAssets) {
    details.push({
      label: "Installed assets",
      value: String(read.bundle.installedAssets.totalAssets)
    });
  }
  if (read.bundle.serviceHistory) {
    details.push({
      label: "Prior cases",
      value: String(read.bundle.serviceHistory.priorCaseCount)
    });
  }
  const degraded =
    read.bundle.missingSources.length + read.degradedSources.length;
  details.push({ label: "Degraded sources", value: String(degraded) });
  return details;
}

function buildProfileEntitlementDetails(
  read: CustomerHistoryReadResult
): OrchestrationEventDetail[] {
  const details: OrchestrationEventDetail[] = [
    { label: "Read source", value: read.bundle.source }
  ];
  if (read.bundle.accountProfile?.tier) {
    details.push({
      label: "Customer tier",
      value: read.bundle.accountProfile.tier
    });
  }
  if (read.bundle.entitlement) {
    details.push({
      label: "SLA class",
      value: read.bundle.entitlement.slaClass ?? "unknown"
    });
  }
  if (read.bundle.warranty) {
    details.push({
      label: "Warranty",
      value: read.bundle.warranty.status
    });
  }
  return details;
}

function buildAnalysisDetails(
  synthesis: CustomerContextSynthesis
): OrchestrationEventDetail[] {
  return [
    {
      label: "Business risk",
      value: synthesis.package.businessRisk.value
    },
    {
      label: "Risk confidence",
      value: synthesis.package.businessRisk.confidence
    },
    {
      label: "Model",
      value: synthesis.model ?? "deterministic"
    }
  ];
}

function buildPackageSummaryDetails(
  channel: CustomerContextChannel
): OrchestrationEventDetail[] {
  const pkg = channel.package;
  if (!pkg) {
    return [{ label: "Package", value: "none" }];
  }
  return [
    {
      label: "Assets found",
      value: String(pkg.installedAssets.value.totalAssets)
    },
    {
      label: "Repeat incidents",
      value: String(pkg.repeatIncident.value.count)
    },
    {
      label: "Business risk",
      value: pkg.businessRisk.value
    }
  ];
}

/**
 * Safe, non-PII summary of the Customer Context Package: the finding
 * values and the risk confidence the read-only UI renders. These are
 * tiers, classes, counts, and model names only.
 */
function buildPackageDetails(
  channel: CustomerContextChannel
): OrchestrationEventDetail[] {
  const pkg = channel.package;
  if (!pkg) {
    return [{ label: "Package", value: "none" }];
  }
  return [
    { label: "Customer tier", value: pkg.customerTier.value },
    { label: "SLA class", value: pkg.slaClass.value },
    { label: "Warranty", value: pkg.warrantyStatus.value },
    {
      label: "Repeat failure",
      value: pkg.repeatIncident.value.repeat ? "Yes" : "No"
    },
    {
      label: "Strategic",
      value: pkg.strategicAccount.notEvidenced
        ? "Not evidenced"
        : pkg.strategicAccount.value
          ? "Yes"
          : "No"
    },
    { label: "Business risk", value: pkg.businessRisk.value },
    { label: "Risk confidence", value: pkg.businessRisk.confidence },
    { label: "Degraded", value: channel.degraded ? "Yes" : "No" }
  ];
}

function buildContextTrace(
  state: CaseTriageStateType,
  context: SalesforceCaseContext
): OrchestrationExecutionTrace {
  const after = buildContextState(
    context,
    state.caseNumber ?? context.caseNumber
  );
  return buildTrace("read_case_context", [
    {
      key: "data_sources",
      title: "Data sources queried",
      data: [
        {
          system: "Salesforce",
          object: "Case",
          action: "readCaseContext",
          outcome: "success"
        }
      ]
    },
    {
      key: "records_read",
      title: "Salesforce records read",
      data: [
        {
          object: "Case",
          count: 1,
          fields: [
            "CaseNumber",
            "Priority",
            "Status",
            "Origin",
            "Account linked flag"
          ]
        }
      ]
    },
    {
      key: "inputs",
      title: "Inputs",
      data: {
        caseNumberHint: state.caseNumber ?? null,
        caseIdProvided: true
      }
    },
    {
      key: "findings",
      title: "Findings",
      data: after
    },
    {
      key: "outputs",
      title: "Outputs",
      data: {
        caseContextLoaded: true,
        nextStep: "run_triage"
      }
    },
    ...buildStateSections(
      {
        context: null,
        caseNumber: state.caseNumber ?? null
      },
      {
        context: after,
        caseNumber: state.caseNumber ?? context.caseNumber ?? null
      },
      [
        stateChange("context", "added", after),
        ...((state.caseNumber ?? context.caseNumber)
          ? [
              stateChange(
                "caseNumber",
                state.caseNumber ? "modified" : "added",
                state.caseNumber ?? context.caseNumber ?? null,
                state.caseNumber ?? null
              )
            ]
          : [])
      ]
    )
  ]);
}

function buildTriageTrace(
  state: CaseTriageStateType,
  triage: SanitizedTriageResult | undefined
): OrchestrationExecutionTrace {
  const output = buildTriageState(triage);
  return buildTrace("run_triage", [
    {
      key: "tool_calls",
      title: "Tool calls",
      data: [
        {
          tool: "SupportTriageService.triage",
          provider: triage?.provider ?? "unknown",
          model: triage?.model ?? "unknown",
          fallbackUsed: triage?.fallbackUsed ?? false,
          latencyMs: triage?.latencyMs ?? 0,
          outcome: triage ? "success" : "missing_output"
        }
      ]
    },
    {
      key: "inputs",
      title: "Inputs",
      data: {
        caseOrigin: state.context?.origin ?? "unknown",
        caseStatus: state.context?.status ?? "unknown",
        reportedPriorityHint: state.context?.reportedPriority ?? "unknown",
        accountLinked: Boolean(state.context?.accountId),
        subjectRedacted: true,
        descriptionRedacted: true
      }
    },
    {
      key: "decision_factors",
      title: "Auditable decision factors",
      data: {
        decisionMode:
          "LLM triage over redacted case text plus reported priority hint.",
        reportedPriorityHint: state.context?.reportedPriority ?? "unknown",
        caseOrigin: state.context?.origin ?? "unknown",
        caseStatus: state.context?.status ?? "unknown",
        accountLinked: Boolean(state.context?.accountId),
        fallbackUsed: triage?.fallbackUsed ?? false
      }
    },
    {
      key: "outputs",
      title: "Outputs",
      data: output
    },
    ...buildStateSections({ triage: null }, { triage: output }, [
      stateChange("triage", "added", output)
    ])
  ]);
}

function buildEligibilitySkipTrace(
  state: CaseTriageStateType,
  eligibility: CustomerHistoryEligibilityResult
): OrchestrationExecutionTrace {
  const after = {
    eligible: false,
    eligibilityReason: eligibility.reason,
    degraded: false
  };
  return buildTrace("skip_customer_history", [
    {
      key: "inputs",
      title: "Inputs",
      data: {
        reportedPriority: state.triage?.recommendedPriority ?? "unknown",
        origin: state.context?.origin ?? "unknown"
      }
    },
    {
      key: "findings",
      title: "Findings",
      data: {
        eligible: false,
        reason: eligibility.reason
      }
    },
    {
      key: "outputs",
      title: "Outputs",
      data: after
    },
    ...buildStateSections(
      { customerContext: null },
      { customerContext: after },
      [stateChange("customerContext", "added", after)]
    )
  ]);
}

function buildProfileEntitlementTrace(
  state: CaseTriageStateType,
  read: CustomerHistoryReadResult,
  triagePriority: TriagePriorityDto | undefined
): OrchestrationExecutionTrace {
  return buildTrace("read_customer_profile_entitlements", [
    {
      key: "tool_calls",
      title: "Tool calls",
      data: [
        {
          tool: "SalesforceCustomerGateway.readCustomerBundle",
          readSource: read.bundle.source,
          outcome: "success"
        }
      ]
    },
    {
      key: "data_sources",
      title: "Data sources queried",
      data: [
        buildSourceDescriptor(
          "Account",
          read.bundle.source,
          Boolean(read.bundle.accountProfile)
        ),
        buildSourceDescriptor(
          "Entitlement",
          read.bundle.source,
          Boolean(read.bundle.entitlement)
        ),
        buildSourceDescriptor(
          "Asset warranty",
          read.bundle.source,
          Boolean(read.bundle.warranty)
        )
      ]
    },
    {
      key: "records_read",
      title: "Salesforce records read",
      data: [
        {
          object: "Account",
          count: read.bundle.accountProfile ? 1 : 0,
          fields: ["Type", "Rating"]
        },
        {
          object: "Entitlement",
          count: read.bundle.entitlement ? 1 : 0,
          fields: ["Name"]
        },
        {
          object: "Asset",
          count: read.bundle.warranty ? 1 : 0,
          fields: ["UsageEndDate"]
        }
      ]
    },
    {
      key: "inputs",
      title: "Inputs",
      data: {
        accountScoped: Boolean(state.context?.accountId),
        triagePriority: triagePriority ?? "unknown",
        readSource: read.bundle.source
      }
    },
    {
      key: "findings",
      title: "Findings",
      data: {
        customerTier: read.bundle.accountProfile?.tier ?? "unknown",
        strategicAccountFlag:
          read.bundle.accountProfile?.strategic ?? "not_evidenced",
        entitlementFound: read.bundle.entitlement?.hasEntitlement ?? false,
        slaClass: read.bundle.entitlement?.slaClass ?? "unknown",
        warrantyStatus: read.bundle.warranty?.status ?? "unknown",
        degradedSources: buildDegradedSources(read)
      }
    },
    {
      key: "outputs",
      title: "Outputs",
      data: {
        accountProfileReady: Boolean(read.bundle.accountProfile),
        entitlementSignalReady: Boolean(read.bundle.entitlement),
        warrantySignalReady: Boolean(read.bundle.warranty)
      }
    }
  ]);
}

function buildAssetHistoryTrace(
  read: CustomerHistoryReadResult
): OrchestrationExecutionTrace {
  return buildTrace("read_assets_service_history", [
    {
      key: "data_sources",
      title: "Data sources queried",
      data: [
        buildSourceDescriptor(
          "Asset",
          read.bundle.source,
          Boolean(read.bundle.installedAssets)
        ),
        buildSourceDescriptor(
          "Case history",
          read.bundle.source,
          Boolean(read.bundle.serviceHistory)
        ),
        ...read.externalSignals.map((signal) => ({
          system: signal.source,
          object: "External signal",
          action: "readAll",
          outcome: "success",
          confidence: signal.confidence
        }))
      ]
    },
    {
      key: "records_read",
      title: "Salesforce records read",
      data: [
        {
          object: "Asset",
          count: read.bundle.installedAssets?.totalAssets ?? 0,
          fields: ["Product2.Name", "COUNT(Id)"]
        },
        {
          object: "Case",
          count: read.bundle.serviceHistory?.priorCaseCount ?? 0,
          fields: ["Status", "IsEscalated", "IsClosed", "CreatedDate"]
        }
      ]
    },
    {
      key: "findings",
      title: "Findings",
      data: {
        assetsFound: read.bundle.installedAssets?.totalAssets ?? 0,
        modelCount: read.bundle.installedAssets?.modelCount ?? 0,
        primaryModel: read.bundle.installedAssets?.primaryModel ?? null,
        priorCasesFound: read.bundle.serviceHistory?.priorCaseCount ?? 0,
        openIncidents: read.bundle.serviceHistory?.openIncidentCount ?? 0,
        priorEscalations: read.bundle.serviceHistory?.priorEscalations ?? 0,
        repeatWindowDays: read.bundle.serviceHistory?.repeatWindowDays ?? 0,
        repeatIncidentCount:
          read.bundle.serviceHistory?.repeatIncidentCount ?? 0,
        externalSignals: read.externalSignals.map((signal) => ({
          source: signal.source,
          confidence: signal.confidence,
          signals: signal.signals
        })),
        degradedSources: buildDegradedSources(read)
      }
    },
    {
      key: "outputs",
      title: "Outputs",
      data: {
        assetSignalsReady: Boolean(read.bundle.installedAssets),
        serviceHistoryReady: Boolean(read.bundle.serviceHistory),
        externalSignalCount: read.externalSignals.length
      }
    }
  ]);
}

function buildAnalysisTrace(
  read: CustomerHistoryReadResult,
  triagePriority: TriagePriorityDto | undefined,
  synthesis: CustomerContextSynthesis
): OrchestrationExecutionTrace {
  const pkg = synthesis.package;
  return buildTrace("analyze_customer_history", [
    {
      key: "tool_calls",
      title: "Tool calls",
      data: [
        {
          tool: "CustomerHistorySynthesisService.synthesize",
          provider: synthesis.provider ?? "deterministic",
          model: synthesis.model ?? "deterministic",
          fallbackUsed: synthesis.fallbackUsed,
          latencyMs: synthesis.latencyMs,
          outcome: "success"
        }
      ]
    },
    {
      key: "inputs",
      title: "Inputs",
      data: {
        reportedPriority: triagePriority ?? "unknown",
        customerTier: pkg.customerTier.value,
        slaClass: pkg.slaClass.value,
        warrantyStatus: pkg.warrantyStatus.value,
        repeatFailure: pkg.repeatIncident.value.repeat,
        repeatCount: pkg.repeatIncident.value.count,
        strategicAccount: pkg.strategicAccount.value,
        openIncidents: pkg.openIncidentCount.value,
        priorEscalations: pkg.escalationHistory.value,
        externalSignals: read.externalSignals.map((signal) => ({
          source: signal.source,
          confidence: signal.confidence,
          signals: signal.signals
        }))
      }
    },
    {
      key: "decision_factors",
      title: "Decision factors",
      data: {
        businessRiskEvidence: pkg.businessRisk.evidenceBasis,
        repeatFailureTriggered: pkg.repeatIncident.value.repeat,
        strategicAccountTriggered:
          pkg.strategicAccount.notEvidenced === true
            ? "not_evidenced"
            : pkg.strategicAccount.value,
        premiumSignal:
          pkg.customerTier.value === "premium" ||
          pkg.slaClass.value === "premium",
        openIncidents: pkg.openIncidentCount.value,
        priorEscalations: pkg.escalationHistory.value
      }
    },
    {
      key: "confidence",
      title: "Confidence scores",
      data: {
        customerTier: pkg.customerTier.confidence,
        slaClass: pkg.slaClass.confidence,
        warrantyStatus: pkg.warrantyStatus.confidence,
        repeatIncident: pkg.repeatIncident.confidence,
        strategicAccount: pkg.strategicAccount.confidence,
        businessRisk: pkg.businessRisk.confidence
      }
    },
    {
      key: "outputs",
      title: "Outputs",
      data: {
        businessRisk: pkg.businessRisk.value,
        riskConfidence: pkg.businessRisk.confidence,
        provider: synthesis.provider ?? null,
        model: synthesis.model ?? null,
        fallbackUsed: synthesis.fallbackUsed
      }
    }
  ]);
}

function buildPackageAssemblyTrace(
  channel: CustomerContextChannel
): OrchestrationExecutionTrace {
  return buildTrace("build_customer_context_package", [
    {
      key: "outputs",
      title: "Final node outputs",
      data: buildCustomerContextState(channel)
    }
  ]);
}

function buildCustomerContextWriteTrace(
  channel: CustomerContextChannel
): OrchestrationExecutionTrace {
  const after = buildCustomerContextState(channel);
  return buildTrace("write_customer_context_state", [
    {
      key: "outputs",
      title: "Outputs",
      data: {
        customerContextWritten: true,
        eligible: channel.eligible,
        businessRisk: channel.package?.businessRisk.value ?? "unknown"
      }
    },
    ...buildStateSections(
      { customerContext: null },
      { customerContext: after },
      [stateChange("customerContext", "added", after)]
    )
  ]);
}

function buildContextState(
  context: SalesforceCaseContext,
  caseNumber: string | undefined
): OrchestrationTraceValue {
  return {
    caseNumber: caseNumber ?? null,
    reportedPriority: context.reportedPriority ?? "unknown",
    status: context.status ?? "unknown",
    origin: context.origin ?? "unknown",
    accountLinked: Boolean(context.accountId)
  };
}

function buildTriageState(
  triage: SanitizedTriageResult | undefined
): OrchestrationTraceValue {
  if (!triage) {
    return {
      recommendedPriority: null,
      summary: null,
      suggestedNextStep: null,
      provider: null,
      model: null,
      fallbackUsed: false,
      latencyMs: 0
    };
  }
  return {
    recommendedPriority: triage.recommendedPriority,
    summary: triage.summary,
    suggestedNextStep: triage.suggestedNextStep,
    provider: triage.provider,
    model: triage.model,
    fallbackUsed: triage.fallbackUsed,
    latencyMs: triage.latencyMs
  };
}

function buildCustomerContextState(
  channel: CustomerContextChannel
): OrchestrationTraceValue {
  return {
    eligible: channel.eligible,
    eligibilityReason: channel.eligibilityReason ?? null,
    degraded: channel.degraded,
    degradedSources: channel.degradedSources ?? [],
    package: channel.package
      ? {
          customerTier: buildFindingState(
            channel.package.customerTier.value,
            channel.package.customerTier.confidence,
            channel.package.customerTier.evidenceBasis,
            channel.package.customerTier.provenance,
            channel.package.customerTier.notEvidenced
          ),
          slaClass: buildFindingState(
            channel.package.slaClass.value,
            channel.package.slaClass.confidence,
            channel.package.slaClass.evidenceBasis,
            channel.package.slaClass.provenance,
            channel.package.slaClass.notEvidenced
          ),
          warrantyStatus: buildFindingState(
            channel.package.warrantyStatus.value,
            channel.package.warrantyStatus.confidence,
            channel.package.warrantyStatus.evidenceBasis,
            channel.package.warrantyStatus.provenance,
            channel.package.warrantyStatus.notEvidenced
          ),
          repeatIncident: buildFindingState(
            channel.package.repeatIncident.value,
            channel.package.repeatIncident.confidence,
            channel.package.repeatIncident.evidenceBasis,
            channel.package.repeatIncident.provenance,
            channel.package.repeatIncident.notEvidenced
          ),
          strategicAccount: buildFindingState(
            channel.package.strategicAccount.value,
            channel.package.strategicAccount.confidence,
            channel.package.strategicAccount.evidenceBasis,
            channel.package.strategicAccount.provenance,
            channel.package.strategicAccount.notEvidenced
          ),
          installedAssets: buildFindingState(
            channel.package.installedAssets.value,
            channel.package.installedAssets.confidence,
            channel.package.installedAssets.evidenceBasis,
            channel.package.installedAssets.provenance,
            channel.package.installedAssets.notEvidenced
          ),
          openIncidentCount: buildFindingState(
            channel.package.openIncidentCount.value,
            channel.package.openIncidentCount.confidence,
            channel.package.openIncidentCount.evidenceBasis,
            channel.package.openIncidentCount.provenance,
            channel.package.openIncidentCount.notEvidenced
          ),
          escalationHistory: buildFindingState(
            channel.package.escalationHistory.value,
            channel.package.escalationHistory.confidence,
            channel.package.escalationHistory.evidenceBasis,
            channel.package.escalationHistory.provenance,
            channel.package.escalationHistory.notEvidenced
          ),
          businessRisk: buildFindingState(
            channel.package.businessRisk.value,
            channel.package.businessRisk.confidence,
            channel.package.businessRisk.evidenceBasis,
            channel.package.businessRisk.provenance,
            channel.package.businessRisk.notEvidenced
          )
        }
      : null,
    provider: channel.provider ?? null,
    model: channel.model ?? null,
    fallbackUsed: channel.fallbackUsed ?? false,
    latencyMs: channel.latencyMs ?? 0
  };
}

function buildFindingState(
  value: OrchestrationTraceValue,
  confidence: string,
  evidenceBasis: string,
  provenance: string,
  notEvidenced?: boolean
): OrchestrationTraceValue {
  return {
    value,
    confidence,
    evidenceBasis,
    provenance,
    notEvidenced: notEvidenced === true
  };
}

function buildDegradedSources(
  read: CustomerHistoryReadResult
): OrchestrationTraceValue {
  return [...read.bundle.missingSources, ...read.degradedSources];
}

function buildSourceDescriptor(
  object: string,
  source: CustomerHistoryReadResult["bundle"]["source"],
  available: boolean
): OrchestrationTraceValue {
  return {
    system: "Salesforce",
    object,
    source,
    outcome: available ? "read" : "missing"
  };
}

function buildTrace(
  stepKey: string,
  sections: Array<
    | {
        key: string;
        title: string;
        data: OrchestrationTraceValue;
      }
    | undefined
  >
): OrchestrationExecutionTrace {
  const compact = sections.filter(
    (
      section
    ): section is {
      key: string;
      title: string;
      data: OrchestrationTraceValue;
    } => section !== undefined
  );
  return {
    stepKey,
    sections: compact.map((section) => ({
      key: section.key,
      title: section.title,
      data: section.data
    }))
  };
}

function buildStateSections(
  before: OrchestrationTraceValue,
  after: OrchestrationTraceValue,
  changes: OrchestrationStateChange[]
): OrchestrationTraceSection[] {
  return [
    {
      key: "state_before",
      title: "State before step",
      data: before
    },
    {
      key: "state_after",
      title: "State after step",
      data: after
    },
    {
      key: "state_changes",
      title: "State changes",
      data: changes
    }
  ];
}

function stateChange(
  path: string,
  change: OrchestrationStateChange["change"],
  after: OrchestrationTraceValue,
  before?: OrchestrationTraceValue
): OrchestrationStateChange {
  return { path, change, before, after };
}

// Node 3 (Knowledge) trace building functions
// These are placeholders for now; full implementation includes query details, retrieval metadata, etc.

function buildKnowledgeEligibilitySkipTrace(
  state: CaseTriageStateType,
  eligibility: KnowledgeEligibilityResult
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_eligibility_skip",
    sections: [
      {
        key: "eligibility",
        title: "Eligibility check",
        data: {
          eligible: false,
          reason: eligibility.reason
        }
      }
    ]
  };
}

function buildKnowledgeQueryDetails(
  state: CaseTriageStateType
): OrchestrationEventDetail[] {
  return [
    { label: "Query", value: "Constructed from Case + customer context" },
    { label: "Namespace", value: "customer-self-service" }
  ];
}

function buildKnowledgeQueryTrace(
  state: CaseTriageStateType
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_query_build",
    sections: [
      {
        key: "inputs",
        title: "Inputs",
        data: {
          caseSubject: state.context?.subject ? "present" : "absent",
          triagePriority: state.triage?.recommendedPriority ?? "unknown",
          customerModel:
            state.customerContext?.package?.installedAssets.value
              .primaryModel ?? "unknown"
        }
      }
    ]
  };
}

function buildKnowledgeSearchDetails(
  state: CaseTriageStateType
): OrchestrationEventDetail[] {
  return [
    { label: "Namespace", value: "customer-self-service" },
    { label: "TopK", value: "5" },
    { label: "Score threshold", value: "0.65" }
  ];
}

function buildKnowledgeSearchTrace(
  state: CaseTriageStateType
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_search",
    sections: [
      {
        key: "search_params",
        title: "Search parameters",
        data: {
          topK: 5,
          scoreThreshold: 0.65,
          includeStale: false
        }
      }
    ]
  };
}

function formatKnowledgeFoundSummary(sourceCount: number): string {
  const guideWord = sourceCount === 1 ? "guide" : "guides";
  const matchVerb = sourceCount === 1 ? "matches" : "match";
  return `Found ${sourceCount} matching troubleshooting ${guideWord} that closely ${matchVerb} the reported issue and can support the next recommended action.`;
}

function buildKnowledgeAnswerDetails(
  channel: KnowledgeGuidanceChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Status", value: "ANSWERED" },
    {
      label: "Sources found",
      value: String(channel.answer?.sources?.length ?? 0)
    },
    { label: "Provider", value: channel.answer?.provider ?? "unknown" },
    { label: "Latency (ms)", value: String(channel.answer?.latencyMs ?? 0) }
  ];
}

function buildKnowledgeAnswerTrace(
  channel: KnowledgeGuidanceChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_answered",
    sections: [
      {
        key: "sources",
        title: "Retrieved sources",
        data:
          channel.answer?.sources?.map((s) => ({
            id: s.sourceId,
            title: s.title,
            scorePercentile: s.retrievalScorePercentile
          })) ?? []
      },
      {
        key: "provider",
        title: "Provider",
        data: {
          provider: channel.answer?.provider,
          model: channel.answer?.model,
          embedding: channel.answer?.embeddingProvider,
          latencyMs: channel.answer?.latencyMs
        }
      }
    ]
  };
}

function buildKnowledgeNoSourceDetails(
  channel: KnowledgeGuidanceChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Status", value: "NO_SOURCE" },
    { label: "Reason", value: "No matching articles found" },
    { label: "Score threshold", value: "0.65" }
  ];
}

function buildKnowledgeNoSourceTrace(
  channel: KnowledgeGuidanceChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_no_source",
    sections: [
      {
        key: "result",
        title: "Result",
        data: {
          status: "NO_SOURCE",
          sourcesMatched: 0,
          degraded: channel.degraded
        }
      }
    ]
  };
}

function buildKnowledgeDegradedDetails(
  channel: KnowledgeGuidanceChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Degraded", value: "Yes" },
    {
      label: "Sources unavailable",
      value: (channel.degradedSources ?? []).join(", ")
    }
  ];
}

function buildKnowledgeDegradedTrace(
  channel: KnowledgeGuidanceChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_degraded",
    sections: [
      {
        key: "degradation",
        title: "Degradation info",
        data: {
          degraded: true,
          degradedSources: channel.degradedSources ?? []
        }
      }
    ]
  };
}

function buildKnowledgeReviewDetails(
  channel: KnowledgeGuidanceChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Status", value: channel.status ?? "skipped" },
    {
      label: "Sources reviewed",
      value: String(channel.answer?.sources?.length ?? 0)
    },
    {
      label: "Primary source",
      value: channel.answer?.sources?.[0]?.title ?? "n/a"
    }
  ];
}

function buildKnowledgeReviewTrace(
  channel: KnowledgeGuidanceChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_review",
    sections: [
      {
        key: "review",
        title: "Guide review",
        data: {
          status: channel.status ?? null,
          sourceCount: channel.answer?.sources?.length ?? 0,
          primarySourceId: channel.answer?.sources?.[0]?.sourceId ?? null
        }
      }
    ]
  };
}

function buildKnowledgeWriteDetails(
  channel: KnowledgeGuidanceChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Status", value: channel.status ?? "skipped" },
    { label: "Eligible", value: channel.eligible ? "Yes" : "No" },
    { label: "Degraded", value: channel.degraded ? "Yes" : "No" }
  ];
}

function buildKnowledgeWriteTrace(
  channel: KnowledgeGuidanceChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_write",
    sections: [
      {
        key: "channel",
        title: "Knowledge guidance channel",
        data: {
          eligible: channel.eligible,
          status: channel.status ?? null,
          degraded: channel.degraded,
          answerPresent: channel.answer ? true : false,
          sourceCount: channel.answer?.sources?.length ?? 0
        }
      },
      {
        key: "state_changes",
        title: "State changes",
        data: [
          {
            path: "knowledgeGuidance",
            change: "added",
            after: {
              eligible: channel.eligible,
              status: channel.status ?? null,
              degraded: channel.degraded,
              answerPresent: channel.answer ? true : false,
              sourceCount: channel.answer?.sources?.length ?? 0
            }
          }
        ]
      },
      {
        key: "state_after",
        title: "State after step",
        data: {
          knowledgeGuidance: {
            eligible: channel.eligible,
            status: channel.status ?? null,
            degraded: channel.degraded,
            answerPresent: channel.answer ? true : false,
            sourceCount: channel.answer?.sources?.length ?? 0
          }
        }
      }
    ]
  };
}

function buildKnowledgeDispatchDetails(
  channel: KnowledgeGuidanceChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Status", value: channel.status ?? "skipped" },
    { label: "Next node", value: "parts" }
  ];
}

function buildKnowledgeDispatchTrace(
  channel: KnowledgeGuidanceChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "knowledge_dispatch",
    sections: [
      {
        key: "handoff",
        title: "Orchestrator handoff",
        data: {
          status: channel.status ?? null,
          eligible: channel.eligible,
          degraded: channel.degraded
        }
      }
    ]
  };
}

// Node 4 (Parts & Logistics) detail + trace builders. Every value is a
// safe, non-PII fact: part codes, warehouse reference codes, ETA windows,
// exception and approval reasons — never serial numbers or raw rows.

function buildPartsEligibilitySkipTrace(
  state: CaseTriageStateType,
  eligibility: PartsLogisticsEligibilityResult
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_eligibility_skip",
    sections: [
      {
        key: "eligibility",
        title: "Eligibility check",
        data: {
          eligible: false,
          reason: eligibility.reason,
          assetLinked: Boolean(state.context?.assetId)
        }
      }
    ]
  };
}

function buildPartsReadDetails(
  state: CaseTriageStateType
): OrchestrationEventDetail[] {
  return [
    {
      label: "Ship-to",
      value:
        [state.context?.serviceShipToCity, state.context?.serviceShipToState]
          .filter(Boolean)
          .join(", ") || "unknown"
    },
    {
      label: "Asset model",
      value: state.context?.assetProductCode ?? "unknown"
    },
    {
      label: "Suggested parts",
      value: String(
        state.knowledgeGuidance?.answer?.suggestedParts?.length ?? 0
      )
    }
  ];
}

function buildPartsReadTrace(
  state: CaseTriageStateType
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_read",
    sections: [
      {
        key: "inputs",
        title: "Inputs",
        data: {
          shipToCountry: state.context?.serviceShipToCountry ?? "unknown",
          shipToState: state.context?.serviceShipToState ?? "unknown",
          assetProductCode: state.context?.assetProductCode ?? "unknown",
          suggestedPartCount:
            state.knowledgeGuidance?.answer?.suggestedParts?.length ?? 0
        }
      },
      {
        key: "data_sources",
        title: "Data sources queried",
        data: [
          {
            system: "Salesforce",
            object: "ProductItem",
            action: "readStockForParts",
            keys: "Product2.ProductCode + Location.ExternalReference"
          }
        ]
      }
    ]
  };
}

function buildPartsInventoryReadDetails(
  state: CaseTriageStateType
): OrchestrationEventDetail[] {
  return [
    {
      label: "Suggested parts",
      value: String(
        state.knowledgeGuidance?.answer?.suggestedParts?.length ?? 0
      )
    },
    {
      label: "Asset model",
      value: state.context?.assetProductCode ?? "unknown"
    }
  ];
}

function buildPartsInventoryReadTrace(
  state: CaseTriageStateType
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_inventory_read",
    sections: [
      {
        key: "inventory_read",
        title: "Inventory read",
        data: {
          suggestedPartCount:
            state.knowledgeGuidance?.answer?.suggestedParts?.length ?? 0,
          assetProductCode: state.context?.assetProductCode ?? "unknown"
        }
      }
    ]
  };
}

function formatPartsIdentifiedSummary(channel: PartsLogisticsChannel): string {
  const count = channel.partPlans?.length ?? 0;
  const verb = count === 1 ? "has" : "have";
  const noun = count === 1 ? "part" : "parts";
  return `Confirming that ${count} required ${noun} ${verb} been identified for this case.`;
}

function buildPartsCompatibilityDetails(
  channel: PartsLogisticsChannel
): OrchestrationEventDetail[] {
  const plans = channel.partPlans ?? [];
  const compatible = plans.filter(
    (plan) =>
      plan.compatibility === "confirmed" || plan.compatibility === "universal"
  ).length;
  return [
    { label: "Parts reviewed", value: String(plans.length) },
    { label: "Compatible", value: String(compatible) }
  ];
}

function buildPartsCompatibilityTrace(
  channel: PartsLogisticsChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_compatibility",
    sections: [
      {
        key: "compatibility",
        title: "Compatibility check",
        data: (channel.partPlans ?? []).map((plan) => ({
          partNumber: plan.partNumber,
          compatibility: plan.compatibility,
          compatibilityEvidence: plan.compatibilityEvidence ?? null
        }))
      }
    ]
  };
}

function formatPartsFulfillmentReadinessSummary(
  channel: PartsLogisticsChannel
): string {
  return "Confirming fulfillment readiness, which means the required part is available and can support the planned service visit.";
}

function buildPartsReadinessDetails(
  channel: PartsLogisticsChannel
): OrchestrationEventDetail[] {
  return [
    {
      label: "Fulfillment",
      value: channel.fulfillmentReadiness ?? "unknown"
    },
    { label: "Status", value: channel.status ?? "n/a" }
  ];
}

function buildPartsReadinessTrace(
  channel: PartsLogisticsChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_readiness",
    sections: [
      {
        key: "readiness",
        title: "Fulfillment readiness",
        data: {
          fulfillmentReadiness: channel.fulfillmentReadiness ?? null,
          fulfillmentConfidence: channel.fulfillmentConfidence ?? null,
          status: channel.status ?? null
        }
      }
    ]
  };
}

function buildPartsDispatchDetails(
  channel: PartsLogisticsChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Status", value: channel.status ?? "skipped" },
    { label: "Next node", value: "scheduling" }
  ];
}

function buildPartsDispatchTrace(
  channel: PartsLogisticsChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_dispatch",
    sections: [
      {
        key: "handoff",
        title: "Orchestrator handoff",
        data: {
          eligible: channel.eligible,
          status: channel.status ?? null,
          degraded: channel.degraded
        }
      }
    ]
  };
}

function buildPartsDegradedTrace(
  channel: PartsLogisticsChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_degraded",
    sections: [
      {
        key: "degradation",
        title: "Degradation info",
        data: {
          degraded: true,
          degradedSources: channel.degradedSources ?? ["salesforce_inventory"],
          fulfillmentReadiness: channel.fulfillmentReadiness ?? "unknown"
        }
      }
    ]
  };
}

function buildPartsPlanDetails(
  channel: PartsLogisticsChannel
): OrchestrationEventDetail[] {
  const details: OrchestrationEventDetail[] = [
    { label: "Status", value: channel.status ?? "n/a" },
    {
      label: "Fulfillment",
      value: channel.fulfillmentReadiness ?? "unknown"
    },
    { label: "Parts", value: String(channel.partPlans?.length ?? 0) }
  ];
  const approvals = (channel.partPlans ?? []).filter(
    (p) => p.requiredApproval
  ).length;
  if (approvals > 0) {
    details.push({ label: "Approvals needed", value: String(approvals) });
  }
  if (channel.kbCrossCheck && channel.kbCrossCheck.status !== "SKIPPED") {
    details.push({
      label: "KB cross-check",
      value: channel.kbCrossCheck.status
    });
  }
  return details;
}

function buildPartsPlanTrace(
  channel: PartsLogisticsChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "parts_logistics_plan",
    sections: [
      {
        key: "part_plans",
        title: "Part plans",
        data: (channel.partPlans ?? []).map((p) => ({
          partNumber: p.partNumber,
          compatibility: p.compatibility,
          availability: p.availability,
          exceptionType: p.exceptionType,
          fulfillmentWarehouse: p.fulfillmentWarehouseReference ?? null,
          sourceWarehouse: p.sourceWarehouseReference ?? null,
          transferRequired: p.transferRequired ?? false,
          etaWindow: p.estimatedArrivalWindow ?? null,
          requiredApproval: p.requiredApproval,
          approvalReason: p.approvalReason ?? "none",
          kbWarehouseAlignment: p.kbWarehouseAlignment ?? null,
          kbDocumentedWarehouses: p.kbDocumentedWarehouses ?? []
        }))
      },
      {
        key: "outputs",
        title: "Outputs",
        data: {
          status: channel.status ?? null,
          fulfillmentReadiness: channel.fulfillmentReadiness ?? null,
          fulfillmentConfidence: channel.fulfillmentConfidence ?? null,
          candidateSources: channel.candidateSources ?? [],
          kbCrossCheck: channel.kbCrossCheck
            ? {
                status: channel.kbCrossCheck.status,
                alignedCount: channel.kbCrossCheck.alignedCount,
                divergentCount: channel.kbCrossCheck.divergentCount,
                undocumentedCount: channel.kbCrossCheck.undocumentedCount
              }
            : null
        }
      }
    ]
  };
}

function buildPartsWriteDetails(
  channel: PartsLogisticsChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Eligible", value: channel.eligible ? "Yes" : "No" },
    { label: "Status", value: channel.status ?? "skipped" },
    { label: "Degraded", value: channel.degraded ? "Yes" : "No" }
  ];
}

function buildPartsWriteTrace(
  channel: PartsLogisticsChannel
): OrchestrationExecutionTrace {
  const after = {
    eligible: channel.eligible,
    status: channel.status ?? null,
    degraded: channel.degraded,
    fulfillmentReadiness: channel.fulfillmentReadiness ?? null,
    partCount: channel.partPlans?.length ?? 0
  };
  return {
    stepKey: "parts_logistics_write",
    sections: [
      { key: "channel", title: "Parts logistics channel", data: after },
      {
        key: "state_changes",
        title: "State changes",
        data: [{ path: "partsLogistics", change: "added", after }]
      },
      {
        key: "state_after",
        title: "State after step",
        data: { partsLogistics: after }
      }
    ]
  };
}

// Node 5 (Scheduling) detail + trace builders. Every value is a safe,
// non-PII fact: a sanitized technician reference (never a full name),
// readiness, territory reference, ISO window, and the gating basis.

function buildSchedulingEligibilitySkipTrace(
  state: CaseTriageStateType,
  eligibility: SchedulingEligibilityResult
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_eligibility_skip",
    sections: [
      {
        key: "eligibility",
        title: "Eligibility check",
        data: {
          eligible: false,
          reason: eligibility.reason,
          partsReadiness: state.partsLogistics?.fulfillmentReadiness ?? "n/a"
        }
      }
    ]
  };
}

function buildSchedulingReadDetails(
  state: CaseTriageStateType
): OrchestrationEventDetail[] {
  return [
    {
      label: "Ship-to",
      value:
        [state.context?.serviceShipToCity, state.context?.serviceShipToState]
          .filter(Boolean)
          .join(", ") || "unknown"
    },
    {
      label: "Parts readiness",
      value: state.partsLogistics?.fulfillmentReadiness ?? "n/a"
    },
    {
      label: "Asset model",
      value: state.context?.assetProductCode ?? "unknown"
    }
  ];
}

function buildSchedulingReadTrace(
  state: CaseTriageStateType
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_read",
    sections: [
      {
        key: "inputs",
        title: "Inputs",
        data: {
          shipToCountry: state.context?.serviceShipToCountry ?? "unknown",
          shipToState: state.context?.serviceShipToState ?? "unknown",
          assetProductCode: state.context?.assetProductCode ?? "unknown",
          partsReadiness:
            state.partsLogistics?.fulfillmentReadiness ?? "unknown"
        }
      },
      {
        key: "data_sources",
        title: "Data sources queried",
        data: [
          {
            system: "Salesforce",
            object: "ServiceResource",
            action: "readSchedulingContext",
            fields:
              "Territory membership + ServiceResourceSkill + OperatingHours"
          }
        ]
      }
    ]
  };
}

function buildSchedulingAvailabilityReadDetails(
  state: CaseTriageStateType
): OrchestrationEventDetail[] {
  return [
    {
      label: "Parts readiness",
      value: state.partsLogistics?.fulfillmentReadiness ?? "n/a"
    },
    {
      label: "Parts ETA considered",
      value: state.partsLogistics?.partPlans?.[0]?.estimatedArrivalWindow
        ? "Yes"
        : "Pending"
    }
  ];
}

function buildSchedulingAvailabilityReadTrace(
  state: CaseTriageStateType
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_availability_read",
    sections: [
      {
        key: "availability_read",
        title: "Field Service availability read",
        data: {
          partsReadiness:
            state.partsLogistics?.fulfillmentReadiness ?? "unknown",
          partsEtaWindow:
            state.partsLogistics?.partPlans?.[0]?.estimatedArrivalWindow ?? null
        }
      }
    ]
  };
}

function buildSchedulingDegradedTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_degraded",
    sections: [
      {
        key: "degradation",
        title: "Degradation info",
        data: {
          degraded: true,
          degradedSources: channel.degradedSources ?? [
            "salesforce_field_service"
          ],
          schedulingReadiness: channel.schedulingReadiness ?? "unknown"
        }
      }
    ]
  };
}

function buildSchedulingSlotCheckDetails(
  channel: SchedulingChannel
): OrchestrationEventDetail[] {
  return [
    {
      label: "Readiness",
      value: channel.schedulingReadiness ?? "unknown"
    },
    {
      label: "Parts readiness seen",
      value: channel.partsReadinessSeen ?? "unknown"
    },
    {
      label: "Candidates",
      value: String(channel.candidates?.length ?? 0)
    }
  ];
}

function buildSchedulingSlotCheckTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_slot_check",
    sections: [
      {
        key: "slot_check",
        title: "Earliest schedulable slot",
        data: {
          schedulingReadiness: channel.schedulingReadiness ?? null,
          partsEtaConsidered: channel.partsEtaConsidered,
          partsReadinessSeen: channel.partsReadinessSeen ?? null,
          candidateCount: channel.candidates?.length ?? 0
        }
      }
    ]
  };
}

function formatSchedulingResourceSummary(channel: SchedulingChannel): string {
  return `Identifying a schedulable service resource: ${channel.recommendedResourceReference}.`;
}

function buildSchedulingResourceDetails(
  channel: SchedulingChannel
): OrchestrationEventDetail[] {
  return [
    {
      label: "Technician",
      value: channel.recommendedResourceReference ?? "n/a"
    },
    {
      label: "Readiness",
      value: channel.schedulingReadiness ?? "unknown"
    }
  ];
}

function buildSchedulingResourceTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_resource",
    sections: [
      {
        key: "resource",
        title: "Recommended resource",
        data: {
          recommendedResourceReference:
            channel.recommendedResourceReference ?? null,
          schedulingReadiness: channel.schedulingReadiness ?? null
        }
      }
    ]
  };
}

function formatSchedulingWindowSummary(channel: SchedulingChannel): string {
  const window = channel.proposedWindow?.displayWindow;
  if (!window) {
    return "Recommending the visit window after parts readiness and technician availability are aligned.";
  }
  const base = window.replace(/\s*\(after parts arrive\)\s*$/i, "");
  if (channel.proposedWindow?.partsEtaConstrained) {
    return `Recommending the visit window: ${base}, after the required part is expected to arrive.`;
  }
  return `Recommending the visit window: ${base}.`;
}

function buildSchedulingWindowDetails(
  channel: SchedulingChannel
): OrchestrationEventDetail[] {
  return [
    {
      label: "Window",
      value: channel.proposedWindow?.displayWindow ?? "n/a"
    },
    {
      label: "Parts ETA constrained",
      value: channel.proposedWindow?.partsEtaConstrained ? "Yes" : "No"
    }
  ];
}

function buildSchedulingWindowTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_window",
    sections: [
      {
        key: "window",
        title: "Proposed visit window",
        data: {
          displayWindow: channel.proposedWindow?.displayWindow ?? null,
          proposedStart: channel.proposedWindow?.proposedStart ?? null,
          proposedEnd: channel.proposedWindow?.proposedEnd ?? null,
          partsEtaConstrained: channel.proposedWindow?.partsEtaConstrained ?? false
        }
      }
    ]
  };
}

function buildSchedulingConflictCheckDetails(
  channel: SchedulingChannel
): OrchestrationEventDetail[] {
  return [
    {
      label: "Readiness",
      value: channel.schedulingReadiness ?? "unknown"
    },
    {
      label: "Required approval",
      value: channel.requiredApproval ? "Yes" : "No"
    }
  ];
}

function buildSchedulingConflictCheckTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_conflict_check",
    sections: [
      {
        key: "conflict_check",
        title: "Scheduling conflict check",
        data: {
          schedulingReadiness: channel.schedulingReadiness ?? null,
          partsReadinessSeen: channel.partsReadinessSeen ?? null,
          requiredApproval: channel.requiredApproval,
          approvalReason: channel.approvalReason ?? "none"
        }
      }
    ]
  };
}

function buildSchedulingDispatchDetails(
  channel: SchedulingChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Status", value: channel.status ?? "skipped" },
    { label: "Next node", value: "guardrail" }
  ];
}

function buildSchedulingDispatchTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_dispatch",
    sections: [
      {
        key: "handoff",
        title: "Orchestrator handoff",
        data: {
          eligible: channel.eligible,
          status: channel.status ?? null,
          degraded: channel.degraded,
          requiredApproval: channel.requiredApproval
        }
      }
    ]
  };
}

function buildSchedulingPlanDetails(
  channel: SchedulingChannel
): OrchestrationEventDetail[] {
  const details: OrchestrationEventDetail[] = [
    { label: "Status", value: channel.status ?? "n/a" },
    {
      label: "Readiness",
      value: channel.schedulingReadiness ?? "unknown"
    },
    {
      label: "Candidates",
      value: String(channel.candidates?.length ?? 0)
    }
  ];
  if (channel.recommendedResourceReference) {
    details.push({
      label: "Technician",
      value: channel.recommendedResourceReference
    });
  }
  if (channel.proposedWindow?.displayWindow) {
    details.push({
      label: "Window",
      value: channel.proposedWindow.displayWindow
    });
  }
  if (channel.requiredApproval) {
    details.push({
      label: "Approval",
      value: channel.approvalReason ?? "required"
    });
  }
  return details;
}

function buildSchedulingPlanTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  return {
    stepKey: "scheduling_plan",
    sections: [
      {
        key: "candidates",
        title: "Ranked technicians",
        data: (channel.candidates ?? []).map((c) => ({
          resourceReference: c.resourceReference,
          rank: c.rank,
          rankScore: c.rankScore,
          skillScore: c.skillScore,
          availabilityScore: c.availabilityScore,
          territoryFitScore: c.territoryFitScore,
          matchedSkills: c.matchedSkills,
          territory: c.territoryReference ?? null,
          membership: c.territoryMembership ?? null,
          earliestAvailableAt: c.earliestAvailableAt ?? null
        }))
      },
      {
        key: "outputs",
        title: "Outputs",
        data: {
          schedulingReadiness: channel.schedulingReadiness ?? null,
          recommendedResourceReference:
            channel.recommendedResourceReference ?? null,
          proposedWindow: channel.proposedWindow
            ? {
                earliestStart: channel.proposedWindow.earliestStart,
                earliestStartBasis: channel.proposedWindow.earliestStartBasis,
                proposedStart: channel.proposedWindow.proposedStart ?? null,
                proposedEnd: channel.proposedWindow.proposedEnd ?? null,
                partsEtaConstrained: channel.proposedWindow.partsEtaConstrained,
                windowConfidence: channel.proposedWindow.windowConfidence
              }
            : null,
          partsReadinessSeen: channel.partsReadinessSeen ?? null,
          requiredApproval: channel.requiredApproval,
          approvalReason: channel.approvalReason ?? "none"
        }
      }
    ]
  };
}

function buildSchedulingWriteDetails(
  channel: SchedulingChannel
): OrchestrationEventDetail[] {
  return [
    { label: "Eligible", value: channel.eligible ? "Yes" : "No" },
    { label: "Status", value: channel.status ?? "skipped" },
    { label: "Degraded", value: channel.degraded ? "Yes" : "No" }
  ];
}

function buildSchedulingWriteTrace(
  channel: SchedulingChannel
): OrchestrationExecutionTrace {
  const after = {
    eligible: channel.eligible,
    status: channel.status ?? null,
    degraded: channel.degraded,
    schedulingReadiness: channel.schedulingReadiness ?? null,
    recommendedResourceReference: channel.recommendedResourceReference ?? null
  };
  return {
    stepKey: "scheduling_write",
    sections: [
      { key: "channel", title: "Scheduling channel", data: after },
      {
        key: "state_changes",
        title: "State changes",
        data: [{ path: "scheduling", change: "added", after }]
      },
      {
        key: "state_after",
        title: "State after step",
        data: { scheduling: after }
      }
    ]
  };
}

// Node 6 (Compliance & Guardrail) builders. Every value is a safe,
// non-PII fact: rule ids, reason labels, a numeric risk score, and the
// priority/status facts an approver needs — never raw Case text, account
// ids, customer names, or technician names.

/** Assembles the `guardrail` channel from the pure policy decision. */
function buildGuardrailChannel(decision: GuardrailDecision): GuardrailChannel {
  return {
    eligible: true,
    outcome: decision.outcome,
    riskScore: decision.riskScore,
    riskLevel: decision.riskLevel,
    policyRulesEvaluated: decision.allRules,
    policyRulesTriggered: decision.triggeredRules,
    requiresHumanApproval: decision.outcome === "requireHumanApproval",
    approvalRequired: decision.outcome === "requireHumanApproval",
    channelBasis: decision.channelBasis,
    approvalReasons: decision.approvalReasons,
    autoApproveReason: decision.autoApproveReason,
    degraded: false,
    latencyMs: decision.latencyMs
  };
}

/**
 * Builds the safe interrupt payload for the approver. Reads typed fields
 * plus the sanitized `displayWindow` string (the one free-text field the
 * §7 contract explicitly allows in the interrupt context). No PII.
 */
function buildGuardrailApprovalPayload(
  state: CaseTriageStateType,
  decision: GuardrailDecision
): GuardrailApprovalInterrupt {
  const parts = state.partsLogistics;
  const scheduling = state.scheduling;
  const partsApprovalReasons = dedupeStrings(
    (parts?.partPlans ?? [])
      .filter(
        (plan) =>
          plan.requiredApproval &&
          plan.approvalReason &&
          plan.approvalReason !== "none"
      )
      .map((plan) => plan.approvalReason as string)
  );
  const schedulingApprovalReasons =
    scheduling?.requiredApproval &&
    scheduling.approvalReason &&
    scheduling.approvalReason !== "none"
      ? [scheduling.approvalReason]
      : undefined;
  return {
    action: "approve_case_workflow",
    workflowId: state.workflowId,
    caseId: state.caseId,
    caseNumber: state.caseNumber,
    guardrail: {
      riskScore: decision.riskScore,
      riskLevel: decision.riskLevel,
      policyRulesTriggered: decision.triggeredRules.map((rule) => rule.ruleId),
      approvalReasons: decision.approvalReasons
    },
    context: {
      recommendedPriority: state.triage?.recommendedPriority ?? "unknown",
      partsStatus: parts?.status,
      partsApprovalReasons:
        partsApprovalReasons.length > 0 ? partsApprovalReasons : undefined,
      schedulingStatus: scheduling?.status,
      schedulingWindow: scheduling?.proposedWindow?.displayWindow,
      schedulingApprovalReasons
    }
  };
}

function buildGuardrailDecisionDetails(
  guardrail: GuardrailChannel
): OrchestrationEventDetail[] {
  const details: OrchestrationEventDetail[] = [
    { label: "Outcome", value: guardrailOutcomeLabel(guardrail.outcome) },
    { label: "Risk score", value: String(guardrail.riskScore) },
    { label: "Risk level", value: guardrail.riskLevel }
  ];
  if (guardrail.policyRulesTriggered.length > 0) {
    details.push({
      label: "Triggered rules",
      value: guardrail.policyRulesTriggered
        .map((rule) => rule.ruleId)
        .join(", ")
    });
  }
  return details;
}

function buildGuardrailTrace(
  guardrail: GuardrailChannel,
  stepKind: "auto_approved" | "rejected" | "escalated" | "waiting_approval"
): OrchestrationExecutionTrace {
  const summary = {
    outcome: guardrail.outcome,
    riskScore: guardrail.riskScore,
    riskLevel: guardrail.riskLevel
  };
  return {
    stepKey: `guardrail_${stepKind}`,
    sections: [
      {
        key: "decision",
        title: "Guardrail decision",
        data: {
          ...summary,
          channelBasis: guardrail.channelBasis,
          requiresHumanApproval: guardrail.requiresHumanApproval
        }
      },
      {
        key: "rules_triggered",
        title: "Policy rules triggered",
        data: guardrail.policyRulesTriggered.map((rule) => ({
          ruleId: rule.ruleId,
          channel: rule.channelSource,
          riskPoints: rule.riskPoints,
          hardRule: rule.isHardRule,
          description: rule.description
        }))
      },
      {
        key: "approval_reasons",
        title: "Approval reasons",
        data: guardrail.approvalReasons
      },
      {
        key: "state_changes",
        title: "State changes",
        data: [{ path: "guardrail", change: "added", after: summary }]
      }
    ]
  };
}

/**
 * Trace for the Node 6 6c Stop-AI takeover terminal (RC-1). No policy ran —
 * the operator stopped the Case before the guardrail evaluated — so the trace
 * records the control flag and the terminal transition only. No PII.
 */
function buildGuardrailStoppedTrace(
  state: CaseTriageStateType
): OrchestrationExecutionTrace {
  return {
    stepKey: "guardrail_stopped_by_user",
    sections: [
      {
        key: "inputs",
        title: "Inputs",
        data: {
          orchestrationStatus: state.context?.orchestrationStatus ?? "active",
          recommendedPriority: state.triage?.recommendedPriority ?? "unknown"
        }
      },
      {
        key: "outputs",
        title: "Outputs",
        data: {
          workflowStatus: "stopped",
          interrupted: false,
          approvalSubmitted: false,
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
            before: "running",
            after: "stopped"
          }
        ]
      }
    ]
  };
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export { Command };

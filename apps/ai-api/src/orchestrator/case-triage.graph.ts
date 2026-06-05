import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver
} from "@langchain/langgraph";

import type {
  ApprovalDecision,
  NodeLifecycleStatus
} from "./dto/case-triage-lifecycle";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type {
  OrchestrationEventDetail,
  SanitizedTriageResult
} from "./dto/orchestration-status-event";

/**
 * LangGraph state for the Node 1 case-triage walking skeleton.
 *
 * The graph is intentionally a single linear chain with one
 * human-in-the-loop interrupt at the write-back gate:
 *
 *   START -> readContext -> triage -> gate --(approved)--> writeBack -> END
 *                                          \--(rejected)--> rejected -> END
 *
 * Nodes 2-8 are intentionally absent.
 */
export const CaseTriageState = Annotation.Root({
  workflowId: Annotation<string>(),
  caseId: Annotation<string>(),
  caseNumber: Annotation<string | undefined>(),
  tenantId: Annotation<string | undefined>(),
  principalSubject: Annotation<string>(),
  context: Annotation<SalesforceCaseContext | undefined>(),
  triage: Annotation<SanitizedTriageResult | undefined>(),
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
  requiresApproval(triage: SanitizedTriageResult): boolean;
  /** Emits a sanitized `running` progress line into the read model. */
  emitRunning(
    workflowId: string,
    safeSummary: string,
    details?: OrchestrationEventDetail[]
  ): void | Promise<void>;
  checkpointer: BaseCheckpointSaver;
}

/**
 * The safe payload surfaced when the graph pauses for approval. It
 * carries no Case text, prompts, or hidden reasoning — only the
 * identifiers an out-of-band approver needs.
 */
export interface TriageApprovalInterrupt {
  action: "approve_triage_write_back";
  workflowId: string;
  caseId: string;
  caseNumber?: string;
  recommendedPriority: SanitizedTriageResult["recommendedPriority"];
}

export function buildCaseTriageGraph(deps: CaseTriageGraphDeps) {
  return new StateGraph(CaseTriageState)
    .addNode("readContext", async (state) => {
      const context = await deps.readContext(state.caseId);
      // Emit after the read so the step can carry safe, non-PII facts
      // about the Case (no subject, description, account id, or names).
      await deps.emitRunning(
        state.workflowId,
        "Reading Case context from Salesforce.",
        buildContextDetails(context)
      );
      return {
        context,
        caseNumber: state.caseNumber ?? context.caseNumber,
        status: "running" as NodeLifecycleStatus
      };
    })
    .addNode("runTriage", async (state) => {
      const triage = await deps.runTriage({
        context: state.context!,
        workflowId: state.workflowId,
        tenantId: state.tenantId,
        principalSubject: state.principalSubject
      });
      await deps.emitRunning(
        state.workflowId,
        "Running AI triage.",
        buildTriageDetails(triage)
      );
      return { triage };
    })
    .addNode("gate", (state) => {
      const triage = state.triage!;
      if (!deps.requiresApproval(triage)) {
        return {
          approvalRequired: false,
          approvalDecision: "approved" as ApprovalDecision
        };
      }
      // Pauses the graph. On resume the node re-runs from here and
      // `interrupt` returns the approver's decision. Anything before
      // this line must stay deterministic because it re-executes.
      const payload: TriageApprovalInterrupt = {
        action: "approve_triage_write_back",
        workflowId: state.workflowId,
        caseId: state.caseId,
        caseNumber: state.caseNumber,
        recommendedPriority: triage.recommendedPriority
      };
      const decision = interrupt(payload) as ApprovalDecision;
      return { approvalRequired: true, approvalDecision: decision };
    })
    .addNode("writeBack", async (state) => {
      await deps.applyWriteBack(state.triage!, state.caseId);
      return {
        writeBackApplied: true,
        status: "done" as NodeLifecycleStatus
      };
    })
    .addNode("rejected", () => {
      return { status: "rejected" as NodeLifecycleStatus };
    })
    .addEdge(START, "readContext")
    .addEdge("readContext", "runTriage")
    .addEdge("runTriage", "gate")
    .addConditionalEdges(
      "gate",
      (state) =>
        state.approvalDecision === "approved" ? "writeBack" : "rejected",
      { writeBack: "writeBack", rejected: "rejected" }
    )
    .addEdge("writeBack", END)
    .addEdge("rejected", END)
    .compile({ checkpointer: deps.checkpointer });
}

export type CompiledCaseTriageGraph = ReturnType<typeof buildCaseTriageGraph>;

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
  triage: SanitizedTriageResult
): OrchestrationEventDetail[] {
  return [
    { label: "Recommended priority", value: triage.recommendedPriority },
    { label: "Provider", value: triage.provider },
    { label: "Model", value: triage.model },
    { label: "Latency", value: `${Math.round(triage.latencyMs)} ms` },
    { label: "Fallback", value: triage.fallbackUsed ? "Yes" : "No" }
  ];
}

export { Command };

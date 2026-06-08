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
  TRIAGE_NODE_ID,
  type ApprovalDecision,
  type NodeLifecycleStatus,
  type OrchestratorNodeId
} from "./dto/case-triage-lifecycle";
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
  OrchestrationExecutionTrace,
  OrchestrationEventDetail,
  OrchestrationStateChange,
  OrchestrationTraceSection,
  OrchestrationTraceValue,
  SanitizedTriageResult
} from "./dto/orchestration-status-event";
import type { TriagePriorityDto } from "../agents/dto/triage-case.dto";

/**
 * LangGraph state for the case-triage orchestrator slice.
 *
 * The chain spans Node 1 (triage) and the non-interrupting Node 2
 * (customer history), with one human-in-the-loop interrupt at the
 * write-back gate. Node 2 is inserted between triage and the gate:
 *
 *   START -> readContext -> runTriage -> customerHistory -> gate
 *                                                            |  \
 *                                              (approved) writeBack -> END
 *                                              (rejected) rejected -> END
 *
 * The state evolves the Node-1-only shape toward a multi-node
 * `ServiceWorkflowState`: Node 2 writes ONLY its own `customerContext`
 * channel; the triage channels stay read-only to it. Nodes 3-8 are
 * intentionally absent.
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
   * Emits a sanitized `running` progress line into the read model.
   * `node` defaults to the triage node so existing call sites are
   * unchanged; Node 2 passes the customer-history node id.
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
      const triage = await deps.runTriage({
        context: state.context!,
        workflowId: state.workflowId,
        tenantId: state.tenantId,
        principalSubject: state.principalSubject
      });
      await deps.emitRunning(
        state.workflowId,
        "Running AI triage.",
        buildTriageDetails(triage),
        TRIAGE_NODE_ID,
        buildTriageTrace(state, triage)
      );
      return { triage };
    })
    .addNode("customerHistory", async (state) => {
      // Node 2 is READ-ONLY to Salesforce and NON-interrupting. It reads
      // the case + triage slices, runs evidence-first synthesis, and
      // writes ONLY its own `customerContext` channel. Triage is a
      // weighting hint: if absent the node still runs from Case context
      // and its own reads (it never hard-fails on missing triage).
      const triagePriority = state.triage?.recommendedPriority;
      const eligibility = deps.isCustomerHistoryEligible(
        state.context!,
        triagePriority
      );
      if (!eligibility.eligible) {
        // Cost control: skip reads + model call for low-value Cases and
        // write an empty/low-confidence channel.
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
        return {
          customerContext: {
            eligible: false,
            eligibilityReason: eligibility.reason,
            degraded: false
          } satisfies CustomerContextChannel
        };
      }

      const scope: CustomerReadScope = {
        accountId: state.context?.accountId ?? "",
        tenantId: state.tenantId
      };

      const read = await deps.readCustomerContext(scope);

      await deps.emitRunning(
        state.workflowId,
        "Reading customer profile and entitlements.",
        buildProfileEntitlementDetails(read),
        CUSTOMER_HISTORY_NODE_ID,
        buildProfileEntitlementTrace(state, read, triagePriority)
      );

      await deps.emitRunning(
        state.workflowId,
        "Reading installed assets and service history.",
        buildReadDetails(read),
        CUSTOMER_HISTORY_NODE_ID,
        buildAssetHistoryTrace(read)
      );
      const synthesis = await deps.synthesizeCustomerHistory({
        bundle: read.bundle,
        triagePriority,
        externalSignals: read.externalSignals,
        requestId: state.workflowId,
        tenantId: state.tenantId,
        clientId: state.tenantId ?? state.principalSubject
      });

      await deps.emitRunning(
        state.workflowId,
        "Analyzing customer history.",
        buildAnalysisDetails(synthesis),
        CUSTOMER_HISTORY_NODE_ID,
        buildAnalysisTrace(read, triagePriority, synthesis)
      );

      const degradedSources = [
        ...read.bundle.missingSources,
        ...read.degradedSources
      ];
      const channel: CustomerContextChannel = {
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
        "Building customer context package.",
        buildPackageSummaryDetails(channel),
        CUSTOMER_HISTORY_NODE_ID,
        buildPackageAssemblyTrace(channel)
      );

      await deps.emitRunning(
        state.workflowId,
        "Writing customer findings to state.",
        buildPackageDetails(channel),
        CUSTOMER_HISTORY_NODE_ID,
        buildCustomerContextWriteTrace(channel)
      );

      return { customerContext: channel };
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
    .addEdge("runTriage", "customerHistory")
    .addEdge("customerHistory", "gate")
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

export { Command };

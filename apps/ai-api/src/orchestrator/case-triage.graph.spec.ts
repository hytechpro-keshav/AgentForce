import { Command, MemorySaver } from "@langchain/langgraph";

import { buildCaseTriageGraph } from "./case-triage.graph";
import type { CaseTriageGraphDeps } from "./case-triage.graph";
import {
  CUSTOMER_HISTORY_NODE_ID,
  GUARDRAIL_NODE_ID,
  PARTS_LOGISTICS_NODE_ID,
  SCHEDULING_NODE_ID
} from "./dto/case-triage-lifecycle";
import type {
  CustomerContextSynthesis,
  CustomerHistoryReadResult
} from "./dto/customer-context";
import type { GuardrailDecision, GuardrailOutcome } from "./dto/guardrail";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type { SanitizedTriageResult } from "./dto/orchestration-status-event";

/** Default-shaped guardrail decision for a given outcome. */
function decisionFor(outcome: GuardrailOutcome): GuardrailDecision {
  return {
    outcome,
    riskScore: outcome === "autoApprove" ? 0 : 50,
    riskLevel: outcome === "autoApprove" ? "low" : "medium",
    allRules: [],
    triggeredRules: [],
    channelBasis: [],
    approvalReasons: outcome === "autoApprove" ? [] : ["test reason"],
    latencyMs: 0
  };
}

const ACCOUNT_ID = "001000000000001";

function buildContext(
  overrides: Partial<SalesforceCaseContext> = {}
): SalesforceCaseContext {
  return {
    caseId: "500000000000001",
    caseNumber: "00004242",
    subject: "Outage",
    description: "No service",
    status: "New",
    origin: "Web",
    reportedPriority: "high",
    accountId: ACCOUNT_ID,
    ...overrides
  };
}

function buildTriage(): SanitizedTriageResult {
  return {
    recommendedPriority: "critical",
    summary: "Outage affecting service.",
    suggestedNextStep: "Route to network ops.",
    provider: "openai",
    model: "gpt-4o-mini",
    fallbackUsed: false,
    latencyMs: 40
  };
}

function buildReadResult(): CustomerHistoryReadResult {
  return {
    bundle: {
      source: "soql",
      accountProfile: { tier: "premium", strategic: true },
      entitlement: { hasEntitlement: true, slaClass: "premium" },
      warranty: { status: "covered" },
      installedAssets: {
        totalAssets: 420,
        modelCount: 1,
        primaryModel: "VX-900"
      },
      serviceHistory: {
        priorCaseCount: 5,
        repeatIncidentCount: 2,
        repeatWindowDays: 30,
        priorEscalations: 1,
        openIncidentCount: 1
      },
      missingSources: []
    },
    externalSignals: [],
    degradedSources: []
  };
}

function buildSynthesis(): CustomerContextSynthesis {
  const finding = <T>(value: T) => ({
    value,
    confidence: "high" as const,
    provenance: "Salesforce",
    evidenceBasis: "evidenced",
    assertedVsInferred: "asserted" as const
  });
  return {
    package: {
      customerTier: finding("premium" as const),
      slaClass: finding("premium" as const),
      warrantyStatus: finding("covered" as const),
      repeatIncident: finding({ repeat: true, count: 2, windowDays: 30 }),
      strategicAccount: finding(true),
      installedAssets: finding({
        totalAssets: 420,
        modelCount: 1,
        primaryModel: "VX-900"
      }),
      openIncidentCount: finding(1),
      escalationHistory: finding(1),
      businessRisk: {
        value: "high" as const,
        confidence: "high" as const,
        provenance: "AI synthesis",
        evidenceBasis: "Risk signals: strategic, repeat-failure, premium",
        assertedVsInferred: "inferred" as const
      }
    },
    provider: "openai",
    model: "gpt-4o-mini",
    fallbackUsed: false,
    latencyMs: 12
  };
}

interface DepsHarness {
  deps: CaseTriageGraphDeps;
  emitRunning: jest.Mock;
  readCustomerContext: jest.Mock;
  synthesize: jest.Mock;
  isEligible: jest.Mock;
  applyWriteBack: jest.Mock;
  runTriage: jest.Mock;
}

function buildDeps(overrides: Partial<CaseTriageGraphDeps> = {}): DepsHarness {
  const emitRunning = jest.fn().mockResolvedValue(undefined);
  const readCustomerContext = jest.fn().mockResolvedValue(buildReadResult());
  const synthesize = jest.fn().mockResolvedValue(buildSynthesis());
  const isEligible = jest
    .fn()
    .mockReturnValue({ eligible: true, reason: "eligible" });
  const applyWriteBack = jest.fn().mockResolvedValue(undefined);
  const runTriage = jest.fn().mockResolvedValue(buildTriage());

  const deps: CaseTriageGraphDeps = {
    readContext: jest.fn().mockResolvedValue(buildContext()),
    runTriage,
    applyWriteBack,
    // Node 6 default: auto-approve so the happy-path tests reach write-back
    // without an interrupt. Individual tests override the outcome.
    evaluateGuardrailPolicy: () => decisionFor("autoApprove"),
    sendApprovalNotification: jest
      .fn()
      .mockResolvedValue({ method: "log_only" }),
    sendEscalationNotification: jest.fn().mockResolvedValue(undefined),
    applyPartsFulfillment: jest.fn().mockResolvedValue(undefined),
    applySchedulingWrite: jest.fn().mockResolvedValue(undefined),
    isCustomerHistoryEligible: isEligible,
    readCustomerContext,
    synthesizeCustomerHistory: synthesize,
    isKnowledgeEligible: jest
      .fn()
      .mockReturnValue({ eligible: false, reason: "disabled_by_test" }),
    retrieveKnowledge: jest.fn().mockResolvedValue({
      eligible: false,
      degraded: false,
      status: undefined
    } as any),
    isPartsLogisticsEligible: jest
      .fn()
      .mockReturnValue({ eligible: false, reason: "disabled_by_test" }),
    planPartsLogistics: jest.fn().mockResolvedValue({
      eligible: false,
      degraded: false
    } as any),
    isSchedulingEligible: jest
      .fn()
      .mockReturnValue({ eligible: false, reason: "disabled_by_test" }),
    planScheduling: jest.fn().mockResolvedValue({
      eligible: false,
      degraded: false,
      partsEtaConsidered: false,
      requiredApproval: false
    } as any),
    emitRunning,
    checkpointer: new MemorySaver(),
    ...overrides
  };

  return {
    deps,
    emitRunning,
    readCustomerContext,
    synthesize,
    isEligible,
    applyWriteBack,
    runTriage
  };
}

async function invoke(deps: CaseTriageGraphDeps, workflowId = "wf-graph-1") {
  const graph = buildCaseTriageGraph(deps);
  return graph.invoke(
    {
      workflowId,
      caseId: "500000000000001",
      caseNumber: "00004242",
      principalSubject: "orchestrator",
      approvalRequired: false,
      writeBackApplied: false,
      status: "running"
    },
    { configurable: { thread_id: workflowId } }
  );
}

describe("case-triage graph — Node 2 customer history", () => {
  it("advances readContext -> runTriage(merged) -> knowledge -> evaluateGuardrail -> writeBack", async () => {
    const h = buildDeps();
    const result = await invoke(h.deps);

    // Customer read ran inside runTriage with the Account scope.
    // triagePriority surrogate = context.reportedPriority ("high"), not
    // triage.recommendedPriority (no AI priority exists pre-triage).
    expect(h.readCustomerContext).toHaveBeenCalledTimes(1);
    expect(h.readCustomerContext.mock.calls[0][0]).toMatchObject({
      accountId: ACCOUNT_ID
    });
    expect(h.synthesize).toHaveBeenCalledTimes(1);
    expect(h.synthesize.mock.calls[0][0].triagePriority).toBe("high");

    // Node 2 wrote ONLY its own channel; Node 1 still completed.
    expect(result.customerContext?.eligible).toBe(true);
    expect(result.customerContext?.package?.businessRisk.value).toBe("high");
    expect(result.writeBackApplied).toBe(true);

    // Every Node 2 progress line is tagged with the customer-history node.
    const node2Events = h.emitRunning.mock.calls.filter(
      (call) => call[3] === CUSTOMER_HISTORY_NODE_ID
    );
    expect(node2Events.length).toBeGreaterThanOrEqual(5);
  });

  it("still runs customer read when triage LLM returns undefined (degrade-safe)", async () => {
    // Customer read happens BEFORE the triage LLM in the merged node, so
    // a degraded triage result does not affect customerContext.
    // triagePriority surrogate is context.reportedPriority ("high").
    const runTriage = jest
      .fn()
      .mockResolvedValue(undefined as unknown as SanitizedTriageResult);
    const h = buildDeps({ runTriage });

    const result = await invoke(h.deps);

    // Customer read ran; triagePriority is the reportedPriority surrogate.
    expect(h.readCustomerContext).toHaveBeenCalledTimes(1);
    expect(h.synthesize).toHaveBeenCalledTimes(1);
    expect(h.synthesize.mock.calls[0][0].triagePriority).toBe("high");
    expect(result.customerContext?.eligible).toBe(true);
    expect(result.customerContext?.package).toBeDefined();
  });

  it("skips Node 2 reads and synthesis when the case is ineligible", async () => {
    const isEligible = jest.fn().mockReturnValue({
      eligible: false,
      reason: "priority=low below threshold"
    });
    const h = buildDeps({ isCustomerHistoryEligible: isEligible });

    const result = await invoke(h.deps);

    // Cost control: no reads, no model call.
    expect(h.readCustomerContext).not.toHaveBeenCalled();
    expect(h.synthesize).not.toHaveBeenCalled();

    // A present-but-skipped channel is written; the triage path continues.
    expect(result.customerContext?.eligible).toBe(false);
    expect(result.customerContext?.package).toBeUndefined();
    expect(result.customerContext?.eligibilityReason).toContain("priority=low");
    expect(result.writeBackApplied).toBe(true);

    const skipEvent = h.emitRunning.mock.calls.find(
      (call) => call[3] === CUSTOMER_HISTORY_NODE_ID
    );
    expect(skipEvent?.[1]).toContain("skipped");
  });

  it("flags degraded mode when reads report missing sources", async () => {
    const readCustomerContext = jest.fn().mockResolvedValue({
      bundle: {
        source: "soql",
        missingSources: ["entitlement", "warranty"]
      },
      externalSignals: [],
      degradedSources: ["erp"]
    });
    const h = buildDeps({ readCustomerContext });

    const result = await invoke(h.deps);

    expect(result.customerContext?.degraded).toBe(true);
    expect(result.customerContext?.degradedSources).toEqual([
      "entitlement",
      "warranty",
      "erp"
    ]);
  });
});

describe("case-triage graph — Node 4 parts & logistics", () => {
  it("runs after knowledge, writes only partsLogistics, and never interrupts", async () => {
    const planPartsLogistics = jest.fn().mockResolvedValue({
      eligible: true,
      degraded: false,
      status: "PARTIAL",
      fulfillmentReadiness: "partial",
      partPlans: [
        {
          partNumber: "SP-BATT-15X",
          requestedQuantity: 1,
          compatibility: "confirmed",
          compatibilityEvidence: "match",
          availability: "unavailable",
          exceptionType: "inter_warehouse_transfer",
          reservationStatus: "planned",
          transferRequired: true,
          confidence: "high",
          requiredApproval: false,
          rationale: "transfer planned"
        }
      ]
    });
    const h = buildDeps({
      isPartsLogisticsEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "enabled" }),
      planPartsLogistics
    });

    const result = await invoke(h.deps);

    // Node 4 ran once and the graph continued to write-back (non-blocking).
    expect(planPartsLogistics).toHaveBeenCalledTimes(1);
    expect(result.partsLogistics?.status).toBe("PARTIAL");
    expect(result.writeBackApplied).toBe(true);

    // It wrote ONLY its own channel; upstream channels are untouched.
    expect(result.triage).toBeDefined();
    expect(result.customerContext?.eligible).toBe(true);

    // Every Node 4 progress line is tagged with the parts-logistics node.
    const node4Events = h.emitRunning.mock.calls.filter(
      (call) => call[3] === PARTS_LOGISTICS_NODE_ID
    );
    expect(node4Events.length).toBeGreaterThanOrEqual(3);
  });

  it("skips Node 4 cleanly when ineligible", async () => {
    const planPartsLogistics = jest.fn();
    const h = buildDeps({
      isPartsLogisticsEligible: jest
        .fn()
        .mockReturnValue({ eligible: false, reason: "disabled" }),
      planPartsLogistics
    });

    const result = await invoke(h.deps);

    expect(planPartsLogistics).not.toHaveBeenCalled();
    expect(result.partsLogistics?.eligible).toBe(false);
    expect(result.writeBackApplied).toBe(true);
  });

  it("4c: applies parts fulfillment in the write-back and merges the channel", async () => {
    const plannedChannel = {
      eligible: true,
      degraded: false,
      status: "PARTIAL",
      fulfillmentReadiness: "partial",
      partPlans: [
        {
          partNumber: "SP-BATT-15X",
          requestedQuantity: 1,
          exceptionType: "inter_warehouse_transfer",
          reservationStatus: "planned",
          requiredApproval: false
        }
      ]
    };
    const appliedChannel = {
      ...plannedChannel,
      partPlans: [
        {
          ...plannedChannel.partPlans[0],
          reservationStatus: "transfer_pending",
          fulfillmentRecordType: "ProductTransfer",
          fulfillmentRecordId: "0a9000000000001"
        }
      ],
      writeOutcome: {
        applied: true,
        degraded: false,
        createdCount: 1,
        idempotentSkipCount: 0
      }
    };
    const applyPartsFulfillment = jest
      .fn()
      .mockResolvedValue(appliedChannel as any);
    const h = buildDeps({
      isPartsLogisticsEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "enabled" }),
      planPartsLogistics: jest.fn().mockResolvedValue(plannedChannel as any),
      applyPartsFulfillment
    });

    const result = await invoke(h.deps);

    expect(applyPartsFulfillment).toHaveBeenCalledTimes(1);
    expect(result.writeBackApplied).toBe(true);
    expect(result.partsLogistics?.writeOutcome?.applied).toBe(true);
    expect(result.partsLogistics?.partPlans?.[0].reservationStatus).toBe(
      "transfer_pending"
    );
  });

  it("4c: does not apply parts fulfillment when the gate is rejected", async () => {
    const applyPartsFulfillment = jest.fn().mockResolvedValue(undefined);
    const h = buildDeps({
      evaluateGuardrailPolicy: () => decisionFor("requireHumanApproval"),
      isPartsLogisticsEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "enabled" }),
      planPartsLogistics: jest.fn().mockResolvedValue({
        eligible: true,
        degraded: false,
        partPlans: [
          {
            partNumber: "SP-BATT-15X",
            requestedQuantity: 1,
            exceptionType: "backorder",
            reservationStatus: "planned",
            requiredApproval: true
          }
        ]
      } as any),
      applyPartsFulfillment
    });

    const graph = buildCaseTriageGraph(h.deps);
    const config = { configurable: { thread_id: "wf-reject-4c" } };
    await graph.invoke(
      {
        workflowId: "wf-reject-4c",
        caseId: "500000000000001",
        principalSubject: "orchestrator",
        approvalRequired: false,
        writeBackApplied: false,
        status: "running"
      },
      config
    );
    const result = (await graph.invoke(
      new Command({ resume: "rejected" }),
      config
    )) as any;

    expect(applyPartsFulfillment).not.toHaveBeenCalled();
    expect(result.status).toBe("rejected");
  });
});

describe("case-triage graph — Node 5 scheduling", () => {
  const schedulableChannel = {
    eligible: true,
    degraded: false,
    status: "PLANNED",
    schedulingReadiness: "schedulable",
    recommendedResourceReference: "SR-A1",
    candidates: [
      {
        resourceReference: "SR-A1",
        matchedSkills: ["Battery/Power"],
        skillScore: 0.85,
        availabilityScore: 1,
        territoryFitScore: 0.7,
        rankScore: 0.7,
        rank: 1,
        rationale: "best skill match"
      }
    ],
    proposedWindow: {
      earliestStart: "2026-06-16T12:00:00.000Z",
      earliestStartBasis: "parts_eta",
      proposedStart: "2026-06-16T13:00:00.000Z",
      proposedEnd: "2026-06-16T15:00:00.000Z",
      displayWindow: "Tomorrow 13:00–15:00 UTC",
      windowConfidence: "high",
      partsEtaConstrained: true
    },
    partsEtaConsidered: true,
    partsReadinessSeen: "ready",
    requiredApproval: false,
    appointmentStatus: "proposed"
  };

  it("B1/B2: runs after parts, writes only scheduling, never interrupts", async () => {
    const planScheduling = jest.fn().mockResolvedValue(schedulableChannel);
    const planPartsLogistics = jest.fn().mockResolvedValue({
      eligible: true,
      degraded: false,
      status: "PLANNED",
      fulfillmentReadiness: "ready",
      partPlans: []
    });
    const h = buildDeps({
      isPartsLogisticsEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "enabled" }),
      planPartsLogistics,
      isSchedulingEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "enabled" }),
      planScheduling
    });

    const result = await invoke(h.deps);

    // Node 5 ran once and the graph continued to write-back (non-blocking).
    expect(planScheduling).toHaveBeenCalledTimes(1);
    // It received the upstream parts channel (gated on parts ETA).
    expect(planScheduling.mock.calls[0][2]).toMatchObject({
      fulfillmentReadiness: "ready"
    });
    expect(result.scheduling?.schedulingReadiness).toBe("schedulable");
    expect(result.writeBackApplied).toBe(true);

    // It wrote ONLY its own channel; upstream channels are untouched.
    expect(result.triage).toBeDefined();
    expect(result.partsLogistics?.status).toBe("PLANNED");

    // Every Node 5 progress line is tagged with the scheduling node.
    const node5Events = h.emitRunning.mock.calls.filter(
      (call) => call[3] === SCHEDULING_NODE_ID
    );
    expect(node5Events.length).toBeGreaterThanOrEqual(3);
  });

  it("B11: skips Node 5 cleanly when ineligible (flag off)", async () => {
    const planScheduling = jest.fn();
    const h = buildDeps({
      isSchedulingEligible: jest.fn().mockReturnValue({
        eligible: false,
        reason: "Scheduling disabled by config"
      }),
      planScheduling
    });

    const result = await invoke(h.deps);

    expect(planScheduling).not.toHaveBeenCalled();
    expect(result.scheduling?.eligible).toBe(false);
    expect(result.writeBackApplied).toBe(true);
  });

  it("5c: books the appointment in the write-back and merges the channel", async () => {
    const applySchedulingWrite = jest.fn().mockResolvedValue({
      ...schedulableChannel,
      appointmentStatus: "booked",
      appointmentReference: "SA-0007"
    });
    const h = buildDeps({
      isSchedulingEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "enabled" }),
      planScheduling: jest.fn().mockResolvedValue(schedulableChannel),
      applySchedulingWrite
    });

    const result = await invoke(h.deps);

    // 5c write runs in the post-approval write-back with the planned channel.
    expect(applySchedulingWrite).toHaveBeenCalledTimes(1);
    expect(applySchedulingWrite.mock.calls[0][3]).toMatchObject({
      schedulingReadiness: "schedulable"
    });
    expect(result.writeBackApplied).toBe(true);
    expect(result.scheduling?.appointmentStatus).toBe("booked");
    expect(result.scheduling?.appointmentReference).toBe("SA-0007");
  });

  it("5c: does not book the appointment when the gate is rejected", async () => {
    const applySchedulingWrite = jest.fn().mockResolvedValue(undefined);
    const h = buildDeps({
      evaluateGuardrailPolicy: () => decisionFor("requireHumanApproval"),
      isSchedulingEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "enabled" }),
      planScheduling: jest.fn().mockResolvedValue(schedulableChannel),
      applySchedulingWrite
    });

    const graph = buildCaseTriageGraph(h.deps);
    const config = { configurable: { thread_id: "wf-reject-5c" } };
    await graph.invoke(
      {
        workflowId: "wf-reject-5c",
        caseId: "500000000000001",
        principalSubject: "orchestrator",
        approvalRequired: false,
        writeBackApplied: false,
        status: "running"
      },
      config
    );
    const result = (await graph.invoke(
      new Command({ resume: "rejected" }),
      config
    )) as any;

    expect(applySchedulingWrite).not.toHaveBeenCalled();
    expect(result.status).toBe("rejected");
  });
});

describe("case-triage graph — Node 6 compliance & guardrail", () => {
  it("autoApprove: replaces gate, writes the guardrail channel, no interrupt", async () => {
    const h = buildDeps(); // default policy = autoApprove
    const result = (await invoke(h.deps, "wf-guardrail-auto")) as any;

    expect(result.guardrail?.outcome).toBe("autoApprove");
    expect(result.guardrail?.requiresHumanApproval).toBe(false);
    expect(result.approvalDecision).toBe("approved");
    expect(result.writeBackApplied).toBe(true);

    // Node 6 emits at least one progress line tagged with its node id so
    // the UI stage lights up.
    const node6Events = h.emitRunning.mock.calls.filter(
      (call) => call[3] === GUARDRAIL_NODE_ID
    );
    expect(node6Events.length).toBeGreaterThanOrEqual(1);
  });

  it("requireHumanApproval: interrupts, then resume approved reaches write-back", async () => {
    const sendApprovalNotification = jest
      .fn()
      .mockResolvedValue({ method: "log_only" });
    const h = buildDeps({
      evaluateGuardrailPolicy: () => decisionFor("requireHumanApproval"),
      sendApprovalNotification
    });
    const graph = buildCaseTriageGraph(h.deps);
    const config = { configurable: { thread_id: "wf-guardrail-approve" } };

    const interrupted = (await graph.invoke(
      {
        workflowId: "wf-guardrail-approve",
        caseId: "500000000000001",
        principalSubject: "orchestrator",
        approvalRequired: false,
        writeBackApplied: false,
        status: "running"
      },
      config
    )) as any;

    // Node 6 is the only interrupting node; the graph paused here.
    expect(interrupted.__interrupt__).toBeDefined();
    expect(interrupted.writeBackApplied).not.toBe(true);
    expect(h.applyWriteBack).not.toHaveBeenCalled();
    expect(sendApprovalNotification).toHaveBeenCalledTimes(1);

    const resumed = (await graph.invoke(
      new Command({ resume: "approved" }),
      config
    )) as any;
    expect(resumed.guardrail?.outcome).toBe("requireHumanApproval");
    expect(resumed.approvalDecision).toBe("approved");
    expect(resumed.writeBackApplied).toBe(true);
  });

  it("requireHumanApproval: builds the SF approval context and forwards it to the notification (6b+)", async () => {
    const sendApprovalNotification = jest
      .fn()
      .mockResolvedValue({ method: "salesforce_approval", sentAt: "t" });
    const approvalContext = {
      verdict: {
        headline: "Approval required",
        summary: "s",
        recommendedSteps: ["step"],
        highlights: [{ label: "Risk", value: "45 (medium)" }]
      },
      orchestrationConsoleUrl: "https://ui.example.com/orchestration?caseId=x"
    };
    const buildApprovalContext = jest.fn().mockReturnValue(approvalContext);
    const h = buildDeps({
      evaluateGuardrailPolicy: () => decisionFor("requireHumanApproval"),
      sendApprovalNotification,
      buildApprovalContext
    });
    const graph = buildCaseTriageGraph(h.deps);
    const config = { configurable: { thread_id: "wf-guardrail-sf-ctx" } };

    await graph.invoke(
      {
        workflowId: "wf-guardrail-sf-ctx",
        caseId: "500000000000001",
        principalSubject: "orchestrator",
        approvalRequired: false,
        writeBackApplied: false,
        status: "running"
      },
      config
    );

    expect(buildApprovalContext).toHaveBeenCalledTimes(1);
    // The context is the 4th arg of the notification call.
    expect(sendApprovalNotification.mock.calls[0][3]).toBe(approvalContext);
  });

  it("escalate: routes to the escalated terminal, notifies, no interrupt, no write-back", async () => {
    const sendEscalationNotification = jest.fn().mockResolvedValue(undefined);
    const h = buildDeps({
      evaluateGuardrailPolicy: () => decisionFor("escalate"),
      sendEscalationNotification
    });
    const result = (await invoke(h.deps, "wf-guardrail-escalate")) as any;

    expect(result.status).toBe("escalated");
    expect(result.approvalDecision).toBe("escalated");
    expect(result.writeBackApplied).not.toBe(true);
    expect(h.applyWriteBack).not.toHaveBeenCalled();
    // 6b — the terminal escalate path fires the supervisor notice exactly once.
    expect(sendEscalationNotification).toHaveBeenCalledTimes(1);
  });

  it("requireHumanApproval: graph guard skips re-notifying when routing already has sentAt", async () => {
    // Simulate the resume re-run AFTER the channel committed: state already
    // carries approvalRouting.sentAt, so the node must NOT call the dep again.
    // (The first-resume case, where the channel is NOT yet committed, is
    // covered by the notification service's own idempotency map.)
    const sendApprovalNotification = jest
      .fn()
      .mockResolvedValue({ method: "log_only" });
    const h = buildDeps({
      evaluateGuardrailPolicy: () => decisionFor("requireHumanApproval"),
      sendApprovalNotification
    });
    const graph = buildCaseTriageGraph(h.deps);
    const config = { configurable: { thread_id: "wf-guardrail-guard" } };
    const interrupted = (await graph.invoke(
      {
        workflowId: "wf-guardrail-guard",
        caseId: "500000000000001",
        principalSubject: "orchestrator",
        approvalRequired: false,
        writeBackApplied: false,
        status: "running",
        guardrail: {
          eligible: true,
          outcome: "requireHumanApproval",
          riskScore: 50,
          riskLevel: "medium",
          policyRulesEvaluated: [],
          policyRulesTriggered: [],
          channelBasis: [],
          requiresHumanApproval: true,
          approvalRequired: true,
          approvalReasons: [],
          degraded: false,
          approvalRouting: {
            method: "email",
            sentAt: "2026-06-18T00:00:00.000Z"
          }
        }
      } as any,
      config
    )) as any;

    expect(interrupted.__interrupt__).toBeDefined();
    expect(sendApprovalNotification).not.toHaveBeenCalled();
  });

  it("reject (policy): routes to rejected without an interrupt", async () => {
    const h = buildDeps({
      evaluateGuardrailPolicy: () => decisionFor("reject")
    });
    const result = (await invoke(h.deps, "wf-guardrail-reject")) as any;

    expect(result.status).toBe("rejected");
    expect(result.approvalDecision).toBe("rejected");
    expect(h.applyWriteBack).not.toHaveBeenCalled();
  });

  it("stop AI (6c/RC-1): stopped_by_user → stopped terminal before policy, no interrupt/submit/write-back", async () => {
    // The operator took the Case over even though the policy would otherwise
    // require approval. The stop check at the top of evaluateGuardrail must
    // short-circuit BEFORE the policy, notification, interrupt, and write-back.
    const evaluateGuardrailPolicy = jest.fn(() =>
      decisionFor("requireHumanApproval")
    );
    const sendApprovalNotification = jest
      .fn()
      .mockResolvedValue({ method: "log_only" });
    const sendEscalationNotification = jest.fn().mockResolvedValue(undefined);
    const h = buildDeps({
      readContext: jest.fn().mockResolvedValue({
        ...buildContext(),
        orchestrationStatus: "stopped_by_user"
      }),
      evaluateGuardrailPolicy,
      sendApprovalNotification,
      sendEscalationNotification
    });

    const result = (await invoke(h.deps, "wf-guardrail-stopped")) as any;

    expect(result.status).toBe("stopped");
    expect(result.__interrupt__).toBeUndefined();
    expect(result.guardrail).toBeUndefined();
    expect(result.approvalDecision).toBeUndefined();
    expect(evaluateGuardrailPolicy).not.toHaveBeenCalled();
    expect(sendApprovalNotification).not.toHaveBeenCalled();
    expect(sendEscalationNotification).not.toHaveBeenCalled();
    expect(h.applyWriteBack).not.toHaveBeenCalled();
    // Node 6 still emits one progress line so the UI stage reflects the stop.
    const node6Events = h.emitRunning.mock.calls.filter(
      (call) => call[3] === GUARDRAIL_NODE_ID
    );
    expect(node6Events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("case-triage graph — stepped mode (Phase 2)", () => {
  const initialState = (workflowId: string) => ({
    workflowId,
    caseId: "500000000000001",
    caseNumber: "00004242",
    principalSubject: "orchestrator",
    approvalRequired: false,
    writeBackApplied: false,
    status: "running" as const
  });

  it("runs Triage (with customer read) then pauses after each upstream stage", async () => {
    const h = buildDeps({
      // Force customer read to actually run so the merged pause is observable.
      isCustomerHistoryEligible: jest
        .fn()
        .mockReturnValue({ eligible: true, reason: "eligible" })
    });
    const graph = buildCaseTriageGraph(h.deps, { stepped: true });
    const config = { configurable: { thread_id: "wf-step-1" } };

    // Initial invoke auto-runs Triage (readContext + runTriage, which now
    // includes customer read + synthesis), then pauses before knowledge.
    const afterTriage = (await graph.invoke(
      initialState("wf-step-1"),
      config
    )) as { triage?: unknown; customerContext?: unknown };
    expect(afterTriage.triage).toBeDefined();
    expect(afterTriage.customerContext).toBeDefined();
    expect((await graph.getState(config)).next).toEqual(["knowledge"]);

    // Each advance steps one stage at a time toward the guardrail.
    await graph.invoke(null, config); // knowledge
    expect((await graph.getState(config)).next).toEqual(["parts"]);
    await graph.invoke(null, config); // parts
    expect((await graph.getState(config)).next).toEqual(["schedule"]);
    await graph.invoke(null, config); // schedule
    expect((await graph.getState(config)).next).toEqual(["evaluateGuardrail"]);
  });

  it("completes on the final advance when the guardrail auto-approves", async () => {
    const h = buildDeps(); // default guardrail outcome is autoApprove
    const graph = buildCaseTriageGraph(h.deps, { stepped: true });
    const config = { configurable: { thread_id: "wf-step-2" } };

    await graph.invoke(initialState("wf-step-2"), config); // Triage (merged), pause
    // Advance through knowledge → parts → schedule → guardrail (3 steps).
    for (let i = 0; i < 3; i += 1) {
      await graph.invoke(null, config);
    }
    expect((await graph.getState(config)).next).toEqual(["evaluateGuardrail"]);

    const final = (await graph.invoke(null, config)) as {
      writeBackApplied?: boolean;
      __interrupt__?: unknown;
    };
    expect(final.__interrupt__).toBeUndefined();
    expect(final.writeBackApplied).toBe(true);
    expect((await graph.getState(config)).next).toEqual([]);
  });

  it("the auto graph never pauses mid-pipeline (unchanged behaviour)", async () => {
    const h = buildDeps();
    const graph = buildCaseTriageGraph(h.deps); // no stepped option
    const config = { configurable: { thread_id: "wf-auto-1" } };
    const result = (await graph.invoke(initialState("wf-auto-1"), config)) as {
      writeBackApplied?: boolean;
    };
    // Ran end-to-end in one invoke; nothing pending.
    expect(result.writeBackApplied).toBe(true);
    expect((await graph.getState(config)).next).toEqual([]);
  });
});

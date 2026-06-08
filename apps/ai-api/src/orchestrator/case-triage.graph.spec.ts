import { MemorySaver } from "@langchain/langgraph";

import { buildCaseTriageGraph } from "./case-triage.graph";
import type { CaseTriageGraphDeps } from "./case-triage.graph";
import { CUSTOMER_HISTORY_NODE_ID } from "./dto/case-triage-lifecycle";
import type {
  CustomerContextSynthesis,
  CustomerHistoryReadResult
} from "./dto/customer-context";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type { SanitizedTriageResult } from "./dto/orchestration-status-event";

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
    requiresApproval: () => false,
    isCustomerHistoryEligible: isEligible,
    readCustomerContext,
    synthesizeCustomerHistory: synthesize,
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
  it("advances readContext -> runTriage -> customerHistory -> gate -> writeBack", async () => {
    const h = buildDeps();
    const result = await invoke(h.deps);

    // Node 2 ran with the case's Account scope and the triage hint.
    expect(h.readCustomerContext).toHaveBeenCalledTimes(1);
    expect(h.readCustomerContext.mock.calls[0][0]).toMatchObject({
      accountId: ACCOUNT_ID
    });
    expect(h.synthesize).toHaveBeenCalledTimes(1);
    expect(h.synthesize.mock.calls[0][0].triagePriority).toBe("critical");

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

  it("still runs Node 2 when triage output is absent (triage is a hint)", async () => {
    // Simulate a degraded triage that yields no usable result.
    const runTriage = jest
      .fn()
      .mockResolvedValue(undefined as unknown as SanitizedTriageResult);
    const h = buildDeps({ runTriage });

    const result = await invoke(h.deps);

    // Node 2 still reads and synthesizes; the triage hint is undefined.
    expect(h.readCustomerContext).toHaveBeenCalledTimes(1);
    expect(h.synthesize).toHaveBeenCalledTimes(1);
    expect(h.synthesize.mock.calls[0][0].triagePriority).toBeUndefined();
    expect(result.customerContext?.eligible).toBe(true);
    expect(result.customerContext?.package).toBeDefined();
  });

  it("skips Node 2 reads and synthesis when the case is ineligible", async () => {
    const isEligible = jest
      .fn()
      .mockReturnValue({
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

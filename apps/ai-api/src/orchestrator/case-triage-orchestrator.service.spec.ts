import type { AppConfigService } from "../config/app-config.service";
import type { TelemetryService } from "../observability/telemetry.service";
import type { SupportTriageService } from "../agents/support-triage.service";
import type { CustomerHistorySynthesisService } from "../agents/customer-history.service";
import type { SalesforceCaseGateway } from "../salesforce/salesforce-case.gateway";
import type { SalesforceCustomerGateway } from "../salesforce/salesforce-customer.gateway";
import type { SalesforceInventoryGateway } from "../salesforce/salesforce-inventory.gateway";
import type { SalesforceFulfillmentGateway } from "../salesforce/salesforce-fulfillment.gateway";
import type { SalesforceSchedulingGateway } from "../salesforce/salesforce-scheduling.gateway";
import type { SalesforceSchedulingWriteGateway } from "../salesforce/salesforce-scheduling-write.gateway";
import { SalesforceGatewayError } from "../salesforce/salesforce-gateway.error";
import { CaseTriageOrchestratorService } from "./case-triage-orchestrator.service";
import { PartsLogisticsPlannerService } from "./parts-logistics-planner.service";
import { SchedulingPlannerService } from "./scheduling-planner.service";
import { GuardrailPolicyService } from "./guardrail-policy.service";
import type { GuardrailApprovalNotificationService } from "./guardrail-approval-notification.service";
import type { CaseTriageStateType } from "./case-triage.graph";
import type { GuardrailDecision } from "./dto/guardrail";

/**
 * Guardrail fake for the orchestrator plumbing tests. It mirrors the
 * pre-Node-6 gate semantics keyed on the legacy approval mode (+ any
 * parts-plan approval flag) so the trigger/resume/persistence tests keep
 * their original intent. The real composite matrix is covered exhaustively
 * by guardrail-policy.service.spec.ts.
 */
function guardrailDecisionForMode(
  mode: TriageApprovalMode,
  state: CaseTriageStateType
): GuardrailDecision {
  const partsNeedApproval = (state.partsLogistics?.partPlans ?? []).some(
    (plan) => plan.requiredApproval
  );
  const priorityHigh =
    state.triage?.recommendedPriority === "high" ||
    state.triage?.recommendedPriority === "critical";
  const requiresApproval =
    mode === "always" ||
    partsNeedApproval ||
    (mode === "high_risk" && priorityHigh);
  return {
    outcome: requiresApproval ? "requireHumanApproval" : "autoApprove",
    riskScore: requiresApproval ? 50 : 0,
    riskLevel: requiresApproval ? "medium" : "low",
    allRules: [],
    triggeredRules: [],
    channelBasis: [],
    approvalReasons: requiresApproval ? ["Approval required for test."] : [],
    latencyMs: 0
  };
}
import { ExternalContextAdapterRegistry } from "./adapters/external-context.adapter";
import {
  InMemoryOrchestrationStatusRepository,
  OrchestrationStatusRepository
} from "./orchestration-status.repository";
import { OrchestrationStatusStore } from "./orchestration-status.store";
import type { TriageApprovalMode } from "../config/app-config.service";
import type { CustomerContextSynthesis } from "./dto/customer-context";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";

const SECRET_DESCRIPTION =
  "Customer Jane Doe jane@example.com lost power; account ACCT-99 secret-detail.";

/** Empty knowledge extraction for the KnowledgeGuidanceExtractor fake. */
function emptyExtraction() {
  return {
    recommendedActions: [],
    suggestedParts: [],
    safetyFlags: []
  };
}

/** A complete, fully-abstained Customer Context Package for Node 2 fakes. */
function buildAbstainedSynthesis(): CustomerContextSynthesis {
  const abstain = <T>(value: T) => ({
    value,
    confidence: "low" as const,
    provenance: "none",
    evidenceBasis: "not evidenced",
    assertedVsInferred: "inferred" as const,
    notEvidenced: true
  });
  return {
    package: {
      customerTier: abstain("unknown" as const),
      slaClass: abstain("unknown" as const),
      warrantyStatus: abstain("unknown" as const),
      repeatIncident: abstain({ repeat: false, count: 0, windowDays: 0 }),
      strategicAccount: abstain(false),
      installedAssets: abstain({ totalAssets: 0, modelCount: 0 }),
      openIncidentCount: abstain(0),
      escalationHistory: abstain(0),
      businessRisk: abstain("unknown" as const)
    },
    fallbackUsed: false,
    latencyMs: 1
  };
}

function buildContext(
  overrides: Partial<SalesforceCaseContext> = {}
): SalesforceCaseContext {
  return {
    caseId: "500000000000001",
    caseNumber: "00004242",
    subject: "Outage",
    description: SECRET_DESCRIPTION,
    status: "New",
    origin: "Web",
    reportedPriority: "high",
    ...overrides
  };
}

interface Harness {
  service: CaseTriageOrchestratorService;
  store: OrchestrationStatusStore;
  repository: OrchestrationStatusRepository;
  readCaseContext: jest.Mock;
  readOrchestrationStatus: jest.Mock;
  writeOrchestrationStop: jest.Mock;
  applyWriteBack: jest.Mock;
  writeTriageTracking: jest.Mock;
  triage: jest.Mock;
  synthesize: jest.Mock;
  readCustomerBundle: jest.Mock;
  recordAgentWorkflow: jest.Mock;
  applyFulfillment: jest.Mock;
  applyAppointment: jest.Mock;
}

function buildHarness(
  approvalMode: TriageApprovalMode = "auto",
  contextOverrides: Partial<SalesforceCaseContext> = {},
  writeBackOverrides: { enabled?: boolean; uiBaseUrl?: string } = {},
  partsOverrides: { enabled?: boolean; writesEnabled?: boolean } = {},
  fulfillmentOverrides: {
    applyFulfillment?: jest.Mock;
  } = {},
  schedulingOverrides: {
    enabled?: boolean;
    writesEnabled?: boolean;
    readSchedulingContext?: jest.Mock;
  } = {},
  schedulingWriteOverrides: {
    applyAppointment?: jest.Mock;
  } = {}
): Harness {
  const readCaseContext = jest
    .fn()
    .mockResolvedValue(buildContext(contextOverrides));
  const applyWriteBack = jest.fn().mockResolvedValue({
    applied: true,
    priorityUpdated: true,
    commentCreated: true
  });
  const writeTriageTracking = jest.fn().mockResolvedValue(undefined);
  // RC-1: default to active (undefined) so existing trigger tests proceed.
  // A stopped-Case override drives the /triggers 409 refuse path.
  const readOrchestrationStatus = jest.fn().mockResolvedValue(undefined);
  const writeOrchestrationStop = jest.fn().mockResolvedValue(undefined);
  const writeOrchestrationSuppressed = jest.fn().mockResolvedValue(undefined);
  const gateway = {
    isConfigured: () => true,
    readCaseContext,
    applyWriteBack,
    writeTriageTracking,
    readOrchestrationStatus,
    writeOrchestrationStop,
    writeOrchestrationSuppressed
  } as unknown as SalesforceCaseGateway;

  const triage = jest.fn().mockResolvedValue({
    recommendedPriority: "critical",
    summary: "Outage affecting service; needs network team.",
    suggestedNextStep: "Route to network operations and notify on-call.",
    provider: "openai",
    model: "gpt-4o-mini",
    fallbackUsed: false,
    latencyMs: 42
  });
  const supportTriage = { triage } as unknown as SupportTriageService;

  const repository = new InMemoryOrchestrationStatusRepository();
  const store = new OrchestrationStatusStore(repository);
  const recordAgentWorkflow = jest.fn();
  const telemetry = {
    recordAgentWorkflow
  } as unknown as TelemetryService;

  const config = {
    orchestrator: {
      triageApprovalMode: approvalMode,
      salesforceWriteBack: {
        enabled: writeBackOverrides.enabled ?? false,
        uiBaseUrl: writeBackOverrides.uiBaseUrl
      },
      customerHistory: {
        eligibility: {},
        dataCloud: { enabled: false },
        externalAdapters: {
          erpEnabled: false,
          serviceNowEnabled: false,
          telemetryEnabled: false
        }
      },
      knowledge: {
        enabled: false,
        namespace: "customer-self-service",
        queryMaxChars: 200,
        retrievalTopK: 5,
        scoreThreshold: 0.65,
        extractionEnabled: false
      },
      partsLogistics: {
        enabled: partsOverrides.enabled ?? false,
        writesEnabled: partsOverrides.writesEnabled ?? false
      },
      scheduling: {
        enabled: schedulingOverrides.enabled ?? false,
        candidatesApiEnabled: false,
        writesEnabled: schedulingOverrides.writesEnabled ?? false
      }
    },
    rag: {
      enabled: false,
      defaultNamespace: "customer-self-service"
    },
    salesforceConnection: { enabled: true }
  } as unknown as AppConfigService;

  const readCustomerBundle = jest.fn().mockResolvedValue({
    source: "none",
    missingSources: [
      "account",
      "entitlement",
      "warranty",
      "installed_assets",
      "service_history"
    ]
  });
  const customerGateway = {
    isConfigured: () => true,
    isDataCloudConfigured: () => false,
    readCustomer360Bundle: jest.fn().mockResolvedValue(undefined),
    readCustomerBundle
  } as unknown as SalesforceCustomerGateway;
  const synthesize = jest.fn().mockResolvedValue(buildAbstainedSynthesis());
  const customerHistory = {
    synthesize
  } as unknown as CustomerHistorySynthesisService;
  const externalAdapters = {
    readAll: jest.fn().mockResolvedValue({ signals: [], degradedSources: [] })
  } as unknown as ExternalContextAdapterRegistry;

  const inventoryGateway = {
    isConfigured: () => true,
    readStockForParts: jest
      .fn()
      .mockResolvedValue({ source: "none", rows: [], degraded: false })
  } as unknown as SalesforceInventoryGateway;
  const partsPlanner = new PartsLogisticsPlannerService();
  const applyFulfillment =
    fulfillmentOverrides.applyFulfillment ??
    jest.fn().mockResolvedValue({ applied: false, degraded: false, items: [] });
  const fulfillmentGateway = {
    isConfigured: () => true,
    applyFulfillment
  } as unknown as SalesforceFulfillmentGateway;
  const schedulingGateway = {
    isConfigured: () => true,
    readSchedulingContext:
      schedulingOverrides.readSchedulingContext ??
      jest.fn().mockResolvedValue({
        source: "none",
        technicians: [],
        businessWindows: [],
        busyIntervals: [],
        degraded: false
      })
  } as unknown as SalesforceSchedulingGateway;
  const applyAppointment =
    schedulingWriteOverrides.applyAppointment ??
    jest.fn().mockResolvedValue({
      applied: false,
      degraded: false,
      booked: false,
      idempotentSkip: false,
      appointmentStatus: "none"
    });
  const schedulingWriteGateway = {
    isConfigured: () => true,
    applyAppointment
  } as unknown as SalesforceSchedulingWriteGateway;
  const schedulingPlanner = new SchedulingPlannerService();
  const guardrailPolicy = {
    evaluate: jest.fn((state: CaseTriageStateType) =>
      guardrailDecisionForMode(approvalMode, state)
    )
  } as unknown as GuardrailPolicyService;
  // Log-only notification fake — keeps the trigger/resume/persistence tests
  // unchanged. The real email routing + idempotency live in
  // guardrail-approval-notification.service.spec.ts.
  const approvalNotifications = {
    notifyApprovalRequired: jest.fn().mockResolvedValue({ method: "log_only" }),
    notifyEscalation: jest.fn().mockResolvedValue(undefined)
  } as unknown as GuardrailApprovalNotificationService;
  const agentCaseComments = {
    postAgentNarrative: jest.fn().mockResolvedValue(undefined),
    postAllForAutoApproval: jest.fn().mockResolvedValue(undefined)
  } as unknown as import("./agent-case-comment.service").AgentCaseCommentService;

  const service = new CaseTriageOrchestratorService(
    gateway,
    customerGateway,
    supportTriage,
    customerHistory,
    {} as any, // ragRetrieval mock
    {} as any, // ragAnswer mock
    {} as any, // knowledgeQueryBuilder mock
    externalAdapters,
    store,
    telemetry,
    config,
    { extract: jest.fn().mockResolvedValue(emptyExtraction()) } as any,
    inventoryGateway,
    partsPlanner,
    fulfillmentGateway,
    schedulingGateway,
    schedulingWriteGateway,
    schedulingPlanner,
    guardrailPolicy,
    approvalNotifications,
    agentCaseComments
  );

  return {
    service,
    store,
    repository,
    readCaseContext,
    readOrchestrationStatus,
    writeOrchestrationStop,
    applyWriteBack,
    writeTriageTracking,
    triage,
    synthesize,
    readCustomerBundle,
    recordAgentWorkflow,
    applyFulfillment,
    applyAppointment
  };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1000
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for workflow state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function statusOf(
  service: CaseTriageOrchestratorService,
  workflowId: string
): Promise<string> {
  return (await service.getSnapshot(workflowId)).status;
}

describe("CaseTriageOrchestratorService", () => {
  it("runs assigned -> running -> done and applies the gated write-back (auto mode)", async () => {
    const h = buildHarness("auto");

    const accepted = await h.service.trigger({
      caseId: "500000000000001",
      caseNumber: "00004242"
    });
    expect(accepted.status).toBe("assigned");
    expect(accepted.workflowId).toMatch(/^wf-/);

    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    expect(snapshot.writeBackApplied).toBe(true);
    expect(snapshot.triage?.recommendedPriority).toBe("critical");
    expect(h.readCaseContext).toHaveBeenCalledWith("500000000000001");
    expect(h.applyWriteBack).toHaveBeenCalledTimes(1);

    const statuses = snapshot.events.map((e) => e.status);
    expect(statuses[0]).toBe("assigned");
    expect(statuses).toContain("running");
    expect(statuses[statuses.length - 1]).toBe("done");
  });

  it("refuses a new workflow with 409 when the operator stopped the Case (RC-1)", async () => {
    const h = buildHarness("auto");
    h.readOrchestrationStatus.mockResolvedValueOnce("stopped_by_user");

    let error: { getStatus?: () => number; getResponse?: () => unknown } = {};
    try {
      await h.service.trigger({ caseId: "500000000000001" });
    } catch (e) {
      error = e as typeof error;
    }
    expect(error.getStatus?.()).toBe(409);
    expect(error.getResponse?.()).toMatchObject({
      error: "orchestration_stopped"
    });
    // The refusal short-circuits before any workflow is created or run.
    expect(h.readCaseContext).not.toHaveBeenCalled();
  });

  it("settles to the stopped terminal when the Case is taken over mid-flight (6c-a)", async () => {
    // trigger passes (active at trigger time, default readOrchestrationStatus),
    // but the graph's readContext sees the operator takeover, so the guardrail
    // node reaches the stopped terminal — no interrupt, no write-back.
    const h = buildHarness("always", {
      orchestrationStatus: "stopped_by_user"
    });

    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "stopped"
    );

    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    expect(snapshot.status).toBe("stopped");
    expect(snapshot.writeBackApplied).toBe(false);
    expect(h.applyWriteBack).not.toHaveBeenCalled();
    expect(snapshot.events[snapshot.events.length - 1].status).toBe("stopped");
    // The verdict reflects the manual takeover, not a guardrail rejection.
    expect(snapshot.orchestratorVerdict?.recommendedSteps.join(" ")).toContain(
      "stopped"
    );
  });

  it("stop() flips a waiting_approval workflow to the stopped terminal + writes the Case flag (RC-1a)", async () => {
    const h = buildHarness("always");
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () =>
        (await statusOf(h.service, accepted.workflowId)) === "waiting_approval"
    );

    const result = await h.service.stop("500000000000001", {
      reason: "manual takeover"
    });

    expect(result).toMatchObject({
      caseId: "500000000000001",
      status: "stopped_by_user",
      workflowId: accepted.workflowId
    });
    expect(result.stoppedAt).toEqual(expect.any(String));
    expect(h.writeOrchestrationStop).toHaveBeenCalledWith("500000000000001");

    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    expect(snapshot.status).toBe("stopped");
    expect(snapshot.stoppedAt).toBe(result.stoppedAt);
    expect(snapshot.stopReason).toBe("manual takeover");
    expect(snapshot.orchestratorVerdict?.recommendedSteps.join(" ")).toContain(
      "stopped"
    );
  });

  it("a late resume no-ops after stop — the stopped snapshot is terminal (RC-1a backstop)", async () => {
    const h = buildHarness("always");
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () =>
        (await statusOf(h.service, accepted.workflowId)) === "waiting_approval"
    );
    await h.service.stop("500000000000001", {});

    const resumed = await h.service.resume(accepted.workflowId, {
      decision: "approved",
      idempotencyKey: "late-key"
    });

    expect(resumed.status).toBe("stopped");
    expect(h.applyWriteBack).not.toHaveBeenCalled();
  });

  it("stop() stamps stoppedAt on an already-terminal workflow without changing its status", async () => {
    const h = buildHarness("auto");
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    const result = await h.service.stop("500000000000001", {});

    expect(result.status).toBe("stopped_by_user");
    expect(h.writeOrchestrationStop).toHaveBeenCalledWith("500000000000001");
    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    expect(snapshot.status).toBe("done"); // terminal status preserved
    expect(snapshot.stoppedAt).toBe(result.stoppedAt);
  });

  it("stop() writes the Case flag even when no workflow exists for the Case", async () => {
    const h = buildHarness("auto");
    const result = await h.service.stop("500000000000009", {});

    expect(result).toMatchObject({
      caseId: "500000000000009",
      status: "stopped_by_user"
    });
    expect(result.workflowId).toBeUndefined();
    expect(h.writeOrchestrationStop).toHaveBeenCalledWith("500000000000009");
  });

  it("stop() still succeeds when the Case flag write degrades (snapshot authoritative)", async () => {
    const h = buildHarness("always");
    h.writeOrchestrationStop.mockRejectedValueOnce(new Error("FLS"));
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () =>
        (await statusOf(h.service, accepted.workflowId)) === "waiting_approval"
    );

    const result = await h.service.stop("500000000000001", {});

    expect(result.status).toBe("stopped_by_user");
    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    expect(snapshot.status).toBe("stopped");
  });

  it("attaches safe, non-PII step details to the timeline events", async () => {
    const h = buildHarness("auto");
    const accepted = await h.service.trigger({
      caseId: "500000000000001",
      caseNumber: "00004242"
    });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    const allDetails = snapshot.events.flatMap((e) => e.details ?? []);
    const labels = allDetails.map((d) => d.label);
    // The triage step exposes the same safe facts as the result card.
    expect(labels).toContain("Recommended priority");
    expect(labels).toContain("Provider");
    expect(labels).toContain("Model");
    // The read step exposes only non-PII Case facts.
    expect(labels).toContain("Account linked");
    expect(allDetails.find((d) => d.label === "Account linked")?.value).toBe(
      "No"
    );
    // The completed write-back step reports its outcome.
    expect(labels).toContain("Write-back");

    // Defense in depth: no raw Case text, account id, or email in details.
    const serializedDetails = JSON.stringify(allDetails);
    expect(serializedDetails).not.toContain("secret-detail");
    expect(serializedDetails).not.toContain("jane@example.com");
    expect(serializedDetails).not.toContain("ACCT-99");
  });

  it("pauses at waiting_approval and resumes to done on approval (always mode)", async () => {
    const h = buildHarness("always");

    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () =>
        (await statusOf(h.service, accepted.workflowId)) === "waiting_approval"
    );
    expect(h.applyWriteBack).not.toHaveBeenCalled();

    const resumed = await h.service.resume(accepted.workflowId, {
      decision: "approved",
      idempotencyKey: "approve-1"
    });
    expect(resumed.status).toBe("done");
    expect(resumed.writeBackApplied).toBe(true);
    expect(h.applyWriteBack).toHaveBeenCalledTimes(1);
  });

  it("resumes to rejected without writing back when rejected", async () => {
    const h = buildHarness("always");
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () =>
        (await statusOf(h.service, accepted.workflowId)) === "waiting_approval"
    );

    const resumed = await h.service.resume(accepted.workflowId, {
      decision: "rejected",
      idempotencyKey: "reject-1"
    });
    expect(resumed.status).toBe("rejected");
    expect(resumed.writeBackApplied).toBe(false);
    expect(h.applyWriteBack).not.toHaveBeenCalled();
  });

  it("makes resume idempotent for a repeated decision key", async () => {
    const h = buildHarness("always");
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () =>
        (await statusOf(h.service, accepted.workflowId)) === "waiting_approval"
    );

    await h.service.resume(accepted.workflowId, {
      decision: "approved",
      idempotencyKey: "approve-1"
    });
    // Replay the same key: must not re-apply the write-back.
    const replay = await h.service.resume(accepted.workflowId, {
      decision: "approved",
      idempotencyKey: "approve-1"
    });

    expect(replay.status).toBe("done");
    expect(h.applyWriteBack).toHaveBeenCalledTimes(1);
  });

  it("ignores a late approval once a workflow is terminal", async () => {
    const h = buildHarness("auto");
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    const result = await h.service.resume(accepted.workflowId, {
      decision: "approved",
      idempotencyKey: "late-1"
    });
    expect(result.status).toBe("done");
    expect(h.applyWriteBack).toHaveBeenCalledTimes(1);
  });

  it("fails safely with a coarse kind when the Salesforce read fails", async () => {
    const h = buildHarness("auto");
    h.readCaseContext.mockRejectedValueOnce(
      new SalesforceGatewayError("not_found", "Case not found.")
    );

    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "failed"
    );

    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    expect(snapshot.failureKind).toBe("salesforce_not_found");
    expect(snapshot.writeBackApplied).toBe(false);
    expect(h.applyWriteBack).not.toHaveBeenCalled();
  });

  it("never leaks raw Case text into status events or telemetry", async () => {
    const h = buildHarness("auto");
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    const serializedEvents = JSON.stringify(snapshot.events);
    expect(serializedEvents).not.toContain("secret-detail");
    expect(serializedEvents).not.toContain("jane@example.com");
    expect(JSON.stringify(snapshot)).not.toContain("secret-detail");

    const telemetryPayloads = JSON.stringify(h.recordAgentWorkflow.mock.calls);
    expect(telemetryPayloads).not.toContain("secret-detail");
    expect(telemetryPayloads).not.toContain("jane@example.com");
    expect(h.recordAgentWorkflow).toHaveBeenCalled();
  });

  it("enriches the workflow with a sanitized customer context package (Node 2)", async () => {
    const h = buildHarness("auto", { accountId: "001000000000001" });
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    const snapshot = await h.service.getSnapshot(accepted.workflowId);
    // Node 2 wrote its own channel and a customer-history event exists.
    expect(snapshot.customerContext?.eligible).toBe(true);
    expect(snapshot.customerContext?.package).toBeDefined();
    expect(snapshot.events.some((e) => e.node === "customer_history")).toBe(
      true
    );
    expect(h.readCustomerBundle).toHaveBeenCalledTimes(1);
    // Node 1 is unchanged.
    expect(snapshot.writeBackApplied).toBe(true);

    // The Node 2 channel and its events carry no PII.
    const serialized = JSON.stringify(snapshot.customerContext);
    expect(serialized).not.toContain("secret-detail");
    expect(serialized).not.toContain("jane@example.com");
    expect(serialized).not.toContain("ACCT-99");
  });

  it("forwards the derived customer signals into the triage adapter (Phase B)", async () => {
    const h = buildHarness("auto", { accountId: "001000000000001" });
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    // The adapter mapped the (eligible, abstained) customerContext package
    // onto the triage request — proving the graph → adapter → service seam.
    expect(h.triage).toHaveBeenCalledTimes(1);
    const triageRequest = h.triage.mock.calls[0][0];
    expect(triageRequest.customerSignals).toBeDefined();
    expect(triageRequest.customerSignals).toMatchObject({
      customerTier: "unknown",
      businessRisk: "unknown",
      repeatIncident: { repeat: false, count: 0 },
      degraded: true
    });
    // Evidence-or-abstain: strategic was not evidenced, so it is omitted.
    expect(triageRequest.customerSignals).not.toHaveProperty(
      "strategicAccount"
    );
  });

  it("durably persists the customer context package for restart resolution", async () => {
    const h = buildHarness("auto", { accountId: "001000000000001" });
    const accepted = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    // The durable repository (what a restarted instance reads from)
    // resolves the Case with its Node 2 channel intact.
    const durable = await h.repository.getLatestForCase("500000000000001");
    expect(durable?.workflowId).toBe(accepted.workflowId);
    expect(durable?.customerContext?.eligible).toBe(true);
    expect(durable?.customerContext?.package).toBeDefined();
  });

  it("throws NotFound for an unknown workflow snapshot", async () => {
    const h = buildHarness("auto");
    await expect(h.service.getSnapshot("wf-does-not-exist")).rejects.toThrow();
  });

  it("returns the latest workflow snapshot for a Case Id", async () => {
    const h = buildHarness("auto");
    const first = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, first.workflowId)) === "done"
    );
    // Strictly later updatedAt for the second run avoids a tie.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await h.service.trigger({ caseId: "500000000000001" });
    await waitFor(
      async () => (await statusOf(h.service, second.workflowId)) === "done"
    );

    const latest = await h.service.getLatestSnapshotForCase("500000000000001");
    expect(latest.workflowId).toBe(second.workflowId);
    expect(latest.workflowId).not.toBe(first.workflowId);
  });

  it("resolves the latest Case workflow from the durable store after a restart", async () => {
    const h = buildHarness("auto");
    const accepted = await h.service.trigger({
      caseId: "500000000000001",
      caseNumber: "00004242"
    });
    await waitFor(
      async () => (await statusOf(h.service, accepted.workflowId)) === "done"
    );

    // Simulate an ai-api restart: a fresh store over the SAME durable
    // repository, with an empty in-memory cache, behind a new service.
    const restartedStore = new OrchestrationStatusStore(h.repository);
    const restartedService = new CaseTriageOrchestratorService(
      { isConfigured: () => true } as unknown as SalesforceCaseGateway,
      {
        readCustomerBundle: jest.fn(),
        readCustomer360Bundle: jest.fn()
      } as unknown as SalesforceCustomerGateway,
      { triage: jest.fn() } as unknown as SupportTriageService,
      { synthesize: jest.fn() } as unknown as CustomerHistorySynthesisService,
      {} as any, // ragRetrieval mock
      {} as any, // ragAnswer mock
      {} as any, // knowledgeQueryBuilder mock
      {
        readAll: jest.fn().mockResolvedValue({
          signals: [],
          degradedSources: []
        })
      } as unknown as ExternalContextAdapterRegistry,
      restartedStore,
      { recordAgentWorkflow: jest.fn() } as unknown as TelemetryService,
      {
        orchestrator: {
          triageApprovalMode: "auto",
          salesforceWriteBack: { enabled: false },
          customerHistory: {
            eligibility: {},
            dataCloud: { enabled: false },
            externalAdapters: {
              erpEnabled: false,
              serviceNowEnabled: false,
              telemetryEnabled: false
            }
          },
          knowledge: {
            enabled: false,
            namespace: "customer-self-service",
            queryMaxChars: 200,
            retrievalTopK: 5,
            scoreThreshold: 0.65,
            extractionEnabled: false
          },
          partsLogistics: { enabled: false },
          scheduling: {
            enabled: false,
            candidatesApiEnabled: false,
            writesEnabled: false
          }
        },
        rag: {
          enabled: false,
          defaultNamespace: "customer-self-service"
        },
        salesforceConnection: { enabled: true }
      } as unknown as AppConfigService,
      { extract: jest.fn().mockResolvedValue(emptyExtraction()) } as any,
      {
        isConfigured: () => true,
        readStockForParts: jest
          .fn()
          .mockResolvedValue({ source: "none", rows: [], degraded: false })
      } as unknown as SalesforceInventoryGateway,
      new PartsLogisticsPlannerService(),
      {
        isConfigured: () => true,
        applyFulfillment: jest
          .fn()
          .mockResolvedValue({ applied: false, degraded: false, items: [] })
      } as unknown as SalesforceFulfillmentGateway,
      {
        isConfigured: () => true,
        readSchedulingContext: jest.fn().mockResolvedValue({
          source: "none",
          technicians: [],
          businessWindows: [],
          busyIntervals: [],
          degraded: false
        })
      } as unknown as SalesforceSchedulingGateway,
      {
        isConfigured: () => true,
        applyAppointment: jest.fn().mockResolvedValue({
          applied: false,
          degraded: false,
          booked: false,
          idempotentSkip: false,
          appointmentStatus: "none"
        })
      } as unknown as SalesforceSchedulingWriteGateway,
      new SchedulingPlannerService(),
      new GuardrailPolicyService(),
      {
        notifyApprovalRequired: jest
          .fn()
          .mockResolvedValue({ method: "log_only" }),
        notifyEscalation: jest.fn().mockResolvedValue(undefined)
      } as unknown as GuardrailApprovalNotificationService,
      {
        postAgentNarrative: jest.fn().mockResolvedValue(undefined)
      } as unknown as import("./agent-case-comment.service").AgentCaseCommentService
    );

    const resolved =
      await restartedService.getLatestSnapshotForCase("500000000000001");
    expect(resolved.workflowId).toBe(accepted.workflowId);
    expect(resolved.status).toBe("done");
  });

  it("throws NotFound for a Case Id with no workflow snapshot", async () => {
    const h = buildHarness("auto");
    await expect(
      h.service.getLatestSnapshotForCase("500000000000999")
    ).rejects.toThrow();
  });

  it("reports readiness from the gateway", () => {
    const h = buildHarness("auto");
    expect(h.service.isReady()).toBe(true);
  });

  describe("optional Salesforce tracking write-back", () => {
    it("does not write back when the feature is disabled (default)", async () => {
      const h = buildHarness("auto");
      const accepted = await h.service.trigger({ caseId: "500000000000001" });
      await waitFor(
        async () => (await statusOf(h.service, accepted.workflowId)) === "done"
      );
      expect(h.writeTriageTracking).not.toHaveBeenCalled();
    });

    it("stamps the workflow id and status onto the Case when enabled", async () => {
      const h = buildHarness(
        "auto",
        {},
        {
          enabled: true,
          uiBaseUrl: "https://chat.example.com/"
        }
      );
      const accepted = await h.service.trigger({
        caseId: "500000000000001",
        caseNumber: "00004242"
      });
      await waitFor(
        async () => (await statusOf(h.service, accepted.workflowId)) === "done"
      );
      // Allow the fire-and-forget assigned write-back to settle.
      await waitFor(() =>
        h.writeTriageTracking.mock.calls.some(
          (call) => call[0]?.status === "done"
        )
      );

      const statuses = h.writeTriageTracking.mock.calls.map(
        (call) => call[0].status
      );
      expect(statuses).toContain("assigned");
      expect(statuses).toContain("done");

      const doneCall = h.writeTriageTracking.mock.calls.find(
        (call) => call[0].status === "done"
      )![0];
      expect(doneCall.caseId).toBe("500000000000001");
      expect(doneCall.workflowId).toBe(accepted.workflowId);
      expect(doneCall.uiUrl).toBe(
        "https://chat.example.com/orchestration?caseId=500000000000001"
      );
      // No double slash from the trailing-slash base URL.
      expect(doneCall.uiUrl).not.toContain(".com//");
    });

    it("never lets a tracking write-back failure break the run", async () => {
      const h = buildHarness("auto", {}, { enabled: true });
      h.writeTriageTracking.mockRejectedValue(
        new SalesforceGatewayError("backend", "Case field not found.")
      );

      const accepted = await h.service.trigger({ caseId: "500000000000001" });
      await waitFor(
        async () => (await statusOf(h.service, accepted.workflowId)) === "done"
      );

      const snapshot = await h.service.getSnapshot(accepted.workflowId);
      expect(snapshot.status).toBe("done");
      expect(snapshot.writeBackApplied).toBe(true);
    });
  });

  describe("Phase 4c gated fulfillment writes", () => {
    it("applies fulfillment after approval and merges the write outcome", async () => {
      const applyFulfillment = jest.fn().mockResolvedValue({
        applied: true,
        degraded: false,
        items: [
          {
            partNumber: "SP-BATT-15X",
            created: true,
            idempotentSkip: false,
            recordType: "ProductRequest",
            recordId: "0a8000000000001",
            reservationStatus: "backorder_requested"
          }
        ]
      });
      // Empty inventory -> backorder -> requiredApproval -> gate interrupts.
      const h = buildHarness(
        "auto",
        {
          subject: "Please order SP-BATT-15X",
          assetProductCode: "AV-LP-15X-PRO",
          serviceShipToCountry: "US"
        },
        {},
        { enabled: true, writesEnabled: true },
        { applyFulfillment }
      );

      const accepted = await h.service.trigger({ caseId: "500000000000001" });
      await waitFor(
        async () =>
          (await statusOf(h.service, accepted.workflowId)) ===
          "waiting_approval"
      );

      const resumed = await h.service.resume(accepted.workflowId, {
        decision: "approved",
        idempotencyKey: "approve-4c-1"
      });

      expect(applyFulfillment).toHaveBeenCalledTimes(1);
      expect(resumed.status).toBe("done");
      expect(resumed.partsLogistics?.writeOutcome?.applied).toBe(true);
      const battery = resumed.partsLogistics?.partPlans?.find(
        (p) => p.partNumber === "SP-BATT-15X"
      );
      expect(battery?.reservationStatus).toBe("backorder_requested");
      expect(battery?.fulfillmentRecordType).toBe("ProductRequest");
    });

    it("does not call the fulfillment gateway when writes are disabled", async () => {
      const applyFulfillment = jest.fn();
      const h = buildHarness(
        "auto",
        {
          subject: "Please order SP-BATT-15X",
          assetProductCode: "AV-LP-15X-PRO",
          serviceShipToCountry: "US"
        },
        {},
        { enabled: true, writesEnabled: false },
        { applyFulfillment }
      );

      const accepted = await h.service.trigger({ caseId: "500000000000001" });
      await waitFor(
        async () =>
          (await statusOf(h.service, accepted.workflowId)) ===
          "waiting_approval"
      );
      await h.service.resume(accepted.workflowId, {
        decision: "approved",
        idempotencyKey: "approve-4c-2"
      });

      expect(applyFulfillment).not.toHaveBeenCalled();
    });
  });

  describe("Phase 5c gated scheduling writes", () => {
    // Mon–Sun 09:00–17:00 so the slot search is weekday/time independent.
    const ALL_DAY_WINDOWS = Array.from({ length: 7 }, (_, day) => ({
      dayOfWeek: day,
      openMinutes: 9 * 60,
      closeMinutes: 17 * 60
    }));
    // A North-America technician with the laptop skills the demo Case needs.
    const schedulableRead = {
      source: "soql" as const,
      technicians: [
        {
          resourceId: "0Hn000000000A1",
          resourceReference: "SR-A1",
          isActive: true,
          territories: [{ name: "North America", type: "S" }],
          skills: [
            { label: "Laptop Hardware", level: 9 },
            { label: "Battery/Power", level: 8 }
          ]
        }
      ],
      businessWindows: ALL_DAY_WINDOWS,
      busyIntervals: [],
      workTypeDurationMinutesBySkill: {},
      candidatesApiUsed: false,
      degraded: false
    };
    const laptopCase = {
      subject: "Laptop battery not charging",
      description: "Battery drains and will not charge on the AV-LP-15X-PRO.",
      assetProductCode: "AV-LP-15X-PRO",
      serviceShipToCountry: "US"
    };

    it("books the ServiceAppointment after approval and merges booked status", async () => {
      const applyAppointment = jest.fn().mockResolvedValue({
        applied: true,
        degraded: false,
        booked: true,
        idempotentSkip: false,
        appointmentStatus: "booked",
        appointmentReference: "SA-0007"
      });
      const readSchedulingContext = jest
        .fn()
        .mockResolvedValue(schedulableRead);
      // "always" → guardrail requireHumanApproval → approved → writeBack,
      // the canonical 5c path (a Case that pauses, then is approved).
      const h = buildHarness(
        "always",
        laptopCase,
        {},
        {},
        {},
        { enabled: true, writesEnabled: true, readSchedulingContext },
        { applyAppointment }
      );

      const accepted = await h.service.trigger({ caseId: "500000000000001" });
      await waitFor(
        async () =>
          (await statusOf(h.service, accepted.workflowId)) ===
          "waiting_approval"
      );
      const resumed = await h.service.resume(accepted.workflowId, {
        decision: "approved",
        idempotencyKey: "approve-5c-1"
      });

      expect(resumed.status).toBe("done");
      // RC-5: the plan was re-read at write time (plan-time + write-time).
      expect(readSchedulingContext.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(applyAppointment).toHaveBeenCalledTimes(1);
      expect(applyAppointment.mock.calls[0][0]).toMatchObject({
        caseId: "500000000000001",
        workflowId: accepted.workflowId,
        resourceReference: "SR-A1"
      });
      expect(resumed.scheduling?.appointmentStatus).toBe("booked");
      expect(resumed.scheduling?.appointmentReference).toBe("SA-0007");
    });

    it("does not call the scheduling gateway when writes are disabled", async () => {
      const applyAppointment = jest.fn();
      const readSchedulingContext = jest
        .fn()
        .mockResolvedValue(schedulableRead);
      const h = buildHarness(
        "always",
        laptopCase,
        {},
        {},
        {},
        { enabled: true, writesEnabled: false, readSchedulingContext },
        { applyAppointment }
      );

      const accepted = await h.service.trigger({ caseId: "500000000000001" });
      await waitFor(
        async () =>
          (await statusOf(h.service, accepted.workflowId)) ===
          "waiting_approval"
      );
      const resumed = await h.service.resume(accepted.workflowId, {
        decision: "approved",
        idempotencyKey: "approve-5c-2"
      });

      expect(applyAppointment).not.toHaveBeenCalled();
      // The plan is still surfaced, just never booked.
      expect(resumed.scheduling?.schedulingReadiness).toBe("schedulable");
      expect(resumed.scheduling?.appointmentStatus).toBe("proposed");
    });
  });
});

describe("CaseTriageOrchestratorService — stepped pause copy", () => {
  it("bootstrap pause says Workflow ready, not Stage complete", async () => {
    const h = buildHarness();
    const accepted = await h.service.triggerStepped({
      caseId: "500000000000001",
      caseNumber: "00004242"
    });
    const snapshot = await h.store.get(accepted.workflowId);
    const pauseEvent = snapshot?.events?.find(
      (event) => event.status === "awaiting_step"
    );
    expect(pauseEvent?.safeSummary).toBe(
      "Workflow ready — press Run for Triage."
    );
    expect(snapshot?.node).toBe("triage");
  });

  it("post-triage pause names Triage complete, not Knowledge", async () => {
    const h = buildHarness();
    const accepted = await h.service.triggerStepped({
      caseId: "500000000000001",
      caseNumber: "00004242"
    });
    const advanced = await h.service.advance(accepted.workflowId);
    const pauseEvents =
      advanced.events?.filter((event) => event.status === "awaiting_step") ??
      [];
    const latest = pauseEvents[pauseEvents.length - 1];
    expect(latest?.safeSummary).toBe(
      "Triage complete — press Run for Knowledge Base."
    );
    expect(advanced.node).toBe("knowledge");
  });
});

import type { AppConfigService } from "../config/app-config.service";
import type { TelemetryService } from "../observability/telemetry.service";
import type { SupportTriageService } from "../agents/support-triage.service";
import type { CustomerHistorySynthesisService } from "../agents/customer-history.service";
import type { SalesforceCaseGateway } from "../salesforce/salesforce-case.gateway";
import type { SalesforceCustomerGateway } from "../salesforce/salesforce-customer.gateway";
import { SalesforceGatewayError } from "../salesforce/salesforce-gateway.error";
import { CaseTriageOrchestratorService } from "./case-triage-orchestrator.service";
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
  applyWriteBack: jest.Mock;
  writeTriageTracking: jest.Mock;
  triage: jest.Mock;
  synthesize: jest.Mock;
  readCustomerBundle: jest.Mock;
  recordAgentWorkflow: jest.Mock;
}

function buildHarness(
  approvalMode: TriageApprovalMode = "auto",
  contextOverrides: Partial<SalesforceCaseContext> = {},
  writeBackOverrides: { enabled?: boolean; uiBaseUrl?: string } = {}
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
  const gateway = {
    isConfigured: () => true,
    readCaseContext,
    applyWriteBack,
    writeTriageTracking
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
      }
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

  const service = new CaseTriageOrchestratorService(
    gateway,
    customerGateway,
    supportTriage,
    customerHistory,
    externalAdapters,
    store,
    telemetry,
    config
  );

  return {
    service,
    store,
    repository,
    readCaseContext,
    applyWriteBack,
    writeTriageTracking,
    triage,
    synthesize,
    readCustomerBundle,
    recordAgentWorkflow
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
          }
        },
        salesforceConnection: { enabled: true }
      } as unknown as AppConfigService
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
});

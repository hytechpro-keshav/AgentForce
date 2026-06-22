import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceCaseGateway } from "../salesforce/salesforce-case.gateway";
import { GUARDRAIL_NODE_ID } from "./dto/case-triage-lifecycle";
import { GuardrailApprovalNotificationService } from "./guardrail-approval-notification.service";
import { GuardrailApprovalTimeoutService } from "./guardrail-approval-timeout.service";
import {
  InMemoryOrchestrationStatusRepository,
  OrchestrationStatusRepository
} from "./orchestration-status.repository";
import { OrchestrationStatusStore } from "./orchestration-status.store";

interface TimeoutOverrides {
  enabled?: boolean;
  timeoutSeconds?: number;
  action?: "escalate" | "reject";
  scanSeconds?: number;
}

interface Harness {
  service: GuardrailApprovalTimeoutService;
  store: OrchestrationStatusStore;
  writeGuardrailStatus: jest.Mock;
  notifyEscalation: jest.Mock;
}

function buildHarness(overrides: TimeoutOverrides = {}): Harness {
  const repository: OrchestrationStatusRepository =
    new InMemoryOrchestrationStatusRepository();
  const store = new OrchestrationStatusStore(repository);
  const writeGuardrailStatus = jest.fn().mockResolvedValue(undefined);
  const gateway = {
    writeGuardrailStatus
  } as unknown as SalesforceCaseGateway;
  const notifyEscalation = jest.fn().mockResolvedValue(undefined);
  const notifications = {
    notifyEscalation
  } as unknown as GuardrailApprovalNotificationService;
  const config = {
    orchestrator: {
      guardrailApproval: {
        emailEnabled: false,
        escalationEmailEnabled: false,
        timeout: {
          enabled: overrides.enabled ?? true,
          timeoutSeconds: overrides.timeoutSeconds ?? 60,
          action: overrides.action ?? "escalate",
          scanSeconds: overrides.scanSeconds ?? 300
        }
      }
    }
  } as unknown as AppConfigService;

  const service = new GuardrailApprovalTimeoutService(
    store,
    config,
    gateway,
    notifications
  );
  return { service, store, writeGuardrailStatus, notifyEscalation };
}

async function seedWaiting(
  store: OrchestrationStatusStore,
  workflowId: string,
  caseId = "500000000000001"
): Promise<void> {
  await store.createAssigned({ workflowId, caseId, caseNumber: "00001060" });
  await store.update(workflowId, {
    approvalRequired: true,
    guardrail: {
      eligible: true,
      outcome: "requireHumanApproval",
      riskScore: 45,
      riskLevel: "medium",
      policyRulesEvaluated: [],
      policyRulesTriggered: [],
      channelBasis: [],
      requiresHumanApproval: true,
      approvalRequired: true,
      approvalReasons: ["partial parts"],
      degraded: false
    } as never
  });
  await store.appendEvent(
    workflowId,
    "waiting_approval",
    "Awaiting approval.",
    undefined,
    GUARDRAIL_NODE_ID
  );
}

/** A `now` far enough ahead that a just-created waiting event is past the SLA. */
const STALE_NOW = Date.now() + 1_000_000;

describe("GuardrailApprovalTimeoutService", () => {
  it("auto-escalates a stale waiting_approval workflow without resume() or an SF token", async () => {
    const h = buildHarness({ action: "escalate" });
    await seedWaiting(h.store, "wf-stale-1");

    const settled = await h.service.sweep(STALE_NOW);

    expect(settled).toBe(1);
    const snapshot = await h.store.get("wf-stale-1");
    expect(snapshot?.status).toBe("escalated");
    expect(snapshot?.approvalDecision).toBe("escalated");
    // Case guardrail status mirrored; supervisor notice attempted (no-op when off).
    expect(h.writeGuardrailStatus).toHaveBeenCalledWith(
      "500000000000001",
      "escalated"
    );
    expect(h.notifyEscalation).toHaveBeenCalledTimes(1);
  });

  it("leaves a fresh waiting_approval workflow untouched (within SLA)", async () => {
    const h = buildHarness({ timeoutSeconds: 60 });
    await seedWaiting(h.store, "wf-fresh-1");

    // now == real time, so the just-created waiting event is well within SLA.
    const settled = await h.service.sweep(Date.now());

    expect(settled).toBe(0);
    const snapshot = await h.store.get("wf-fresh-1");
    expect(snapshot?.status).toBe("waiting_approval");
    expect(h.writeGuardrailStatus).not.toHaveBeenCalled();
  });

  it("is idempotent across overlapping sweeps — settles each workflow once", async () => {
    const h = buildHarness();
    await seedWaiting(h.store, "wf-idem-1");

    const first = await h.service.sweep(STALE_NOW);
    const second = await h.service.sweep(STALE_NOW);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(h.writeGuardrailStatus).toHaveBeenCalledTimes(1);
    expect(h.notifyEscalation).toHaveBeenCalledTimes(1);
  });

  it("auto-rejects (no escalation notice) when the action is reject", async () => {
    const h = buildHarness({ action: "reject" });
    await seedWaiting(h.store, "wf-reject-1");

    const settled = await h.service.sweep(STALE_NOW);

    expect(settled).toBe(1);
    const snapshot = await h.store.get("wf-reject-1");
    expect(snapshot?.status).toBe("rejected");
    expect(snapshot?.approvalDecision).toBe("rejected");
    expect(h.writeGuardrailStatus).toHaveBeenCalledWith(
      "500000000000001",
      "rejected"
    );
    expect(h.notifyEscalation).not.toHaveBeenCalled();
  });

  it("never settles when the timeout is disabled (6b+ parity)", async () => {
    const h = buildHarness({ enabled: false });
    await seedWaiting(h.store, "wf-off-1");

    const settled = await h.service.sweep(STALE_NOW);

    expect(settled).toBe(0);
    expect(h.writeGuardrailStatus).not.toHaveBeenCalled();
  });

  it("ignores non-waiting_approval workflows", async () => {
    const h = buildHarness();
    await h.store.createAssigned({
      workflowId: "wf-done-1",
      caseId: "500000000000002"
    });
    await h.store.appendEvent("wf-done-1", "done", "Done.");

    const settled = await h.service.sweep(STALE_NOW);

    expect(settled).toBe(0);
    expect(h.writeGuardrailStatus).not.toHaveBeenCalled();
  });

  it("settles the snapshot even when the Case guardrail-status write degrades", async () => {
    const h = buildHarness();
    h.writeGuardrailStatus.mockRejectedValueOnce(new Error("FLS"));
    await seedWaiting(h.store, "wf-degrade-1");

    const settled = await h.service.sweep(STALE_NOW);

    expect(settled).toBe(1);
    const snapshot = await h.store.get("wf-degrade-1");
    expect(snapshot?.status).toBe("escalated");
  });
});

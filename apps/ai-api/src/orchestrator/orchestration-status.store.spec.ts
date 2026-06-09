import {
  InMemoryOrchestrationStatusRepository,
  OrchestrationStatusRepository
} from "./orchestration-status.repository";
import { OrchestrationStatusStore } from "./orchestration-status.store";

const knowledgeGuidance = {
  eligible: true,
  degraded: false,
  status: "ANSWERED" as const,
  answer: {
    safeSummary:
      "Verify adapter functionality, run BIOS diagnostics, and replace SP-BATT-15X if diagnostics confirm failure.",
    sources: [
      {
        sourceId: "kb-av-lp-15x-pro-battery-1",
        title: "Battery Not Charging on AeroVolt ProBook 15X",
        retrievalScorePercentile: 81
      }
    ],
    provider: "openai",
    model: "gpt-4o-mini",
    embeddingProvider: "openai",
    retrievalId: "ret-123",
    latencyMs: 253,
    fallbackUsed: false
  }
};

describe("OrchestrationStatusStore", () => {
  function build(
    repository: OrchestrationStatusRepository = new InMemoryOrchestrationStatusRepository()
  ): OrchestrationStatusStore {
    return new OrchestrationStatusStore(repository);
  }

  it("creates an assigned workflow with a first event", async () => {
    const store = build();
    const snapshot = await store.createAssigned({
      workflowId: "wf-1",
      caseId: "500000000000001",
      caseNumber: "00001234"
    });
    expect(snapshot.status).toBe("assigned");
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0].status).toBe("assigned");
    expect(snapshot.events[0].sequence).toBe(1);
  });

  it("appends events with monotonic sequence and updates status", async () => {
    const store = build();
    await store.createAssigned({
      workflowId: "wf-1",
      caseId: "500000000000001"
    });
    await store.appendEvent("wf-1", "running", "Reading context");
    await store.appendEvent("wf-1", "done", "Done");

    const snapshot = (await store.get("wf-1"))!;
    expect(snapshot.status).toBe("done");
    expect(snapshot.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(snapshot.events.map((e) => e.status)).toEqual([
      "assigned",
      "running",
      "done"
    ]);
  });

  it("merges patch fields without adding an event", async () => {
    const store = build();
    await store.createAssigned({
      workflowId: "wf-1",
      caseId: "500000000000001"
    });
    await store.update("wf-1", {
      writeBackApplied: true,
      approvalRequired: true,
      failureKind: undefined
    });
    const snapshot = (await store.get("wf-1"))!;
    expect(snapshot.writeBackApplied).toBe(true);
    expect(snapshot.approvalRequired).toBe(true);
    expect(snapshot.events).toHaveLength(1);
  });

  it("merges the knowledge guidance channel without adding an event", async () => {
    const store = build();
    await store.createAssigned({
      workflowId: "wf-1",
      caseId: "500000000000001"
    });
    await store.update("wf-1", {
      knowledgeGuidance
    });
    const snapshot = (await store.get("wf-1"))!;
    expect(snapshot.knowledgeGuidance?.status).toBe("ANSWERED");
    expect(snapshot.knowledgeGuidance?.answer?.sources).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
  });

  it("returns cloned snapshots so callers cannot mutate the store", async () => {
    const store = build();
    await store.createAssigned({
      workflowId: "wf-1",
      caseId: "500000000000001"
    });
    const first = (await store.get("wf-1"))!;
    first.events.push({
      workflowId: "wf-1",
      caseId: "500000000000001",
      node: "triage",
      status: "failed",
      sequence: 99,
      occurredAt: new Date().toISOString()
    });
    first.status = "failed";

    const second = (await store.get("wf-1"))!;
    expect(second.events).toHaveLength(1);
    expect(second.status).toBe("assigned");
  });

  it("returns the latest workflow for a Case Id", async () => {
    const store = build();
    await store.createAssigned({
      workflowId: "wf-1",
      caseId: "500000000000001"
    });
    await store.createAssigned({
      workflowId: "wf-2",
      caseId: "500000000000002"
    });
    await store.createAssigned({
      workflowId: "wf-3",
      caseId: "500000000000001"
    });

    expect((await store.getLatestForCase("500000000000001"))?.workflowId).toBe(
      "wf-3"
    );
    expect((await store.getLatestForCase("500000000000002"))?.workflowId).toBe(
      "wf-2"
    );
    expect(await store.getLatestForCase("500000000000003")).toBeUndefined();
  });

  it("ignores events and patches for unknown workflows", async () => {
    const store = build();
    await expect(store.appendEvent("missing", "done")).resolves.toBeUndefined();
    await expect(
      store.update("missing", { writeBackApplied: true })
    ).resolves.toBeUndefined();
    expect(await store.get("missing")).toBeUndefined();
    expect(store.has("missing")).toBe(false);
  });

  describe("durable write-through and restart resilience", () => {
    it("writes every mutation through to the durable repository", async () => {
      const repository = new InMemoryOrchestrationStatusRepository();
      const store = build(repository);
      await store.createAssigned({
        workflowId: "wf-1",
        caseId: "500000000000001",
        caseNumber: "00001234"
      });
      await store.appendEvent("wf-1", "running", "Reading context");
      await store.update("wf-1", { writeBackApplied: true });
      await store.appendEvent("wf-1", "done", "Triage applied.");

      const durable = await repository.get("wf-1");
      expect(durable?.status).toBe("done");
      expect(durable?.writeBackApplied).toBe(true);
      expect(durable?.events.map((e) => e.status)).toEqual([
        "assigned",
        "running",
        "done"
      ]);
    });

    it("resolves a workflow by id from the durable store after a restart", async () => {
      const repository = new InMemoryOrchestrationStatusRepository();
      const before = build(repository);
      await before.createAssigned({
        workflowId: "wf-1",
        caseId: "500000000000001",
        caseNumber: "00001234"
      });
      await before.appendEvent("wf-1", "done", "Triage applied.");

      // A fresh store with an empty in-memory cache simulates a restart.
      const afterRestart = build(repository);
      const resolved = await afterRestart.get("wf-1");
      expect(resolved?.workflowId).toBe("wf-1");
      expect(resolved?.status).toBe("done");
    });

    it("resolves the latest workflow by Case Id from the durable store after a restart", async () => {
      const repository = new InMemoryOrchestrationStatusRepository();
      const before = build(repository);
      await before.createAssigned({
        workflowId: "wf-old",
        caseId: "500000000000001"
      });
      // Ensure a strictly later updatedAt for the second workflow.
      await new Promise((resolve) => setTimeout(resolve, 2));
      await before.createAssigned({
        workflowId: "wf-new",
        caseId: "500000000000001"
      });

      const afterRestart = build(repository);
      const latest = await afterRestart.getLatestForCase("500000000000001");
      expect(latest?.workflowId).toBe("wf-new");
    });

    it("warms the in-memory cache on a durable fallback read", async () => {
      const repository = new InMemoryOrchestrationStatusRepository();
      const seeded = build(repository);
      await seeded.createAssigned({
        workflowId: "wf-1",
        caseId: "500000000000001"
      });

      const afterRestart = build(repository);
      const getSpy = jest.spyOn(repository, "get");
      await afterRestart.get("wf-1");
      await afterRestart.get("wf-1");
      // First read hits durable; second read is served from the warmed cache.
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it("keeps in-memory state authoritative when a durable write fails", async () => {
      const repository = new InMemoryOrchestrationStatusRepository();
      jest
        .spyOn(repository, "save")
        .mockRejectedValue(new Error("durable backend offline"));
      const store = build(repository);

      // A failing durable write must not throw into the workflow path.
      const snapshot = await store.createAssigned({
        workflowId: "wf-1",
        caseId: "500000000000001"
      });
      expect(snapshot.status).toBe("assigned");
      const local = await store.get("wf-1");
      expect(local?.status).toBe("assigned");
    });
  });
});

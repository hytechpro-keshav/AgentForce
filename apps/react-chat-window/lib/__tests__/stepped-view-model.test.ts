import { describe, expect, it } from "vitest";

import {
  buildSteppedViewModel,
  computeRevealedProgress,
  filterActivityForRevealed
} from "@/lib/stepped-view-model";

import {
  steppedInProgressTriageFixture,
  steppedPausedFixture,
  steppedSnapshotFixture
} from "./stepped-fixture";

describe("buildSteppedViewModel", () => {
  it("maps all six nodes in order with real outputs", () => {
    const vm = buildSteppedViewModel(steppedSnapshotFixture());

    expect(vm.nodes.map((node) => node.id)).toEqual([
      "triage",
      "customer_history",
      "knowledge",
      "parts_logistics",
      "scheduling",
      "guardrail"
    ]);
    expect(vm.nodes.every((node) => node.available)).toBe(true);

    expect(vm.nodes[0].output).toBe("normal priority");
    expect(vm.nodes[0].latency).toBe("1285 ms");
    expect(vm.nodes[1].output).toContain("high business risk");
    expect(vm.nodes[2].output).toContain("ANSWERED");
    expect(vm.nodes[3].output).toContain("SP-BATT-15X");
    expect(vm.nodes[4].output).toContain("SR-A1");
    expect(vm.nodes[5].output).toContain("Approval required");
  });

  it("builds the triage accordion with summary, fields, and execution trace", () => {
    const vm = buildSteppedViewModel(steppedSnapshotFixture());
    const triage = vm.nodes[0];

    const types = triage.detail.map((section) => section.type);
    expect(types).toEqual(["summary", "fields", "trace"]);

    const fields = triage.detail.find((s) => s.type === "fields");
    expect(fields && fields.type === "fields" && fields.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ k: "Priority", v: "normal" }),
        expect.objectContaining({ k: "Model", v: "gpt-4o-mini" })
      ])
    );

    const trace = triage.detail.find((s) => s.type === "trace");
    expect(
      trace && trace.type === "trace" && trace.items.length
    ).toBeGreaterThan(0);
  });

  it("flags the guardrail as waiting for human approval", () => {
    const vm = buildSteppedViewModel(steppedSnapshotFixture());
    expect(vm.guardrailWaiting).toBe(true);
    expect(vm.complete).toBe(true);

    const fired = vm.nodes[5].detail.find((s) => s.type === "chips");
    expect(
      fired && fired.type === "chips" && fired.items.map((c) => c.k)
    ).toEqual(["CUSTOMER_RISK_HIGH", "KB_REQUIRED_APPROVAL"]);
  });

  it("maps the orchestrator verdict and activity log", () => {
    const vm = buildSteppedViewModel(steppedSnapshotFixture());
    expect(vm.verdict?.headline).toContain("approval required");
    expect(vm.verdict?.steps.length).toBe(2);
    expect(vm.verdict?.chips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ k: "Risk score", v: "40" })
      ])
    );
    expect(vm.activity.length).toBeGreaterThan(0);
    expect(vm.activity[vm.activity.length - 1].text).toContain("Guardrail");
  });

  it("marks downstream nodes unavailable when their payloads are missing", () => {
    const vm = buildSteppedViewModel(
      steppedSnapshotFixture({
        status: "running",
        node: "customer_history",
        customerContext: undefined,
        knowledgeGuidance: undefined,
        partsLogistics: undefined,
        scheduling: undefined,
        guardrail: undefined,
        orchestratorVerdict: undefined,
        events: [
          {
            node: "triage",
            status: "done",
            sequence: 1,
            occurredAt: "t1",
            safeSummary: "Triage applied."
          }
        ]
      })
    );

    expect(vm.nodes[0].available).toBe(true);
    expect(vm.nodes[1].available).toBe(false);
    expect(vm.nodes[5].available).toBe(false);
    expect(vm.complete).toBe(false);
    expect(vm.guardrailWaiting).toBe(false);
  });
});

describe("computeRevealedProgress", () => {
  it("pauses at the awaiting node in stepped mode", () => {
    const vm = buildSteppedViewModel(steppedPausedFixture());
    expect(computeRevealedProgress(vm.nodes, steppedPausedFixture())).toBe(1);
  });

  it("reveals every produced stage for terminal or in-flight auto runs", () => {
    const full = buildSteppedViewModel(steppedSnapshotFixture());
    expect(computeRevealedProgress(full.nodes, steppedSnapshotFixture())).toBe(6);

    const triageOnly = buildSteppedViewModel(steppedInProgressTriageFixture());
    expect(
      computeRevealedProgress(triageOnly.nodes, steppedInProgressTriageFixture())
    ).toBe(1);
  });
});

describe("filterActivityForRevealed", () => {
  it("keeps activity aligned with revealed spine stages", () => {
    const vm = buildSteppedViewModel(steppedSnapshotFixture());
    const filtered = filterActivityForRevealed(vm.activity, vm.nodes, 1);
    expect(filtered.every((entry) => entry.nodeId === "triage")).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });
});

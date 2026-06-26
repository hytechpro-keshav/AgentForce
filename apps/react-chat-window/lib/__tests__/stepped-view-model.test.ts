import { describe, expect, it } from "vitest";

import {
  buildSteppedViewModel,
  buildVisibleActivity,
  computeRevealedProgress,
  filterActivityForRevealed,
  isSteppedSnapshot
} from "@/lib/stepped-view-model";

import {
  steppedAfterCustomerHistoryFixture,
  steppedInProgressTriageFixture,
  steppedPausedFixture,
  steppedSnapshotFixture
} from "./stepped-fixture";

describe("buildSteppedViewModel", () => {
  it("maps all five spine nodes in order with real outputs", () => {
    const vm = buildSteppedViewModel(steppedSnapshotFixture());

    expect(vm.nodes.map((node) => node.id)).toEqual([
      "triage",
      "knowledge",
      "parts_logistics",
      "scheduling",
      "guardrail"
    ]);
    expect(vm.nodes.every((node) => node.available)).toBe(true);

    expect(vm.nodes[0].output).toBe(
      "Routine battery replacement needed for ProBook 15X."
    );
    expect(vm.nodes[0].latency).toBe("1285 ms");
    expect(vm.nodes[1].output).toContain("ANSWERED");
    expect(vm.nodes[2].output).toContain("SP-BATT-15X");
    expect(vm.nodes[3].output).toContain("SR-A1");
    expect(vm.nodes[4].output).toContain("Approval required");
  });

  it("builds the triage accordion with summary, triage fields, customer fields, and trace", () => {
    const vm = buildSteppedViewModel(steppedSnapshotFixture());
    const triage = vm.nodes[0];

    const types = triage.detail.map((section) => section.type);
    // summary + optional next note + triage fields + customer context fields + trace
    expect(types).toEqual(["summary", "note", "fields", "fields", "trace"]);

    const triageFields = triage.detail.find((s) => s.type === "fields");
    expect(triageFields && triageFields.type === "fields" && triageFields.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ k: "Priority", v: "normal" }),
        expect.objectContaining({ k: "Model", v: "gpt-4o-mini" })
      ])
    );

    // Customer context fields folded in
    const allFields = triage.detail.filter((s) => s.type === "fields");
    const customerFields = allFields[1];
    expect(customerFields && customerFields.type === "fields" && customerFields.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ k: "Business risk", v: "high" }),
        expect.objectContaining({
          k: "Installed assets",
          v: "12 (ProBook 15X)"
        })
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

    const fired = vm.nodes[4].detail.find((s) => s.type === "chips");
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
        node: "knowledge",
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
    expect(vm.nodes[1].available).toBe(false); // knowledge
    expect(vm.nodes[4].available).toBe(false); // guardrail
    expect(vm.complete).toBe(false);
    expect(vm.guardrailWaiting).toBe(false);
  });
});

describe("isSteppedSnapshot", () => {
  it("detects paused stepped runs and ignores auto-trigger full runs", () => {
    expect(isSteppedSnapshot(steppedPausedFixture())).toBe(true);
    expect(isSteppedSnapshot(steppedInProgressTriageFixture())).toBe(false);
    expect(isSteppedSnapshot(steppedSnapshotFixture())).toBe(false);
  });
});

describe("computeRevealedProgress", () => {
  it("pauses at the awaiting node in stepped mode", () => {
    const vm = buildSteppedViewModel(steppedPausedFixture());
    expect(computeRevealedProgress(vm.nodes, steppedPausedFixture())).toBe(1);
  });

  it("reveals every produced stage for a completed stepped run", () => {
    const completedStepped = steppedSnapshotFixture({
      events: [
        ...(steppedSnapshotFixture().events ?? []),
        {
          node: "scheduling",
          status: "awaiting_step",
          sequence: 99,
          occurredAt: "t99",
          safeSummary: "Paused before guardrail."
        }
      ]
    });
    const full = buildSteppedViewModel(completedStepped);
    expect(computeRevealedProgress(full.nodes, completedStepped)).toBe(5);
  });

  it("returns zero for auto-trigger workflows", () => {
    const triageOnly = buildSteppedViewModel(steppedInProgressTriageFixture());
    expect(
      computeRevealedProgress(triageOnly.nodes, steppedInProgressTriageFixture())
    ).toBe(0);
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

describe("buildVisibleActivity", () => {
  it("collapses the just-finished stage and surfaces frontier pause when awaiting_step", () => {
    const snapshot = steppedAfterCustomerHistoryFixture();
    const vm = buildSteppedViewModel(snapshot);
    const visible = buildVisibleActivity(vm.activity, vm.nodes, 2, snapshot);

    expect(
      visible.some((entry) => entry.text.includes("Writing customer findings"))
    ).toBe(false);
    expect(visible.some((entry) => entry.text.includes("Knowledge Base · complete"))).toBe(
      true
    );
    expect(
      visible.some((entry) =>
        entry.text.includes("Stage complete — awaiting Run for Parts & Logistics")
      )
    ).toBe(true);
    expect(
      visible.some((entry) => entry.text === "Ready to dispatch → Parts & Logistics")
    ).toBe(true);
    expect(visible[visible.length - 1]?.text).toBe(
      "Ready to dispatch → Parts & Logistics"
    );
  });

  it("includes detailed traces for the active node while backend is running", () => {
    const snapshot = steppedInProgressTriageFixture();
    const vm = buildSteppedViewModel(snapshot);
    const visible = buildVisibleActivity(vm.activity, vm.nodes, 0, snapshot);

    expect(visible.some((entry) => entry.text.includes("Running AI triage"))).toBe(
      true
    );
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SteppedOrchestrationView } from "@/components/SteppedOrchestrationView";
import { traceItemsFromDetail } from "@/components/SteppedLiveTrace";
import {
  steppedAfterCustomerHistoryFixture,
  steppedInProgressTriageFixture,
  steppedPausedFixture,
  steppedSnapshotFixture
} from "@/lib/__tests__/stepped-fixture";
import { buildSteppedViewModel } from "@/lib/stepped-view-model";
import type { OrchestrationSnapshot } from "@/lib/orchestration";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock })
}));

const WORKFLOW_ID = "wf-c79ee03d-a8fa-4316-9517-a9b4872833a4";

function advanceTypingForSnapshot(
  snapshot: OrchestrationSnapshot,
  nodeIndex = 0
) {
  const items = traceItemsFromDetail(
    buildSteppedViewModel(snapshot).nodes[nodeIndex]?.detail ?? []
  );
  const ticks =
    items.reduce((total, item) => total + item.label.length, 0) +
    Math.max(items.length, 1) * 6 +
    20;
  for (let tick = 0; tick < ticks; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(40);
    });
  }
}

function advanceCompletionForSnapshot(
  snapshot: OrchestrationSnapshot,
  nodeIndex = 0
) {
  const node = buildSteppedViewModel(snapshot).nodes[nodeIndex];
  if (!node) return;
  let chars = 0;
  let blocks = 0;
  for (const section of node.detail) {
    if (section.type === "summary" || section.type === "note") {
      chars += section.text.length;
      blocks += 1;
    }
  }
  if (node.output) {
    chars += node.output.length;
    blocks += 1;
  }
  const ticks = chars + Math.max(blocks, 1) * 6 + 20;
  for (let tick = 0; tick < ticks; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(40);
    });
  }
}

function completeStageReveal(
  snapshot: OrchestrationSnapshot,
  nodeIndex = 0
) {
  advanceTypingForSnapshot(snapshot, nodeIndex);
  advanceCompletionForSnapshot(snapshot, nodeIndex);
}

describe("SteppedOrchestrationView", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  function mount() {
    render(
      <SteppedOrchestrationView
        caseId="500000000000001"
        pollIntervalMs={0}
        initialSnapshot={steppedPausedFixture()}
      />
    );
  }

  it("completes triage after the backend pauses for customer context", async () => {
    const running = {
      ...steppedPausedFixture(),
      status: "running" as const,
      node: "triage" as const,
      triage: undefined,
      events: steppedPausedFixture().events?.filter(
        (event) => event.status !== "awaiting_step"
      )
    };
    let poll = 0;

    vi.spyOn(global, "fetch").mockImplementation(async () => {
      poll += 1;
      const body = poll === 1 ? running : steppedPausedFixture();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    render(
      <SteppedOrchestrationView
        workflowId={WORKFLOW_ID}
        pollIntervalMs={50}
        initialSnapshot={running}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/Execution trace/i)).toBeInTheDocument();
    expect(screen.getByTestId("stepped-live-trace-cursor")).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("stepped-live-trace-cursor")).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();
  });

  it("plays a triage intro animation while the backend is still running triage", () => {
    const runningTriage = {
      ...steppedPausedFixture(),
      status: "running" as const,
      node: "triage" as const,
      triage: undefined,
      customerContext: undefined
    };
    render(
      <SteppedOrchestrationView
        workflowId={WORKFLOW_ID}
        pollIntervalMs={0}
        initialSnapshot={runningTriage}
      />
    );

    expect(screen.getByText(/Execution trace/i)).toBeInTheDocument();
    expect(screen.getByTestId("stepped-live-trace-cursor")).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Run Knowledge Base/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("priority-badge-normal")).not.toBeInTheDocument();
  });

  it("shows Run Triage when the workflow is paused before the first stage", () => {
    const pausedBeforeTriage = steppedPausedFixture({
      node: "triage",
      status: "awaiting_step",
      triage: undefined,
      customerContext: undefined,
      events: [
        {
          node: "triage",
          status: "awaiting_step",
          sequence: 1,
          occurredAt: "t1",
          safeSummary: "Stage complete — awaiting Run for Triage."
        }
      ]
    });
    render(
      <SteppedOrchestrationView
        workflowId={WORKFLOW_ID}
        pollIntervalMs={0}
        initialSnapshot={pausedBeforeTriage}
      />
    );
    expect(screen.getByText("Agent activated")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run Triage/i })
    ).toBeEnabled();
    expect(screen.queryByTestId("triage-insight-rationale")).not.toBeInTheDocument();
  });

  it("shows triage complete and gates the next stage in a stepped run", () => {
    mount();
    expect(screen.getByText("00001079")).toBeInTheDocument();
    expect(screen.getByText("Triage")).toBeInTheDocument();
    expect(screen.getByTestId("priority-badge-normal")).toBeInTheDocument();
    expect(screen.getByTestId("triage-insight-rationale")).toHaveTextContent(
      /Strategic account/i
    );
    expect(screen.getByTestId("triage-confidence-chart")).toBeInTheDocument();
    expect(screen.getByTestId("triage-confidence-verdict")).toHaveTextContent(
      /AI can likely complete the workflow/i
    );
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    ).toBeEnabled();
  });

  it("shows the start panel when only an auto-run workflow exists", () => {
    render(
      <SteppedOrchestrationView
        caseId="500000000000001"
        pollIntervalMs={0}
        initialSnapshot={steppedInProgressTriageFixture()}
      />
    );
    expect(screen.getByText(/No orchestration run yet/i)).toBeInTheDocument();
  });

  it("hydrates completed stepped stages from the snapshot on load", () => {
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
    render(
      <SteppedOrchestrationView
        caseId="500000000000001"
        pollIntervalMs={0}
        initialSnapshot={completedStepped}
      />
    );

    expect(screen.getAllByTestId("priority-badge-normal").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/business risk/i).length).toBeGreaterThan(0);
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
  });

  it("hydrates stepped progress on workflow refresh without replaying triage", () => {
    render(
      <SteppedOrchestrationView
        workflowId={WORKFLOW_ID}
        pollIntervalMs={0}
        initialSnapshot={steppedPausedFixture()}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    expect(screen.getByTestId("triage-insight-rationale")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    ).toBeEnabled();
    expect(screen.queryByTestId("stepped-live-trace-cursor")).not.toBeInTheDocument();
    expect(screen.getByText(/Ready to dispatch → Knowledge Base/i)).toBeInTheDocument();
  });

  it("collapses a done stage accordion when the header is clicked", () => {
    render(
      <SteppedOrchestrationView
        workflowId={WORKFLOW_ID}
        pollIntervalMs={0}
        initialSnapshot={steppedPausedFixture()}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const triageNode = screen.getByTestId("stepped-node-triage");
    const detail = screen.getByTestId("stepped-node-detail-triage");
    expect(detail).toBeInTheDocument();

    fireEvent.click(triageNode.querySelector('[class*="chead"]')!);
    expect(screen.queryByTestId("stepped-node-detail-triage")).not.toBeInTheDocument();

    fireEvent.click(triageNode.querySelector('[class*="chead"]')!);
    expect(screen.getByTestId("stepped-node-detail-triage")).toBeInTheDocument();
  });
});

describe("SteppedOrchestrationView — Phase 2 (real stepped run)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  function mountStepped() {
    render(
      <SteppedOrchestrationView
        workflowId={WORKFLOW_ID}
        pollIntervalMs={0}
        initialSnapshot={steppedPausedFixture()}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    advanceTypingForSnapshot(steppedPausedFixture());
    advanceCompletionForSnapshot(steppedPausedFixture());
  }

  it("shows the Run button enabled for the awaiting node in stepped mode", () => {
    mountStepped();

    const btn = screen.getByRole("button", {
      name: /Run Knowledge Base/i
    });
    expect(btn).toBeEnabled();
    expect(
      screen.getByText(/press Run to dispatch Knowledge Base/i)
    ).toBeInTheDocument();
    // Hint text indicates this is a backend call, not a local reveal.
    expect(
      screen.getByText(/sends to backend, then reveals/i)
    ).toBeInTheDocument();
  });

  it("calls /advance on click and reveals the stage from the response", async () => {
    const advanceResponse = steppedAfterCustomerHistoryFixture();
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(advanceResponse), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    mountStepped();

    fireEvent.click(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    );

    // Flush the async advance call, then the reveal animation timer.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    advanceTypingForSnapshot(advanceResponse, 1);
    advanceCompletionForSnapshot(advanceResponse, 1);

    // The advance proxy was called with the right workflow id.
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/orchestrator/${WORKFLOW_ID}/advance`,
      expect.objectContaining({ method: "POST" })
    );

    // After the advance, the Parts & Logistics frontier button appears.
    expect(
      screen.getByRole("button", { name: /Run Parts & Logistics/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/press Run to dispatch Parts & Logistics/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ready to dispatch → Parts & Logistics/i)
    ).toBeInTheDocument();
    const activity = screen.getByLabelText("Orchestrator activity");
    expect(
      within(activity).queryByText(/Writing customer findings to state/i)
    ).not.toBeInTheDocument();
    // Customer Context output from the response is now visible.
    expect(screen.getAllByText(/business risk/i).length).toBeGreaterThan(0);
  });

  it("shows an error message when /advance returns a non-ok status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not_awaiting_step" }), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    );

    mountStepped();

    fireEvent.click(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/advance failed/i);
  });

  it("shows RUNNING on the node header during completion animation", async () => {
    const advanceResponse = steppedAfterCustomerHistoryFixture();
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(advanceResponse), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    mountStepped();
    fireEvent.click(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    advanceTypingForSnapshot(advanceResponse, 1);

    const knowledgeNode = screen.getByTestId("stepped-node-knowledge");
    expect(within(knowledgeNode).getByText("RUNNING")).toBeInTheDocument();
  });

  it("shows Receiving in the sidebar during completion animation", async () => {
    const advanceResponse = steppedAfterCustomerHistoryFixture();
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(advanceResponse), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    mountStepped();
    fireEvent.click(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    advanceTypingForSnapshot(advanceResponse, 1);

    expect(screen.getByText(/Receiving/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Working…$/)).not.toBeInTheDocument();
  });
});

describe("SteppedOrchestrationView — start panel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    replaceMock.mockReset();
  });

  it("shows the start panel when the Case has no workflow yet", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));

    render(
      <SteppedOrchestrationView caseId="500000000000001" pollIntervalMs={2500} />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/No orchestration run yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start stepped run/i })
    ).toBeInTheDocument();
  });

  it("POSTs to the stepped proxy and updates the URL on success", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            workflowId: WORKFLOW_ID,
            caseId: "500000000000001",
            status: "assigned"
          }),
          { status: 202, headers: { "content-type": "application/json" } }
        )
      );

    render(
      <SteppedOrchestrationView caseId="500000000000001" pollIntervalMs={2500} />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Start stepped run/i })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/orchestrator/case/500000000000001/stepped",
      expect.objectContaining({ method: "POST" })
    );
    expect(replaceMock).toHaveBeenCalledWith(
      `/orchestration/stepped?workflowId=${encodeURIComponent(WORKFLOW_ID)}`
    );
  });
});

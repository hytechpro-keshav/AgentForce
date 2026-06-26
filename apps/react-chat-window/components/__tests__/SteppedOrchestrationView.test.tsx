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
import {
  steppedAfterCustomerHistoryFixture,
  steppedInProgressTriageFixture,
  steppedPausedFixture,
  steppedSnapshotFixture
} from "@/lib/__tests__/stepped-fixture";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock })
}));

const REVEAL = 950;

const WORKFLOW_ID = "wf-c79ee03d-a8fa-4316-9517-a9b4872833a4";

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
    const paused = steppedPausedFixture();
    let poll = 0;

    vi.spyOn(global, "fetch").mockImplementation(async () => {
      poll += 1;
      const body = poll === 1 ? running : paused;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    render(
      <SteppedOrchestrationView workflowId={WORKFLOW_ID} pollIntervalMs={50} />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/analysing request/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    expect(screen.getByTestId("priority-badge-normal")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    ).toBeEnabled();
  });

  it("plays a triage intro animation before showing the next Run button", () => {
    render(
      <SteppedOrchestrationView
        workflowId={WORKFLOW_ID}
        pollIntervalMs={0}
        initialSnapshot={steppedPausedFixture()}
      />
    );

    expect(screen.getByText(/analysing request/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Run Knowledge Base/i })
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    expect(screen.getByTestId("priority-badge-normal")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    ).toBeEnabled();
  });

  it("shows triage complete and gates the next stage in a stepped run", () => {
    mount();
    expect(screen.getByText("00001079")).toBeInTheDocument();
    expect(screen.getByText("Triage")).toBeInTheDocument();
    expect(screen.getByTestId("priority-badge-normal")).toBeInTheDocument();
    expect(screen.getByTestId("triage-insight-rationale")).toHaveTextContent(
      /Strategic account/i
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
      vi.advanceTimersByTime(REVEAL);
    });
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
    await act(async () => {
      vi.advanceTimersByTime(REVEAL);
    });

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

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SteppedOrchestrationView } from "@/components/SteppedOrchestrationView";
import {
  steppedAfterCustomerHistoryFixture,
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
        initialSnapshot={steppedSnapshotFixture()}
      />
    );
  }

  it("auto-runs Triage and gates the next stage behind a Run button", () => {
    mount();
    // Spine renders the real case + node names.
    expect(screen.getByText("00001079")).toBeInTheDocument();
    expect(screen.getByText("Triage")).toBeInTheDocument();

    // Triage auto-reveal completes; Customer Context becomes the frontier.
    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    const runCustomer = screen.getByRole("button", {
      name: /Run Customer Context/i
    });
    expect(runCustomer).toBeEnabled();
    // Triage output (real data) is shown once revealed.
    expect(screen.getByText(/normal priority/i)).toBeInTheDocument();
    // Later stages are still queued, not auto-advanced.
    expect(
      screen.getAllByRole("button", { name: /Queued/i }).length
    ).toBeGreaterThan(0);
  });

  it("advances one stage per click", () => {
    mount();
    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Run Customer Context/i })
    );
    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    // Frontier moved on to Knowledge Base after the click.
    expect(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    ).toBeInTheDocument();
    // Customer Context output (real business risk) is now visible.
    expect(screen.getAllByText(/business risk/i).length).toBeGreaterThan(0);
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
        caseId="500000000000001"
        pollIntervalMs={0}
        initialSnapshot={steppedPausedFixture()}
      />
    );
  }

  it("shows the Run button enabled for the awaiting node in stepped mode", () => {
    mountStepped();
    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    const btn = screen.getByRole("button", {
      name: /Run Customer Context/i
    });
    expect(btn).toBeEnabled();
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
    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Run Customer Context/i })
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

    // After the advance, the Knowledge Base frontier button appears.
    expect(
      screen.getByRole("button", { name: /Run Knowledge Base/i })
    ).toBeInTheDocument();
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
    act(() => {
      vi.advanceTimersByTime(REVEAL);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Run Customer Context/i })
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

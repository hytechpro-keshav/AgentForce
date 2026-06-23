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
import { steppedSnapshotFixture } from "@/lib/__tests__/stepped-fixture";

const REVEAL = 950;

describe("SteppedOrchestrationView", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
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

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";

import { SteppedLiveTrace, isTraceSignatureAppendOnly } from "@/components/SteppedLiveTrace";

describe("SteppedLiveTrace", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("types trace labels while active and shows the cursor", () => {
    render(
      <SteppedLiveTrace
        active
        items={[
          {
            label: "Sending the output back to the Orchestrator for the next action.",
            status: "running",
            fields: []
          }
        ]}
      />
    );

    expect(screen.getByText(/Execution trace/i)).toBeInTheDocument();
    expect(screen.getByTestId("stepped-live-trace-cursor")).toBeInTheDocument();

    for (let tick = 0; tick < 120; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }

    expect(
      screen.getByTestId("stepped-detail-trace").textContent
    ).toContain("Sending the output back to the Orchestrator for the next action.");
  });

  it("renders the full trace instantly when inactive", () => {
    render(
      <SteppedLiveTrace
        active={false}
        items={[
          {
            label: "Sending the output back to the Orchestrator for the next action.",
            status: "done",
            fields: []
          }
        ]}
      />
    );

    expect(screen.getByText("Sending the output back to the Orchestrator for the next action.")).toBeInTheDocument();
    expect(screen.queryByTestId("stepped-live-trace-cursor")).toBeNull();
  });

  it("fires onTypingComplete for a multi-step trace", () => {
    const onTypingComplete = vi.fn();
    render(
      <SteppedLiveTrace
        active
        onTypingComplete={onTypingComplete}
        items={[
          {
            label: "Triage Agent assigned to Case 00001079.",
            status: "assigned",
            fields: []
          },
          {
            label: "Sending the output back to the Orchestrator for the next action.",
            status: "running",
            fields: []
          },
          {
            label: "Creating a complete customer context package and includes the customer profile, entitlement status, asset details, service history and known risks.",
            status: "running",
            fields: []
          }
        ]}
      />
    );

    const ticks = 420;
    for (let tick = 0; tick < ticks; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }

    expect(onTypingComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps typing through parent re-renders driven by an elapsed clock", () => {
    function Wrapper() {
      const [, setElapsed] = useState(0);
      useEffect(() => {
        const id = setInterval(() => setElapsed((value) => value + 1), 1000);
        return () => clearInterval(id);
      }, []);
      return (
        <SteppedLiveTrace
          active
          items={[
            {
              label: "Triage Agent assigned to Case 00001079.",
              status: "assigned",
              fields: []
            },
            {
              label: "Sending the output back to the Orchestrator for the next action.",
              status: "running",
              fields: []
            },
            {
              label: "Creating a complete customer context package and includes the customer profile, entitlement status, asset details, service history and known risks.",
              status: "running",
              fields: []
            }
          ]}
        />
      );
    }

    render(<Wrapper />);

    const ticks = 420;
    for (let tick = 0; tick < ticks; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }

    expect(
      screen.getByTestId("stepped-detail-trace").textContent
    ).toContain("Creating a complete customer context package");
  });

  it("fires onTypingComplete after the final character", () => {
    const onTypingComplete = vi.fn();
    render(
      <SteppedLiveTrace
        active
        onTypingComplete={onTypingComplete}
        items={[
          {
            label: "Done.",
            status: "done",
            fields: []
          }
        ]}
      />
    );

    for (let tick = 0; tick < 12; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }

    expect(onTypingComplete).toHaveBeenCalledTimes(1);
  });

  it("continues typing when new trace steps append from polling", () => {
    const onTypingComplete = vi.fn();
    const initial = [
      {
        label: "Triage Agent assigned to Case 00001079.",
        status: "assigned" as const,
        fields: []
      }
    ];
    const { rerender } = render(
      <SteppedLiveTrace
        active
        onTypingComplete={onTypingComplete}
        items={initial}
      />
    );

    for (let tick = 0; tick < 200; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }

    expect(screen.getByText("Triage Agent assigned to Case 00001079.")).toBeInTheDocument();

    rerender(
      <SteppedLiveTrace
        active
        onTypingComplete={onTypingComplete}
        items={[
          ...initial,
          {
            label:
              "Reading and understanding the case, customer priority and next best action.",
            status: "running",
            fields: []
          }
        ]}
      />
    );

    for (let tick = 0; tick < 240; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }

    expect(
      screen.getByTestId("stepped-detail-trace").textContent
    ).toContain(
      "Reading and understanding the case, customer priority and next best action."
    );
    expect(onTypingComplete.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("renders settled trace statuses as completed, not running", () => {
    render(
      <SteppedLiveTrace
        active={false}
        settled
        items={[
          {
            label: "Sending the output back to the Orchestrator for the next action.",
            status: "running",
            fields: []
          },
          {
            label: "Triage Agent assigned to Case 00001079.",
            status: "assigned",
            fields: []
          }
        ]}
      />
    );

    const statuses = screen.getAllByTestId("stepped-trace-step-status");
    expect(statuses.length).toBe(2);
    for (const badge of statuses) {
      expect(badge.textContent).toBe("completed");
    }
  });

  it("detects append-only trace signatures", () => {
    const a = "Triage Agent assigned";
    const b = `${a}\u0001Reading and understanding the case`;
    expect(isTraceSignatureAppendOnly(a, b)).toBe(true);
    expect(isTraceSignatureAppendOnly(b, a)).toBe(false);
    expect(isTraceSignatureAppendOnly(a, a)).toBe(true);
  });
});

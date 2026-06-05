// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OrchestrationPanel } from "@/components/OrchestrationView";
import type { OrchestrationSnapshot } from "@/lib/orchestration";

function snapshot(
  overrides: Partial<OrchestrationSnapshot> = {}
): OrchestrationSnapshot {
  return {
    workflowId: "wf-9d6b898e-affa-406f-941c-6da4e3437e25",
    caseNumber: "00004242",
    status: "done",
    approvalRequired: false,
    writeBackApplied: true,
    triage: {
      recommendedPriority: "critical",
      summary: "Outage affecting service.",
      suggestedNextStep: "Route to network operations.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 42
    },
    events: [
      { status: "assigned", sequence: 1, occurredAt: "t1", safeSummary: "Triage assigned for case 00004242." },
      { status: "running", sequence: 2, occurredAt: "t2", safeSummary: "Reading Case context from Salesforce." },
      { status: "running", sequence: 3, occurredAt: "t3", safeSummary: "Running AI triage." },
      { status: "done", sequence: 4, occurredAt: "t4", safeSummary: "Triage applied: priority critical." }
    ],
    ...overrides
  };
}

describe("OrchestrationPanel", () => {
  afterEach(() => cleanup());

  it("renders Node 1 status, timeline, and sanitized triage output", () => {
    render(<OrchestrationPanel snapshot={snapshot()} />);

    expect(screen.getByText(/Node 1 · Triage/)).toBeInTheDocument();
    expect(screen.getByText("Case 00004242")).toBeInTheDocument();
    expect(screen.getByTestId("triage-priority")).toHaveTextContent(
      "priority: critical"
    );
    expect(screen.getByText("Outage affecting service.")).toBeInTheDocument();
    expect(screen.getByText(/Route to network operations\./)).toBeInTheDocument();
    expect(screen.getByText(/openai · gpt-4o-mini/)).toBeInTheDocument();

    const timeline = screen.getByTestId("status-timeline");
    expect(timeline).toHaveTextContent("AI triage completed.");
    expect(timeline).toHaveTextContent("Triage applied: priority critical.");
  });

  it("renders per-step safe details under each timeline event", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          events: [
            {
              status: "assigned",
              sequence: 1,
              occurredAt: "t1",
              safeSummary: "Triage assigned for case 00004242."
            },
            {
              status: "running",
              sequence: 2,
              occurredAt: "t2",
              safeSummary: "Reading Case context from Salesforce.",
              details: [
                { label: "Reported priority", value: "high" },
                { label: "Status", value: "New" },
                { label: "Account linked", value: "No" }
              ]
            },
            {
              status: "running",
              sequence: 3,
              occurredAt: "t3",
              safeSummary: "Running AI triage.",
              details: [
                { label: "Provider", value: "openai" },
                { label: "Model", value: "gpt-4o-mini" }
              ]
            },
            {
              status: "done",
              sequence: 4,
              occurredAt: "t4",
              safeSummary: "Triage applied: priority critical.",
              details: [{ label: "Write-back", value: "Applied" }]
            }
          ]
        })}
      />
    );

    const detailBlocks = screen.getAllByTestId("event-details");
    expect(detailBlocks.length).toBe(3);
    const timeline = screen.getByTestId("status-timeline");
    expect(timeline).toHaveTextContent("Reported priority");
    expect(timeline).toHaveTextContent("Account linked");
    expect(timeline).toHaveTextContent("Provider");
    expect(timeline).toHaveTextContent("Write-back");
  });

  it("marks historical running timeline events as done after the workflow advances", () => {
    render(<OrchestrationPanel snapshot={snapshot()} />);

    const badges = within(screen.getByTestId("status-timeline"))
      .getAllByTestId("status-badge")
      .map((badge) => badge.getAttribute("data-status"));

    expect(badges).toEqual(["assigned", "done", "done", "done"]);
  });

  it("shows the read-only / approvals-elsewhere notice", () => {
    render(<OrchestrationPanel snapshot={snapshot()} />);
    expect(
      screen.getByText(/Approvals are\s+handled in the account manager/i)
    ).toBeInTheDocument();
  });

  it("never renders approval action controls", () => {
    render(<OrchestrationPanel snapshot={snapshot({ status: "waiting_approval" })} />);
    // The UI is read-only observability: zero buttons, zero inputs.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/^approve$/i)).toBeNull();
    expect(screen.queryByText(/^reject$/i)).toBeNull();
  });

  it("surfaces the waiting_approval lifecycle state", () => {
    render(<OrchestrationPanel snapshot={snapshot({ status: "waiting_approval" })} />);
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.some((b) => b.getAttribute("data-status") === "waiting_approval")).toBe(
      true
    );
  });

  it("shows a safe failure message without raw detail", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          status: "failed",
          writeBackApplied: false,
          triage: undefined,
          failureKind: "salesforce_not_found",
          events: [
            { status: "assigned", sequence: 1, occurredAt: "t1", safeSummary: "Assigned" },
            { status: "failed", sequence: 2, occurredAt: "t2", safeSummary: "Triage failed." }
          ]
        })}
      />
    );
    expect(screen.getByText(/Triage could not complete/)).toHaveTextContent(
      "salesforce_not_found"
    );
  });
});

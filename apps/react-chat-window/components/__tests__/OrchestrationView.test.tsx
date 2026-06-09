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
    node: "triage",
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
      {
        node: "triage",
        status: "assigned",
        sequence: 1,
        occurredAt: "t1",
        safeSummary: "Triage assigned for case 00004242."
      },
      {
        node: "triage",
        status: "running",
        sequence: 2,
        occurredAt: "t2",
        safeSummary: "Reading Case context from Salesforce."
      },
      {
        node: "triage",
        status: "running",
        sequence: 3,
        occurredAt: "t3",
        safeSummary: "Running AI triage."
      },
      {
        node: "triage",
        status: "done",
        sequence: 4,
        occurredAt: "t4",
        safeSummary: "Triage applied: priority critical."
      }
    ],
    ...overrides
  };
}

describe("OrchestrationPanel", () => {
  afterEach(() => cleanup());

  it("renders Node 1 status, timeline, and sanitized triage output", () => {
    render(<OrchestrationPanel snapshot={snapshot()} />);

    expect(
      within(screen.getByTestId("stage-triage")).getByText(/Node 1 · Triage/)
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("stage-knowledge")).getByText(
        /Node 3 · Knowledge Base/
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Case 00004242")).toBeInTheDocument();
    expect(screen.getByTestId("triage-priority")).toHaveTextContent(
      "priority: critical"
    );
    expect(screen.getByText("Outage affecting service.")).toBeInTheDocument();
    expect(screen.getByText(/Route to network operations\./)).toBeInTheDocument();
    expect(screen.getByText("openai")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();

    const timeline = screen.getByTestId("status-timeline");
    expect(timeline).toHaveTextContent("Running AI triage.");
    expect(timeline).toHaveTextContent("Triage applied: priority critical.");
  });

  it("renders per-step safe details under each timeline event", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          events: [
            {
              node: "triage",
              status: "assigned",
              sequence: 1,
              occurredAt: "t1",
              safeSummary: "Triage assigned for case 00004242."
            },
            {
              node: "triage",
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
              node: "triage",
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
              node: "triage",
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
      screen.getByText(/Approvals remain outside this console/i)
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
          node: "triage",
          writeBackApplied: false,
          triage: undefined,
          failureKind: "salesforce_not_found",
          events: [
            {
              node: "triage",
              status: "assigned",
              sequence: 1,
              occurredAt: "t1",
              safeSummary: "Assigned"
            },
            {
              node: "triage",
              status: "failed",
              sequence: 2,
              occurredAt: "t2",
              safeSummary: "Triage failed."
            }
          ]
        })}
      />
    );
    expect(screen.getByText(/Workflow could not complete/)).toHaveTextContent(
      "salesforce_not_found"
    );
  });

  it("renders execution trace sections and customer-context findings", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "triage",
          customerContext: {
            eligible: true,
            degraded: false,
            eligibilityReason: "origin=Phone priority=critical",
            package: {
              customerTier: {
                value: "premium",
                confidence: "high",
                provenance: "Salesforce Account",
                evidenceBasis: "Account tier: premium"
              },
              slaClass: {
                value: "premium",
                confidence: "high",
                provenance: "Salesforce Entitlement",
                evidenceBasis: "SLA class: premium"
              },
              warrantyStatus: {
                value: "covered",
                confidence: "high",
                provenance: "Salesforce Asset warranty",
                evidenceBasis: "Warranty status: covered"
              },
              repeatIncident: {
                value: { repeat: true, count: 3, windowDays: 30 },
                confidence: "high",
                provenance: "Salesforce Case history",
                evidenceBasis: "3 cases in 30d"
              },
              strategicAccount: {
                value: true,
                confidence: "high",
                provenance: "Salesforce Account flag",
                evidenceBasis: "Strategic flag: yes"
              },
              installedAssets: {
                value: { totalAssets: 2, modelCount: 1, primaryModel: "VX-900" },
                confidence: "high",
                provenance: "Salesforce Asset",
                evidenceBasis: "2 assets across 1 models"
              },
              openIncidentCount: {
                value: 1,
                confidence: "high",
                provenance: "Salesforce Case history",
                evidenceBasis: "1 open incidents"
              },
              escalationHistory: {
                value: 2,
                confidence: "high",
                provenance: "Salesforce Case history",
                evidenceBasis: "2 prior escalations"
              },
              businessRisk: {
                value: "high",
                confidence: "high",
                provenance: "AI synthesis",
                evidenceBasis: "Risk signals: strategic, repeat-failure, premium"
              }
            }
          },
          events: [
            ...snapshot().events,
            {
              node: "customer_history",
              status: "running",
              sequence: 5,
              occurredAt: "t5",
              safeSummary: "Writing customer findings to state.",
              trace: {
                stepKey: "write_customer_context_state",
                sections: [
                  {
                    key: "outputs",
                    title: "Outputs",
                    data: { customerContextWritten: true, businessRisk: "high" }
                  },
                  {
                    key: "state_changes",
                    title: "State changes",
                    data: [
                      {
                        path: "customerContext",
                        change: "added",
                        after: { eligible: true }
                      }
                    ]
                  }
                ]
              }
            },
            {
              node: "knowledge",
              status: "running",
              sequence: 6,
              occurredAt: "t6",
              safeSummary: "Writing knowledge findings to state.",
              trace: {
                stepKey: "knowledge_write",
                sections: [
                  {
                    key: "outputs",
                    title: "Outputs",
                    data: { knowledgeGuidanceWritten: true, status: "ANSWERED" }
                  },
                  {
                    key: "state_changes",
                    title: "State changes",
                    data: [
                      {
                        path: "knowledgeGuidance",
                        change: "added",
                        after: { eligible: true, status: "ANSWERED" }
                      }
                    ]
                  }
                ]
              }
            }
          ],
          knowledgeGuidance: {
            eligible: true,
            degraded: false,
            status: "ANSWERED",
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
          }
        })}
      />
    );

    expect(
      screen.getByRole("heading", { name: /Customer context package/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Knowledge guidance/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Knowledge finished")).toBeInTheDocument();
    expect(
      screen.getByText("Latest node: Node 3 · Knowledge Base")
    ).toBeInTheDocument();
    expect(screen.getByText(/Repeat failure/)).toBeInTheDocument();
    expect(screen.getByText(/Suggested next step/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Battery Not Charging on AeroVolt ProBook 15X/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Agent Reasoning \/ Execution Trace/).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/State before and after each step/)).toBeInTheDocument();
    expect(screen.getByText(/Knowledge · Writing knowledge findings to state\./)).toBeInTheDocument();
  });
});

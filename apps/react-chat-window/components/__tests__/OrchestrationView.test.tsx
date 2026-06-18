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
    expect(
      screen.getByText(/Route to network operations\./)
    ).toBeInTheDocument();
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
    render(
      <OrchestrationPanel snapshot={snapshot({ status: "waiting_approval" })} />
    );
    // The UI is read-only observability: zero buttons, zero inputs.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/^approve$/i)).toBeNull();
    expect(screen.queryByText(/^reject$/i)).toBeNull();
  });

  it("surfaces the waiting_approval lifecycle state", () => {
    render(
      <OrchestrationPanel snapshot={snapshot({ status: "waiting_approval" })} />
    );
    const badges = screen.getAllByTestId("status-badge");
    expect(
      badges.some((b) => b.getAttribute("data-status") === "waiting_approval")
    ).toBe(true);
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
                value: {
                  totalAssets: 2,
                  modelCount: 1,
                  primaryModel: "VX-900"
                },
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
                evidenceBasis:
                  "Risk signals: strategic, repeat-failure, premium"
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
    expect(screen.getByText(/Recommended guidance/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Battery Not Charging on AeroVolt ProBook 15X/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Agent Reasoning \/ Execution Trace/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/State before and after each step/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Knowledge · Writing knowledge findings to state\./)
    ).toBeInTheDocument();
  });

  it("renders Node 3 guidance as scannable label/value rows and always-visible sources", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "knowledge",
          knowledgeGuidance: {
            eligible: true,
            degraded: false,
            status: "ANSWERED",
            answer: {
              safeSummary:
                "Product: AeroVolt ProBook 15X, Category: Power, Issue: Battery not charging, Symptoms: No charge LED, Cause: Faulty adapter",
              sources: [
                {
                  sourceId: "kb-av-lp-15x-pro-battery-1",
                  title: "Battery Not Charging on AeroVolt ProBook 15X",
                  version: "3",
                  retrievalScorePercentile: 81
                }
              ],
              provider: "openai",
              model: "gpt-4o-mini",
              retrievalId: "ret-123",
              latencyMs: 253
            }
          }
        })}
      />
    );

    const detail = screen.getByTestId("knowledge-guidance-detail");
    expect(within(detail).getByText("Product")).toBeInTheDocument();
    expect(
      within(detail).getByText("AeroVolt ProBook 15X")
    ).toBeInTheDocument();
    expect(within(detail).getByText("Issue")).toBeInTheDocument();
    expect(
      within(detail).getByText("Battery not charging")
    ).toBeInTheDocument();
    expect(within(detail).getByText("Cause")).toBeInTheDocument();

    // Sources are visible without expanding a collapsed panel.
    const sources = screen.getByTestId("knowledge-sources");
    expect(sources.tagName).not.toBe("DETAILS");
    expect(
      within(sources).getByText("Battery Not Charging on AeroVolt ProBook 15X")
    ).toBeInTheDocument();
    expect(within(sources).getByText(/Score: 81/)).toBeInTheDocument();
  });

  it("renders the Final Verdict panel with headline, steps, and highlights", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          orchestratorVerdict: {
            headline: "Critical priority case · high business risk",
            summary:
              "Triage recommends critical priority with high business risk. The recommended priority was written back to the Case.",
            recommendedSteps: [
              "Route to network operations.",
              'Review 2 knowledge source(s), starting with "Battery Not Charging".'
            ],
            highlights: [
              { label: "Priority", value: "critical" },
              { label: "Business risk", value: "high" },
              { label: "Write-back", value: "Applied" }
            ],
            basis: ["triage", "customerContext", "knowledgeGuidance"]
          }
        })}
      />
    );

    const verdict = screen.getByTestId("final-verdict");
    expect(
      within(verdict).getByText(/Critical priority case/)
    ).toBeInTheDocument();
    expect(
      within(verdict).getByText(/Route to network operations\./)
    ).toBeInTheDocument();
    expect(within(verdict).getByText(/Business risk:/)).toBeInTheDocument();
    expect(
      within(verdict).getByText(
        /downstream automation uses the typed channels/i
      )
    ).toBeInTheDocument();
  });

  it("omits the Final Verdict panel when there is no verdict", () => {
    render(<OrchestrationPanel snapshot={snapshot()} />);
    expect(screen.queryByTestId("final-verdict")).toBeNull();
  });

  it("renders typed Node 3 actions, confidence, and prefers displaySummary", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "knowledge",
          knowledgeGuidance: {
            eligible: true,
            degraded: false,
            status: "ANSWERED",
            answer: {
              safeSummary: "Product: X, Category: Power",
              displaySummary:
                "Run diagnostics, then replace the battery if needed.",
              guidanceConfidence: "high",
              recommendedActions: [
                {
                  actionType: "run_diagnostic",
                  confidence: "high",
                  rationale: "Run BIOS battery diagnostics first.",
                  requiredApproval: false
                },
                {
                  actionType: "replace_part",
                  confidence: "medium",
                  rationale: "Replace SP-BATT-15X if confirmed.",
                  requiredApproval: true
                }
              ],
              safetyFlags: [
                {
                  code: "HV",
                  message: "Disconnect power before servicing.",
                  severity: "warning"
                }
              ],
              sources: [{ sourceId: "kb-1", title: "Battery guide" }]
            }
          }
        })}
      />
    );

    const actions = screen.getByTestId("knowledge-actions");
    expect(within(actions).getByText(/run diagnostic/i)).toBeInTheDocument();
    expect(
      within(actions).getByText(/Run BIOS battery diagnostics first\./)
    ).toBeInTheDocument();
    expect(within(actions).getByText("Approval")).toBeInTheDocument();

    expect(
      within(screen.getByTestId("knowledge-safety-flags")).getByText(
        /Disconnect power before servicing\./
      )
    ).toBeInTheDocument();

    // Display summary is preferred over the raw safeSummary metadata.
    const detail = screen.getByTestId("knowledge-guidance-detail");
    expect(
      within(detail).getByText(/Run diagnostics, then replace the battery/)
    ).toBeInTheDocument();

    expect(screen.getByText(/Guidance confidence/)).toBeInTheDocument();
  });

  it("falls back to readable prose when Node 3 guidance is not label/value metadata", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "knowledge",
          knowledgeGuidance: {
            eligible: true,
            degraded: false,
            status: "ANSWERED",
            answer: {
              safeSummary:
                "Verify adapter functionality and replace the battery if diagnostics confirm failure.",
              sources: [],
              provider: "openai",
              model: "gpt-4o-mini"
            }
          }
        })}
      />
    );

    const detail = screen.getByTestId("knowledge-guidance-detail");
    expect(
      within(detail).getByText(
        /Verify adapter functionality and replace the battery/
      )
    ).toBeInTheDocument();
  });

  it("renders Node 4 KB cross-check, fulfillment writes, and per-part write status", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "parts_logistics",
          events: [
            ...snapshot().events,
            {
              node: "parts_logistics",
              status: "done",
              sequence: 5,
              occurredAt: "t5",
              safeSummary: "Parts logistics planned."
            }
          ],
          partsLogistics: {
            eligible: true,
            degraded: false,
            status: "PLANNED",
            fulfillmentReadiness: "ready_with_transfer",
            fulfillmentConfidence: "high",
            kbCrossCheck: {
              status: "ALIGNED",
              alignedCount: 1,
              divergentCount: 0,
              undocumentedCount: 0
            },
            writeOutcome: {
              applied: true,
              degraded: false,
              createdCount: 1,
              idempotentSkipCount: 0
            },
            partPlans: [
              {
                partNumber: "SP-DISP-15X-FHD",
                requestedQuantity: 1,
                compatibility: "confirmed",
                compatibilityEvidence: "Asset match",
                availability: "transfer_required",
                exceptionType: "transfer_required",
                transferRequired: true,
                sourceWarehouseReference: "WH-EAST-01",
                fulfillmentWarehouseReference: "WH-WEST-02",
                reservationStatus: "transfer_pending",
                fulfillmentRecordType: "ProductTransfer",
                fulfillmentRecordId: "0a9000000000001",
                confidence: "high",
                requiredApproval: true,
                approvalReason: "transfer_required",
                rationale: "Cross-region transfer required.",
                kbWarehouseAlignment: "aligned"
              }
            ]
          }
        })}
      />
    );

    const summary = screen.getByTestId("parts-logistics-summary");
    expect(
      within(summary).getByText("KB warehouse cross-check")
    ).toBeInTheDocument();
    expect(within(summary).getByText("ALIGNED")).toBeInTheDocument();
    expect(within(summary).getByText("Fulfillment writes")).toBeInTheDocument();
    expect(within(summary).getByText("1 created")).toBeInTheDocument();
    expect(
      within(summary).getByText(/transfer pending · ProductTransfer/i)
    ).toBeInTheDocument();
    expect(within(summary).getByText(/KB aligned/i)).toBeInTheDocument();
    expect(screen.getByText(/Completed stages: 2\/6/)).toBeInTheDocument();
  });

  it("renders the Node 5 scheduling card with a sanitized technician + window", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "scheduling",
          events: [
            {
              node: "scheduling",
              status: "running",
              sequence: 1,
              occurredAt: "t1",
              safeSummary:
                "Scheduling schedulable: SR-A1 · Tomorrow 13:00–15:00 UTC."
            }
          ],
          scheduling: {
            eligible: true,
            degraded: false,
            status: "PLANNED",
            schedulingReadiness: "schedulable",
            recommendedResourceReference: "SR-A1",
            candidates: [
              {
                resourceReference: "SR-A1",
                territoryReference: "North America",
                territoryMembership: "secondary",
                matchedSkills: ["Laptop Hardware", "Battery/Power"],
                skillScore: 0.85,
                availabilityScore: 1,
                territoryFitScore: 0.7,
                rankScore: 0.7,
                rank: 1,
                earliestAvailableAt: "2026-06-16T13:00:00.000Z",
                rationale:
                  "matches Battery/Power; secondary member of North America."
              }
            ],
            proposedWindow: {
              earliestStart: "2026-06-16T12:00:00.000Z",
              earliestStartBasis: "parts_eta",
              proposedStart: "2026-06-16T13:00:00.000Z",
              proposedEnd: "2026-06-16T15:00:00.000Z",
              displayWindow: "Tomorrow 13:00–15:00 UTC (after parts arrive)",
              durationMinutes: 120,
              windowConfidence: "high",
              partsEtaConstrained: true
            },
            partsEtaConsidered: true,
            partsReadinessSeen: "ready",
            requiredApproval: false,
            appointmentStatus: "proposed",
            confidence: "high"
          }
        })}
      />
    );

    const summary = screen.getByTestId("scheduling-summary");
    expect(within(summary).getByText("schedulable")).toBeInTheDocument();
    expect(within(summary).getAllByText("SR-A1").length).toBeGreaterThan(0);
    expect(
      within(summary).getByText(
        /Tomorrow 13:00–15:00 UTC \(after parts arrive\)/
      )
    ).toBeInTheDocument();
    expect(within(summary).getByText(/gated on parts ETA/)).toBeInTheDocument();
    // Stage rail shows Node 5 and the count is out of five stages.
    expect(
      within(screen.getByTestId("stage-scheduling")).getByText(
        /Node 5 · Scheduling/
      )
    ).toBeInTheDocument();
    // The stage count is now out of six nodes.
    expect(screen.getByText(/Completed stages: \d\/6/)).toBeInTheDocument();
    // No full technician name ever reaches the DOM.
    expect(screen.queryByText(/Techinican/)).toBeNull();
  });

  it("renders the Node 6 guardrail card and the waiting-for-approval state", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "guardrail",
          status: "waiting_approval",
          approvalRequired: true,
          writeBackApplied: false,
          events: [
            ...snapshot().events,
            {
              node: "guardrail",
              status: "waiting_approval",
              sequence: 5,
              occurredAt: "t5",
              safeSummary:
                "Awaiting human approval — guardrail flagged the case for review."
            }
          ],
          guardrail: {
            eligible: true,
            outcome: "requireHumanApproval",
            riskScore: 70,
            riskLevel: "high",
            policyRulesTriggered: [
              {
                ruleId: "PARTS_APPROVAL_REQUIRED",
                channelSource: "partsLogistics",
                triggered: true,
                riskPoints: 20,
                isHardRule: false,
                description: "Parts plan requires approval."
              },
              {
                ruleId: "SCHEDULING_AFTER_HOURS",
                channelSource: "scheduling",
                triggered: true,
                riskPoints: 10,
                isHardRule: false,
                description: "Scheduling proposed an after-hours window."
              }
            ],
            channelBasis: ["triage", "partsLogistics", "scheduling"],
            requiresHumanApproval: true,
            approvalRequired: true,
            approvalReasons: [
              "Parts plan requires approval.",
              "Scheduling proposed an after-hours window."
            ],
            degraded: false
          }
        })}
      />
    );

    const summary = screen.getByTestId("guardrail-summary");
    expect(
      within(summary).getByTestId("guardrail-outcome-badge")
    ).toHaveTextContent("Waiting for Approval");
    expect(within(summary).getByText("70 / HIGH")).toBeInTheDocument();
    expect(
      within(summary).getByText("PARTS_APPROVAL_REQUIRED")
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("SCHEDULING_AFTER_HOURS")
    ).toBeInTheDocument();
    // The Node 6 stage shows the waiting state in the rail.
    expect(
      within(screen.getByTestId("stage-guardrail")).getByText(
        /Node 6 · Compliance & Guardrail/
      )
    ).toBeInTheDocument();
    // It remains read-only — no approval controls.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the escalated guardrail outcome and lifecycle state", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "guardrail",
          status: "escalated",
          approvalDecision: "escalated",
          writeBackApplied: false,
          guardrail: {
            eligible: true,
            outcome: "escalate",
            riskScore: 100,
            riskLevel: "critical",
            policyRulesTriggered: [
              {
                ruleId: "SAFETY_CRITICAL_KB",
                channelSource: "knowledgeGuidance",
                triggered: true,
                riskPoints: 0,
                isHardRule: true,
                description: "Knowledge base raised a safety-critical flag."
              }
            ],
            channelBasis: ["triage", "knowledgeGuidance"],
            requiresHumanApproval: false,
            approvalRequired: false,
            approvalReasons: ["Knowledge base raised a safety-critical flag."],
            degraded: false
          }
        })}
      />
    );

    expect(
      within(screen.getByTestId("guardrail-summary")).getByTestId(
        "guardrail-outcome-badge"
      )
    ).toHaveTextContent("Escalated");
    // The overall workflow badge reflects the new terminal lifecycle state.
    const badges = screen.getAllByTestId("status-badge");
    expect(
      badges.some((b) => b.getAttribute("data-status") === "escalated")
    ).toBe(true);
  });

  it("shows the auto-approved guardrail outcome with no triggered rules", () => {
    render(
      <OrchestrationPanel
        snapshot={snapshot({
          node: "guardrail",
          status: "done",
          approvalRequired: false,
          approvalDecision: "approved",
          writeBackApplied: true,
          guardrail: {
            eligible: true,
            outcome: "autoApprove",
            riskScore: 5,
            riskLevel: "low",
            policyRulesTriggered: [],
            channelBasis: ["triage", "partsLogistics", "scheduling"],
            requiresHumanApproval: false,
            approvalRequired: false,
            approvalReasons: [],
            autoApproveReason:
              "Composite risk score 5 (low); no approval flags triggered.",
            degraded: false
          }
        })}
      />
    );

    expect(
      within(screen.getByTestId("guardrail-summary")).getByTestId(
        "guardrail-outcome-badge"
      )
    ).toHaveTextContent("Auto-Approved");
    expect(screen.queryByTestId("guardrail-rules")).toBeNull();
  });
});

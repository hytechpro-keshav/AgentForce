import { describe, expect, it } from "vitest";

import {
  isValidCaseId,
  isTerminalStatus,
  isValidWorkflowId,
  sanitizeSnapshot,
  statusLabel,
  STATUS_META,
  type OrchestrationStatus
} from "@/lib/orchestration";

const VALID_WORKFLOW_ID = "wf-9d6b898e-affa-406f-941c-6da4e3437e25";

describe("isValidWorkflowId", () => {
  it("accepts a wf-<uuid> id", () => {
    expect(isValidWorkflowId(VALID_WORKFLOW_ID)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidWorkflowId("not-a-workflow")).toBe(false);
    expect(isValidWorkflowId("wf-123")).toBe(false);
    expect(isValidWorkflowId("")).toBe(false);
  });
});

describe("isValidCaseId", () => {
  it("accepts 15 and 18 character Salesforce ids", () => {
    expect(isValidCaseId("500000000000001")).toBe(true);
    expect(isValidCaseId("500000000000001ABC")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidCaseId("500")).toBe(false);
    expect(isValidCaseId("not-a-case-id")).toBe(false);
    expect(isValidCaseId(VALID_WORKFLOW_ID)).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("treats done/rejected/failed as terminal", () => {
    for (const status of [
      "done",
      "rejected",
      "failed"
    ] as OrchestrationStatus[]) {
      expect(isTerminalStatus(status)).toBe(true);
    }
  });

  it("treats assigned/running/waiting_approval as non-terminal", () => {
    for (const status of [
      "assigned",
      "running",
      "waiting_approval"
    ] as OrchestrationStatus[]) {
      expect(isTerminalStatus(status)).toBe(false);
    }
  });
});

describe("statusLabel + STATUS_META", () => {
  it("has a label and tone for every status", () => {
    for (const status of Object.keys(STATUS_META) as OrchestrationStatus[]) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
      expect(STATUS_META[status].tone.length).toBeGreaterThan(0);
    }
  });
});

describe("sanitizeSnapshot", () => {
  it("parses a valid snapshot and keeps only safe fields", () => {
    const snapshot = sanitizeSnapshot({
      workflowId: VALID_WORKFLOW_ID,
      node: "triage",
      caseNumber: "00004242",
      status: "done",
      approvalRequired: false,
      writeBackApplied: true,
      triage: {
        recommendedPriority: "critical",
        summary: "Outage affecting service.",
        suggestedNextStep: "Route to network ops.",
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
          safeSummary: "Assigned"
        },
        {
          node: "triage",
          status: "running",
          sequence: 2,
          occurredAt: "t2",
          safeSummary: "Running"
        },
        {
          node: "triage",
          status: "done",
          sequence: 3,
          occurredAt: "t3",
          safeSummary: "Done"
        }
      ],
      // Hidden/unsafe fields that must never survive sanitization:
      rawPrompt: "chain of thought",
      caseDescription: "secret-customer-detail"
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.status).toBe("done");
    expect(snapshot!.node).toBe("triage");
    expect(snapshot!.triage?.recommendedPriority).toBe("critical");
    expect(snapshot!.events).toHaveLength(3);
    expect(JSON.stringify(snapshot)).not.toContain("chain of thought");
    expect(JSON.stringify(snapshot)).not.toContain("secret-customer-detail");
    expect("rawPrompt" in (snapshot as object)).toBe(false);
  });

  it("returns null for a missing workflowId or bad status", () => {
    expect(sanitizeSnapshot({ status: "done" })).toBeNull();
    expect(
      sanitizeSnapshot({ workflowId: VALID_WORKFLOW_ID, status: "weird" })
    ).toBeNull();
    expect(sanitizeSnapshot(null)).toBeNull();
    expect(sanitizeSnapshot("nope")).toBeNull();
  });

  it("drops triage with an invalid priority and filters bad events", () => {
    const snapshot = sanitizeSnapshot({
      workflowId: VALID_WORKFLOW_ID,
      node: "triage",
      status: "running",
      triage: { recommendedPriority: "spicy", summary: "x" },
      events: [
        { node: "triage", status: "running", sequence: 2, occurredAt: "t2" },
        { node: "triage", status: "bogus", sequence: 1, occurredAt: "t1" },
        { sequence: 3 }
      ]
    });

    expect(snapshot!.triage).toBeUndefined();
    expect(snapshot!.events).toHaveLength(1);
    expect(snapshot!.events[0].status).toBe("running");
  });

  it("sorts events by sequence", () => {
    const snapshot = sanitizeSnapshot({
      workflowId: VALID_WORKFLOW_ID,
      node: "triage",
      status: "done",
      events: [
        { node: "triage", status: "done", sequence: 3, occurredAt: "t3" },
        { node: "triage", status: "assigned", sequence: 1, occurredAt: "t1" },
        { node: "triage", status: "running", sequence: 2, occurredAt: "t2" }
      ]
    });
    expect(snapshot!.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("keeps safe event details and drops malformed ones", () => {
    const snapshot = sanitizeSnapshot({
      workflowId: VALID_WORKFLOW_ID,
      node: "triage",
      status: "done",
      events: [
        {
          node: "triage",
          status: "running",
          sequence: 1,
          occurredAt: "t1",
          details: [
            { label: "Provider", value: "openai" },
            { label: "Model", value: "gpt-4o-mini" },
            { label: "missing value" },
            { value: "missing label" },
            "not-an-object",
            { label: "Latency", value: "42 ms" }
          ]
        }
      ]
    });

    const details = snapshot!.events[0].details;
    expect(details).toHaveLength(3);
    expect(details).toEqual([
      { label: "Provider", value: "openai" },
      { label: "Model", value: "gpt-4o-mini" },
      { label: "Latency", value: "42 ms" }
    ]);
  });

  it("caps the number of event details and clips long values", () => {
    const longValue = "x".repeat(500);
    const snapshot = sanitizeSnapshot({
      workflowId: VALID_WORKFLOW_ID,
      node: "triage",
      status: "done",
      events: [
        {
          node: "triage",
          status: "done",
          sequence: 1,
          occurredAt: "t1",
          details: Array.from({ length: 20 }, (_, i) => ({
            label: `L${i}`,
            value: longValue
          }))
        }
      ]
    });

    const details = snapshot!.events[0].details!;
    expect(details.length).toBeLessThanOrEqual(8);
    expect(details[0].value.length).toBeLessThanOrEqual(120);
  });

  it("omits details when none are valid", () => {
    const snapshot = sanitizeSnapshot({
      workflowId: VALID_WORKFLOW_ID,
      node: "triage",
      status: "done",
      events: [
        {
          node: "triage",
          status: "done",
          sequence: 1,
          occurredAt: "t1",
          details: [{ nope: true }, "bad"]
        }
      ]
    });
    expect(snapshot!.events[0].details).toBeUndefined();
  });

  it("keeps structured execution traces and customer context packages", () => {
    const snapshot = sanitizeSnapshot({
      workflowId: VALID_WORKFLOW_ID,
      node: "customer_history",
      status: "done",
      customerContext: {
        eligible: true,
        degraded: false,
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
        {
          node: "customer_history",
          status: "running",
          sequence: 1,
          occurredAt: "t1",
          trace: {
            stepKey: "write_customer_context_state",
            sections: [
              {
                key: "outputs",
                title: "Outputs",
                data: { customerContextWritten: true, businessRisk: "high" }
              }
            ]
          }
        }
      ]
    });

    expect(snapshot?.customerContext?.package?.businessRisk.value).toBe("high");
    expect(snapshot?.events[0].trace?.stepKey).toBe(
      "write_customer_context_state"
    );
    expect(snapshot?.events[0].trace?.sections[0].key).toBe("outputs");
  });
});

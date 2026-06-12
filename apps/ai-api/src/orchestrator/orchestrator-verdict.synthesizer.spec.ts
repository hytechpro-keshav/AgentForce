import { synthesizeOrchestratorVerdict } from "./orchestrator-verdict.synthesizer";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type { SanitizedTriageResult } from "./dto/orchestration-status-event";

const triage: SanitizedTriageResult = {
  recommendedPriority: "critical",
  summary: "Outage affecting service.",
  suggestedNextStep: "Route to network operations.",
  provider: "openai",
  model: "gpt-4o-mini",
  fallbackUsed: false,
  latencyMs: 42
};

function customerContext(
  overrides: Partial<CustomerContextChannel["package"]> = {}
): CustomerContextChannel {
  return {
    eligible: true,
    degraded: false,
    package: {
      customerTier: {
        value: "premium",
        confidence: "high",
        provenance: "Salesforce Account",
        evidenceBasis: "tier"
      },
      slaClass: {
        value: "premium",
        confidence: "high",
        provenance: "Salesforce Entitlement",
        evidenceBasis: "sla"
      },
      warrantyStatus: {
        value: "covered",
        confidence: "high",
        provenance: "Salesforce Asset",
        evidenceBasis: "warranty"
      },
      repeatIncident: {
        value: { repeat: true, count: 3, windowDays: 30 },
        confidence: "high",
        provenance: "Salesforce Case history",
        evidenceBasis: "3 in 30d"
      },
      strategicAccount: {
        value: true,
        confidence: "high",
        provenance: "Salesforce Account",
        evidenceBasis: "flag"
      },
      installedAssets: {
        value: { totalAssets: 2, modelCount: 1, primaryModel: "VX-900" },
        confidence: "high",
        provenance: "Salesforce Asset",
        evidenceBasis: "assets"
      },
      openIncidentCount: {
        value: 1,
        confidence: "high",
        provenance: "Salesforce Case history",
        evidenceBasis: "open"
      },
      escalationHistory: {
        value: 2,
        confidence: "high",
        provenance: "Salesforce Case history",
        evidenceBasis: "escalations"
      },
      businessRisk: {
        value: "high",
        confidence: "high",
        provenance: "AI synthesis",
        evidenceBasis: "risk"
      },
      ...overrides
    }
  } as CustomerContextChannel;
}

const knowledgeAnswered: KnowledgeGuidanceChannel = {
  eligible: true,
  degraded: false,
  status: "ANSWERED",
  answer: {
    safeSummary: "Replace the battery if diagnostics fail.",
    sources: [
      { sourceId: "kb-1", title: "Battery Not Charging on ProBook 15X" },
      { sourceId: "kb-2", title: "Adapter diagnostics" }
    ]
  }
};

describe("synthesizeOrchestratorVerdict", () => {
  it("builds a headline, summary, steps, and highlights from typed channels", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      customerContext: customerContext(),
      knowledgeGuidance: knowledgeAnswered
    });

    expect(verdict.headline).toContain("Critical priority");
    expect(verdict.headline).toContain("high business risk");
    expect(verdict.summary).toContain("critical priority");
    expect(verdict.summary).toContain("2 matching source");
    expect(verdict.summary).toContain("written back");
    expect(verdict.recommendedSteps[0]).toBe("Route to network operations.");
    expect(verdict.recommendedSteps.join(" ")).toContain(
      "Battery Not Charging on ProBook 15X"
    );
    expect(verdict.basis).toEqual([
      "triage",
      "customerContext",
      "knowledgeGuidance"
    ]);
    const labels = verdict.highlights.map((h) => h.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Priority", "Business risk", "Knowledge", "Write-back"])
    );
    expect(verdict.highlights.find((h) => h.label === "Write-back")?.value).toBe(
      "Applied"
    );
  });

  it("reflects the waiting_approval outcome", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "waiting_approval",
      approvalRequired: true,
      triage,
      customerContext: customerContext(),
      knowledgeGuidance: knowledgeAnswered
    });
    expect(verdict.summary).toContain("awaiting out-of-band approval");
    expect(verdict.recommendedSteps.join(" ")).toContain("Approve or reject");
    expect(verdict.highlights.find((h) => h.label === "Write-back")?.value).toBe(
      "Awaiting approval"
    );
  });

  it("handles a no-source, knowledge-skipped, triage-only case", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      knowledgeGuidance: { eligible: true, degraded: false, status: "NO_SOURCE" }
    });
    expect(verdict.summary).toContain("No matching knowledge sources");
    expect(verdict.summary).toContain("No write-back was applied");
    expect(verdict.basis).toEqual(["triage", "knowledgeGuidance"]);
  });

  it("prefers typed recommendedActions and surfaces guidance confidence", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      knowledgeGuidance: {
        eligible: true,
        degraded: false,
        status: "ANSWERED",
        answer: {
          safeSummary: "Replace the battery if diagnostics fail.",
          guidanceConfidence: "high",
          recommendedActions: [
            {
              actionType: "run_diagnostic",
              confidence: "high",
              rationale: "Run BIOS battery diagnostics before any replacement.",
              requiredApproval: false
            },
            {
              actionType: "replace_part",
              confidence: "medium",
              rationale: "Replace SP-BATT-15X if diagnostics confirm failure.",
              requiredApproval: true
            }
          ],
          sources: [{ sourceId: "kb-1", title: "Battery guide" }]
        }
      }
    });

    expect(verdict.recommendedSteps).toContain(
      "Run BIOS battery diagnostics before any replacement."
    );
    expect(verdict.recommendedSteps.join(" ")).not.toContain(
      "Review 1 knowledge source"
    );
    expect(
      verdict.highlights.find((h) => h.label === "Guidance confidence")?.value
    ).toBe("high");
  });

  it("does not embed raw knowledge chunk text in the verdict", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      knowledgeGuidance: knowledgeAnswered
    });
    const serialized = JSON.stringify(verdict);
    expect(serialized).not.toContain("Replace the battery if diagnostics fail.");
  });
});

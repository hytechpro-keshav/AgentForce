import {
  buildAgentCaseNarrative,
  type AgentNarrativeKey
} from "./agent-case-narrative.builder";
import type { CaseTriageStateType } from "./case-triage.graph";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type { SchedulingChannel } from "./dto/scheduling";
import type { GuardrailChannel } from "./dto/guardrail";
import type { SanitizedTriageResult } from "./dto/orchestration-status-event";

function baseState(
  overrides: Partial<CaseTriageStateType> = {}
): CaseTriageStateType {
  return {
    workflowId: "wf-test",
    caseId: "500000000000001",
    tenantId: "tenant-1",
    principalSubject: "orchestrator",
    approvalRequired: false,
    writeBackApplied: false,
    status: "running",
    ...overrides
  } as CaseTriageStateType;
}

const triage: SanitizedTriageResult = {
  recommendedPriority: "normal",
  summary: "Display issue.",
  suggestedNextStep: "Replace panel.",
  provider: "openai",
  model: "gpt-4o-mini",
  fallbackUsed: false,
  latencyMs: 10
};

const customerContext: CustomerContextChannel = {
  eligible: true,
  degraded: false,
  package: {
    businessRisk: {
      value: "medium",
      confidence: "high",
      provenance: "AI synthesis",
      evidenceBasis: "risk"
    },
    warrantyStatus: {
      value: "covered",
      confidence: "high",
      provenance: "Salesforce Asset",
      evidenceBasis: "warranty"
    },
    repeatIncident: {
      value: { repeat: false, count: 0, windowDays: 30 },
      confidence: "high",
      provenance: "Salesforce Case history",
      evidenceBasis: "repeat"
    }
  }
} as CustomerContextChannel;

describe("buildAgentCaseNarrative", () => {
  it("Agent 1 includes priority, customer context, and LLM summary", () => {
    const body = buildAgentCaseNarrative(
      "triage",
      baseState({
        triage: {
          ...triage,
          recommendedPriority: "high",
          summary:
            "The case is prioritized as high due to the strategic account status, high business risk, and the repeat nature of the overheating incidents.",
          suggestedNextStep:
            "Schedule replacement of cooling parts SP-FAN-15X and SP-HEAT-15X."
        },
        customerContext
      })
    );
    expect(body).toContain("Agent 1 – Triage:");
    expect(body).toContain("High priority");
    expect(body).toContain("strategic account status");
    expect(body).toContain("SP-FAN-15X");
    expect(body).not.toContain("Customer History");
  });

  it("Agent 2 states conclusions, not only article titles", () => {
    const knowledge: KnowledgeGuidanceChannel = {
      eligible: true,
      degraded: false,
      status: "ANSWERED",
      answer: {
        safeSummary:
          "display panel is a hardware defect under warranty; technician visit may be required",
        sources: [
          { sourceId: "kb-1", title: "KB-101" },
          { sourceId: "kb-2", title: "KB-204" },
          { sourceId: "kb-3", title: "KB-305" }
        ],
        recommendedActions: [
          {
            actionType: "replace_part",
            confidence: "medium",
            rationale: "Replace the display assembly.",
            requiredApproval: false
          }
        ],
        suggestedParts: [{ partNumber: "SP-DISP-15X-FHD", confidence: "medium" }],
        guidanceConfidence: "medium"
      }
    };
    const body = buildAgentCaseNarrative(
      "knowledge",
      baseState({ knowledgeGuidance: knowledge })
    );
    expect(body).toContain("Agent 2 – Knowledge Base:");
    expect(body).toContain("Reviewed 3 approved sources");
    expect(body).toContain("Replace the display assembly");
    expect(body).toContain("SP-DISP-15X-FHD");
    expect(body).toContain("Guidance confidence: medium");
  });

  it("Agent 3 covers transfer, part, and ETA", () => {
    const parts: PartsLogisticsChannel = {
      eligible: true,
      degraded: false,
      status: "PARTIAL",
      fulfillmentReadiness: "partial",
      partPlans: [
        {
          partNumber: "SP-DISP-15X-FHD",
          requestedQuantity: 1,
          compatibility: "confirmed",
          compatibilityEvidence: "match",
          availability: "unavailable",
          exceptionType: "inter_warehouse_transfer",
          transferRequired: true,
          fulfillmentWarehouseReference: "WH-AUS-001",
          sourceWarehouseReference: "WH-SJO-002",
          requiredApproval: true,
          approvalReason: "cross_region_transfer",
          estimatedDispatchHoursMin: 26,
          estimatedDispatchHoursMax: 46,
          reservationStatus: "planned",
          confidence: "medium",
          rationale: "Transfer."
        }
      ]
    };
    const body = buildAgentCaseNarrative("parts", baseState({ partsLogistics: parts }));
    expect(body).toContain("Agent 3 – Parts & Logistics:");
    expect(body).toContain("SP-DISP-15X-FHD");
    expect(body).toContain("WH-SJO-002");
    expect(body).toContain("26–46 hours");
  });

  it("Agent 4 covers tentative appointment details", () => {
    const scheduling: SchedulingChannel = {
      eligible: true,
      degraded: false,
      status: "PLANNED",
      schedulingReadiness: "provisional",
      recommendedResourceReference: "SR-A2",
      proposedWindow: {
        earliestStart: "2026-06-16T12:00:00.000Z",
        displayWindow: "Friday 09:00–11:00 PDT",
        earliestStartBasis: "parts_eta",
        durationMinutes: 120,
        windowConfidence: "medium",
        partsEtaConstrained: true
      },
      partsEtaConsidered: true,
      requiredApproval: false,
      appointmentStatus: "proposed"
    };
    const body = buildAgentCaseNarrative(
      "scheduling",
      baseState({ scheduling })
    );
    expect(body).toContain("Agent 4 – Scheduling:");
    expect(body).toContain("SR-A2");
    expect(body).toContain("Friday 09:00–11:00 PDT");
    expect(body).toContain("provisional");
  });

  it("Agent 5 uses Account Manager approval wording", () => {
    const guardrail: GuardrailChannel = {
      eligible: true,
      outcome: "requireHumanApproval",
      riskScore: 45,
      riskLevel: "medium",
      policyRulesEvaluated: [],
      policyRulesTriggered: [],
      channelBasis: ["triage", "partsLogistics", "scheduling"],
      requiresHumanApproval: true,
      approvalRequired: true,
      approvalReasons: ["Parts plan requires approval."],
      degraded: false
    };
    const body = buildAgentCaseNarrative("guardrail", baseState({ guardrail }));
    expect(body).toContain("Agent 5 – Guardrail:");
    expect(body).toContain("Account Manager approval is required");
    expect(body?.toLowerCase()).not.toContain("human approval");
  });

  it("does not emit a separate customer_history agent key", () => {
    const keys: AgentNarrativeKey[] = [
      "triage",
      "knowledge",
      "parts",
      "scheduling",
      "guardrail"
    ];
    expect(keys).not.toContain("customer_history" as AgentNarrativeKey);
  });
});

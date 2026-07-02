import { buildAccountManagerExecutiveSummary } from "./account-manager-summary.synthesizer";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type { SchedulingChannel } from "./dto/scheduling";
import type { GuardrailChannel, GuardrailPolicyRule } from "./dto/guardrail";
import type { SanitizedTriageResult } from "./dto/orchestration-status-event";

const triage: SanitizedTriageResult = {
  recommendedPriority: "normal",
  summary: "Display panel failure.",
  suggestedNextStep: "Replace display assembly.",
  provider: "openai",
  model: "gpt-4o-mini",
  fallbackUsed: false,
  latencyMs: 40
};

function customerContext(): CustomerContextChannel {
  return {
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
}

const partsPartial: PartsLogisticsChannel = {
  eligible: true,
  degraded: false,
  status: "PARTIAL",
  fulfillmentReadiness: "partial",
  partPlans: [
    {
      partNumber: "SP-DISP-15X-FHD",
      requestedQuantity: 1,
      compatibility: "confirmed",
      compatibilityEvidence: "product code match",
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
      rationale: "Transfer required."
    }
  ]
};

const schedulingProvisional: SchedulingChannel = {
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

function guardrailChannel(): GuardrailChannel {
  return {
    eligible: true,
    outcome: "requireHumanApproval",
    riskScore: 45,
    riskLevel: "medium",
    policyRulesEvaluated: [],
    policyRulesTriggered: [
      {
        ruleId: "PARTS_APPROVAL_REQUIRED",
        channelSource: "partsLogistics",
        fieldPath: "x",
        triggered: true,
        riskPoints: 20,
        isHardRule: false,
        description: "Parts plan requires approval."
      } satisfies GuardrailPolicyRule
    ],
    channelBasis: ["triage", "partsLogistics", "scheduling"],
    requiresHumanApproval: true,
    approvalRequired: true,
    approvalReasons: ["Parts plan requires approval."],
    degraded: false
  };
}

describe("buildAccountManagerExecutiveSummary", () => {
  it("matches the Case 00001187-style approvable pattern", () => {
    const summary = buildAccountManagerExecutiveSummary({
      status: "waiting_approval",
      approvalRequired: true,
      triage,
      customerContext: customerContext(),
      partsLogistics: partsPartial,
      scheduling: schedulingProvisional,
      guardrail: guardrailChannel()
    });

    expect(summary).toContain("Normal priority service request");
    expect(summary).toContain("Medium business risk");
    expect(summary).toContain("transferring replacement parts");
    expect(summary).toContain("scheduling a provisional service visit");
    expect(summary).toContain("Account Manager approval is required because");
    expect(summary).toContain(
      "the parts transfer exceeds the configured approval policy"
    );
    expect(summary.toLowerCase()).not.toContain("human approval");
  });

  it("includes the resolved Account Owner name when provided", () => {
    const summary = buildAccountManagerExecutiveSummary(
      {
        status: "waiting_approval",
        triage,
        guardrail: guardrailChannel()
      },
      { accountManagerName: "Jordan Lee" }
    );
    expect(summary).toContain(
      "Account Manager approval is required from Jordan Lee because"
    );
  });

  it("reflects post-approval decisions without human wording", () => {
    const approved = buildAccountManagerExecutiveSummary({
      status: "done",
      writeBackApplied: true,
      triage,
      guardrail: guardrailChannel(),
      approvalDecision: "approved"
    });
    expect(approved).toContain("Account Manager approval was granted");
    expect(approved.toLowerCase()).not.toContain("human");
  });
});

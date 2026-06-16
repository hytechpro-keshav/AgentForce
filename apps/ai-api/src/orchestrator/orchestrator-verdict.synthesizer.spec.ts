import { synthesizeOrchestratorVerdict } from "./orchestrator-verdict.synthesizer";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type { SchedulingChannel } from "./dto/scheduling";
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

const partsLogisticsPartialTransfer: PartsLogisticsChannel = {
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
      requiredApproval: false,
      approvalReason: "none",
      estimatedDispatchHoursMax: 41,
      reservationStatus: "planned",
      confidence: "medium",
      rationale: "Display panel replacement; transfer from SJO to AUS."
    }
  ]
};

describe("synthesizeOrchestratorVerdict", () => {
  it("4b: surfaces a KB-alignment highlight and divergence note", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      partsLogistics: {
        ...partsLogisticsPartialTransfer,
        kbCrossCheck: {
          status: "DIVERGENT",
          alignedCount: 1,
          divergentCount: 1,
          undocumentedCount: 0
        }
      }
    });
    const kb = verdict.highlights.find((h) => h.label === "KB alignment");
    expect(kb?.value).toBe("aligned 1 / divergent 1");
    expect(verdict.summary).toContain("KB warehouse cross-check flagged 1");
  });

  it("4c: reflects applied fulfillment writes in steps and highlights", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      partsLogistics: {
        ...partsLogisticsPartialTransfer,
        partPlans: [
          {
            ...partsLogisticsPartialTransfer.partPlans![0],
            reservationStatus: "transfer_pending",
            fulfillmentRecordType: "ProductTransfer",
            fulfillmentRecordId: "0a9000000000001"
          }
        ],
        writeOutcome: {
          applied: true,
          degraded: false,
          createdCount: 1,
          idempotentSkipCount: 0
        }
      }
    });
    expect(verdict.recommendedSteps.join(" ")).toContain(
      "Inter-warehouse transfer initiated"
    );
    const writes = verdict.highlights.find((h) => h.label === "Parts writes");
    expect(writes?.value).toBe("1 created");
  });

  it("4b: omits the KB-alignment highlight when the cross-check was skipped", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      partsLogistics: {
        ...partsLogisticsPartialTransfer,
        kbCrossCheck: {
          status: "SKIPPED",
          alignedCount: 0,
          divergentCount: 0,
          undocumentedCount: 0
        }
      }
    });
    expect(
      verdict.highlights.find((h) => h.label === "KB alignment")
    ).toBeUndefined();
  });

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

  it("rolls Node 4 partial transfer into headline, summary, steps, and highlights", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      customerContext: customerContext(),
      knowledgeGuidance: knowledgeAnswered,
      partsLogistics: partsLogisticsPartialTransfer
    });

    expect(verdict.headline).toContain("parts transfer required");
    expect(verdict.summary).toContain("SP-DISP-15X-FHD");
    expect(verdict.summary).toContain("WH-SJO-002");
    expect(verdict.summary).toContain("WH-AUS-001");
    expect(verdict.recommendedSteps.join(" ")).toContain(
      "Initiate inter-warehouse transfer for SP-DISP-15X-FHD"
    );
    expect(verdict.highlights.map((h) => h.label)).toEqual(
      expect.arrayContaining(["Parts fulfillment", "Primary part"])
    );
    expect(verdict.basis).toContain("partsLogistics");
  });

  it("surfaces ready fulfillment with dispatch step", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      partsLogistics: {
        eligible: true,
        degraded: false,
        status: "PLANNED",
        fulfillmentReadiness: "ready",
        partPlans: [
          {
            partNumber: "SP-BATT-15X",
            requestedQuantity: 1,
            compatibility: "confirmed",
            compatibilityEvidence: "product code match",
            availability: "available",
            exceptionType: "none",
            transferRequired: false,
            fulfillmentWarehouseReference: "WH-AUS-001",
            requiredApproval: false,
            reservationStatus: "planned",
            confidence: "high",
            rationale: "Battery in stock at fulfillment WH."
          }
        ]
      }
    });

    expect(verdict.headline).toContain("parts available");
    expect(verdict.summary).toContain(
      "Parts plan: SP-BATT-15X is available at WH-AUS-001."
    );
    expect(verdict.recommendedSteps).toContain(
      "Dispatch SP-BATT-15X from WH-AUS-001."
    );
  });

  it("surfaces blocked catalog_gap with catalog review step", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      partsLogistics: {
        eligible: true,
        degraded: false,
        status: "UNAVAILABLE",
        fulfillmentReadiness: "blocked",
        partPlans: [
          {
            partNumber: "SP-UNKNOWN",
            requestedQuantity: 1,
            compatibility: "unknown",
            compatibilityEvidence: "no catalog match",
            availability: "unavailable",
            exceptionType: "catalog_gap",
            transferRequired: false,
            requiredApproval: false,
            reservationStatus: "none",
            confidence: "low",
            rationale: "Part not found in catalog."
          }
        ]
      }
    });

    expect(verdict.headline).toContain("parts fulfillment blocked");
    expect(verdict.summary).toContain("catalog_gap");
    expect(verdict.recommendedSteps).toContain(
      "Review catalog gap for requested part; manual sourcing required."
    );
  });

  it("mentions degraded inventory without stock claims", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      partsLogistics: {
        eligible: true,
        degraded: true,
        degradedSources: ["salesforce_inventory"],
        fulfillmentReadiness: "unknown",
        partPlans: [
          {
            partNumber: "SP-DISP-15X-FHD",
            requestedQuantity: 1,
            compatibility: "confirmed",
            compatibilityEvidence: "product code match",
            availability: "unknown",
            exceptionType: "none",
            transferRequired: false,
            requiredApproval: false,
            reservationStatus: "none",
            confidence: "low",
            rationale: "Inventory read failed."
          }
        ]
      }
    });

    expect(verdict.headline).toContain("parts inventory degraded");
    expect(verdict.summary).toContain("degraded mode");
    expect(verdict.summary).not.toContain("available at");
    expect(verdict.recommendedSteps.join(" ")).not.toContain("SP-DISP-15X-FHD");
  });

  it("skips parts detail when eligible is false", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      partsLogistics: {
        eligible: false,
        degraded: false,
        eligibilityReason: "Parts logistics disabled by config"
      }
    });

    expect(verdict.headline).not.toContain("parts");
    expect(verdict.summary).toContain("not eligible");
    expect(verdict.summary).not.toMatch(/SP-/);
    expect(verdict.recommendedSteps.join(" ")).not.toMatch(/SP-/);
    expect(
      verdict.highlights.find((h) => h.label === "Primary part")
    ).toBeUndefined();
  });

  it("adds approval step and highlight when required", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      partsLogistics: {
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
            reservationStatus: "planned",
            confidence: "medium",
            rationale: "Cross-region transfer requires approval."
          }
        ]
      }
    });

    expect(verdict.recommendedSteps).toContain(
      "Approve parts action: SP-DISP-15X-FHD (cross_region_transfer)."
    );
    expect(
      verdict.highlights.find((h) => h.label === "Parts approvals")?.value
    ).toBe("1 required");
  });

  it("appends +N more when multiple part plans exist", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      partsLogistics: {
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
            estimatedDispatchHoursMax: 41,
            requiredApproval: false,
            reservationStatus: "planned",
            confidence: "medium",
            rationale: "Display panel transfer."
          },
          {
            partNumber: "SP-BATT-15X",
            requestedQuantity: 1,
            compatibility: "confirmed",
            compatibilityEvidence: "product code match",
            availability: "available",
            exceptionType: "none",
            transferRequired: false,
            fulfillmentWarehouseReference: "WH-AUS-001",
            requiredApproval: false,
            reservationStatus: "planned",
            confidence: "high",
            rationale: "Battery in stock."
          }
        ]
      }
    });

    expect(verdict.summary).toContain("(+1 more)");
    expect(
      verdict.recommendedSteps.filter((s) => s.includes("SP-")).length
    ).toBe(1);
  });

  it("does not embed forbidden PII patterns in parts rollup", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      partsLogistics: partsLogisticsPartialTransfer
    });
    const serialized = JSON.stringify(verdict);
    expect(serialized).not.toMatch(/001[a-zA-Z0-9]{12,18}/);
    expect(serialized).not.toContain("Display panel replacement; transfer from SJO to AUS.");
  });

  // Node 5 — scheduling rollup (§10). All four surfaces must reflect the
  // scheduling channel; technician identity stays a sanitized reference.
  function schedulingChannel(
    overrides: Partial<SchedulingChannel> = {}
  ): SchedulingChannel {
    return {
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
          rationale: "matches Battery/Power; secondary member of North America."
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
      confidence: "high",
      provider: "deterministic",
      ...overrides
    };
  }

  it("Node 5: rolls a schedulable plan into all four verdict surfaces", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      scheduling: schedulingChannel()
    });

    expect(verdict.headline).toContain("technician scheduled");
    expect(verdict.summary).toContain("SR-A1");
    expect(verdict.summary).toContain("Tomorrow 13:00–15:00");
    expect(verdict.recommendedSteps.join(" ")).toContain(
      "Confirm appointment for SR-A1"
    );
    expect(verdict.basis).toContain("scheduling");
    const labels = verdict.highlights.map((h) => h.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Scheduling", "Technician", "Proposed window"])
    );
    expect(
      verdict.highlights.find((h) => h.label === "Technician")?.value
    ).toBe("SR-A1");
  });

  it("Node 5: provisional plan reflects parts-ETA dependency", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      scheduling: schedulingChannel({
        status: "PROVISIONAL",
        schedulingReadiness: "provisional",
        partsReadinessSeen: "partial"
      })
    });
    expect(verdict.headline).toContain("scheduling provisional");
    expect(verdict.recommendedSteps.join(" ")).toContain("parts ETA is met");
  });

  it("Node 5: deferred plan recommends scheduling after parts confirmed", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      scheduling: schedulingChannel({
        status: "DEFERRED",
        schedulingReadiness: "deferred",
        partsReadinessSeen: "blocked",
        proposedWindow: undefined,
        requiredApproval: true,
        approvalReason: "parts_not_ready",
        appointmentStatus: "none"
      })
    });
    expect(verdict.headline).toContain("scheduling deferred (parts)");
    expect(verdict.recommendedSteps.join(" ")).toContain(
      "Schedule after parts confirmed"
    );
  });

  it("Node 5: unschedulable surfaces an assignment step", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      scheduling: schedulingChannel({
        status: "UNSCHEDULABLE",
        schedulingReadiness: "unschedulable",
        recommendedResourceReference: undefined,
        candidates: [],
        proposedWindow: undefined,
        appointmentStatus: undefined
      })
    });
    expect(verdict.headline).toContain("no technician available");
    expect(verdict.recommendedSteps.join(" ")).toContain(
      "Assign a qualified technician"
    );
  });

  it("Node 5: degraded scheduling read is surfaced without a window", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      scheduling: {
        eligible: true,
        degraded: true,
        degradedSources: ["salesforce_field_service"],
        schedulingReadiness: "unknown",
        partsEtaConsidered: false,
        requiredApproval: false
      }
    });
    expect(verdict.headline).toContain("scheduling degraded");
    expect(verdict.summary).toContain("degraded mode");
    expect(
      verdict.highlights.find((h) => h.label === "Scheduling")?.value
    ).toBe("Degraded");
  });

  it("Node 5: a skipped scheduling channel adds no scheduling clause", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: false,
      triage,
      scheduling: {
        eligible: false,
        degraded: false,
        eligibilityReason: "Scheduling disabled by config",
        partsEtaConsidered: false,
        requiredApproval: false
      }
    });
    expect(verdict.headline).not.toContain("technician");
    expect(verdict.headline).not.toContain("scheduling");
    expect(verdict.summary).not.toContain("Scheduling");
    expect(
      verdict.highlights.find((h) => h.label === "Scheduling")
    ).toBeUndefined();
  });

  it("Node 5: never embeds a full technician name in the verdict", () => {
    const verdict = synthesizeOrchestratorVerdict({
      status: "done",
      writeBackApplied: true,
      triage,
      scheduling: schedulingChannel()
    });
    const serialized = JSON.stringify(verdict);
    expect(serialized).not.toContain("Techinican");
    expect(serialized).toContain("SR-A1");
  });
});

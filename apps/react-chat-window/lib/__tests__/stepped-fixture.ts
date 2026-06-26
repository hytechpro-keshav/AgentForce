import type {
  OrchestrationFinding,
  OrchestrationSnapshot,
  OrchestrationTraceValue
} from "@/lib/orchestration";

function finding<T extends OrchestrationTraceValue>(
  value: T,
  evidenceBasis = "evidence"
): OrchestrationFinding<T> {
  return { value, confidence: "high", provenance: "Salesforce", evidenceBasis };
}

/**
 * A representative, fully-populated real-run snapshot used by the stepped
 * console tests. Mirrors Case 00001079 from the design sign-off: normal
 * priority, high business risk, parts available, technician scheduled,
 * guardrail requires human approval (paused).
 */
export function steppedSnapshotFixture(
  overrides: Partial<OrchestrationSnapshot> = {}
): OrchestrationSnapshot {
  return {
    workflowId: "wf-c79ee03d-a8fa-4316-9517-a9b4872833a4",
    node: "guardrail",
    caseNumber: "00001079",
    status: "waiting_approval",
    approvalRequired: true,
    writeBackApplied: true,
    triage: {
      recommendedPriority: "normal",
      summary: "Routine battery replacement needed for ProBook 15X.",
      suggestedNextStep: "Confirm local stock availability.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 1285
    },
    customerContext: {
      eligible: true,
      degraded: false,
      provider: "salesforce",
      model: "gpt-4o-mini",
      latencyMs: 240,
      package: {
        customerTier: finding("standard"),
        slaClass: finding("none"),
        warrantyStatus: finding("unknown"),
        repeatIncident: finding({ repeat: true, count: 10, windowDays: 30 }),
        strategicAccount: finding(false),
        installedAssets: finding({
          totalAssets: 12,
          modelCount: 2,
          primaryModel: "ProBook 15X"
        }),
        openIncidentCount: finding(10),
        escalationHistory: finding(0),
        businessRisk: finding("high", "Risk signals: repeat-failure, 10 open")
      }
    },
    knowledgeGuidance: {
      eligible: true,
      degraded: false,
      status: "ANSWERED",
      answer: {
        safeSummary: "The battery of the ProBook 15X may need replacement.",
        guidanceConfidence: "medium",
        recommendedActions: [
          {
            actionType: "replace_part",
            confidence: "medium",
            rationale: "Battery wear level may exceed acceptable limits.",
            requiredApproval: true
          }
        ],
        sources: [
          {
            sourceId: "kb-1",
            title: "Battery Health Check Procedure for Warranty Assessment",
            version: "2026.06.10",
            retrievalScorePercentile: 63
          }
        ],
        provider: "openai",
        embeddingProvider: "openai",
        retrievalId: "rag-4662cb30-d662-4dba-ad12-a95b2fdf54cd",
        latencyMs: 1094
      }
    },
    partsLogistics: {
      eligible: true,
      degraded: false,
      status: "PLANNED",
      fulfillmentReadiness: "ready",
      fulfillmentConfidence: "high",
      partPlans: [
        {
          partNumber: "SP-BATT-15X",
          partName: "6 Cell Battery Pack",
          requestedQuantity: 1,
          compatibility: "confirmed",
          compatibilityEvidence: "matches asset model",
          availability: "available",
          fulfillmentWarehouseReference: "WH-AUS-001",
          exceptionType: "none",
          reservationStatus: "planned",
          estimatedArrivalWindow: "12-20 hours",
          confidence: "high",
          requiredApproval: false,
          rationale: "25 in stock at WH-AUS-001; ready to reserve.",
          kbWarehouseAlignment: "aligned"
        }
      ],
      kbCrossCheck: {
        status: "aligned",
        alignedCount: 1,
        divergentCount: 0,
        undocumentedCount: 0
      },
      provider: "warehouse"
    },
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
          skillScore: 0.9,
          availabilityScore: 0.8,
          territoryFitScore: 0.7,
          rankScore: 0.81,
          rank: 1,
          earliestAvailableAt: "2026-06-24T18:00:00.000Z",
          rationale:
            "matches Laptop Hardware, Battery/Power; available in horizon."
        }
      ],
      proposedWindow: {
        earliestStart: "2026-06-24T18:00:00.000Z",
        earliestStartBasis: "parts_eta",
        displayWindow: "Tomorrow 11:00–13:00 PDT",
        windowConfidence: "high",
        partsEtaConstrained: true
      },
      partsEtaConsidered: true,
      partsReadinessSeen: "ready",
      requiredApproval: false
    },
    guardrail: {
      eligible: true,
      outcome: "requireHumanApproval",
      riskScore: 40,
      riskLevel: "medium",
      policyRulesTriggered: [
        {
          ruleId: "CUSTOMER_RISK_HIGH",
          channelSource: "risk_engine",
          triggered: true,
          riskPoints: 20,
          isHardRule: false,
          description: "Customer business risk is high"
        },
        {
          ruleId: "KB_REQUIRED_APPROVAL",
          channelSource: "knowledge",
          triggered: true,
          riskPoints: 20,
          isHardRule: false,
          description: "Knowledge action requires approval"
        }
      ],
      channelBasis: ["triage", "customerContext", "knowledgeGuidance"],
      requiresHumanApproval: true,
      approvalRequired: true,
      approvalReasons: [
        "Customer business risk is high.",
        "Knowledge action requires approval."
      ],
      degraded: false
    },
    orchestratorVerdict: {
      headline: "Normal priority · high business risk · approval required.",
      summary:
        "Triage normal; parts available at WH-AUS-001; SR-A1 scheduled; guardrail requires human approval.",
      recommendedSteps: [
        "Confirm local stock availability for battery replacement part.",
        "Dispatch SP-BATT-15X from WH-AUS-001."
      ],
      highlights: [
        { label: "Risk score", value: "40" },
        { label: "Priority", value: "normal" }
      ],
      basis: ["triage", "guardrail"]
    },
    events: [
      {
        node: "triage",
        status: "assigned",
        sequence: 1,
        occurredAt: "t1",
        safeSummary: "Triage assigned for case 00001079."
      },
      {
        node: "triage",
        status: "done",
        sequence: 2,
        occurredAt: "t2",
        safeSummary: "Running AI triage.",
        details: [{ label: "Recommended priority", value: "normal" }]
      },
      {
        node: "customer_history",
        status: "done",
        sequence: 3,
        occurredAt: "t3",
        safeSummary: "Building customer context package."
      },
      {
        node: "knowledge",
        status: "done",
        sequence: 4,
        occurredAt: "t4",
        safeSummary: "Found 2 matching troubleshooting guides."
      },
      {
        node: "parts_logistics",
        status: "done",
        sequence: 5,
        occurredAt: "t5",
        safeSummary: "Planned 1 part(s) — fulfillment ready."
      },
      {
        node: "scheduling",
        status: "done",
        sequence: 6,
        occurredAt: "t6",
        safeSummary: "Proposed earliest service window after parts ETA."
      },
      {
        node: "guardrail",
        status: "waiting_approval",
        sequence: 7,
        occurredAt: "t7",
        safeSummary: "Evaluated composite policy; routed for human approval."
      }
    ],
    ...overrides
  };
}

/**
 * A snapshot representing a PAUSED stepped run: Triage (merged with customer
 * context) has auto-run, the graph is waiting for the operator to advance to
 * Knowledge Base. Returned by the initial `/triggers/stepped` call
 * (status `awaiting_step`, node `knowledge`).
 */
export function steppedPausedFixture(
  overrides: Partial<OrchestrationSnapshot> = {}
): OrchestrationSnapshot {
  return {
    workflowId: "wf-c79ee03d-a8fa-4316-9517-a9b4872833a4",
    node: "knowledge",
    caseNumber: "00001079",
    status: "awaiting_step",
    approvalRequired: false,
    writeBackApplied: false,
    triage: {
      recommendedPriority: "normal",
      summary: "Routine battery replacement needed for ProBook 15X.",
      suggestedNextStep: "Confirm local stock availability.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 1285
    },
    customerContext: {
      eligible: true,
      degraded: false,
      provider: "salesforce",
      model: "gpt-4o-mini",
      latencyMs: 240,
      package: {
        customerTier: finding("standard"),
        slaClass: finding("none"),
        warrantyStatus: finding("unknown"),
        repeatIncident: finding({ repeat: true, count: 10, windowDays: 30 }),
        strategicAccount: finding(false),
        installedAssets: finding({
          totalAssets: 12,
          modelCount: 2,
          primaryModel: "ProBook 15X"
        }),
        openIncidentCount: finding(10),
        escalationHistory: finding(0),
        businessRisk: finding("high", "Risk signals: repeat-failure, 10 open")
      }
    },
    events: [
      {
        node: "triage",
        status: "assigned",
        sequence: 1,
        occurredAt: "t1",
        safeSummary: "Triage assigned for case 00001079."
      },
      {
        node: "triage",
        status: "running",
        sequence: 2,
        occurredAt: "t2",
        safeSummary: "Running AI triage.",
        details: [{ label: "Recommended priority", value: "normal" }]
      },
      {
        node: "customer_history",
        status: "running",
        sequence: 3,
        occurredAt: "t3",
        safeSummary: "Building customer context package."
      },
      {
        node: "knowledge",
        status: "awaiting_step",
        sequence: 4,
        occurredAt: "t4",
        safeSummary: "Stage complete — awaiting Run for Knowledge Base."
      }
    ],
    ...overrides
  };
}

/**
 * In-progress auto-run: Triage (merged with customer context) is running.
 */
export function steppedInProgressTriageFixture(): OrchestrationSnapshot {
  return {
    workflowId: "wf-c79ee03d-a8fa-4316-9517-a9b4872833a4",
    node: "knowledge",
    caseNumber: "00001079",
    status: "running",
    approvalRequired: false,
    writeBackApplied: false,
    triage: {
      recommendedPriority: "normal",
      summary: "Routine battery replacement needed for ProBook 15X.",
      suggestedNextStep: "Confirm local stock availability.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 1285
    },
    events: [
      {
        node: "triage",
        status: "assigned",
        sequence: 1,
        occurredAt: "t1",
        safeSummary: "Triage assigned for case 00001079."
      },
      {
        node: "triage",
        status: "done",
        sequence: 2,
        occurredAt: "t2",
        safeSummary: "Running AI triage."
      }
    ]
  };
}

/**
 * The response returned by the first `/advance` call: Knowledge Base has now
 * run, and the graph paused again before Parts & Logistics. Customer context
 * events (tagged customer_history) are rolled into the Triage trace.
 */
export function steppedAfterCustomerHistoryFixture(): OrchestrationSnapshot {
  return steppedPausedFixture({
    node: "parts_logistics",
    knowledgeGuidance: {
      eligible: true,
      degraded: false,
      status: "ANSWERED",
      answer: {
        safeSummary: "The battery of the ProBook 15X may need replacement.",
        guidanceConfidence: "medium",
        sources: [
          {
            sourceId: "kb-1",
            title: "Battery Health Check Procedure for Warranty Assessment",
            version: "2026.06.10",
            retrievalScorePercentile: 63
          }
        ],
        provider: "openai",
        embeddingProvider: "openai",
        retrievalId: "rag-4662cb30-d662-4dba-ad12-a95b2fdf54cd",
        latencyMs: 1094
      }
    },
    events: [
      {
        node: "triage",
        status: "assigned",
        sequence: 1,
        occurredAt: "t1",
        safeSummary: "Triage assigned for case 00001079."
      },
      {
        node: "triage",
        status: "running",
        sequence: 2,
        occurredAt: "t2",
        safeSummary: "Running AI triage."
      },
      {
        node: "customer_history",
        status: "running",
        sequence: 3,
        occurredAt: "t3",
        safeSummary: "Reading customer profile and entitlements."
      },
      {
        node: "customer_history",
        status: "running",
        sequence: 4,
        occurredAt: "t4",
        safeSummary: "Analyzing customer history."
      },
      {
        node: "customer_history",
        status: "running",
        sequence: 5,
        occurredAt: "t5",
        safeSummary: "Writing customer findings to state."
      },
      {
        node: "knowledge",
        status: "running",
        sequence: 6,
        occurredAt: "t6",
        safeSummary: "Querying knowledge base."
      },
      {
        node: "parts_logistics",
        status: "awaiting_step",
        sequence: 7,
        occurredAt: "t7",
        safeSummary:
          "Stage complete — awaiting Run for Parts & Logistics."
      }
    ]
  });
}

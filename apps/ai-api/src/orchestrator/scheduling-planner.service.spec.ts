import { SchedulingPlannerService } from "./scheduling-planner.service";
import type { SchedulingPlanInput } from "./scheduling-planner.service";
import type { SchedulingReadResult } from "../salesforce/salesforce-scheduling.gateway";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";

const planner = new SchedulingPlannerService();

// A fixed weekday-independent clock: 08:00 UTC, before the 09:00 window.
const NOW = new Date("2026-06-15T08:00:00.000Z");

/** Mon–Sun 09:00–17:00 so the slot search is weekday-independent. */
const ALL_DAY_WINDOWS = Array.from({ length: 7 }, (_, day) => ({
  dayOfWeek: day,
  openMinutes: 9 * 60,
  closeMinutes: 17 * 60
}));

/** A1 — strong on hardware/battery/motherboard. Secondary in North America. */
const A1 = {
  resourceId: "0Hn000000000A1",
  resourceReference: "SR-A1",
  isActive: true,
  territories: [{ name: "North America", type: "S" }],
  skills: [
    { label: "Laptop Hardware", level: 9 },
    { label: "Battery/Power", level: 8 },
    { label: "Motherboard", level: 9 },
    { label: "Thermal/Cooling", level: 6 }
  ]
};

/** A2 — strong on display. Secondary in North America. */
const A2 = {
  resourceId: "0Hn000000000A2",
  resourceReference: "SR-A2",
  isActive: true,
  territories: [{ name: "North America", type: "S" }],
  skills: [
    { label: "Laptop Hardware", level: 7 },
    { label: "Display", level: 8 },
    { label: "Battery/Power", level: 5 },
    { label: "Thermal/Cooling", level: 7 }
  ]
};

function buildRead(
  overrides: Partial<SchedulingReadResult> = {}
): SchedulingReadResult {
  return {
    source: "soql",
    technicians: [A1, A2],
    businessWindows: ALL_DAY_WINDOWS,
    busyIntervals: [],
    degraded: false,
    ...overrides
  };
}

function buildContext(
  overrides: Partial<SalesforceCaseContext> = {}
): SalesforceCaseContext {
  return {
    caseId: "500g500000YpQMnAAN",
    caseNumber: "00001046",
    subject: "Laptop battery not charging",
    description: "Battery drains and will not charge on the AV-LP-15X-PRO.",
    assetProductCode: "AV-LP-15X-PRO",
    serviceShipToCity: "Austin",
    serviceShipToState: "TX",
    serviceShipToCountry: "US",
    ...overrides
  };
}

function partsChannel(
  readiness: "ready" | "partial" | "blocked",
  partNumber: string,
  dispatchHoursMax: number
): PartsLogisticsChannel {
  return {
    eligible: true,
    degraded: false,
    status:
      readiness === "ready"
        ? "PLANNED"
        : readiness === "partial"
          ? "PARTIAL"
          : "UNAVAILABLE",
    fulfillmentReadiness: readiness,
    partPlans: [
      {
        partNumber,
        requestedQuantity: 1,
        compatibility: "confirmed",
        compatibilityEvidence: "match",
        availability: readiness === "ready" ? "available" : "unavailable",
        exceptionType:
          readiness === "ready"
            ? "none"
            : readiness === "partial"
              ? "inter_warehouse_transfer"
              : "backorder",
        reservationStatus: readiness === "blocked" ? "none" : "planned",
        estimatedDispatchHoursMax: dispatchHoursMax,
        confidence: "high",
        requiredApproval: false,
        rationale: "test plan"
      }
    ]
  };
}

function plan(overrides: Partial<SchedulingPlanInput> = {}) {
  return planner.plan({
    context: buildContext(),
    read: buildRead(),
    now: NOW,
    ...overrides
  });
}

describe("SchedulingPlannerService", () => {
  it("B4: parts ready → schedulable, window ≥ parts ETA floor, basis set", () => {
    const channel = plan({
      partsLogistics: partsChannel("ready", "SP-BATT-15X", 4)
    });

    expect(channel.schedulingReadiness).toBe("schedulable");
    expect(channel.status).toBe("PLANNED");
    expect(channel.partsReadinessSeen).toBe("ready");
    const floorMs = NOW.getTime() + 4 * 3_600_000;
    expect(
      Date.parse(channel.proposedWindow!.proposedStart!)
    ).toBeGreaterThanOrEqual(floorMs);
    expect(channel.proposedWindow!.earliestStartBasis).toBe("parts_eta");
    expect(channel.proposedWindow!.partsEtaConstrained).toBe(true);
    expect(channel.appointmentStatus).toBe("proposed");
  });

  it("B5: parts partial (transfer) → provisional, partsEtaConstrained, window from transfer ETA", () => {
    const channel = plan({
      partsLogistics: partsChannel("partial", "SP-DISP-15X-FHD", 41)
    });

    expect(channel.schedulingReadiness).toBe("provisional");
    expect(channel.status).toBe("PROVISIONAL");
    expect(channel.proposedWindow!.partsEtaConstrained).toBe(true);
    const transferFloorMs = NOW.getTime() + 41 * 3_600_000;
    expect(
      Date.parse(channel.proposedWindow!.proposedStart!)
    ).toBeGreaterThanOrEqual(transferFloorMs);
  });

  it("B6: parts blocked → deferred, no committed window, approval surfaced", () => {
    const channel = plan({
      partsLogistics: partsChannel("blocked", "SP-MB-15X", 120)
    });

    expect(channel.schedulingReadiness).toBe("deferred");
    expect(channel.status).toBe("DEFERRED");
    expect(channel.proposedWindow).toBeUndefined();
    expect(channel.appointmentStatus).toBe("none");
    expect(channel.requiredApproval).toBe(true);
    expect(channel.approvalReason).toBe("parts_not_ready");
    // The recommended technician is still ranked for when parts arrive.
    expect(channel.recommendedResourceReference).toBeDefined();
  });

  it("B7: no eligible technician in the territory → unschedulable", () => {
    const channel = plan({
      read: buildRead({ technicians: [] }),
      partsLogistics: partsChannel("ready", "SP-BATT-15X", 4)
    });

    expect(channel.schedulingReadiness).toBe("unschedulable");
    expect(channel.status).toBe("UNSCHEDULABLE");
    expect(channel.candidates).toEqual([]);
    expect(channel.proposedWindow).toBeUndefined();
  });

  it("B8: degraded Field Service read → degraded, never throws, graph continues", () => {
    const channel = plan({
      read: buildRead({ degraded: true, technicians: [] }),
      partsLogistics: partsChannel("ready", "SP-BATT-15X", 4)
    });

    expect(channel.degraded).toBe(true);
    expect(channel.degradedSources).toEqual(["salesforce_field_service"]);
    expect(channel.schedulingReadiness).toBe("unknown");
  });

  it("B3: ranks A1 over A2 for a motherboard repair (skill match)", () => {
    const channel = plan({
      partsLogistics: partsChannel("partial", "SP-MB-15X", 30)
    });

    expect(channel.recommendedResourceReference).toBe("SR-A1");
    expect(channel.candidates![0].rank).toBe(1);
    expect(channel.candidates![0].matchedSkills).toContain("Motherboard");
    expect(channel.candidates![0].skillScore).toBeGreaterThan(
      channel.candidates![1].skillScore
    );
  });

  it("B3: ranks A2 over A1 for a display repair (skill match)", () => {
    const channel = plan({
      partsLogistics: partsChannel("ready", "SP-DISP-15X-FHD", 4)
    });

    expect(channel.recommendedResourceReference).toBe("SR-A2");
    expect(channel.candidates![0].matchedSkills).toContain("Display");
  });

  it("includes Secondary territory members (A1/A2 are Secondary in NA)", () => {
    const channel = plan({
      partsLogistics: partsChannel("ready", "SP-BATT-15X", 4)
    });
    expect(channel.candidates!.length).toBe(2);
    expect(channel.candidates![0].territoryMembership).toBe("secondary");
    expect(channel.candidates![0].territoryReference).toBe("North America");
  });

  it("an absence delays a candidate's earliest slot", () => {
    // Block A1 for the next 3 days; A1's first slot must fall after it.
    const absenceEnd = NOW.getTime() + 3 * 24 * 3_600_000;
    const channel = plan({
      partsLogistics: partsChannel("ready", "SP-MB-15X", 4),
      read: buildRead({
        busyIntervals: [
          {
            startMs: NOW.getTime(),
            endMs: absenceEnd,
            resourceId: A1.resourceId
          }
        ]
      })
    });

    const a1 = channel.candidates!.find(
      (c) => c.resourceReference === "SR-A1"
    )!;
    expect(Date.parse(a1.earliestAvailableAt!)).toBeGreaterThanOrEqual(
      absenceEnd
    );
  });

  it("schedules from availability + SLA when parts are skipped (no-parts repair)", () => {
    const channel = plan({
      partsLogistics: { eligible: false, degraded: false }
    });

    expect(channel.partsReadinessSeen).toBe("skipped");
    expect(channel.schedulingReadiness).toBe("schedulable");
    expect(channel.proposedWindow!.partsEtaConstrained).toBe(false);
    expect(channel.proposedWindow!.earliestStartBasis).toBe("now");
  });

  it("flags sla_breach_risk approval when the window exceeds the SLA target", () => {
    // Premium SLA target is ~8h; a 41h transfer pushes well past it.
    const channel = plan({
      customerContext: {
        eligible: true,
        degraded: false,
        package: {
          slaClass: {
            value: "premium",
            confidence: "high",
            provenance: "Salesforce Entitlement",
            evidenceBasis: "sla",
            assertedVsInferred: "asserted"
          }
        }
      } as any,
      triagePriority: "critical",
      partsLogistics: partsChannel("partial", "SP-DISP-15X-FHD", 41)
    });

    expect(channel.requiredApproval).toBe(true);
    expect(channel.approvalReason).toBe("sla_breach_risk");
  });

  it("B9: never emits a full technician name in the channel", () => {
    const channel = plan({
      partsLogistics: partsChannel("ready", "SP-BATT-15X", 4)
    });
    const serialized = JSON.stringify(channel);
    expect(serialized).not.toContain("Techinican");
    expect(serialized).not.toMatch(/\bA1 \w/);
    // Only the sanitized reference appears.
    expect(serialized).toContain("SR-A1");
  });

  it("degrades to provisional when upstream parts read is unknown", () => {
    const channel = plan({
      partsLogistics: {
        eligible: true,
        degraded: true
      } as PartsLogisticsChannel
    });
    expect(channel.partsReadinessSeen).toBe("unknown");
    expect(channel.schedulingReadiness).toBe("provisional");
    expect(channel.degraded).toBe(false); // scheduling's own read was fine
  });
});

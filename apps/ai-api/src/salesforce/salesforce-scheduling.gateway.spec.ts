import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceSchedulingGateway } from "./salesforce-scheduling.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";

interface Harness {
  gateway: SalesforceSchedulingGateway;
  fetchMock: jest.Mock;
}

function buildHarness(): Harness {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  const auth = {
    isConfigured: () => true,
    invalidate: jest.fn(),
    getAccessContext: jest.fn().mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      instanceUrl: INSTANCE_URL
    })
  } as unknown as SalesforceAuthService;
  const config = {
    salesforceConnection: {
      enabled: true,
      apiVersion: "60.0",
      timeoutMs: 15000
    }
  } as unknown as AppConfigService;
  return { gateway: new SalesforceSchedulingGateway(auth, config), fetchMock };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const TECHNICIAN_RECORDS = {
  records: [
    {
      Id: "0Hn000000000A1",
      Name: "A1 Techinican",
      ResourceType: "T",
      IsActive: true,
      ServiceTerritories: {
        records: [
          {
            ServiceTerritory: { Name: "North America" },
            TerritoryType: "S"
          }
        ]
      },
      ServiceResourceSkills: {
        records: [
          { Skill: { MasterLabel: "Laptop Hardware" }, SkillLevel: 9 },
          { Skill: { MasterLabel: "Battery/Power" }, SkillLevel: 8 }
        ]
      }
    }
  ]
};

const OPERATING_HOURS_RECORDS = {
  records: [
    {
      Id: "0Oh000000000001",
      TimeZone: "America/Chicago",
      TimeSlots: {
        records: [
          {
            DayOfWeek: "Monday",
            StartTime: "09:00:00.000Z",
            EndTime: "17:00:00.000Z",
            Type: "Normal"
          },
          {
            DayOfWeek: "Saturday",
            StartTime: "10:00:00.000Z",
            EndTime: "14:00:00.000Z",
            Type: "Extended"
          }
        ]
      }
    }
  ]
};

const ABSENCE_RECORDS = {
  records: [
    {
      ResourceId: "0Hn000000000A1",
      Start: "2026-06-18T09:00:00.000Z",
      End: "2026-06-18T17:00:00.000Z"
    }
  ]
};

const APPOINTMENT_RECORDS = {
  records: [
    {
      ServiceResourceId: "0Hn000000000A1",
      ServiceAppointment: {
        SchedStartTime: "2026-06-19T09:00:00.000Z",
        SchedEndTime: "2026-06-19T11:00:00.000Z",
        Status: "Scheduled"
      }
    },
    {
      // Terminal appointment — must NOT block availability.
      ServiceResourceId: "0Hn000000000A2",
      ServiceAppointment: {
        SchedStartTime: "2026-06-20T09:00:00.000Z",
        SchedEndTime: "2026-06-20T11:00:00.000Z",
        Status: "Completed"
      }
    }
  ]
};

const WORKTYPE_RECORDS = {
  records: [
    {
      Name: "Laptop Battery Replacement",
      EstimatedDuration: 1,
      DurationType: "Hours"
    },
    {
      Name: "Laptop Onsite Repair",
      EstimatedDuration: 120,
      DurationType: "Minutes"
    }
  ]
};

const READ_INPUT = {
  territoryName: "North America",
  windowStartIso: "2026-06-15T00:00:00.000Z",
  windowEndIso: "2026-07-06T00:00:00.000Z"
};

/**
 * Dispatches each SOQL read by a distinctive substring so tests are robust
 * to read ordering. Pass overrides to fail/replace a specific read.
 */
function installDispatcher(
  h: Harness,
  overrides: Partial<{
    tech: Response;
    operatingHours: Response;
    absence: Response;
    appointment: Response;
    workType: Response;
  }> = {}
): void {
  h.fetchMock.mockImplementation((url: string) => {
    const soql = decodeURIComponent(url);
    if (soql.includes("ResourceType = 'T'")) {
      return Promise.resolve(
        overrides.tech ?? jsonResponse(TECHNICIAN_RECORDS)
      );
    }
    if (soql.includes("FROM OperatingHours")) {
      return Promise.resolve(
        overrides.operatingHours ?? jsonResponse(OPERATING_HOURS_RECORDS)
      );
    }
    if (soql.includes("FROM ResourceAbsence")) {
      return Promise.resolve(
        overrides.absence ?? jsonResponse(ABSENCE_RECORDS)
      );
    }
    if (soql.includes("FROM AssignedResource")) {
      return Promise.resolve(
        overrides.appointment ?? jsonResponse({ records: [] })
      );
    }
    if (soql.includes("FROM WorkType")) {
      return Promise.resolve(
        overrides.workType ?? jsonResponse({ records: [] })
      );
    }
    return Promise.resolve(jsonResponse({ records: [] }));
  });
}

describe("SalesforceSchedulingGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("reads technicians by territory (incl. Secondary), skills, and operating hours", async () => {
    const h = buildHarness();
    installDispatcher(h);

    const result = await h.gateway.readSchedulingContext(READ_INPUT);

    const techQuery = decodeURIComponent(
      h.fetchMock.mock.calls[0][0] as string
    );
    expect(techQuery).toContain("FROM ServiceResource");
    expect(techQuery).toContain("ServiceTerritoryMember");
    expect(techQuery).toContain("TerritoryType");
    expect(techQuery).toContain("North America");
    // §8.3 — must NOT filter Primary-only; Secondary members are included.
    expect(techQuery).not.toMatch(/TerritoryType\s*=\s*'P'/);

    expect(result.source).toBe("soql");
    expect(result.degraded).toBe(false);
    expect(result.technicians).toHaveLength(1);
    expect(result.technicians[0]).toMatchObject({
      resourceReference: "SR-A1",
      territories: [{ name: "North America", type: "S" }],
      skills: [
        { label: "Laptop Hardware", level: 9 },
        { label: "Battery/Power", level: 8 }
      ]
    });
    // Only the "Normal" Monday window is kept (Extended is dropped).
    expect(result.businessWindows).toEqual([
      { dayOfWeek: 1, openMinutes: 540, closeMinutes: 1020 }
    ]);
    // 5b — territory-local timezone surfaced from OperatingHours.TimeZone.
    expect(result.timeZone).toBe("America/Chicago");
    expect(result.busyIntervals).toHaveLength(1);
    expect(result.busyIntervals[0].resourceId).toBe("0Hn000000000A1");
  });

  it("never leaks a full technician name (sanitizes at the boundary)", async () => {
    const h = buildHarness();
    installDispatcher(h, {
      operatingHours: jsonResponse({ records: [] }),
      absence: jsonResponse({ records: [] })
    });

    const result = await h.gateway.readSchedulingContext(READ_INPUT);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Techinican");
    expect(result.technicians[0].resourceReference).toBe("SR-A1");
  });

  it("degrades (never throws) when the technician read fails", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    const result = await h.gateway.readSchedulingContext(READ_INPUT);

    expect(result.degraded).toBe(true);
    expect(result.technicians).toEqual([]);
    expect(result.candidatesApiUsed).toBe(false);
    // It does not proceed to the availability reads once the critical
    // technician read fails.
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the ranked candidates when only the operating-hours read fails", async () => {
    const h = buildHarness();
    installDispatcher(h, {
      operatingHours: jsonResponse({ message: "boom" }, 500),
      absence: jsonResponse({ records: [] })
    });

    const result = await h.gateway.readSchedulingContext(READ_INPUT);

    expect(result.degraded).toBe(false);
    expect(result.technicians).toHaveLength(1);
    expect(result.businessWindows).toEqual([]);
    expect(result.timeZone).toBeUndefined();
  });

  it("merges existing ServiceAppointments into busy intervals (excludes terminal)", async () => {
    const h = buildHarness();
    installDispatcher(h, {
      absence: jsonResponse({ records: [] }),
      appointment: jsonResponse(APPOINTMENT_RECORDS)
    });

    const result = await h.gateway.readSchedulingContext(READ_INPUT);

    // The scheduled appointment blocks; the completed one is excluded.
    expect(result.busyIntervals).toHaveLength(1);
    expect(result.busyIntervals[0]).toMatchObject({
      resourceId: "0Hn000000000A1",
      startMs: Date.parse("2026-06-19T09:00:00.000Z"),
      endMs: Date.parse("2026-06-19T11:00:00.000Z")
    });
  });

  it("builds a WorkType duration map keyed by required skill", async () => {
    const h = buildHarness();
    installDispatcher(h, { workType: jsonResponse(WORKTYPE_RECORDS) });

    const result = await h.gateway.readSchedulingContext(READ_INPUT);

    expect(result.workTypeDurationMinutesBySkill).toEqual({
      "Battery/Power": 60, // 1 hour → 60 minutes
      "Laptop Hardware": 120
    });
  });

  it("does not use the AppointmentCandidates API when the flag is off", async () => {
    const h = buildHarness();
    installDispatcher(h);

    const result = await h.gateway.readSchedulingContext(READ_INPUT);

    expect(result.candidatesApiUsed).toBe(false);
    expect(result.appointmentCandidates ?? []).toEqual([]);
  });

  it("keeps the deterministic fallback even when the candidates flag is on", async () => {
    const h = buildHarness();
    installDispatcher(h);

    const result = await h.gateway.readSchedulingContext({
      ...READ_INPUT,
      candidatesApiEnabled: true
    });

    // 5b: the native scheduler needs a draft ServiceAppointment (5c), so the
    // flag-on read still falls back to deterministic planning.
    expect(result.candidatesApiUsed).toBe(false);
  });

  it("returns an empty, non-degraded result for a blank territory", async () => {
    const h = buildHarness();
    const result = await h.gateway.readSchedulingContext({
      ...READ_INPUT,
      territoryName: "   "
    });
    expect(result.source).toBe("none");
    expect(result.degraded).toBe(false);
    expect(result.candidatesApiUsed).toBe(false);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

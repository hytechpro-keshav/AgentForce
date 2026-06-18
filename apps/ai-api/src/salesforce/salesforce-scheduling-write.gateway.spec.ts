import type { AppConfigService } from "../config/app-config.service";
import type { SchedulingWriteCommand } from "../orchestrator/dto/scheduling-write";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceSchedulingWriteGateway } from "./salesforce-scheduling-write.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";

interface Harness {
  gateway: SalesforceSchedulingWriteGateway;
  fetchMock: jest.Mock;
  invalidate: jest.Mock;
  getAccessContext: jest.Mock;
}

function buildHarness(): Harness {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  const invalidate = jest.fn();
  const getAccessContext = jest.fn().mockResolvedValue({
    accessToken: ACCESS_TOKEN,
    instanceUrl: INSTANCE_URL
  });
  const auth = {
    isConfigured: () => true,
    invalidate,
    getAccessContext
  } as unknown as SalesforceAuthService;
  const config = {
    salesforceConnection: {
      enabled: true,
      apiVersion: "60.0",
      timeoutMs: 15000
    }
  } as unknown as AppConfigService;
  return {
    gateway: new SalesforceSchedulingWriteGateway(auth, config),
    fetchMock,
    invalidate,
    getAccessContext
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const command: SchedulingWriteCommand = {
  workflowId: "wf-1",
  caseId: "500000000000001",
  resourceReference: "SR-A2",
  territoryReference: "North America",
  schedStart: "2026-06-18T16:00:00.000Z",
  schedEnd: "2026-06-18T18:00:00.000Z",
  durationMinutes: 120
};

describe("SalesforceSchedulingWriteGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("POSTs the command to the Apex REST resource and maps a booking", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        applied: true,
        degraded: false,
        booked: true,
        idempotentSkip: false,
        appointmentStatus: "booked",
        appointmentReference: "SA-0007",
        appointmentId: "08p000000000001",
        message: "Appointment booked."
      })
    );

    const result = await h.gateway.applyAppointment(command);

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe(
      `${INSTANCE_URL}/services/apexrest/agentforce/scheduling-appointment`
    );
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    // The sanitized reference (no full name) is what crosses the boundary.
    expect(JSON.parse(init.body).resourceReference).toBe("SR-A2");
    expect(result.applied).toBe(true);
    expect(result.booked).toBe(true);
    expect(result.appointmentStatus).toBe("booked");
    expect(result.appointmentReference).toBe("SA-0007");
  });

  it("maps an idempotent reuse as booked (no new record)", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        applied: true,
        degraded: false,
        booked: true,
        idempotentSkip: true,
        appointmentStatus: "booked",
        appointmentReference: "SA-0007"
      })
    );

    const result = await h.gateway.applyAppointment(command);

    expect(result.appointmentStatus).toBe("booked");
    expect(result.idempotentSkip).toBe(true);
    expect(result.appointmentReference).toBe("SA-0007");
  });

  it("returns a degraded no-op for an incomplete command without calling Salesforce", async () => {
    const h = buildHarness();
    const result = await h.gateway.applyAppointment({
      ...command,
      resourceReference: ""
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(result.appointmentStatus).toBe("none");
  });

  it("retries once on a 401 after invalidating the token", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          applied: true,
          degraded: false,
          booked: true,
          idempotentSkip: false,
          appointmentStatus: "booked",
          appointmentReference: "SA-0008"
        })
      );

    const result = await h.gateway.applyAppointment(command);

    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(result.appointmentStatus).toBe("booked");
  });

  it("degrades (never throws) on a backend error, leaving the plan unbooked", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const result = await h.gateway.applyAppointment(command);

    expect(result.degraded).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.appointmentStatus).toBe("none");
  });

  it("degrades when an applied write returns no appointment reference", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ applied: true, booked: true })
    );

    const result = await h.gateway.applyAppointment(command);

    expect(result.degraded).toBe(true);
    expect(result.appointmentStatus).toBe("none");
  });
});

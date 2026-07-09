import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCaseNotifyGateway } from "./salesforce-case-notify.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";
const BASE_PATH = "/services/apexrest/agentforce/case-notify";

interface Harness {
  gateway: SalesforceCaseNotifyGateway;
  fetchMock: jest.Mock;
  invalidate: jest.Mock;
}

function buildHarness(): Harness {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  const invalidate = jest.fn();
  const auth = {
    isConfigured: () => true,
    invalidate,
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
    },
    customerIntake: { caseNotifyApexBasePath: BASE_PATH }
  } as unknown as AppConfigService;
  return {
    gateway: new SalesforceCaseNotifyGateway(auth, config),
    fetchMock,
    invalidate
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("SalesforceCaseNotifyGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("POSTs the confirmation to the case-notify apexrest path", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ sent: true, status: "SENT" })
    );

    const result = await h.gateway.sendCaseConfirmation({
      email: "user@example.com",
      caseNumber: "00001234",
      customerName: "Ada Lovelace",
      subject: "Laptop running slow"
    });

    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe(`${INSTANCE_URL}${BASE_PATH}/confirmation`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      email: "user@example.com",
      caseNumber: "00001234",
      customerName: "Ada Lovelace",
      subject: "Laptop running slow"
    });
    expect(result).toEqual({ sent: true, status: "SENT" });
  });

  it("never reports sent for a non-SENT status, even if body claims sent", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ sent: true, status: "INVALID_REQUEST" })
    );

    const result = await h.gateway.sendCaseConfirmation({
      email: "user@example.com",
      caseNumber: "00001234"
    });

    expect(result.sent).toBe(false);
    expect(result.status).toBe("INVALID_REQUEST");
  });

  it("retries once on 401 after invalidating the token", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ sent: true, status: "SENT" }));

    const result = await h.gateway.sendCaseConfirmation({
      email: "user@example.com",
      caseNumber: "00001234"
    });

    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("SENT");
  });

  it("degrades (never throws) on a backend error", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const result = await h.gateway.sendCaseConfirmation({
      email: "user@example.com",
      caseNumber: "00001234"
    });

    expect(result).toEqual({ sent: false, status: "DEGRADED" });
  });

  it("degrades when the Apex resource is not deployed yet (404)", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ error: "missing" }, 404));

    const result = await h.gateway.sendCaseConfirmation({
      email: "user@example.com",
      caseNumber: "00001234"
    });

    expect(result).toEqual({ sent: false, status: "DEGRADED" });
  });
});

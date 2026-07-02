import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceOtpGateway } from "./salesforce-otp.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";
const BASE_PATH = "/services/apexrest/agentforce/otp";

interface Harness {
  gateway: SalesforceOtpGateway;
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
    customerIntake: { otpApexBasePath: BASE_PATH }
  } as unknown as AppConfigService;
  return {
    gateway: new SalesforceOtpGateway(auth, config),
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

describe("SalesforceOtpGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("POSTs generate to the OTP apexrest path and maps the status", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "SENT", expiresInSeconds: 600 })
    );

    const result = await h.gateway.generate("user@example.com", "corr-1");

    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe(`${INSTANCE_URL}${BASE_PATH}/generate`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      email: "user@example.com",
      purpose: "chat_intake",
      correlationId: "corr-1"
    });
    expect(result).toEqual({ status: "SENT", expiresInSeconds: 600 });
  });

  it("maps a matching verify body to valid=true", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ valid: true, status: "VERIFIED" })
    );

    const result = await h.gateway.verify("user@example.com", "123456");

    expect(h.fetchMock.mock.calls[0][0]).toBe(
      `${INSTANCE_URL}${BASE_PATH}/verify`
    );
    expect(result).toEqual({ valid: true, status: "VERIFIED" });
  });

  it("never treats a non-VERIFIED status as valid, even if body claims valid", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ valid: true, status: "INVALID_CODE" })
    );

    const result = await h.gateway.verify("user@example.com", "000000");

    expect(result.valid).toBe(false);
    expect(result.status).toBe("INVALID_CODE");
  });

  it("retries once on 401 after invalidating the token", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ status: "SENT", expiresInSeconds: 600 })
      );

    const result = await h.gateway.generate("user@example.com");

    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("SENT");
  });

  it("degrades generate (never throws) on a backend error", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const result = await h.gateway.generate("user@example.com");

    expect(result).toEqual({ status: "DEGRADED", expiresInSeconds: 0 });
  });

  it("fails verify CLOSED on a backend error", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const result = await h.gateway.verify("user@example.com", "123456");

    expect(result).toEqual({ valid: false, status: "DEGRADED" });
  });
});

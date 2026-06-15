import type { AppConfigService } from "../config/app-config.service";
import type { PartsFulfillmentCommand } from "../orchestrator/dto/parts-fulfillment";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceFulfillmentGateway } from "./salesforce-fulfillment.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";

interface Harness {
  gateway: SalesforceFulfillmentGateway;
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
    gateway: new SalesforceFulfillmentGateway(auth, config),
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

const command: PartsFulfillmentCommand = {
  workflowId: "wf-1",
  caseId: "500000000000001",
  items: [
    {
      partNumber: "SP-BATT-15X",
      quantity: 1,
      exceptionType: "inter_warehouse_transfer",
      fulfillmentWarehouseReference: "WH-AUS-001",
      sourceWarehouseReference: "WH-SJO-002"
    }
  ]
};

describe("SalesforceFulfillmentGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("POSTs the command to the Apex REST resource and maps the result", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        applied: true,
        degraded: false,
        items: [
          {
            partNumber: "SP-BATT-15X",
            created: true,
            idempotentSkip: false,
            recordType: "ProductTransfer",
            recordId: "0a9000000000001",
            reservationStatus: "transfer_pending"
          }
        ]
      })
    );

    const result = await h.gateway.applyFulfillment(command);

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe(
      `${INSTANCE_URL}/services/apexrest/agentforce/parts-fulfillment`
    );
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(result.applied).toBe(true);
    expect(result.items[0].reservationStatus).toBe("transfer_pending");
    expect(result.items[0].recordType).toBe("ProductTransfer");
  });

  it("returns a no-op for an empty command without calling Salesforce", async () => {
    const h = buildHarness();
    const result = await h.gateway.applyFulfillment({
      ...command,
      items: []
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: false, degraded: false, items: [] });
  });

  it("retries once on a 401 after invalidating the token", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          applied: true,
          degraded: false,
          items: [
            {
              partNumber: "SP-BATT-15X",
              created: true,
              idempotentSkip: false,
              recordType: "ProductTransfer",
              recordId: "0a9000000000002",
              reservationStatus: "transfer_pending"
            }
          ]
        })
      );

    const result = await h.gateway.applyFulfillment(command);

    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(result.applied).toBe(true);
  });

  it("degrades (never throws) on a backend error, leaving items planned", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const result = await h.gateway.applyFulfillment(command);

    expect(result.degraded).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.items[0].reservationStatus).toBe("planned");
  });

  it("degrades on a malformed/empty body for a non-empty command", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ applied: true }));

    const result = await h.gateway.applyFulfillment(command);

    expect(result.degraded).toBe(true);
    expect(result.items).toHaveLength(1);
  });
});

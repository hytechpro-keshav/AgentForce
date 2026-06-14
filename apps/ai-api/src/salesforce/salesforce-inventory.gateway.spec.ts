import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceInventoryGateway } from "./salesforce-inventory.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";

interface Harness {
  gateway: SalesforceInventoryGateway;
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
    }
  } as unknown as AppConfigService;
  return {
    gateway: new SalesforceInventoryGateway(auth, config),
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

describe("SalesforceInventoryGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("reads stock keyed on ProductCode + ExternalReference, never Product2.Id", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          {
            Product2: {
              ProductCode: "SP-BATT-15X",
              Name: "6 Cell Battery Pack",
              Compatible_Product_Code__c: "AV-LP-15X-PRO",
              Is_Universal_Part__c: false
            },
            QuantityOnHand: 75,
            Location: {
              ExternalReference: "WH-SJO-002",
              Name: "San Jose",
              Region__c: "North America",
              Outbound_Lead_Time_Hours__c: 2,
              Supports_Expedite__c: true
            }
          }
        ]
      })
    );

    const result = await h.gateway.readStockForParts(["SP-BATT-15X"]);

    const query = decodeURIComponent(h.fetchMock.mock.calls[0][0] as string);
    expect(query).toContain("Product2.ProductCode IN ('SP-BATT-15X')");
    expect(query).toContain("Location.ExternalReference");
    expect(query).not.toMatch(/Product2\.Id/);
    expect(result.source).toBe("soql");
    expect(result.degraded).toBe(false);
    expect(result.rows[0]).toMatchObject({
      productCode: "SP-BATT-15X",
      warehouseReference: "WH-SJO-002",
      quantityOnHand: 75,
      warehouseRegion: "North America",
      outboundLeadTimeHours: 2
    });
  });

  it("returns an empty result for an empty part list without calling Salesforce", async () => {
    const h = buildHarness();
    const result = await h.gateway.readStockForParts([]);
    expect(result.source).toBe("none");
    expect(result.rows).toEqual([]);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("degrades (never throws) when the inventory read fails", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));
    const result = await h.gateway.readStockForParts(["SP-BATT-15X"]);
    expect(result.degraded).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it("drops rows missing either stable key", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          { Product2: { ProductCode: "SP-BATT-15X" }, QuantityOnHand: 1 },
          {
            QuantityOnHand: 5,
            Location: { ExternalReference: "WH-AUS-001" }
          }
        ]
      })
    );
    const result = await h.gateway.readStockForParts(["SP-BATT-15X"]);
    expect(result.rows).toHaveLength(0);
  });
});

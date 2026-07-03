import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCaseWriteGateway } from "./salesforce-case-write.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";

interface Harness {
  gateway: SalesforceCaseWriteGateway;
  fetchMock: jest.Mock;
}

function buildHarness(): Harness {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;

  const auth = {
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

  return {
    gateway: new SalesforceCaseWriteGateway(auth, config),
    fetchMock
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("SalesforceCaseWriteGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("resolves an Account by name via SOQL", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ records: [{ Id: "001000000000001" }] })
    );

    const accountId = await h.gateway.resolveAccountByName("Aptivance tech");
    expect(accountId).toBe("001000000000001");

    const [url, init] = h.fetchMock.mock.calls[0];
    expect(String(url)).toContain("/query?q=");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${ACCESS_TOKEN}`
    });
  });

  it("creates a Case and reads CaseNumber", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "500000000000001ABC", success: true }))
      .mockResolvedValueOnce(jsonResponse({ CaseNumber: "00001234" }));

    const result = await h.gateway.createCase({
      subject: "Battery swap",
      description: "SP-BATT-15X",
      status: "New",
      origin: "Web",
      priority: "High",
      accountId: "001000000000001",
      assetId: "02i000000000001",
      serviceShipToCity: "Austin",
      serviceShipToState: "TX",
      serviceShipToCountry: "US"
    });

    expect(result).toEqual({
      caseId: "500000000000001ABC",
      caseNumber: "00001234"
    });

    const [, postInit] = h.fetchMock.mock.calls[0];
    const body = JSON.parse((postInit as RequestInit).body as string);
    expect(body.Subject).toBe("Battery swap");
    expect(body.AssetId).toBe("02i000000000001");
    expect(body.Service_Ship_To_City__c).toBe("Austin");
  });

  it("creates a chat Case with AssetId via createChatCase", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "500000000000001ABC", success: true }))
      .mockResolvedValueOnce(jsonResponse({ CaseNumber: "00005678" }));

    await h.gateway.createChatCase({
      subject: "Chat intake",
      description: "Screen flickers",
      priority: "Medium",
      accountId: "001000000000001",
      contactId: "003000000000001",
      assetId: "02i000000000001",
      suppliedName: "Ada Lovelace",
      suppliedEmail: "ada@corp.com",
      serviceShipToCity: "London",
      serviceShipToState: "LDN",
      serviceShipToCountry: "UK"
    });

    const [, postInit] = h.fetchMock.mock.calls[0];
    const body = JSON.parse((postInit as RequestInit).body as string);
    expect(body.AssetId).toBe("02i000000000001");
    expect(body.Origin).toBe("Chat");
    expect(body.AI_Orchestration_Status__c).toBe("stopped_by_user");
  });

  it("returns undefined when Asset serial is not found", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }));

    const asset = await h.gateway.resolveAssetBySerial("SN-MISSING");
    expect(asset).toBeUndefined();
  });
});

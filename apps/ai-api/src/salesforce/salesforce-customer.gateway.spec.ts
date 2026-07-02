import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCustomerGateway } from "./salesforce-customer.gateway";
import { SalesforceGatewayError } from "./salesforce-gateway.error";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";
const ACCOUNT_ID = "001000000000001";
const CONTACT_ID = "003000000000001";
const ASSET_ID = "02i000000000001";
const CASE_ID = "500000000000001";

interface Harness {
  gateway: SalesforceCustomerGateway;
  fetchMock: jest.Mock;
  invalidate: jest.Mock;
}

function buildHarness(dataCloudEnabled = false): Harness {
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
    orchestrator: {
      customerHistory: { dataCloud: { enabled: dataCloudEnabled } }
    }
  } as unknown as AppConfigService;

  return {
    gateway: new SalesforceCustomerGateway(auth, config),
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

function decodedQuery(call: [string, RequestInit]): string {
  return decodeURIComponent(call[0]);
}

describe("SalesforceCustomerGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("reads the account profile with an Account-scoped SOQL query and bearer token", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ records: [{ Type: "Enterprise", Rating: "Hot" }] })
    );

    const profile = await h.gateway.readAccountProfile({
      accountId: ACCOUNT_ID
    });

    expect(profile.tier).toBe("premium");
    expect(profile.strategic).toBe(true);

    const [url, init] = h.fetchMock.mock.calls[0];
    expect(decodeURIComponent(url)).toContain(`WHERE Id = '${ACCOUNT_ID}'`);
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${ACCESS_TOKEN}`
    });
  });

  it("scopes service history to the Account AND the verified contact", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          {
            Status: "New",
            IsEscalated: true,
            IsClosed: false,
            CreatedDate: new Date().toISOString()
          }
        ]
      })
    );

    await h.gateway.readServiceHistory({
      accountId: ACCOUNT_ID,
      verifiedContactId: CONTACT_ID
    });

    const query = decodedQuery(h.fetchMock.mock.calls[0]);
    expect(query).toContain(`AccountId = '${ACCOUNT_ID}'`);
    expect(query).toContain(`ContactId = '${CONTACT_ID}'`);
  });

  it("scopes repeat history to the same Asset and excludes the current Case", async () => {
    const h = buildHarness();
    const recent = new Date().toISOString();
    const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          {
            Id: "500000000000002",
            IsEscalated: false,
            IsClosed: true,
            CreatedDate: recent
          },
          {
            Id: "500000000000003",
            IsEscalated: false,
            IsClosed: true,
            CreatedDate: stale
          }
        ]
      })
    );

    const history = await h.gateway.readServiceHistory({
      accountId: ACCOUNT_ID,
      assetId: ASSET_ID,
      excludeCaseId: CASE_ID
    });

    const query = decodedQuery(h.fetchMock.mock.calls[0]);
    expect(query).toContain(`AssetId = '${ASSET_ID}'`);
    expect(query).toContain(`Id != '${CASE_ID}'`);
    expect(history.repeatIncidentCount).toBe(1);
    expect(history.repeatScope).toBe("asset");
    expect(history.currentCaseExcluded).toBe(true);
  });

  it("refuses an unscoped read — returns an empty bundle and never queries", async () => {
    const h = buildHarness();

    const bundle = await h.gateway.readCustomerBundle({ accountId: "" });

    expect(bundle.source).toBe("none");
    expect(bundle.missingSources).toContain("account");
    expect(bundle.missingSources).toHaveLength(5);
    // The primary cross-customer-contamination guard: no HTTP at all.
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid Account id to prevent SOQL injection", async () => {
    const h = buildHarness();

    await expect(
      h.gateway.readAccountProfile({ accountId: "x' OR Id != '" })
    ).rejects.toMatchObject({ kind: "malformed" });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("retries once on a 401 after invalidating the token", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse({ records: [{ Type: "Customer", Rating: "Warm" }] })
      );

    const profile = await h.gateway.readAccountProfile({
      accountId: ACCOUNT_ID
    });

    expect(profile.strategic).toBe(false);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies a 404 as not_found, a 403 as auth, and a 500 as backend", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(
      h.gateway.readAccountProfile({ accountId: ACCOUNT_ID })
    ).rejects.toMatchObject({ kind: "not_found" });

    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    let authError: SalesforceGatewayError | undefined;
    try {
      await h.gateway.readAccountProfile({ accountId: ACCOUNT_ID });
    } catch (e) {
      authError = e as SalesforceGatewayError;
    }
    expect(authError?.kind).toBe("auth");
    expect(JSON.stringify(authError)).not.toContain(ACCESS_TOKEN);

    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(
      h.gateway.readAccountProfile({ accountId: ACCOUNT_ID })
    ).rejects.toMatchObject({ kind: "backend" });
  });

  it("isolates a per-source failure into missingSources without failing the bundle", async () => {
    const h = buildHarness();
    const future = new Date(Date.now() + 10_000_000_000).toISOString();
    h.fetchMock
      // 1. account
      .mockResolvedValueOnce(
        jsonResponse({ records: [{ Type: "Enterprise", Rating: "Hot" }] })
      )
      // 2. entitlement — fails
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      // 3. warranty
      .mockResolvedValueOnce(
        jsonResponse({ records: [{ UsageEndDate: future }] })
      )
      // 4. installed assets
      .mockResolvedValueOnce(
        jsonResponse({ records: [{ pname: "VX-900", total: 3 }] })
      )
      // 5. service history
      .mockResolvedValueOnce(
        jsonResponse({
          records: [{ IsEscalated: false, IsClosed: true, CreatedDate: future }]
        })
      );

    const bundle = await h.gateway.readCustomerBundle({
      accountId: ACCOUNT_ID
    });

    expect(bundle.source).toBe("soql");
    expect(bundle.missingSources).toEqual(["entitlement"]);
    expect(bundle.accountProfile?.tier).toBe("premium");
    expect(bundle.warranty?.status).toBe("covered");
    expect(bundle.installedAssets?.totalAssets).toBe(3);
    expect(bundle.serviceHistory?.priorCaseCount).toBe(1);
    // Every issued query stayed Account-scoped.
    for (const call of h.fetchMock.mock.calls) {
      expect(decodeURIComponent(call[0])).toContain(ACCOUNT_ID);
    }
  });

  it("returns undefined from the Data 360 bundle when Data Cloud is disabled", async () => {
    const h = buildHarness(false);
    const bundle = await h.gateway.readCustomer360Bundle({
      accountId: ACCOUNT_ID
    });
    expect(bundle).toBeUndefined();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

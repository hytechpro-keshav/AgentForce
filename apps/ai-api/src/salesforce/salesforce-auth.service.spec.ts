import type { AppConfigService } from "../config/app-config.service";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";

const CLIENT_SECRET = "super-secret-client-credential";

function configWith(
  overrides: Partial<{
    enabled: boolean;
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    instanceUrl?: string;
  }> = {}
): AppConfigService {
  return {
    salesforceConnection: {
      enabled: overrides.enabled ?? true,
      instanceUrl: overrides.instanceUrl ?? "https://example.my.salesforce.com",
      tokenUrl:
        overrides.tokenUrl ??
        "https://example.my.salesforce.com/services/oauth2/token",
      clientId: overrides.clientId ?? "client-123",
      clientSecret:
        "clientSecret" in overrides ? overrides.clientSecret : CLIENT_SECRET,
      apiVersion: "60.0",
      timeoutMs: 15000
    }
  } as unknown as AppConfigService;
}

describe("SalesforceAuthService", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("requests a client-credentials token and caches it", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "tok-1",
          instance_url: "https://example.my.salesforce.com"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const auth = new SalesforceAuthService(configWith());

    const first = await auth.getAccessContext();
    const second = await auth.getAccessContext();

    expect(first.accessToken).toBe("tok-1");
    expect(second.accessToken).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toContain(
      "grant_type=client_credentials"
    );
  });

  it("throws not_configured when the connection is disabled", async () => {
    const auth = new SalesforceAuthService(
      configWith({ enabled: false, clientSecret: undefined })
    );
    await expect(auth.getAccessContext()).rejects.toMatchObject({
      kind: "not_configured"
    });
  });

  it("classifies a rejected credential as auth without leaking the secret", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 400 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const auth = new SalesforceAuthService(configWith());

    const error = (await auth
      .getAccessContext()
      .catch((e) => e)) as SalesforceGatewayError;

    expect(error).toBeInstanceOf(SalesforceGatewayError);
    expect(error.kind).toBe("auth");
    expect(error.message).not.toContain(CLIENT_SECRET);
  });

  it("treats a missing access_token as malformed", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ instance_url: "https://x" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const auth = new SalesforceAuthService(configWith());

    await expect(auth.getAccessContext()).rejects.toMatchObject({
      kind: "malformed"
    });
  });

  it("re-fetches after invalidate", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "tok-1",
              instance_url: "https://x"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    const auth = new SalesforceAuthService(configWith());

    await auth.getAccessContext();
    auth.invalidate();
    await auth.getAccessContext();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

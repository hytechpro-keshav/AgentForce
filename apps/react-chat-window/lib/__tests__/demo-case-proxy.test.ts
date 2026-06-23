import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/demo/cases/route";

const CREATE_TOKEN = "server-side-demo-create-token";

function call(body: Record<string, unknown>) {
  const request = {
    json: async () => body,
    headers: new Headers({ "x-forwarded-for": "203.0.113.10" })
  } as never;
  return POST(request);
}

describe("demo Case create proxy", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      AI_API_BASE_URL: "https://ai-api.internal",
      AI_API_DEMO_CASE_CREATE_TOKEN: CREATE_TOKEN,
      DEMO_CASE_CREATE_ENABLED: "true"
    };
  });

  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it("returns 403 when the feature flag is off", async () => {
    process.env.DEMO_CASE_CREATE_ENABLED = "false";
    const response = await call({ scenarioId: "same-day-battery-fix" });
    expect(response.status).toBe(403);
  });

  it("returns 503 when the create token is not configured", async () => {
    delete process.env.AI_API_DEMO_CASE_CREATE_TOKEN;
    const response = await call({ scenarioId: "same-day-battery-fix" });
    expect(response.status).toBe(503);
  });

  it("attaches the server-side bearer token and proxies the create payload", async () => {
    const upstreamBody = JSON.stringify({
      caseId: "500000000000001ABC",
      caseNumber: "00001234",
      orchestrationUrl: "/orchestration?caseId=500000000000001ABC"
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(upstreamBody, {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await call({ scenarioId: "same-day-battery-fix" });
    expect(response.status).toBe(201);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://ai-api.internal/demo/cases");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${CREATE_TOKEN}`
    });

    const text = await response.text();
    expect(text).not.toContain(CREATE_TOKEN);
    expect(text).toContain("500000000000001ABC");
  });

  it("maps an upstream failure to 503", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const response = await call({ scenarioId: "same-day-battery-fix" });
    expect(response.status).toBe(503);
  });
});

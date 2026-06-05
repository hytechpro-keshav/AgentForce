import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/orchestrator/case/[caseId]/route";

const VALID_CASE_ID = "500000000000001ABC";
const VIEW_TOKEN = "server-side-view-token";

function call(caseId: string) {
  return GET({} as never, { params: { caseId } });
}

describe("orchestrator Case lookup proxy", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      AI_API_BASE_URL: "https://ai-api.internal",
      AI_API_ORCHESTRATOR_VIEW_TOKEN: VIEW_TOKEN
    };
  });

  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it("rejects a malformed Case id without calling upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await call("not-a-case");
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 when the view token is not configured", async () => {
    delete process.env.AI_API_ORCHESTRATOR_VIEW_TOKEN;
    const response = await call(VALID_CASE_ID);
    expect(response.status).toBe(503);
  });

  it("attaches the server-side bearer token and proxies latest Case workflow JSON", async () => {
    const upstreamBody = JSON.stringify({
      workflowId: "wf-9d6b898e-affa-406f-941c-6da4e3437e25",
      caseId: VALID_CASE_ID,
      status: "done"
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await call(VALID_CASE_ID);
    expect(response.status).toBe(200);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      `https://ai-api.internal/orchestrator/case-triage/cases/${VALID_CASE_ID}/latest`
    );
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${VIEW_TOKEN}`
    });

    const text = await response.text();
    expect(text).not.toContain(VIEW_TOKEN);
    expect(text).toContain("done");
  });

  it("maps an upstream failure to 503", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const response = await call(VALID_CASE_ID);
    expect(response.status).toBe(503);
  });
});

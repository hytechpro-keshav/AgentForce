import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

import { GET } from "@/app/api/orchestrator/[workflowId]/route";

const VALID_WORKFLOW_ID = "wf-9d6b898e-affa-406f-941c-6da4e3437e25";
const VIEW_TOKEN = "server-side-view-token";
const SESSION_TOKEN = "operator-session-jwt";

function call(workflowId: string, sessionCookie?: string) {
  const request = {
    cookies: {
      get: (name: string) =>
        sessionCookie && name === "orchestrator_session"
          ? { value: sessionCookie }
          : undefined
    }
  } as NextRequest;
  return GET(request, { params: { workflowId } });
}

describe("orchestrator status proxy", () => {
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

  it("rejects a malformed workflow id without calling upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await call("not-a-workflow");
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 when no orchestrator token is configured", async () => {
    delete process.env.AI_API_ORCHESTRATOR_VIEW_TOKEN;
    delete process.env.AI_API_DEMO_CASE_CREATE_TOKEN;
    const response = await call(VALID_WORKFLOW_ID);
    expect(response.status).toBe(503);
  });

  it("prefers the operator session cookie over the static view token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "awaiting_step" }), { status: 200 })
    );

    const response = await call(VALID_WORKFLOW_ID, SESSION_TOKEN);
    expect(response.status).toBe(200);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${SESSION_TOKEN}`
    });
  });

  it("attaches the server-side bearer token and proxies upstream JSON", async () => {
    const upstreamBody = JSON.stringify({
      workflowId: VALID_WORKFLOW_ID,
      status: "done"
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await call(VALID_WORKFLOW_ID);
    expect(response.status).toBe(200);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      `https://ai-api.internal/orchestrator/case-triage/${VALID_WORKFLOW_ID}`
    );
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${VIEW_TOKEN}`
    });

    // The browser-facing response must never echo the bearer token.
    const text = await response.text();
    expect(text).not.toContain(VIEW_TOKEN);
    expect(text).toContain("done");
  });

  it("maps an upstream failure to 503", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const response = await call(VALID_WORKFLOW_ID);
    expect(response.status).toBe(503);
  });
});

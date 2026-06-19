import type { AppConfigService } from "../config/app-config.service";
import type { GuardrailApprovalSubmitCommand } from "../orchestrator/dto/guardrail";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGuardrailApprovalGateway } from "./salesforce-guardrail-approval.gateway";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";

interface Harness {
  gateway: SalesforceGuardrailApprovalGateway;
  fetchMock: jest.Mock;
  invalidate: jest.Mock;
  getAccessContext: jest.Mock;
}

function buildHarness(enabled = true): Harness {
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
      enabled,
      apiVersion: "60.0",
      timeoutMs: 15000
    }
  } as unknown as AppConfigService;
  return {
    gateway: new SalesforceGuardrailApprovalGateway(auth, config),
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

const command: GuardrailApprovalSubmitCommand = {
  workflowId: "wf-1",
  caseId: "500000000000001",
  riskScore: 45,
  riskLevel: "medium",
  policyRulesTriggered: ["PARTS_APPROVAL_REQUIRED"],
  approvalReasons: ["cross_region_transfer"],
  resumeToken: "header.payload.sig",
  verdict: {
    headline: "Approval required",
    summary: "Held for human approval.",
    recommendedSteps: ["Review"],
    highlights: [{ label: "Risk", value: "45 (medium)" }]
  },
  orchestrationConsoleUrl: "https://ui.example.com/orchestration?caseId=x"
};

describe("SalesforceGuardrailApprovalGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("POSTs the command to the Apex REST resource and maps the result", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        submitted: true,
        processInstanceId: "04i000000000001AAA"
      })
    );
    const result = await h.gateway.submitApproval(command);
    expect(result.submitted).toBe(true);
    expect(result.processInstanceId).toBe("04i000000000001AAA");
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe(
      `${INSTANCE_URL}/services/apexrest/agentforce/guardrail-approval/submit`
    );
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(JSON.parse(init.body).workflowId).toBe("wf-1");
  });

  it("maps the idempotent alreadyPending result", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        submitted: true,
        alreadyPending: true,
        processInstanceId: "04i000000000002AAA"
      })
    );
    const result = await h.gateway.submitApproval(command);
    expect(result.alreadyPending).toBe(true);
    expect(result.processInstanceId).toBe("04i000000000002AAA");
  });

  it("retries once after a 401 with a fresh token", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ submitted: true }));
    const result = await h.gateway.submitApproval(command);
    expect(result.submitted).toBe(true);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("degrades (never throws) on a backend error", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const result = await h.gateway.submitApproval(command);
    expect(result.submitted).toBe(false);
    expect(result.degraded).toBe(true);
  });

  it("degrades (never throws) on a network failure", async () => {
    const h = buildHarness();
    h.fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await h.gateway.submitApproval(command);
    expect(result.degraded).toBe(true);
  });

  it("degrades without a call when Salesforce is not configured", async () => {
    const h = buildHarness(false);
    const result = await h.gateway.submitApproval(command);
    expect(result.degraded).toBe(true);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCaseGateway } from "./salesforce-case.gateway";
import { SalesforceGatewayError } from "./salesforce-gateway.error";

const ACCESS_TOKEN = "tok-secret-value";
const INSTANCE_URL = "https://example.my.salesforce.com";

interface Harness {
  gateway: SalesforceCaseGateway;
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
    gateway: new SalesforceCaseGateway(auth, config),
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

describe("SalesforceCaseGateway", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("reads and maps a Case, sending a bearer token to the REST API", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          Id: "500000000000001",
          CaseNumber: "00004242",
          Subject: "Outage",
          Description: "No service",
          Priority: "High",
          Status: "New",
          Origin: "Web",
          AccountId: "001000000000001",
          AssetId: "02i000000000001",
          Asset: {
            Product2: { ProductCode: "AV-LP-15X-PRO" }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          records: [
            {
              Service_Ship_To_City__c: "Austin",
              Service_Ship_To_State__c: "TX",
              Service_Ship_To_Country__c: "US"
            }
          ]
        })
      );

    const context = await h.gateway.readCaseContext("500000000000001");

    expect(context.reportedPriority).toBe("high");
    expect(context.caseNumber).toBe("00004242");
    expect(context.assetId).toBe("02i000000000001");
    expect(context.assetProductCode).toBe("AV-LP-15X-PRO");
    expect(context.serviceShipToCity).toBe("Austin");
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toContain(
      `${INSTANCE_URL}/services/data/v60.0/sobjects/Case/500000000000001`
    );
    expect(url).toContain("fields=");
    expect(url).toContain("AssetId");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${ACCESS_TOKEN}`
    });
  });

  it("threads the operator orchestration status into the Case context (RC-1)", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          Id: "500000000000001",
          Subject: "x",
          Description: "y",
          Priority: "High",
          AssetId: "02i000000000001",
          Asset: { Product2: { ProductCode: "AV-LP-15X-PRO" } }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ records: [] })) // ship-to
      .mockResolvedValueOnce(
        jsonResponse({
          records: [{ AI_Orchestration_Status__c: "stopped_by_user" }]
        })
      );

    const context = await h.gateway.readCaseContext("500000000000001");
    expect(context.orchestrationStatus).toBe("stopped_by_user");
  });

  it("readOrchestrationStatus returns the Stop-AI flag for the Case", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [{ AI_Orchestration_Status__c: "stopped_by_user" }]
      })
    );
    await expect(
      h.gateway.readOrchestrationStatus("500000000000001")
    ).resolves.toBe("stopped_by_user");
  });

  it("readOrchestrationStatus degrades to undefined when the field read fails", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    // Degrade-safe: a missing field / failed read is treated as `active`.
    await expect(
      h.gateway.readOrchestrationStatus("500000000000001")
    ).resolves.toBeUndefined();
  });

  it("readOrchestrationStatus ignores an unrecognized value", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse({ records: [{ AI_Orchestration_Status__c: "weird" }] })
    );
    await expect(
      h.gateway.readOrchestrationStatus("500000000000001")
    ).resolves.toBeUndefined();
  });

  it("readOrchestrationStatus rejects a malformed case id without a callout", async () => {
    const h = buildHarness();
    await expect(
      h.gateway.readOrchestrationStatus("../bad")
    ).resolves.toBeUndefined();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("maps Salesforce Medium priority to normal", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          Id: "500000000000001",
          Subject: "x",
          Description: "y",
          Priority: "Medium"
        })
      )
      .mockResolvedValueOnce(jsonResponse({ records: [] }));
    const context = await h.gateway.readCaseContext("500000000000001");
    expect(context.reportedPriority).toBe("normal");
  });

  it("posts a private Case comment without throwing on failure", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(
      new Response("error", { status: 500, statusText: "Server Error" })
    );

    const result = await h.gateway.postCaseComment({
      caseId: "500000000000001",
      commentBody: "Agent 1 – Triage: test narrative."
    });

    expect(result).toEqual({ posted: false });
  });

  it("applies the write-back as a Priority PATCH plus a CaseComment POST", async () => {
    const h = buildHarness();
    h.fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ id: "00a000000000001" }, 201));

    const result = await h.gateway.applyWriteBack({
      caseId: "500000000000001",
      recommendedPriority: "critical",
      triageSummary: "Outage needs network team.",
      suggestedNextStep: "Route to network ops."
    });

    expect(result).toEqual({
      applied: true,
      priorityUpdated: true,
      commentCreated: true
    });

    const [patchUrl, patchInit] = h.fetchMock.mock.calls[0];
    expect((patchInit as RequestInit).method).toBe("PATCH");
    expect(patchUrl).toContain("/sobjects/Case/500000000000001");
    expect(JSON.parse((patchInit as RequestInit).body as string)).toEqual({
      Priority: "High"
    });

    const [commentUrl, commentInit] = h.fetchMock.mock.calls[1];
    expect((commentInit as RequestInit).method).toBe("POST");
    expect(commentUrl).toContain("/sobjects/CaseComment");
    const commentBody = JSON.parse((commentInit as RequestInit).body as string);
    expect(commentBody.ParentId).toBe("500000000000001");
    expect(commentBody.IsPublished).toBe(false);
    expect(commentBody.CommentBody).toContain("Outage needs network team.");
  });

  it("writes triage tracking fields onto the Case via PATCH", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await h.gateway.writeTriageTracking({
      caseId: "500000000000001",
      workflowId: "wf-9d6b898e-affa-406f-941c-6da4e3437e25",
      status: "done",
      updatedAt: "2026-06-05T10:00:00.000Z",
      uiUrl: "https://chat.example.com/orchestration?caseId=500000000000001"
    });

    const [url, init] = h.fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("PATCH");
    expect(url).toContain("/sobjects/Case/500000000000001");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      AI_Triage_Workflow_Id__c: "wf-9d6b898e-affa-406f-941c-6da4e3437e25",
      AI_Triage_Status__c: "done",
      AI_Triage_Updated_At__c: "2026-06-05T10:00:00.000Z",
      AI_Triage_UI_URL__c:
        "https://chat.example.com/orchestration?caseId=500000000000001"
    });
  });

  it("omits the UI URL field when no link is provided", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await h.gateway.writeTriageTracking({
      caseId: "500000000000001",
      workflowId: "wf-9d6b898e-affa-406f-941c-6da4e3437e25",
      status: "assigned",
      updatedAt: "2026-06-05T10:00:00.000Z"
    });

    const body = JSON.parse(
      (h.fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body).not.toHaveProperty("AI_Triage_UI_URL__c");
    expect(body.AI_Triage_Status__c).toBe("assigned");
  });

  it("writeOrchestrationStop PATCHes the Stop-AI flag onto the Case (RC-1)", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await h.gateway.writeOrchestrationStop("500000000000001");

    const [url, init] = h.fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("PATCH");
    expect(url).toContain("/sobjects/Case/500000000000001");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      AI_Orchestration_Status__c: "stopped_by_user"
    });
  });

  it("surfaces a Stop-AI flag write error for the caller to swallow", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await expect(
      h.gateway.writeOrchestrationStop("500000000000001")
    ).rejects.toBeInstanceOf(SalesforceGatewayError);
  });

  it("writeGuardrailStatus PATCHes the guardrail status onto the Case (6c timeout)", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await h.gateway.writeGuardrailStatus("500000000000001", "escalated");

    const [url, init] = h.fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("PATCH");
    expect(url).toContain("/sobjects/Case/500000000000001");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      AI_Guardrail_Status__c: "escalated"
    });
  });

  it("surfaces a tracking write-back error for the caller to swallow", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await expect(
      h.gateway.writeTriageTracking({
        caseId: "500000000000001",
        workflowId: "wf-9d6b898e-affa-406f-941c-6da4e3437e25",
        status: "done",
        updatedAt: "2026-06-05T10:00:00.000Z"
      })
    ).rejects.toBeInstanceOf(SalesforceGatewayError);
  });

  it("classifies a 404 read as not_found", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(
      h.gateway.readCaseContext("500000000000001")
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("classifies a 403 as auth and does not leak the token", async () => {
    const h = buildHarness();
    // 401 triggers one retry, then 403 surfaces as auth.
    h.fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 }));

    let error: SalesforceGatewayError | undefined;
    try {
      await h.gateway.readCaseContext("500000000000001");
    } catch (e) {
      error = e as SalesforceGatewayError;
    }

    expect(error).toBeInstanceOf(SalesforceGatewayError);
    expect(error?.kind).toBe("auth");
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error)).not.toContain(ACCESS_TOKEN);
    expect(error?.message).not.toContain(ACCESS_TOKEN);
  });

  it("classifies a 500 as backend", async () => {
    const h = buildHarness();
    h.fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(
      h.gateway.readCaseContext("500000000000001")
    ).rejects.toMatchObject({ kind: "backend" });
  });
});

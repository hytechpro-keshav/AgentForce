import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { SupportTriageService } from "../src/agents/support-triage.service";
import { SalesforceCaseGateway } from "../src/salesforce/salesforce-case.gateway";
import type { SalesforceCaseContext } from "../src/orchestrator/dto/salesforce-case-context";

const JWT_SECRET = "orchestrator-e2e-secret";
const ALL_SCOPES =
  "agentforce:orchestrator-triage agentforce:orchestrator-read agentforce:orchestrator-approval";

function token(scope: string): string {
  return jwt.sign({ sub: "sf-service", scope }, JWT_SECRET, {
    algorithm: "HS256"
  });
}

function bearer(scope: string): string {
  return `Bearer ${token(scope)}`;
}

const fakeGateway = {
  isConfigured: jest.fn().mockReturnValue(true),
  readCaseContext: jest.fn(),
  applyWriteBack: jest.fn()
};

const fakeTriage = {
  triage: jest.fn()
};

describe("CaseTriageOrchestrator (e2e)", () => {
  let app: INestApplication;
  const previousSecret = process.env.AI_API_JWT_SECRET;

  beforeAll(async () => {
    process.env.AI_API_JWT_SECRET = JWT_SECRET;
    delete process.env.AI_API_AUTH_DISABLED;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(SalesforceCaseGateway)
      .useValue(fakeGateway)
      .overrideProvider(SupportTriageService)
      .useValue(fakeTriage)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (previousSecret === undefined) {
      delete process.env.AI_API_JWT_SECRET;
    } else {
      process.env.AI_API_JWT_SECRET = previousSecret;
    }
  });

  beforeEach(() => {
    fakeGateway.isConfigured.mockReturnValue(true);
    fakeGateway.readCaseContext.mockReset();
    fakeGateway.applyWriteBack.mockReset();
    fakeTriage.triage.mockReset();

    const context: SalesforceCaseContext = {
      caseId: "500000000000001",
      caseNumber: "00004242",
      subject: "Outage",
      description: "No service since 9am",
      reportedPriority: "high"
    };
    fakeGateway.readCaseContext.mockResolvedValue(context);
    fakeGateway.applyWriteBack.mockResolvedValue({
      applied: true,
      priorityUpdated: true,
      commentCreated: true
    });
    fakeTriage.triage.mockResolvedValue({
      recommendedPriority: "critical",
      summary: "Outage affecting service.",
      suggestedNextStep: "Route to network operations.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 40
    });
  });

  async function pollUntilStatus(
    workflowId: string,
    auth: string,
    accepted: string[]
  ): Promise<request.Response> {
    for (let i = 0; i < 60; i += 1) {
      const response = await request(app.getHttpServer())
        .get(`/orchestrator/case-triage/${workflowId}`)
        .set("Authorization", auth);
      if (response.status === 200 && accepted.includes(response.body.status)) {
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`Workflow did not reach any of [${accepted.join(", ")}].`);
  }

  it("drives Node 1→6 to an auto-approved done with a real write-back", async () => {
    // A low-risk, account-linked case clears the Node 6 composite policy to
    // autoApprove (no NO_ACCOUNT_LINKED hard rule; no TRIAGE_* lift), so the
    // graph proceeds straight to the gated write-back without an interrupt.
    fakeGateway.readCaseContext.mockResolvedValue({
      caseId: "500000000000001",
      caseNumber: "00004242",
      subject: "Outage",
      description: "No service since 9am",
      reportedPriority: "normal",
      accountId: "001000000000001"
    });
    fakeTriage.triage.mockResolvedValue({
      recommendedPriority: "normal",
      summary: "Service degraded.",
      suggestedNextStep: "Route to support queue.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 40
    });

    const accepted = await request(app.getHttpServer())
      .post("/orchestrator/case-triage/triggers")
      .set("Authorization", bearer("agentforce:orchestrator-triage"))
      .send({ caseId: "500000000000001", caseNumber: "00004242" })
      .expect(202);

    expect(accepted.body.status).toBe("assigned");
    const workflowId = accepted.body.workflowId as string;
    expect(workflowId).toMatch(/^wf-/);

    const final = await pollUntilStatus(
      workflowId,
      bearer("agentforce:orchestrator-read"),
      ["done", "rejected", "failed"]
    );
    expect(final.body.status).toBe("done");
    expect(final.body.writeBackApplied).toBe(true);
    expect(final.body.triage.recommendedPriority).toBe("normal");
    expect(final.body.guardrail.outcome).toBe("autoApprove");
    expect(fakeGateway.readCaseContext).toHaveBeenCalledWith("500000000000001");
    expect(fakeGateway.applyWriteBack).toHaveBeenCalledTimes(1);

    // The read model never carries raw Case description text.
    expect(JSON.stringify(final.body)).not.toContain("No service since 9am");
  });

  it("rejects a trigger without the orchestrator-triage scope", async () => {
    await request(app.getHttpServer())
      .post("/orchestrator/case-triage/triggers")
      .set("Authorization", bearer("agentforce:orchestrator-read"))
      .send({ caseId: "500000000000001" })
      .expect(403);
  });

  it("rejects an unauthenticated trigger", async () => {
    await request(app.getHttpServer())
      .post("/orchestrator/case-triage/triggers")
      .send({ caseId: "500000000000001" })
      .expect(401);
  });

  it("validates the trigger DTO", async () => {
    await request(app.getHttpServer())
      .post("/orchestrator/case-triage/triggers")
      .set("Authorization", bearer("agentforce:orchestrator-triage"))
      .send({ caseId: "not-an-id" })
      .expect(400);
  });

  it("requires the read scope for the status feed", async () => {
    const accepted = await request(app.getHttpServer())
      .post("/orchestrator/case-triage/triggers")
      .set("Authorization", bearer(ALL_SCOPES))
      .send({ caseId: "500000000000001" })
      .expect(202);

    await request(app.getHttpServer())
      .get(`/orchestrator/case-triage/${accepted.body.workflowId}`)
      .set("Authorization", bearer("agentforce:orchestrator-triage"))
      .expect(403);
  });

  it("returns 503 when outbound Salesforce is not configured", async () => {
    fakeGateway.isConfigured.mockReturnValue(false);
    await request(app.getHttpServer())
      .post("/orchestrator/case-triage/triggers")
      .set("Authorization", bearer("agentforce:orchestrator-triage"))
      .send({ caseId: "500000000000001" })
      .expect(503);
  });

  it("returns 400 for a malformed workflow id", async () => {
    await request(app.getHttpServer())
      .get("/orchestrator/case-triage/not-a-workflow")
      .set("Authorization", bearer("agentforce:orchestrator-read"))
      .expect(400);
  });
});

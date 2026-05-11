import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { ModelRouter } from "../src/llm/model-router";
import { LlmProviderError } from "../src/llm/interfaces/llm-provider";

const TEST_JWT_SECRET = "phase2-test-secret";

describe("Chat and OpenAI-compatible (e2e)", () => {
  let app: INestApplication;
  let router: {
    chat: jest.Mock;
    listAllModels: jest.Mock;
    availableProviders: string[];
  };

  beforeAll(async () => {
    process.env.AI_API_JWT_SECRET = TEST_JWT_SECRET;
    delete process.env.AI_API_AUTH_DISABLED;
    delete process.env.AGENTFORCE_HEALTH_API_KEY;

    router = {
      chat: jest.fn(),
      listAllModels: jest.fn(() => [{ id: "gpt-test", provider: "openai" }]),
      availableProviders: ["openai"]
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(ModelRouter)
      .useValue(router)
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
    delete process.env.AI_API_JWT_SECRET;
  });

  function signToken(payload: Record<string, unknown> = {}): string {
    return jwt.sign(
      { sub: "test", scope: "chat:write", ...payload },
      TEST_JWT_SECRET,
      { algorithm: "HS256" }
    );
  }

  it("POST /chat/message rejects requests without a bearer token", async () => {
    await request(app.getHttpServer())
      .post("/chat/message")
      .send({ messages: [{ role: "user", content: "hi" }] })
      .expect(401);
  });

  it("POST /chat/message validates the request body", async () => {
    await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ messages: [] })
      .expect(400);

    await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ messages: [{ role: "wizard", content: "hi" }] })
      .expect(400);
  });

  it("POST /chat/message calls ModelRouter and returns a normalized response", async () => {
    router.chat.mockResolvedValueOnce({
      content: "hello from openai",
      finishReason: "stop",
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      metadata: {
        provider: "openai",
        model: "gpt-test",
        latencyMs: 12,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });

    const response = await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        messages: [{ role: "user", content: "hi" }],
        requestId: "req-abc"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      content: "hello from openai",
      provider: "openai",
      model: "gpt-test",
      fallbackUsed: false,
      attemptedProviders: ["openai"],
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
    });

    const call = router.chat.mock.calls[0][0];
    expect(call.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(call.requestId).toBe("req-abc");
  });

  it("POST /chat/message surfaces provider failures as 4xx", async () => {
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("openai", "rate_limit", "throttled")
    );

    const response = await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ messages: [{ role: "user", content: "hi" }] })
      .expect(400);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "openai",
      kind: "rate_limit"
    });
  });

  it("GET /v1/models exposes available models for OpenAI-compatible clients", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("authorization", `Bearer ${signToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      object: "list",
      data: [{ id: "gpt-test", object: "model", owned_by: "openai" }]
    });
  });

  it("POST /v1/chat/completions returns an OpenAI-shaped response", async () => {
    router.chat.mockResolvedValueOnce({
      content: "hi back",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      metadata: {
        provider: "openai",
        model: "gpt-test",
        latencyMs: 7,
        fallbackUsed: false,
        attemptedProviders: ["openai"],
        responseId: "chatcmpl-x"
      }
    });

    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        model: "gpt-test",
        messages: [{ role: "user", content: "hi" }]
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: "chatcmpl-x",
      object: "chat.completion",
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hi back" },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    });
  });

  it("GET /health/live remains public after Phase 2 wiring", async () => {
    const response = await request(app.getHttpServer())
      .get("/health/live")
      .expect(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("POST /agent/support/triage-case requires the Agentforce triage scope", async () => {
    await request(app.getHttpServer())
      .post("/agent/support/triage-case")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        subject: "Phase 2 proof",
        description: "The customer reports no service.",
        reportedPriority: "high"
      })
      .expect(403);
  });

  it("POST /agent/support/triage-case calls ModelRouter with scoped Agentforce JWT", async () => {
    router.chat.mockResolvedValueOnce({
      content:
        '{"priority":"high","summary":"Outage report for jane@example.com","nextStep":"Call 415-555-1212 for details"}',
      finishReason: "stop",
      usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 },
      metadata: {
        provider: "openai",
        model: "gpt-4.1-mini",
        latencyMs: 21,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });

    const response = await request(app.getHttpServer())
      .post("/agent/support/triage-case")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:support-triage" })}`
      )
      .send({
        subject: "Phase 2 proof for Jane Doe",
        description:
          "Customer name is Jane Doe. Email jane@example.com, phone 415-555-1212, account number ACCT-123456, and service address 123 Main St. The customer reports no service.",
        reportedPriority: "high"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      recommendedPriority: "high",
      summary: "Outage report for [redacted-email]",
      suggestedNextStep: "Call [redacted-phone] for details",
      provider: "openai",
      model: "gpt-4.1-mini",
      fallbackUsed: false,
      latencyMs: 21
    });

    const llmRequest = router.chat.mock.calls.at(-1)?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(llmRequest).toBeDefined();
    const userMessage = llmRequest.messages.find(
      (message: { role: string }) => message.role === "user"
    );
    expect(userMessage).toBeDefined();
    const userContent = userMessage?.content ?? "";
    expect(userContent).toContain("[redacted-name]");
    expect(userContent).toContain("[redacted-email]");
    expect(userContent).toContain("[redacted-phone]");
    expect(userContent).toContain("[redacted-identifier]");
    expect(userContent).toContain("[redacted-address]");
    expect(userContent).toContain("The customer reports no service.");
    expect(userContent).not.toContain("Jane Doe");
    expect(userContent).not.toContain("jane@example.com");
    expect(userContent).not.toContain("415-555-1212");
    expect(userContent).not.toContain("ACCT-123456");
    expect(userContent).not.toContain("123 Main St");
  });

  it("POST /agent/support/triage-case returns structured provider errors", async () => {
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("model-router", "validation", "No providers")
    );

    const response = await request(app.getHttpServer())
      .post("/agent/support/triage-case")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:support-triage" })}`
      )
      .send({
        subject: "Phase 2 proof",
        description: "The customer reports no service.",
        reportedPriority: "high"
      })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "model-router",
      kind: "validation"
    });
  });

  it("POST /agent/support/analyze-case requires the case-analysis scope", async () => {
    await request(app.getHttpServer())
      .post("/agent/support/analyze-case")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        caseSubject: "Phase 3 proof",
        caseDescription: "The customer reports no service since 9 AM.",
        reportedPriority: "high"
      })
      .expect(403);
  });

  it("POST /agent/support/analyze-case calls ModelRouter with structured case context", async () => {
    router.chat.mockResolvedValueOnce({
      content:
        '{"summary":"Outage reported for jane@example.com","category":"outage","priority":"high","confidence":"high","nextAction":"Call 415-555-1212 to confirm"}',
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 16, totalTokens: 28 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 33,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });

    const response = await request(app.getHttpServer())
      .post("/agent/support/analyze-case")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:case-analysis" })}`
      )
      .send({
        caseSubject: "Outage in service area",
        caseDescription:
          "Customer name is Jane Doe. Email jane@example.com, phone 415-555-1212, account number ACCT-123456, and service address 123 Main St. The customer reports no service.",
        caseStatus: "Working",
        caseType: "Outage",
        caseOrigin: "Web",
        reportedPriority: "high",
        requestId: "case-analysis-req-1"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      category: "outage",
      recommendedPriority: "high",
      confidence: "high",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 33
    });
    expect(response.body.summary).toContain("[redacted-email]");
    expect(response.body.nextAction).toContain("[redacted-phone]");

    const llmRequest = router.chat.mock.calls.at(-1)?.[0] as {
      messages: Array<{ role: string; content: string }>;
      requestId?: string;
    };
    expect(llmRequest).toBeDefined();
    expect(llmRequest.requestId).toBe("case-analysis-req-1");
    const userMessage = llmRequest.messages.find(
      (m: { role: string }) => m.role === "user"
    );
    const userContent = userMessage?.content ?? "";
    expect(userContent).toContain("Status: Working");
    expect(userContent).toContain("Type: Outage");
    expect(userContent).toContain("Origin: Web");
    expect(userContent).toContain("Reported priority: high");
    expect(userContent).toContain("[redacted-email]");
    expect(userContent).toContain("[redacted-phone]");
    expect(userContent).toContain("[redacted-identifier]");
    expect(userContent).toContain("[redacted-address]");
    expect(userContent).not.toContain("Jane Doe");
    expect(userContent).not.toContain("jane@example.com");
    expect(userContent).not.toContain("415-555-1212");
    expect(userContent).not.toContain("ACCT-123456");
    expect(userContent).not.toContain("123 Main St");
  });

  it("POST /agent/support/analyze-case surfaces provider validation as 503", async () => {
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("model-router", "validation", "No providers")
    );

    const response = await request(app.getHttpServer())
      .post("/agent/support/analyze-case")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:case-analysis" })}`
      )
      .send({
        caseSubject: "Phase 3 proof",
        caseDescription: "The customer reports no service.",
        reportedPriority: "high"
      })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "model-router",
      kind: "validation"
    });
  });
});

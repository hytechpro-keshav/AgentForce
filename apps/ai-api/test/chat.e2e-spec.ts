import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash } from "crypto";
import * as jwt from "jsonwebtoken";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { ModelRouter } from "../src/llm/model-router";
import { LlmProviderError } from "../src/llm/interfaces/llm-provider";
import { RagAnswerService } from "../src/rag/rag-answer.service";

const TEST_JWT_SECRET = "phase2-test-secret";
const TEST_OAUTH_CLIENT_SECRET = "phase8-oauth-client-secret";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Chat and OpenAI-compatible (e2e)", () => {
  let app: INestApplication;
  let router: {
    chat: jest.Mock;
    chatStream: jest.Mock;
    listAllModels: jest.Mock;
    availableProviders: string[];
  };
  let ragAnswerService: { answer: jest.Mock };

  beforeAll(async () => {
    process.env.AI_API_JWT_SECRET = TEST_JWT_SECRET;
    process.env.RAG_ENABLED = "true";
    process.env.DEFAULT_EMBEDDING_PROVIDER = "deterministic";
    process.env.VECTOR_DB_PROVIDER = "memory";
    process.env.RAG_DEFAULT_NAMESPACE = "customer-self-service";
    process.env.CUSTOMER_CHAT_ACCESS_CODE = "phase6-login-code";
    process.env.CUSTOMER_CHAT_SESSION_TTL_SECONDS = "900";
    process.env.CUSTOMER_CHAT_SESSION_RATE_LIMIT_MAX_REQUESTS = "100";
    process.env.AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS = "900";
    process.env.AI_API_PUBLIC_BASE_URL = "https://ai-api.example.test";
    process.env.AI_API_OAUTH_CLIENTS_JSON = JSON.stringify([
      {
        clientId: "certinia-phase8-oauth",
        clientSecretSha256: sha256(TEST_OAUTH_CLIENT_SECRET),
        tenantId: "certinia-phase8",
        salesforceOrgId: "00D000000000001",
        ragNamespace: "certinia-phase8",
        scopes: [
          "agentforce:support-triage",
          "agentforce:services-project-health",
          "agentforce:revenue-account-health",
          "agentforce:revenue-portfolio-intelligence"
        ],
        roles: ["services-org-intelligence"]
      }
    ]);
    delete process.env.AI_API_AUTH_DISABLED;
    delete process.env.AGENTFORCE_HEALTH_API_KEY;

    router = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      listAllModels: jest.fn(() => [{ id: "gpt-test", provider: "openai" }]),
      availableProviders: ["openai"]
    };
    ragAnswerService = { answer: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(ModelRouter)
      .useValue(router)
      .overrideProvider(RagAnswerService)
      .useValue(ragAnswerService)
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
    delete process.env.RAG_ENABLED;
    delete process.env.DEFAULT_EMBEDDING_PROVIDER;
    delete process.env.VECTOR_DB_PROVIDER;
    delete process.env.RAG_DEFAULT_NAMESPACE;
    delete process.env.CUSTOMER_CHAT_ACCESS_CODE;
    delete process.env.CUSTOMER_CHAT_SESSION_TTL_SECONDS;
    delete process.env.CUSTOMER_CHAT_SESSION_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS;
    delete process.env.AI_API_PUBLIC_BASE_URL;
    delete process.env.AI_API_OAUTH_CLIENTS_JSON;
  });

  beforeEach(() => {
    router.chat.mockReset();
    router.chatStream.mockReset();
    ragAnswerService.answer.mockReset();
  });

  function signToken(payload: Record<string, unknown> = {}): string {
    return jwt.sign(
      {
        sub: "test",
        scope: "chat:write",
        tenant: "tenant-demo",
        roles: ["customer"],
        ...payload
      },
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
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "chat:write chat:diagnostic" })}`
      )
      .send({ messages: [] })
      .expect(400);

    await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ messages: [{ role: "wizard", content: "hi" }] })
      .expect(400);

    await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        messages: [{ role: "user", content: "hi" }],
        requestId: "jane@example.com"
      })
      .expect(400);
  });

  it("POST /chat/message routes default customer chat through Knowledge RAG", async () => {
    ragAnswerService.answer.mockResolvedValueOnce({
      answerStatus: "ANSWERED",
      safeMessage:
        "Grounded answer generated from authorized knowledge sources.",
      answer:
        "Confirm the service light status, power cycle the gateway for 30 seconds, and wait up to 5 minutes. Source: sourceId=kb-1 chunkId=kb-1:v1:chunk-1.",
      sourceCount: 1,
      sources: [
        {
          sourceId: "kb-1",
          title: "Troubleshooting intermittent residential service",
          url: "https://help.example.invalid/kb/troubleshooting",
          documentVersion: "2026.05.11",
          chunkId: "kb-1:v1:chunk-1",
          score: 0.92,
          retrievalId: "rag-chat-test"
        }
      ],
      sourceIds: "kb-1",
      sourceTitles: "Troubleshooting intermittent residential service",
      sourceUrls: "https://help.example.invalid/kb/troubleshooting",
      sourceVersions: "2026.05.11",
      sourceChunkIds: "kb-1:v1:chunk-1",
      retrievalIds: "rag-chat-test",
      sourcesJson: "[]",
      provider: "openai",
      model: "gpt-4o-mini",
      embeddingProvider: "deterministic",
      embeddingModel: "deterministic-local-test",
      vectorDbProvider: "memory",
      fallbackUsed: false,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      latencyMs: 42,
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      requestId: "req-abc"
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
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      attemptedProviders: ["openai"],
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
    });
    expect(response.body.content).toContain("Confirm the service light status");
    expect(response.body.content).toContain("**Sources**");
    expect(response.body.content).toContain(
      "[Troubleshooting intermittent residential service](https://help.example.invalid/kb/troubleshooting)"
    );
    expect(response.body.content).not.toContain("chunkId=");
    expect(response.body.content).not.toContain("rag-chat-test");
    expect(ragAnswerService.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "hi",
        requestId: "req-abc"
      }),
      expect.objectContaining({
        tenantId: "tenant-demo",
        namespace: "customer-self-service",
        scopes: ["chat:write"]
      }),
      { useCase: "customer_chat" }
    );
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("POST /chat/message allows explicit provider routing for diagnostics", async () => {
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
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "chat:write chat:diagnostic" })}`
      )
      .send({
        messages: [{ role: "user", content: "hi" }],
        provider: "openai",
        requestId: "req-direct"
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
    expect(call.requestId).toBe("req-direct");
  });

  it("POST /chat/message ignores customer provider overrides without diagnostic scope", async () => {
    ragAnswerService.answer.mockResolvedValueOnce({
      answerStatus: "ANSWERED",
      safeMessage:
        "Grounded answer generated from authorized knowledge sources.",
      answer: "Use the approved customer knowledge path.",
      sourceCount: 0,
      sources: [],
      sourceIds: "",
      sourceTitles: "",
      sourceUrls: "",
      sourceVersions: "",
      sourceChunkIds: "",
      retrievalIds: "",
      sourcesJson: "[]",
      provider: "openai",
      model: "gpt-4o-mini",
      embeddingProvider: "deterministic",
      embeddingModel: "deterministic-local-test",
      vectorDbProvider: "memory",
      fallbackUsed: false,
      usage: { inputTokens: 8, outputTokens: 6, totalTokens: 14 },
      latencyMs: 20,
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      requestId: "req-customer-override"
    });

    await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        messages: [{ role: "user", content: "hi" }],
        provider: "openai-compatible",
        model: "expensive-model",
        requestId: "req-customer-override"
      })
      .expect(201);

    expect(ragAnswerService.answer).toHaveBeenCalledWith(
      expect.objectContaining({ question: "hi" }),
      expect.objectContaining({ tenantId: "tenant-demo" }),
      { useCase: "customer_chat" }
    );
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("POST /chat/message/stream streams grounded Knowledge RAG text", async () => {
    ragAnswerService.answer.mockResolvedValueOnce({
      answerStatus: "ANSWERED",
      safeMessage:
        "Grounded answer generated from authorized knowledge sources.",
      answer:
        "Use the approved gateway power-cycle guidance before escalation.",
      sourceCount: 1,
      sources: [
        {
          sourceId: "kb-1",
          title: "Troubleshooting intermittent residential service",
          url: "https://help.example.invalid/kb/troubleshooting",
          documentVersion: "2026.05.11",
          chunkId: "kb-1:v1:chunk-1",
          score: 0.92,
          retrievalId: "rag-chat-stream-test"
        }
      ],
      sourceIds: "kb-1",
      sourceTitles: "Troubleshooting intermittent residential service",
      sourceUrls: "https://help.example.invalid/kb/troubleshooting",
      sourceVersions: "2026.05.11",
      sourceChunkIds: "kb-1:v1:chunk-1",
      retrievalIds: "rag-chat-stream-test",
      sourcesJson: "[]",
      provider: "openai",
      model: "gpt-4o-mini",
      embeddingProvider: "deterministic",
      embeddingModel: "deterministic-local-test",
      vectorDbProvider: "memory",
      fallbackUsed: false,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      latencyMs: 42,
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      requestId: "req-stream"
    });

    const response = await request(app.getHttpServer())
      .post("/chat/message/stream")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        messages: [{ role: "user", content: "intermittent service help" }],
        requestId: "req-stream"
      })
      .expect(200)
      .expect("content-type", /text\/event-stream/);

    expect(response.text).toContain("Use the approved gateway power-cycle");
    expect(response.text).toContain("**Sources**");
    expect(response.text).toContain("data: [DONE]");
    expect(response.text).not.toContain("rag-chat-stream-test");
    expect(router.chatStream).not.toHaveBeenCalled();
  });

  it("POST /chat/message rejects Open WebUI gateway tokens", async () => {
    await request(app.getHttpServer())
      .post("/chat/message")
      .set("authorization", `Bearer ${signToken({ scope: "openwebui:chat" })}`)
      .send({ messages: [{ role: "user", content: "hi" }] })
      .expect(403);
  });

  it("POST /auth/customer-chat/session validates the request body", async () => {
    await request(app.getHttpServer())
      .post("/auth/customer-chat/session")
      .send({})
      .expect(400);
  });

  it("POST /auth/customer-chat/session rejects an invalid access code", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/customer-chat/session")
      .send({ accessCode: "wrong" })
      .expect(401);

    expect(response.body).toMatchObject({
      error: "customer_chat_login_failed"
    });
  });

  it("POST /auth/customer-chat/session mints a chat token for customer login", async () => {
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/customer-chat/session")
      .send({ accessCode: "phase6-login-code", locale: "en-US" })
      .expect(201);

    expect(loginResponse.body).toMatchObject({
      tokenType: "Bearer",
      expiresInSeconds: 900,
      subject: expect.stringMatching(/^customer-chat:/)
    });
    expect(loginResponse.body.accessToken).toEqual(expect.any(String));
    expect(loginResponse.body.expiresAt).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post("/chat/escalate")
      .set("authorization", `Bearer ${loginResponse.body.accessToken}`)
      .send({ reason: "Need help after login" })
      .expect(201);
  });

  it("POST /chat/escalate rejects requests without a bearer token", async () => {
    await request(app.getHttpServer())
      .post("/chat/escalate")
      .send({ reason: "Need help" })
      .expect(401);
  });

  it("POST /chat/escalate rejects Open WebUI gateway tokens", async () => {
    await request(app.getHttpServer())
      .post("/chat/escalate")
      .set("authorization", `Bearer ${signToken({ scope: "openwebui:chat" })}`)
      .send({ reason: "Need help" })
      .expect(403);
  });

  it("POST /chat/escalate validates the request body", async () => {
    await request(app.getHttpServer())
      .post("/chat/escalate")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ reason: "" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/chat/escalate")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ reason: "Need help", urgency: "panic" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/chat/escalate")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ reason: "Need help", caseReference: "not safe id!" })
      .expect(400);
  });

  it("POST /chat/escalate acknowledges a customer-safe escalation", async () => {
    const response = await request(app.getHttpServer())
      .post("/chat/escalate")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        reason: "Outage continues after troubleshooting",
        urgency: "high",
        caseReference: "case-00123456",
        conversationSummary: "Customer reported repeated dropouts",
        locale: "en-US",
        requestId: "req-esc-1"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: "received",
      urgency: "high",
      requestId: "req-esc-1"
    });
    expect(response.body.escalationId).toMatch(/^esc-/);
    expect(typeof response.body.receivedAt).toBe("string");
    expect(typeof response.body.nextSteps).toBe("string");
  });

  it("POST /chat/escalate defaults urgency to normal", async () => {
    const response = await request(app.getHttpServer())
      .post("/chat/escalate")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ reason: "Need help" })
      .expect(201);
    expect(response.body.urgency).toBe("normal");
  });

  it("POST /chat/message surfaces provider failures as 4xx", async () => {
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("openai", "rate_limit", "throttled")
    );

    const response = await request(app.getHttpServer())
      .post("/chat/message")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "chat:write chat:diagnostic" })}`
      )
      .send({
        messages: [{ role: "user", content: "hi" }],
        provider: "openai"
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "openai",
      kind: "rate_limit"
    });
  });

  it("GET /v1/models exposes only the Knowledge RAG model for Open WebUI", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("authorization", `Bearer ${signToken({ scope: "openwebui:chat" })}`)
      .expect(200);

    expect(response.body).toEqual({
      object: "list",
      data: [
        {
          id: "knowledge-rag",
          object: "model",
          owned_by: "agentforce-ai-api"
        }
      ]
    });
  });

  it("GET /v1/models requires the Open WebUI gateway scope", async () => {
    await request(app.getHttpServer()).get("/v1/models").expect(401);

    await request(app.getHttpServer())
      .get("/v1/models")
      .set("authorization", `Bearer ${signToken()}`)
      .expect(403);
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
      .set("authorization", `Bearer ${signToken({ scope: "openwebui:chat" })}`)
      .send({
        model: "gpt-test",
        user: "jane@example.com",
        messages: [{ role: "user", content: "hi" }],
        max_completion_tokens: 64,
        temperature: 0.4,
        top_p: 0.9,
        stream: false,
        stop: "END",
        tools: []
      })
      .expect(200);

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
    expect(router.chat.mock.calls[0][0]).toMatchObject({
      model: "gpt-test",
      maxTokens: 64,
      temperature: 0.4,
      requestId: expect.stringMatching(/^openwebui-/)
    });
    expect(router.chat.mock.calls[0][0].requestId).not.toContain("jane");
    expect(router.chat.mock.calls[0][0].requestId).not.toContain("@");
  });

  it("POST /v1/chat/completions returns an SSE envelope for stream=true", async () => {
    router.chat.mockResolvedValueOnce({
      content: "streamed hi back",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      metadata: {
        provider: "openai",
        model: "gpt-test",
        latencyMs: 7,
        fallbackUsed: false,
        attemptedProviders: ["openai"],
        responseId: "chatcmpl-stream-x"
      }
    });

    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${signToken({ scope: "openwebui:chat" })}`)
      .send({
        model: "gpt-test",
        messages: [{ role: "user", content: "hi" }],
        stream: true
      })
      .expect(200)
      .expect("content-type", /text\/event-stream/);

    expect(response.text).toContain("chat.completion.chunk");
    expect(response.text).toContain("streamed hi back");
    expect(response.text).toContain("data: [DONE]");
  });

  it("POST /v1/chat/completions requires the Open WebUI gateway scope", async () => {
    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("authorization", `Bearer ${signToken()}`)
      .send({
        model: "gpt-test",
        messages: [{ role: "user", content: "hi" }]
      })
      .expect(403);
  });

  it("POST /v1/chat/completions routes the virtual RAG model through RagAnswerService", async () => {
    ragAnswerService.answer.mockResolvedValueOnce({
      answerStatus: "ANSWERED",
      safeMessage:
        "Grounded answer generated from authorized knowledge sources.",
      answer:
        "Confirm the service light status, power cycle the gateway for 30 seconds, and wait up to 5 minutes.",
      sourceCount: 1,
      sources: [
        {
          sourceId: "kb-troubleshoot-intermittent-service-v1",
          title: "Troubleshooting intermittent residential service",
          url: "https://help.example.invalid/kb/troubleshoot-intermittent-service",
          documentVersion: "2026.05.11",
          chunkId: "kb-troubleshoot-intermittent-service-v1:2026.05.11:chunk-1",
          score: 0.6905,
          retrievalId: "rag-openwebui-test"
        }
      ],
      sourceIds: "kb-troubleshoot-intermittent-service-v1",
      sourceTitles: "Troubleshooting intermittent residential service",
      sourceUrls:
        "https://help.example.invalid/kb/troubleshoot-intermittent-service",
      sourceVersions: "2026.05.11",
      sourceChunkIds:
        "kb-troubleshoot-intermittent-service-v1:2026.05.11:chunk-1",
      retrievalIds: "rag-openwebui-test",
      sourcesJson: "[]",
      provider: "openai",
      model: "gpt-4o-mini",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      vectorDbProvider: "qdrant",
      fallbackUsed: false,
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
      latencyMs: 24,
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      requestId: "openwebui-user-1"
    });

    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set(
        "authorization",
        `Bearer ${signToken({
          scope: "openwebui:chat",
          tenant: "tenant-demo",
          rag_namespace: "customer-self-service",
          roles: ["support-agent"]
        })}`
      )
      .send({
        model: "knowledge-rag",
        user: "openwebui-user-1",
        messages: [
          { role: "system", content: "Internal console system prompt" },
          {
            role: "user",
            content:
              "Earlier support context for jane@example.com and phone 415-555-1212"
          },
          { role: "assistant", content: "Earlier assistant answer" },
          {
            role: "user",
            content:
              "What approved troubleshooting can I give for intermittent residential service?"
          }
        ]
      })
      .expect(200);

    expect(ragAnswerService.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        question:
          "What approved troubleshooting can I give for intermittent residential service?",
        contextSummary:
          "user: Earlier support context for [redacted-email] and phone [redacted-phone]\nassistant: Earlier assistant answer",
        requestId: expect.stringMatching(/^openwebui-/)
      }),
      expect.objectContaining({
        tenantId: "tenant-demo",
        namespace: "customer-self-service",
        scopes: ["openwebui:chat"],
        roles: ["support-agent"]
      }),
      { useCase: "openwebui_rag" }
    );
    expect(router.chat).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      object: "chat.completion",
      model: "knowledge-rag",
      choices: [
        {
          index: 0,
          message: { role: "assistant" },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    });
    expect(response.body.choices[0].message.content).toContain(
      "Confirm the service light status"
    );
    expect(response.body.choices[0].message.content).toContain("Sources:");
    expect(response.body.choices[0].message.content).toContain(
      "kb-troubleshoot-intermittent-service-v1"
    );
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

  it("POST /agent/services/project-health rejects requests without a bearer token", async () => {
    await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .send({ projectStatus: "Green" })
      .expect(401);
  });

  it("POST /oauth/token issues a scoped token for a configured Salesforce client", async () => {
    const response = await request(app.getHttpServer())
      .post("/oauth/token")
      .send({
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: TEST_OAUTH_CLIENT_SECRET,
        scope: "agentforce:services-project-health"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 900,
      scope: "agentforce:services-project-health"
    });
    const payload = jwt.verify(
      response.body.access_token,
      TEST_JWT_SECRET
    ) as jwt.JwtPayload;
    expect(payload).toMatchObject({
      tenant: "certinia-phase8",
      sf_org_id: "00D000000000001",
      client_id: "certinia-phase8-oauth",
      rag_namespace: "certinia-phase8",
      scope: "agentforce:services-project-health"
    });
  });

  it("POST /oauth/token accepts Salesforce-style Basic auth client credentials", async () => {
    const basicAuthorization = Buffer.from(
      `certinia-phase8-oauth:${TEST_OAUTH_CLIENT_SECRET}`
    ).toString("base64");

    const response = await request(app.getHttpServer())
      .post("/oauth/token")
      .set("authorization", `Basic ${basicAuthorization}`)
      .type("form")
      .send({
        grant_type: "client_credentials",
        scope: "agentforce:services-project-health"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 900,
      scope: "agentforce:services-project-health"
    });
  });

  it("POST /oauth/token rejects invalid Salesforce client credentials", async () => {
    await request(app.getHttpServer())
      .post("/oauth/token")
      .send({
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: "wrong-secret",
        scope: "agentforce:services-project-health"
      })
      .expect(401);
  });

  it("GET /admin/tenants/:tenantId/salesforce-setup returns secret-safe setup instructions", async () => {
    const response = await request(app.getHttpServer())
      .get("/admin/tenants/certinia-phase8/salesforce-setup")
      .set("authorization", `Bearer ${signToken({ scope: "tenant:admin" })}`)
      .expect(200);

    expect(response.body).toMatchObject({
      tenant: {
        tenantId: "certinia-phase8",
        salesforceOrgId: "00D000000000001",
        status: "active"
      },
      oauthClient: {
        clientId: "certinia-phase8-oauth",
        secretHandling: {
          valuePrinted: false
        }
      },
      aiApi: {
        tokenEndpoint: "https://ai-api.example.test/oauth/token",
        protectedSmokeEndpoint:
          "https://ai-api.example.test/agent/services/project-health"
      },
      validation: {
        requiredScope: "agentforce:services-project-health"
      }
    });
    expect(JSON.stringify(response.body)).not.toContain(
      TEST_OAUTH_CLIENT_SECRET
    );
  });

  it("GET /admin/tenants/:tenantId/report requires tenant admin scope", async () => {
    await request(app.getHttpServer())
      .get("/admin/tenants/certinia-phase8/report")
      .set("authorization", `Bearer ${signToken()}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .get("/admin/tenants/certinia-phase8/report")
      .set("authorization", `Bearer ${signToken({ scope: "tenant:admin" })}`)
      .expect(200);

    expect(response.body).toMatchObject({
      tenantId: "certinia-phase8",
      readiness: expect.arrayContaining([
        "tenant_active",
        "project_health_scope_granted",
        "active_oauth_client_present"
      ])
    });
  });

  it("OAuth-issued tokens can call project health when scoped", async () => {
    router.chat.mockResolvedValueOnce({
      content:
        '{"summary":"Project health is stable.","riskDrivers":"no major risk drivers detected","recommendedActions":"continue normal project monitoring","confidence":"medium"}',
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 12, totalTokens: 32 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 25,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });
    const tokenResponse = await request(app.getHttpServer())
      .post("/oauth/token")
      .send({
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: TEST_OAUTH_CLIENT_SECRET,
        scope: "agentforce:services-project-health"
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set("authorization", `Bearer ${tokenResponse.body.access_token}`)
      .send({ projectStatus: "Green", percentHoursComplete: 20 })
      .expect(201);
  });

  it("OAuth-issued tokens can call revenue portfolio intelligence when scoped", async () => {
    router.chat.mockResolvedValueOnce({
      content:
        '{"portfolioStatus":"WATCH","summary":"Portfolio has one monitored account.","topRiskAccounts":[],"topExpansionAccounts":[],"urgentRenewals":[],"escalationAccounts":[],"silentAccounts":[],"portfolioWatchlists":[],"portfolioTrends":[],"recommendedActions":[],"weeklyExecutionPlan":[]}',
      finishReason: "stop",
      usage: { inputTokens: 25, outputTokens: 18, totalTokens: 43 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 31,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });
    const tokenResponse = await request(app.getHttpServer())
      .post("/oauth/token")
      .send({
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: TEST_OAUTH_CLIENT_SECRET,
        scope: "agentforce:revenue-portfolio-intelligence"
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post("/agent/revenue/portfolio-intelligence")
      .set("authorization", `Bearer ${tokenResponse.body.access_token}`)
      .send({
        accounts: [{ accountReference: "account-1", openOpportunityCount: 1 }]
      })
      .expect(201);

    expect(response.body).toMatchObject({
      portfolioStatus: "WATCH",
      provider: "openai",
      model: "gpt-4o-mini"
    });
  });

  it("OAuth-issued tokens without project-health scope receive 403", async () => {
    const tokenResponse = await request(app.getHttpServer())
      .post("/oauth/token")
      .send({
        grant_type: "client_credentials",
        client_id: "certinia-phase8-oauth",
        client_secret: TEST_OAUTH_CLIENT_SECRET,
        scope: "agentforce:support-triage"
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set("authorization", `Bearer ${tokenResponse.body.access_token}`)
      .send({ projectStatus: "Green" })
      .expect(403);
  });

  it("POST /agent/services/project-health requires the services project health scope", async () => {
    await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ projectStatus: "Green" })
      .expect(403);
  });

  it("POST /agent/services/project-health validates aggregate facts", async () => {
    await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:services-project-health" })}`
      )
      .send({ percentHoursComplete: 150 })
      .expect(400);
  });

  it("POST /agent/services/project-health rejects unknown project status values", async () => {
    await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:services-project-health" })}`
      )
      .send({ projectStatus: "Amber" })
      .expect(400);
  });

  it("POST /agent/services/project-health summarizes sanitized PSA aggregates", async () => {
    router.chat.mockResolvedValueOnce({
      content:
        '{"summary":"Delivery health is constrained by milestones and staffing.","riskDrivers":"late milestones; open resource request; hours above plan","recommendedActions":"rebaseline milestones; staff the open role; review scope controls","confidence":"high"}',
      finishReason: "stop",
      usage: { inputTokens: 34, outputTokens: 22, totalTokens: 56 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 44,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });

    const response = await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:services-project-health" })}`
      )
      .send({
        projectStatus: "Yellow",
        daysUntilEnd: 10,
        percentHoursComplete: 70,
        plannedHours: 1000,
        estimatedHoursAtCompletion: 1300,
        marginPercent: 10,
        assignmentCount: 4,
        assignmentAtRiskCount: 1,
        milestoneCount: 6,
        lateMilestoneCount: 2,
        timecardHeaderCount: 8,
        submittedTimecardCount: 1,
        rejectedTimecardCount: 1,
        projectTaskCount: 20,
        overdueProjectTaskCount: 2,
        resourceRequestCount: 1,
        openResourceRequestCount: 1,
        budgetCount: 1,
        budgetAmount: 100000,
        budgetConsumedAmount: 95000,
        budgetRemainingAmount: 5000,
        requestId: "project-health-e2e-1"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      healthStatus: "red",
      riskLevel: "critical",
      scheduleStatus: "red",
      budgetStatus: "red",
      staffingStatus: "red",
      summary: "Delivery health is constrained by milestones and staffing.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 44
    });

    const llmRequest = router.chat.mock.calls.at(-1)?.[0] as {
      useCase?: string;
      requestId?: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(llmRequest.useCase).toBe("agentforce_services_project_health");
    expect(llmRequest.requestId).toBe("project-health-e2e-1");
    expect(llmRequest.messages[1].content).toContain(
      "Deterministic healthStatus: red"
    );
    expect(llmRequest.messages[1].content).not.toContain("jane@example.com");
    expect(llmRequest.messages[1].content).not.toContain("ACCT-123456");
  });

  it("POST /agent/services/project-health surfaces provider validation as 503", async () => {
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("model-router", "validation", "No providers")
    );

    const response = await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:services-project-health" })}`
      )
      .send({ projectStatus: "Green", requestId: "project-health-e2e-2" })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "model-router",
      kind: "validation"
    });
  });

  it("POST /agent/services/project-health falls back safely for malformed model output", async () => {
    router.chat.mockResolvedValueOnce({
      content: "not json",
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 30,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });

    const response = await request(app.getHttpServer())
      .post("/agent/services/project-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:services-project-health" })}`
      )
      .send({
        projectStatus: "Green",
        plannedHours: 100,
        estimatedHoursAtCompletion: 80,
        assignmentCount: 2,
        milestoneCount: 2,
        lateMilestoneCount: 0,
        requestId: "project-health-e2e-3"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      healthStatus: "green",
      riskLevel: "low",
      riskDrivers: "no major deterministic risk drivers detected",
      recommendedActions: "continue normal project health monitoring"
    });
  });

  it("POST /agent/revenue/account-health requires the revenue scope", async () => {
    await request(app.getHttpServer())
      .post("/agent/revenue/account-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:services-project-health" })}`
      )
      .send({ openOpportunityCount: 1 })
      .expect(403);
  });

  it("POST /agent/revenue/account-health returns an LLM-led revenue decision", async () => {
    router.chat.mockResolvedValueOnce({
      content:
        '{"accountHealthScore":46,"accountHealthBand":"at_risk","churnRiskScore":82,"churnRiskLevel":"high","expansionScore":64,"expansionLevel":"medium","deliveryRiskLevel":"high","financialRiskLevel":"medium","supportRiskLevel":"high","executiveEngagementLevel":"weak","primaryDecision":"Prioritize retention before expansion.","summary":"Revenue health is pressured by support, delivery, and engagement signals while expansion remains possible.","decisionRationale":"Escalated cases; late milestones; overdue invoices; low activity","revenueImpact":"Renewal and expansion timing may slip without intervention.","operationalBlockers":"Support escalations; delivery delays; overdue invoices","recommendedActions":"Run executive save plan; resolve top escalations; assign delivery recovery owner; review renewal path","confidence":"high"}',
      finishReason: "stop",
      usage: { inputTokens: 72, outputTokens: 48, totalTokens: 120 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 58,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });

    const response = await request(app.getHttpServer())
      .post("/agent/revenue/account-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-account-health" })}`
      )
      .send({
        accountType: "Customer",
        accountIndustry: "Software",
        annualRevenue: 2500000,
        openOpportunityCount: 4,
        openOpportunityAmount: 460000,
        weightedPipelineAmount: 220000,
        renewalOpportunityCount: 1,
        expansionOpportunityCount: 2,
        openCaseCount: 7,
        escalatedCaseCount: 2,
        highPriorityCaseCount: 3,
        activityCountLast30Days: 1,
        daysSinceLastActivity: 37,
        activeProjectCount: 2,
        atRiskProjectCount: 1,
        lateMilestoneCount: 3,
        overdueInvoiceCount: 2,
        overdueInvoiceAmount: 42000,
        productUsageTrendPercent: -22,
        sourceSystems: "Salesforce CRM aggregates; Certinia PSA aggregates",
        requestId: "revenue-health-e2e-1"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      accountHealthScore: 46,
      accountHealthBand: "at_risk",
      churnRiskScore: 82,
      churnRiskLevel: "high",
      expansionScore: 64,
      expansionLevel: "medium",
      deliveryRiskLevel: "high",
      financialRiskLevel: "medium",
      supportRiskLevel: "high",
      executiveEngagementLevel: "weak",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 58
    });

    const llmRequest = router.chat.mock.calls.at(-1)?.[0] as {
      useCase?: string;
      requestId?: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(llmRequest.useCase).toBe("agentforce_revenue_account_health");
    expect(llmRequest.requestId).toBe("revenue-health-e2e-1");
    expect(llmRequest.messages[0].content).toContain(
      "The model is responsible for the account health score"
    );
    expect(llmRequest.messages[1].content).toContain("Decision mode: LLM-led");
    expect(llmRequest.messages[1].content).not.toContain("Deterministic");
  });

  it("POST /agent/revenue/account-health validates request facts", async () => {
    await request(app.getHttpServer())
      .post("/agent/revenue/account-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-account-health" })}`
      )
      .send({ accountHealthScore: 90, annualRevenue: -1 })
      .expect(400);
  });

  it("POST /agent/revenue/account-health surfaces provider validation as 503", async () => {
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("model-router", "validation", "No providers")
    );

    const response = await request(app.getHttpServer())
      .post("/agent/revenue/account-health")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-account-health" })}`
      )
      .send({ openOpportunityCount: 1, requestId: "revenue-health-e2e-2" })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "model-router",
      kind: "validation"
    });
  });

  it("POST /agent/revenue/portfolio-intelligence requires the portfolio scope", async () => {
    await request(app.getHttpServer())
      .post("/agent/revenue/portfolio-intelligence")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-account-health" })}`
      )
      .send({ accounts: [{ accountReference: "account-1" }] })
      .expect(403);
  });

  it("POST /agent/revenue/portfolio-intelligence returns ranked portfolio intelligence", async () => {
    router.chat.mockResolvedValueOnce({
      content:
        '{"portfolioStatus":"ATTENTION_REQUIRED","summary":"Portfolio needs attention on retention and expansion sequencing.","topRiskAccounts":[{"accountReference":"account-1","rank":1,"score":88,"level":"high","reason":"Escalations and renewal proximity.","supportingSignals":["open escalations","renewal proximity"],"recommendedAction":"Run executive outreach."}],"topExpansionAccounts":[{"accountReference":"account-2","rank":1,"score":72,"level":"high","reason":"Expansion pipeline and usage momentum.","supportingSignals":["expansion pipeline","usage growth"],"recommendedAction":"Sequence expansion outreach."}],"urgentRenewals":[{"accountReference":"account-1","rank":1,"score":80,"level":"high","reason":"Renewal is near close.","supportingSignals":["renewal proximity"],"recommendedAction":"Review renewal blockers."}],"escalationAccounts":[],"silentAccounts":[],"portfolioWatchlists":[{"name":"Churn risk watchlist","accountReferences":["account-1"],"rationale":"Retention pressure is concentrated."}],"portfolioTrends":[{"trend":"Renewal risk concentration","direction":"near_term","severity":"high","rationale":"One high-risk renewal is close."}],"recommendedActions":[{"priority":"high","action":"Run executive outreach.","accountReferences":["account-1"],"rationale":"Risk is urgent."}],"weeklyExecutionPlan":[{"day":"Monday","actions":["Call account-1 renewal team"]}]}',
      finishReason: "stop",
      usage: { inputTokens: 172, outputTokens: 88, totalTokens: 260 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 77,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });

    const response = await request(app.getHttpServer())
      .post("/agent/revenue/portfolio-intelligence")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-portfolio-intelligence" })}`
      )
      .send({
        analysisFocus: "risk",
        sourceSystems: "Salesforce Account, Opportunity, Case, Task aggregates",
        requestId: "revenue-portfolio-e2e-1",
        accounts: [
          {
            accountReference: "account-1",
            accountType: "Customer",
            accountIndustry: "Software",
            openOpportunityCount: 4,
            weightedPipelineAmount: 220000,
            daysToNextCloseDate: 21,
            renewalOpportunityCount: 1,
            expansionOpportunityCount: 1,
            openCaseCount: 7,
            escalatedCaseCount: 2,
            highPriorityCaseCount: 3,
            activityCountLast30Days: 1,
            daysSinceLastActivity: 37,
            productUsageTrendPercent: -22
          },
          {
            accountReference: "account-2",
            accountType: "Customer",
            accountIndustry: "Manufacturing",
            openOpportunityCount: 3,
            weightedPipelineAmount: 175000,
            daysToNextCloseDate: 90,
            expansionOpportunityCount: 2,
            expansionOpportunityAmount: 300000,
            openCaseCount: 0,
            activityCountLast30Days: 5,
            daysSinceLastActivity: 8,
            wonOpportunityCountLast180Days: 2,
            productUsageTrendPercent: 18
          }
        ]
      })
      .expect(201);

    expect(response.body).toMatchObject({
      portfolioStatus: "ATTENTION_REQUIRED",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      decisionFallbackUsed: false,
      latencyMs: 77
    });
    expect(response.body.topRiskAccounts[0]).toMatchObject({
      accountReference: "account-1",
      score: 88,
      recommendedAction: "Run executive outreach."
    });
    expect(response.body.portfolioWatchlists[0].name).toBe(
      "Churn risk watchlist"
    );
    expect(response.body.weeklyExecutionPlan[0].actions).toContain(
      "Call account-1 renewal team"
    );

    const llmRequest = router.chat.mock.calls.at(-1)?.[0] as {
      useCase?: string;
      requestId?: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(llmRequest.useCase).toBe(
      "agentforce_revenue_portfolio_intelligence"
    );
    expect(llmRequest.requestId).toBe("revenue-portfolio-e2e-1");
    expect(llmRequest.messages[1].content).toContain(
      "accountReference=account-1"
    );
    expect(llmRequest.messages[1].content).toContain("deterministicSignals");
  });

  it("POST /agent/revenue/portfolio-intelligence validates account references", async () => {
    await request(app.getHttpServer())
      .post("/agent/revenue/portfolio-intelligence")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-portfolio-intelligence" })}`
      )
      .send({ accounts: [{ accountReference: "001000000000001AAA" }] })
      .expect(400);

    await request(app.getHttpServer())
      .post("/agent/revenue/portfolio-intelligence")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-portfolio-intelligence" })}`
      )
      .send({ accounts: [{ accountReference: "Acme Strategic" }] })
      .expect(400);
  });

  it("POST /agent/revenue/portfolio-intelligence surfaces provider validation as 503", async () => {
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("model-router", "validation", "No providers")
    );

    const response = await request(app.getHttpServer())
      .post("/agent/revenue/portfolio-intelligence")
      .set(
        "authorization",
        `Bearer ${signToken({ scope: "agentforce:revenue-portfolio-intelligence" })}`
      )
      .send({
        requestId: "revenue-portfolio-e2e-2",
        accounts: [{ accountReference: "account-1", openOpportunityCount: 1 }]
      })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "model-router",
      kind: "validation"
    });
  });
});

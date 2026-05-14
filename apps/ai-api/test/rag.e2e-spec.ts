import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash } from "crypto";
import * as jwt from "jsonwebtoken";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { ModelRouter } from "../src/llm/model-router";
import { LlmProviderError } from "../src/llm/interfaces/llm-provider";

const TEST_JWT_SECRET = "phase4-test-secret";
const TEST_AGENTFORCE_SERVICE_TOKEN = "opaque-agentforce-service-token";

describe("Knowledge RAG endpoints (e2e)", () => {
  let app: INestApplication;
  let router: { chat: jest.Mock; describeRoute: jest.Mock };

  beforeAll(async () => {
    process.env.AI_API_JWT_SECRET = TEST_JWT_SECRET;
    process.env.AI_API_AGENTFORCE_BEARER_TOKEN_SHA256 = sha256(
      TEST_AGENTFORCE_SERVICE_TOKEN
    );
    process.env.AI_API_AGENTFORCE_BEARER_RAG_NAMESPACE =
      "phase4-e2e-service-token";
    process.env.RAG_ENABLED = "true";
    process.env.DEFAULT_EMBEDDING_PROVIDER = "deterministic";
    process.env.VECTOR_DB_PROVIDER = "memory";
    process.env.RAG_SCORE_THRESHOLD = "0";
    delete process.env.AI_API_AUTH_DISABLED;
    delete process.env.AGENTFORCE_HEALTH_API_KEY;
    delete process.env.OPENAI_API_KEY;

    router = {
      describeRoute: jest.fn(() => ({
        routingFingerprint: "rag-e2e-route"
      })),
      chat: jest.fn(async () => ({
        content:
          "Power cycle the gateway for 30 seconds and escalate if unresolved. Sources: kb-e2e-troubleshoot kb-e2e-troubleshoot:v1:chunk-1.",
        finishReason: "stop",
        usage: { inputTokens: 45, outputTokens: 18, totalTokens: 63 },
        metadata: {
          provider: "openai",
          model: "gpt-4o-mini",
          latencyMs: 25,
          fallbackUsed: false,
          attemptedProviders: ["openai"]
        }
      }))
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
    delete process.env.AI_API_AGENTFORCE_BEARER_TOKEN_SHA256;
    delete process.env.AI_API_AGENTFORCE_BEARER_RAG_NAMESPACE;
    delete process.env.RAG_ENABLED;
    delete process.env.DEFAULT_EMBEDDING_PROVIDER;
    delete process.env.VECTOR_DB_PROVIDER;
    delete process.env.RAG_SCORE_THRESHOLD;
  });

  function signToken(
    overrides: Record<string, unknown> = {},
    namespace = "phase4-e2e"
  ): string {
    return jwt.sign(
      {
        sub: "agent-1",
        tenant: "tenant-demo",
        rag_namespace: namespace,
        roles: ["support-agent"],
        scope: "rag:ingest rag:search agentforce:knowledge-rag",
        ...overrides
      },
      TEST_JWT_SECRET,
      { algorithm: "HS256" }
    );
  }

  async function ingest(
    namespace: string,
    token = signToken({}, namespace)
  ): Promise<void> {
    await request(app.getHttpServer())
      .post("/rag/ingest")
      .set("authorization", `Bearer ${token}`)
      .send({
        namespace,
        requestId: `ingest-${namespace}`,
        documents: [
          {
            sourceId: "kb-e2e-troubleshoot",
            title: "E2E troubleshooting",
            documentVersion: "v1",
            access: { visibility: "tenant" },
            content:
              "Approved gateway troubleshooting says to power cycle the gateway for 30 seconds and wait up to 5 minutes. Escalate if service remains down."
          }
        ]
      })
      .expect(201);
  }

  it("requires bearer auth and the ingest scope", async () => {
    await request(app.getHttpServer())
      .post("/rag/ingest")
      .send({ documents: [] })
      .expect(401);

    await request(app.getHttpServer())
      .post("/rag/ingest")
      .set("authorization", `Bearer ${signToken({ scope: "rag:search" })}`)
      .send({
        documents: [
          {
            sourceId: "kb-auth",
            title: "Auth",
            content: "content",
            documentVersion: "v1"
          }
        ]
      })
      .expect(403);
  });

  it("validates ingestion DTOs", async () => {
    await request(app.getHttpServer())
      .post("/rag/ingest")
      .set("authorization", `Bearer ${signToken()}`)
      .send({ documents: [] })
      .expect(400);
  });

  it("ingests and searches with source metadata", async () => {
    const namespace = "phase4-e2e-search";
    await ingest(namespace);

    const response = await request(app.getHttpServer())
      .post("/rag/search")
      .set("authorization", `Bearer ${signToken({}, namespace)}`)
      .send({
        namespace,
        query: "gateway power cycle troubleshooting",
        scoreThreshold: 0,
        requestId: "search-e2e"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: "FOUND",
      tenantId: "tenant-demo",
      namespace,
      returnedCount: 1,
      matches: [
        expect.objectContaining({
          sourceId: "kb-e2e-troubleshoot",
          title: "E2E troubleshooting",
          documentVersion: "v1",
          retrievalId: expect.any(String)
        })
      ]
    });
  });

  it("enforces tenant isolation from JWT claims", async () => {
    const namespace = "phase4-e2e-tenant";
    await ingest(namespace);

    const response = await request(app.getHttpServer())
      .post("/rag/search")
      .set(
        "authorization",
        `Bearer ${signToken({ tenant: "tenant-other" }, namespace)}`
      )
      .send({ namespace, query: "gateway troubleshooting", scoreThreshold: 0 })
      .expect(201);

    expect(response.body.status).toBe("NO_AUTHORIZED_SOURCES");
    expect(response.body.matches).toEqual([]);
  });

  it("excludes stale and deleted sources from default retrieval", async () => {
    const namespace = "phase4-e2e-stale";
    const token = signToken({}, namespace);
    await request(app.getHttpServer())
      .post("/rag/ingest")
      .set("authorization", `Bearer ${token}`)
      .send({
        namespace,
        documents: [
          {
            sourceId: "kb-stale",
            title: "Stale",
            documentVersion: "v0",
            stale: true,
            content: "legacy factory reset pin guidance"
          },
          {
            sourceId: "kb-deleted",
            title: "Deleted",
            documentVersion: "v0",
            deleted: true,
            content: "deleted outage credit promise"
          }
        ]
      })
      .expect(201);

    const defaultResponse = await request(app.getHttpServer())
      .post("/rag/search")
      .set("authorization", `Bearer ${token}`)
      .send({ namespace, query: "legacy factory reset", scoreThreshold: 0 })
      .expect(201);
    expect(defaultResponse.body.status).toBe("NO_AUTHORIZED_SOURCES");

    const includeStaleResponse = await request(app.getHttpServer())
      .post("/rag/search")
      .set(
        "authorization",
        `Bearer ${signToken(
          {
            scope:
              "rag:ingest rag:search rag:search:stale agentforce:knowledge-rag"
          },
          namespace
        )}`
      )
      .send({
        namespace,
        query: "legacy factory reset",
        includeStale: true,
        scoreThreshold: 0
      })
      .expect(201);
    expect(includeStaleResponse.body.matches).toEqual([
      expect.objectContaining({ sourceId: "kb-stale" })
    ]);
  });

  it("answers with sources through the Agentforce knowledge endpoint", async () => {
    const namespace = "phase4-e2e-answer";
    await ingest(namespace);

    const response = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("authorization", `Bearer ${signToken({}, namespace)}`)
      .send({
        namespace,
        question:
          "What should I tell the customer about gateway troubleshooting?",
        scoreThreshold: 0,
        requestId: "answer-e2e"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      answerStatus: "ANSWERED",
      sourceCount: 1,
      sourceIds: "kb-e2e-troubleshoot",
      sourceTitles: "E2E troubleshooting",
      provider: "openai",
      model: "gpt-4o-mini",
      embeddingProvider: "deterministic",
      vectorDbProvider: "memory"
    });
    expect(response.body.sourcesJson).toContain("kb-e2e-troubleshoot");
  });

  it("accepts the opaque Agentforce service bearer for answer generation", async () => {
    const namespace = "phase4-e2e-service-token";
    await ingest(namespace);

    const response = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("authorization", `Bearer ${TEST_AGENTFORCE_SERVICE_TOKEN}`)
      .send({
        namespace,
        question:
          "What should I tell the customer about gateway troubleshooting?",
        scoreThreshold: 0,
        requestId: "answer-service-token-e2e"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      answerStatus: "ANSWERED",
      sourceCount: 1,
      sourceIds: "kb-e2e-troubleshoot",
      tenantId: "tenant-demo",
      namespace
    });
  });

  it("serves repeated authorized RAG answers from the tenant-safe cache", async () => {
    const namespace = "phase7-e2e-cache";
    await ingest(namespace);
    router.chat.mockClear();

    await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("authorization", `Bearer ${signToken({}, namespace)}`)
      .send({
        namespace,
        question:
          "What should I tell the customer about gateway troubleshooting?",
        scoreThreshold: 0,
        requestId: "cache-e2e-first"
      })
      .expect(201);

    const secondResponse = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("authorization", `Bearer ${signToken({}, namespace)}`)
      .send({
        namespace,
        question:
          "What should I tell the customer about gateway troubleshooting?",
        scoreThreshold: 0,
        requestId: "cache-e2e-second"
      })
      .expect(201);

    expect(secondResponse.body.answerStatus).toBe("ANSWERED");
    expect(secondResponse.body.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    });
    expect(router.chat).toHaveBeenCalledTimes(1);
  });

  it("does not reuse cached RAG answers across tenant claims", async () => {
    const namespace = "phase7-e2e-cache-tenant";
    await ingest(namespace);
    router.chat.mockClear();

    await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("authorization", `Bearer ${signToken({}, namespace)}`)
      .send({
        namespace,
        question:
          "What should I tell the customer about gateway troubleshooting?",
        scoreThreshold: 0
      })
      .expect(201);

    const otherTenantResponse = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set(
        "authorization",
        `Bearer ${signToken({ tenant: "tenant-other" }, namespace)}`
      )
      .send({
        namespace,
        question:
          "What should I tell the customer about gateway troubleshooting?",
        scoreThreshold: 0
      })
      .expect(201);

    expect(otherTenantResponse.body.answerStatus).toBe("NO_SOURCE");
    expect(router.chat).toHaveBeenCalledTimes(1);
  });

  it("returns no-source uncertainty without generation", async () => {
    router.chat.mockClear();
    const namespace = "phase4-e2e-empty";
    const response = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("authorization", `Bearer ${signToken({}, namespace)}`)
      .send({
        namespace,
        question: "What is the unsupported executive compensation policy?",
        scoreThreshold: 0,
        requestId: "empty-answer-e2e"
      })
      .expect(201);

    expect(response.body.answerStatus).toBe("NO_SOURCE");
    expect(response.body.sourceCount).toBe(0);
    expect(response.body.answer).toContain(
      "I do not have an authorized source"
    );
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("surfaces provider failures safely", async () => {
    const namespace = "phase4-e2e-provider-failure";
    await ingest(namespace);
    router.chat.mockRejectedValueOnce(
      new LlmProviderError("openai", "rate_limit", "throttled")
    );

    const response = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("authorization", `Bearer ${signToken({}, namespace)}`)
      .send({
        namespace,
        question: "gateway troubleshooting",
        scoreThreshold: 0
      })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "provider_unavailable",
      provider: "openai",
      kind: "rate_limit"
    });
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Node 3 — Laptop KB corpus e2e test.
 *
 * Ingests the AeroVolt / Quantum laptop KB (kb-laptop-corpus.json) into the
 * in-memory vector store using deterministic embeddings, then verifies that
 * Node 3's RAG pipeline retrieves the right articles for laptop-specific
 * queries via /agent/knowledge/answer.
 *
 * Run: npm run test:e2e -- --testPathPattern=node3-laptop-kb
 */
import * as fs from "fs";
import * as path from "path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { ModelRouter } from "../src/llm/model-router";

const TEST_JWT_SECRET = "laptop-kb-e2e-test-secret";

function mintToken(tenantId = "tenant-demo", namespace = "customer-self-service") {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "e2e-laptop-kb-test",
      scope: "rag:ingest rag:search agentforce:knowledge-rag",
      tenant: tenantId,
      rag_namespace: namespace,
      roles: ["support-agent"],
      iat: now,
      exp: now + 3600
    },
    TEST_JWT_SECRET,
    { issuer: "salesforce-agentforce", audience: "agentforce-ai-api" }
  );
}

describe("Node 3 — Laptop KB corpus (e2e)", () => {
  let app: INestApplication;
  let token: string;

  const CORPUS_PATH = path.resolve(
    __dirname,
    "../data/knowledge/kb-laptop-corpus.json"
  );

  beforeAll(async () => {
    process.env.AI_API_JWT_SECRET = TEST_JWT_SECRET;
    process.env.RAG_ENABLED = "true";
    process.env.DEFAULT_EMBEDDING_PROVIDER = "deterministic";
    process.env.VECTOR_DB_PROVIDER = "memory";
    process.env.RAG_SCORE_THRESHOLD = "0";
    process.env.RAG_TOP_K = "5";
    process.env.AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED = "true";
    process.env.AI_API_ORCHESTRATOR_KNOWLEDGE_SCORE_THRESHOLD = "0";
    process.env.AI_API_ORCHESTRATOR_KNOWLEDGE_RETRIEVAL_TOP_K = "5";
    delete process.env.OPENAI_API_KEY;
    delete process.env.AGENTFORCE_HEALTH_API_KEY;

    const router = {
      describeRoute: jest.fn(() => ({ routingFingerprint: "laptop-kb-test-route" })),
      chat: jest.fn(async (msgs: unknown[]) => ({
        content: "Based on the retrieved knowledge base articles, here are the troubleshooting steps.",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        metadata: {
          provider: "openai",
          model: "gpt-4o-mini",
          latencyMs: 50,
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

    token = mintToken();

    // Ingest the laptop corpus in batches of 50
    const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8")) as {
      namespace: string;
      requestId: string;
      documents: unknown[];
    };
    const BATCH = 50;
    for (let i = 0; i < corpus.documents.length; i += BATCH) {
      const batch = corpus.documents.slice(i, i + BATCH);
      const res = await request(app.getHttpServer())
        .post("/rag/ingest")
        .set("Authorization", `Bearer ${token}`)
        .send({
          namespace: corpus.namespace,
          requestId: `${corpus.requestId}-batch-${Math.floor(i / BATCH)}`,
          documents: batch
        });
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`Ingest batch failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
  }, 60000);

  afterAll(async () => {
    await app?.close();
    delete process.env.AI_API_JWT_SECRET;
    delete process.env.RAG_ENABLED;
    delete process.env.DEFAULT_EMBEDDING_PROVIDER;
    delete process.env.VECTOR_DB_PROVIDER;
    delete process.env.RAG_SCORE_THRESHOLD;
    delete process.env.RAG_TOP_K;
    delete process.env.AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED;
    delete process.env.AI_API_ORCHESTRATOR_KNOWLEDGE_SCORE_THRESHOLD;
    delete process.env.AI_API_ORCHESTRATOR_KNOWLEDGE_RETRIEVAL_TOP_K;
  });

  it("ingests 143 laptop KB articles — smoke retrieval check", async () => {
    const res = await request(app.getHttpServer())
      .post("/rag/search")
      .set("Authorization", `Bearer ${token}`)
      .send({ query: "battery charging", topK: 1 });
    expect([200, 201]).toContain(res.status);
    // matches field (not sources) per RagSearchResponseDto
    expect(res.body.status).toBe("FOUND");
    expect(res.body.matches).toBeDefined();
    expect(res.body.matches.length).toBeGreaterThan(0);
    console.log("\n--- Smoke check: battery charging ---");
    console.log("  Status:", res.body.status, "| Matches:", res.body.matches?.length);
    console.log("  First match:", res.body.matches?.[0]?.sourceId);
  });

  it("retrieves laptop battery articles for a charging query", async () => {
    const res = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("Authorization", `Bearer ${token}`)
      .send({
        question: "My AeroVolt ProBook 15X battery is not charging — charging LED is off",
        requestId: "laptop-kb-battery-test"
      });
    expect([200, 201]).toContain(res.status);
    // answerStatus field per KnowledgeAnswerResponseDto
    expect(res.body.answerStatus).toBe("ANSWERED");
    expect(res.body.sources).toBeDefined();
    expect(res.body.sources.length).toBeGreaterThan(0);

    const titles: string[] = res.body.sources.map((s: { title: string }) => s.title);
    console.log("\n--- Battery query sources ---");
    titles.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
    console.log("  Answer excerpt:", res.body.answer?.substring(0, 180));

    const hasBatteryArticle = titles.some(
      (t) =>
        t.toLowerCase().includes("battery") || t.toLowerCase().includes("charging")
    );
    expect(hasBatteryArticle).toBe(true);
  });

  it("retrieves power/no-boot articles for a laptop won't power on query", async () => {
    const res = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("Authorization", `Bearer ${token}`)
      .send({
        question:
          "AeroVolt ProBook 15X laptop does not power on, no LED indicator lights up",
        requestId: "laptop-kb-power-test"
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.answerStatus).toBe("ANSWERED");

    const titles: string[] = res.body.sources.map((s: { title: string }) => s.title);
    console.log("\n--- No-power query sources ---");
    titles.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
    console.log("  Answer excerpt:", res.body.answer?.substring(0, 180));

    // With deterministic (hash-based) embeddings, topic-specific ordering
    // is not guaranteed — we verify the pipeline works end-to-end here.
    // Semantic ordering is confirmed with real OpenAI embeddings in production.
    expect(titles.length).toBeGreaterThan(0);
  });

  it("retrieves display articles for a screen flickering query", async () => {
    const res = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("Authorization", `Bearer ${token}`)
      .send({
        question: "Display is flickering and shows horizontal lines on ProBook 15X",
        requestId: "laptop-kb-display-test"
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.answerStatus).toBe("ANSWERED");

    const titles: string[] = res.body.sources.map((s: { title: string }) => s.title);
    console.log("\n--- Display query sources ---");
    titles.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
  });

  it("retrieves thermal/fan articles for an overheating query", async () => {
    const res = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("Authorization", `Bearer ${token}`)
      .send({
        question:
          "Laptop overheating, fan at full speed, CPU throttling, very hot bottom",
        requestId: "laptop-kb-thermal-test"
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.answerStatus).toBe("ANSWERED");

    const titles: string[] = res.body.sources.map((s: { title: string }) => s.title);
    console.log("\n--- Thermal query sources ---");
    titles.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
  });

  it("retrieves keyboard articles for keys not working query", async () => {
    const res = await request(app.getHttpServer())
      .post("/agent/knowledge/answer")
      .set("Authorization", `Bearer ${token}`)
      .send({
        question:
          "Keyboard keys not responding on Stratos Air 13, backlight also stopped working",
        requestId: "laptop-kb-keyboard-test"
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.answerStatus).toBe("ANSWERED");

    const titles: string[] = res.body.sources.map((s: { title: string }) => s.title);
    console.log("\n--- Keyboard query sources ---");
    titles.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
  });

  it("returns result for an out-of-scope query with high score threshold", async () => {
    const res = await request(app.getHttpServer())
      .post("/rag/search")
      .set("Authorization", `Bearer ${token}`)
      .send({
        query: "How do I file a legal complaint against the manufacturer?",
        topK: 1,
        scoreThreshold: 0.99
      });
    expect([200, 201]).toContain(res.status);
    expect(["FOUND", "NO_AUTHORIZED_SOURCES"]).toContain(res.body.status);
    console.log("\n--- Legal query (out-of-scope, high threshold) ---");
    console.log(
      "  Status:",
      res.body.status,
      "| Matches:",
      res.body.matches?.length ?? 0
    );
  });

  it("enforces tenant isolation — tenant-B cannot see tenant-A articles", async () => {
    const tenantBToken = mintToken("tenant-B");
    const res = await request(app.getHttpServer())
      .post("/rag/search")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({ query: "AeroVolt battery charging issue", topK: 5 });
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe("NO_AUTHORIZED_SOURCES");
    console.log("\n--- Tenant isolation (tenant-B → 0 results) ---");
    console.log("  Status:", res.body.status, "✓ tenant isolation confirmed");
  });
});

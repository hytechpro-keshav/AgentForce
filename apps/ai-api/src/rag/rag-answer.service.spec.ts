import type { ModelRouter } from "../llm/model-router";
import type { TelemetryService } from "../observability/telemetry.service";
import type { RagAnswerCacheService } from "./rag-answer-cache.service";
import { RagAnswerService } from "./rag-answer.service";
import type { RagRetrievalService } from "./rag-retrieval.service";
import type { TrustedRagContext } from "./trusted-rag-context";

function context(): TrustedRagContext {
  return {
    tenantId: "tenant-demo",
    namespace: "phase4-test",
    subject: "agent-1",
    scopes: ["agentforce:knowledge-rag"],
    roles: ["support-agent"]
  };
}

describe("RagAnswerService", () => {
  it("returns no-source uncertainty without calling the model", async () => {
    const retrieval = {
      search: jest.fn(async () => ({
        status: "NO_AUTHORIZED_SOURCES",
        tenantId: "tenant-demo",
        namespace: "phase4-test",
        retrievalId: "rag-1",
        matches: [],
        rawMatches: [],
        retrievedCount: 0,
        returnedCount: 0,
        accessFilteredCount: 0,
        embeddingProvider: "deterministic",
        embeddingModel: "deterministic-local-test",
        vectorDbProvider: "memory"
      }))
    };
    const router = { chat: jest.fn() };
    const cache = {
      buildKey: jest.fn(() => "cache-key"),
      get: jest.fn(),
      set: jest.fn()
    };
    const telemetry = { recordRagWorkflow: jest.fn() };
    const service = new RagAnswerService(
      retrieval as unknown as RagRetrievalService,
      router as unknown as ModelRouter,
      cache as unknown as RagAnswerCacheService,
      telemetry as unknown as TelemetryService
    );

    const response = await service.answer(
      { question: "What is unsupported?" },
      context()
    );

    expect(response.answerStatus).toBe("NO_SOURCE");
    expect(response.sourceCount).toBe(0);
    expect(router.chat).not.toHaveBeenCalled();
    expect(response.answer).toContain("I do not have an authorized source");
  });

  it("generates a grounded answer with structured and flat sources", async () => {
    const retrieval = {
      search: jest.fn(async () => ({
        status: "FOUND",
        tenantId: "tenant-demo",
        namespace: "phase4-test",
        retrievalId: "rag-2",
        matches: [
          {
            sourceId: "kb-1",
            title: "Troubleshooting",
            url: "https://help.example.invalid/kb-1",
            documentVersion: "2026.05.11",
            chunkId: "kb-1:v1:chunk-1",
            score: 0.95,
            retrievalId: "rag-2"
          }
        ],
        rawMatches: [
          {
            id: "match-1",
            text: "Power cycle the gateway for 30 seconds before escalating.",
            score: 0.95,
            metadata: {
              sourceId: "kb-1",
              title: "Troubleshooting",
              tenantId: "tenant-demo",
              namespace: "phase4-test",
              documentVersion: "2026.05.11",
              access: {
                visibility: "tenant",
                allowedSubjects: [],
                allowedScopes: [],
                allowedRoles: []
              },
              ingestedAt: "2026-05-11T00:00:00Z",
              stale: false,
              deleted: false,
              chunkId: "kb-1:v1:chunk-1",
              chunkIndex: 0,
              contentHash: "hash",
              tags: []
            }
          }
        ],
        retrievedCount: 1,
        returnedCount: 1,
        accessFilteredCount: 0,
        embeddingProvider: "deterministic",
        embeddingModel: "deterministic-local-test",
        vectorDbProvider: "memory"
      }))
    };
    const router = {
      describeRoute: jest.fn(() => ({
        routingFingerprint: "route-fingerprint"
      })),
      chat: jest.fn(async () => ({
        content:
          "Power cycle the gateway, then escalate if unresolved. Source: kb-1 kb-1:v1:chunk-1.",
        usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        metadata: {
          provider: "openai",
          model: "gpt-4o-mini",
          latencyMs: 42,
          fallbackUsed: false,
          attemptedProviders: ["openai"]
        }
      }))
    };
    const cache = {
      buildKey: jest.fn(() => "cache-key"),
      get: jest.fn(),
      set: jest.fn()
    };
    const telemetry = { recordRagWorkflow: jest.fn() };
    const service = new RagAnswerService(
      retrieval as unknown as RagRetrievalService,
      router as unknown as ModelRouter,
      cache as unknown as RagAnswerCacheService,
      telemetry as unknown as TelemetryService
    );

    const response = await service.answer(
      {
        question: "How should I troubleshoot intermittent service?",
        requestId: "answer-test"
      },
      context()
    );

    expect(response).toMatchObject({
      answerStatus: "ANSWERED",
      sourceCount: 1,
      sourceIds: "kb-1",
      sourceTitles: "Troubleshooting",
      sourceChunkIds: "kb-1:v1:chunk-1",
      retrievalIds: "rag-2",
      provider: "openai",
      model: "gpt-4o-mini"
    });
    expect(JSON.parse(response.sourcesJson ?? "[]")).toHaveLength(1);
    expect(router.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "answer-test",
        useCase: "knowledge_rag",
        tenantId: "tenant-demo",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Power cycle the gateway")
          })
        ])
      })
    );
    const llmRequest = (router.chat as jest.Mock).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = llmRequest.messages.find(
      (message) => message.role === "user"
    );
    expect(userMessage?.content).toContain("Structured source metadata");
    expect(userMessage?.content).toContain("Troubleshooting");
    expect(userMessage?.content).not.toContain('"score"');
    expect(userMessage?.content).not.toContain('"retrievalId"');
    expect(cache.set).toHaveBeenCalledWith(
      "cache-key",
      expect.objectContaining({
        answer: expect.stringContaining("Power cycle"),
        provider: "openai",
        model: "gpt-4o-mini"
      })
    );
  });

  it("returns a cached grounded answer without calling the model", async () => {
    const retrieval = {
      search: jest.fn(async () => ({
        status: "FOUND",
        tenantId: "tenant-demo",
        namespace: "phase4-test",
        retrievalId: "rag-cache-hit",
        matches: [
          {
            sourceId: "kb-1",
            title: "Troubleshooting",
            documentVersion: "v1",
            chunkId: "kb-1:v1:chunk-1",
            score: 0.95,
            retrievalId: "rag-cache-hit"
          }
        ],
        rawMatches: [
          {
            id: "match-1",
            text: "Power cycle the gateway.",
            score: 0.95,
            metadata: {
              sourceId: "kb-1",
              title: "Troubleshooting",
              tenantId: "tenant-demo",
              namespace: "phase4-test",
              documentVersion: "v1",
              access: {
                visibility: "tenant",
                allowedSubjects: [],
                allowedScopes: [],
                allowedRoles: []
              },
              ingestedAt: "2026-05-11T00:00:00Z",
              stale: false,
              deleted: false,
              chunkId: "kb-1:v1:chunk-1",
              chunkIndex: 0,
              contentHash: "hash-v1",
              tags: []
            }
          }
        ],
        retrievedCount: 1,
        returnedCount: 1,
        accessFilteredCount: 0,
        embeddingProvider: "deterministic",
        embeddingModel: "deterministic-local-test",
        vectorDbProvider: "memory"
      }))
    };
    const router = {
      describeRoute: jest.fn(() => ({
        routingFingerprint: "route-fingerprint"
      })),
      chat: jest.fn()
    };
    const cache = {
      buildKey: jest.fn(() => "cache-key"),
      get: jest.fn(() => ({
        answer: "Cached approved troubleshooting answer.",
        provider: "openai",
        model: "gpt-4o-mini",
        fallbackUsed: false
      })),
      set: jest.fn()
    };
    const telemetry = { recordRagWorkflow: jest.fn() };
    const service = new RagAnswerService(
      retrieval as unknown as RagRetrievalService,
      router as unknown as ModelRouter,
      cache as unknown as RagAnswerCacheService,
      telemetry as unknown as TelemetryService
    );

    const response = await service.answer(
      { question: "How do I troubleshoot?", requestId: "cache-hit" },
      context()
    );

    expect(response.answer).toBe("Cached approved troubleshooting answer.");
    expect(response.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    });
    expect(router.chat).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(telemetry.recordRagWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ cacheHit: true, cacheKeyHash: "cache-key" })
    );
  });
});

import type { ModelRouter } from "../llm/model-router";
import type { TelemetryService } from "../observability/telemetry.service";
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
    const telemetry = { recordRagWorkflow: jest.fn() };
    const service = new RagAnswerService(
      retrieval as unknown as RagRetrievalService,
      router as unknown as ModelRouter,
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
    const telemetry = { recordRagWorkflow: jest.fn() };
    const service = new RagAnswerService(
      retrieval as unknown as RagRetrievalService,
      router as unknown as ModelRouter,
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
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Power cycle the gateway")
          })
        ])
      })
    );
  });
});

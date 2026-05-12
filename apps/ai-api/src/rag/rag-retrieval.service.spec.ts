import type { AppConfigService } from "../config/app-config.service";
import type { EmbeddingRouter } from "../llm/embedding-router";
import type { TelemetryService } from "../observability/telemetry.service";
import type {
  VectorSearchMatch,
  VectorStore
} from "../vector-db/vector-db.types";
import { RagRetrievalService } from "./rag-retrieval.service";
import type { TrustedRagContext } from "./trusted-rag-context";

function context(): TrustedRagContext {
  return {
    tenantId: "tenant-demo",
    namespace: "phase4-test",
    subject: "agent-1",
    scopes: ["rag:search"],
    roles: ["support-agent"]
  };
}

function match(
  overrides: Partial<VectorSearchMatch["metadata"]> = {}
): VectorSearchMatch {
  return {
    id: `match-${overrides.sourceId ?? "kb-1"}`,
    text: "Approved source text",
    score: 0.9,
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
      tags: [],
      ...overrides
    }
  };
}

describe("RagRetrievalService", () => {
  it("filters unauthorized matches after vector search", async () => {
    const embeddings = {
      embedDocuments: jest.fn(async () => ({
        embeddings: [[1, 0, 0]],
        usage: { inputTokens: 4, totalTokens: 4 },
        metadata: {
          provider: "deterministic",
          model: "deterministic-local-test",
          dimensions: 3,
          latencyMs: 1
        }
      }))
    };
    const vectorStore = {
      name: "memory",
      search: jest.fn(async () => [
        match(),
        match({
          sourceId: "kb-restricted",
          access: {
            visibility: "restricted",
            allowedSubjects: ["someone-else"],
            allowedScopes: [],
            allowedRoles: []
          }
        })
      ])
    };
    const telemetry = { recordRagWorkflow: jest.fn() };
    const service = new RagRetrievalService(
      {
        rag: { enabled: true, topK: 4, scoreThreshold: 0.1 }
      } as AppConfigService,
      embeddings as unknown as EmbeddingRouter,
      telemetry as unknown as TelemetryService,
      vectorStore as unknown as VectorStore
    );

    const response = await service.search(
      { query: "gateway reset", requestId: "retrieve-test" },
      context()
    );

    expect(response.status).toBe("FOUND");
    expect(response.matches).toHaveLength(1);
    expect(response.accessFilteredCount).toBe(1);
    expect(response.matches[0]).toMatchObject({
      sourceId: "kb-1",
      title: "Troubleshooting",
      retrievalId: response.retrievalId
    });
    expect(vectorStore.search).toHaveBeenCalledWith(
      expect.objectContaining({
        topK: 12,
        scoreThreshold: 0.1,
        filter: {
          tenantId: "tenant-demo",
          namespace: "phase4-test",
          includeStale: false
        }
      })
    );
    expect(telemetry.recordRagWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "retrieve",
        requestId: "retrieve-test",
        retrievedCount: 2,
        returnedCount: 1,
        accessFilteredCount: 1,
        emptyRetrieval: false
      })
    );
  });

  it("redacts sensitive query text before embedding", async () => {
    const embedDocuments = jest.fn(async (_request: { texts: string[] }) => ({
      embeddings: [[1, 0, 0]],
      metadata: {
        provider: "deterministic",
        model: "deterministic-local-test",
        dimensions: 3,
        latencyMs: 1
      }
    }));
    const embeddings = {
      embedDocuments
    };
    const service = new RagRetrievalService(
      {
        rag: { enabled: true, topK: 4, scoreThreshold: 0.1 }
      } as AppConfigService,
      embeddings as unknown as EmbeddingRouter,
      { recordRagWorkflow: jest.fn() } as unknown as TelemetryService,
      {
        name: "memory",
        search: jest.fn(async () => [])
      } as unknown as VectorStore
    );

    await service.search(
      {
        query:
          "Tell Jane Doe at jane@example.com, phone 415-555-1212, account number ACCT-123456, card 4111 1111 1111 1111, SSN 123-45-6789, and 123 Main St about troubleshooting."
      },
      context()
    );

    const embeddingRequest = embedDocuments.mock.calls[0][0];
    expect(embeddingRequest.texts[0]).toContain("[redacted-name]");
    expect(embeddingRequest.texts[0]).toContain("[redacted-email]");
    expect(embeddingRequest.texts[0]).toContain("[redacted-phone]");
    expect(embeddingRequest.texts[0]).toContain("[redacted-identifier]");
    expect(embeddingRequest.texts[0]).toContain("[redacted-payment]");
    expect(embeddingRequest.texts[0]).toContain("[redacted-ssn]");
    expect(embeddingRequest.texts[0]).toContain("[redacted-address]");
    expect(embeddingRequest.texts[0]).not.toContain("Jane Doe");
    expect(embeddingRequest.texts[0]).not.toContain("jane@example.com");
    expect(embeddingRequest.texts[0]).not.toContain("415-555-1212");
    expect(embeddingRequest.texts[0]).not.toContain("ACCT-123456");
    expect(embeddingRequest.texts[0]).not.toContain("4111 1111");
    expect(embeddingRequest.texts[0]).not.toContain("123-45-6789");
    expect(embeddingRequest.texts[0]).not.toContain("123 Main St");
  });

  it("rejects wrong-namespace chunks returned by the vector store", async () => {
    const service = new RagRetrievalService(
      {
        rag: { enabled: true, topK: 4, scoreThreshold: 0.1 }
      } as AppConfigService,
      {
        embedDocuments: jest.fn(async () => ({
          embeddings: [[1]],
          metadata: {
            provider: "deterministic",
            model: "deterministic-local-test",
            dimensions: 1,
            latencyMs: 1
          }
        }))
      } as unknown as EmbeddingRouter,
      { recordRagWorkflow: jest.fn() } as unknown as TelemetryService,
      {
        name: "memory",
        search: jest.fn(async () => [match({ namespace: "other-namespace" })])
      } as unknown as VectorStore
    );

    const response = await service.search({ query: "gateway" }, context());

    expect(response.status).toBe("NO_AUTHORIZED_SOURCES");
    expect(response.matches).toEqual([]);
    expect(response.accessFilteredCount).toBe(1);
  });

  it("overfetches so authorized matches survive post-vector access filtering", async () => {
    const restrictedMatches = Array.from({ length: 4 }, (_, index) =>
      match({
        sourceId: `kb-restricted-${index}`,
        access: {
          visibility: "restricted",
          allowedSubjects: ["someone-else"],
          allowedScopes: [],
          allowedRoles: []
        }
      })
    );
    const vectorStore = {
      name: "memory",
      search: jest.fn(async () => [...restrictedMatches, match()])
    };
    const service = new RagRetrievalService(
      {
        rag: { enabled: true, topK: 2, scoreThreshold: 0.1 }
      } as AppConfigService,
      {
        embedDocuments: jest.fn(async () => ({
          embeddings: [[1]],
          metadata: {
            provider: "deterministic",
            model: "deterministic-local-test",
            dimensions: 1,
            latencyMs: 1
          }
        }))
      } as unknown as EmbeddingRouter,
      { recordRagWorkflow: jest.fn() } as unknown as TelemetryService,
      vectorStore as unknown as VectorStore
    );

    const response = await service.search(
      { query: "gateway", topK: 2 },
      context()
    );

    expect(vectorStore.search).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 6 })
    );
    expect(response.status).toBe("FOUND");
    expect(response.matches).toHaveLength(1);
    expect(response.matches[0].sourceId).toBe("kb-1");
  });

  it("returns explicit no-authorized-source status for empty retrieval", async () => {
    const service = new RagRetrievalService(
      {
        rag: { enabled: true, topK: 4, scoreThreshold: 0.1 }
      } as AppConfigService,
      {
        embedDocuments: jest.fn(async () => ({
          embeddings: [[1]],
          metadata: {
            provider: "deterministic",
            model: "deterministic-local-test",
            dimensions: 1,
            latencyMs: 1
          }
        }))
      } as unknown as EmbeddingRouter,
      { recordRagWorkflow: jest.fn() } as unknown as TelemetryService,
      {
        name: "memory",
        search: jest.fn(async () => [])
      } as unknown as VectorStore
    );

    const response = await service.search({ query: "unsupported" }, context());

    expect(response.status).toBe("NO_AUTHORIZED_SOURCES");
    expect(response.matches).toEqual([]);
  });
});

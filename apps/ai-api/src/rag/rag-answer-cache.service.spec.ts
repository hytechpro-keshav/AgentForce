import { AppConfigService } from "../config/app-config.service";
import { RagAnswerCacheService } from "./rag-answer-cache.service";
import type { TrustedRagContext } from "./trusted-rag-context";
import type { VectorSearchMatch } from "../vector-db/vector-db.types";

function makeContext(tenantId = "tenant-a"): TrustedRagContext {
  return {
    tenantId,
    namespace: "customer-self-service",
    subject: "user-1",
    scopes: ["agentforce:knowledge-rag"],
    roles: ["support-agent"]
  };
}

function makeMatch(version = "v1"): VectorSearchMatch {
  return {
    id: "doc-1:chunk-1",
    text: "raw source text that must never appear in the key",
    score: 0.9,
    metadata: {
      sourceId: "doc-1",
      title: "Troubleshooting",
      url: "https://help.example.com/troubleshooting",
      salesforceRecordRef: "Knowledge__kav/doc-1",
      tenantId: "tenant-a",
      namespace: "customer-self-service",
      documentVersion: version,
      access: {
        visibility: "tenant",
        allowedSubjects: [],
        allowedScopes: [],
        allowedRoles: []
      },
      ingestedAt: "2026-05-13T00:00:00Z",
      stale: false,
      deleted: false,
      chunkId: `doc-1:${version}:chunk-1`,
      chunkIndex: 0,
      contentHash: `hash-${version}`,
      language: "en-US",
      tags: ["support"]
    }
  };
}

function makeService(env: NodeJS.ProcessEnv = {}): RagAnswerCacheService {
  return new RagAnswerCacheService(
    AppConfigService.load(env) as AppConfigService
  );
}

describe("RagAnswerCacheService", () => {
  it("builds tenant-safe hash-only keys without raw question or chunk text", () => {
    const service = makeService();
    const key = service.buildKey({
      request: {
        question: "What should Jane do about outage 123456?",
        contextSummary: "Customer jane@example.com called twice"
      },
      context: makeContext(),
      rawMatches: [makeMatch()],
      sources: [
        {
          sourceId: "doc-1",
          title: "Troubleshooting",
          documentVersion: "v1",
          chunkId: "doc-1:v1:chunk-1",
          score: 0.9,
          retrievalId: "rag-1"
        }
      ],
      retrieval: {
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        vectorDbProvider: "qdrant"
      },
      useCase: "knowledge_rag",
      routingFingerprint: "route-a"
    });

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("Jane");
    expect(key).not.toContain("jane@example.com");
    expect(key).not.toContain("raw source text");
    expect(key).not.toContain("Troubleshooting");
    expect(key).not.toContain("help.example.com");
  });

  it("misses across tenants, source versions, and routing fingerprints", () => {
    const service = makeService();
    const baseInput = {
      request: { question: "How do I troubleshoot?" },
      context: makeContext(),
      rawMatches: [makeMatch("v1")],
      sources: [
        {
          sourceId: "doc-1",
          title: "Troubleshooting",
          documentVersion: "v1",
          chunkId: "doc-1:v1:chunk-1",
          score: 0.9,
          retrievalId: "rag-1"
        }
      ],
      retrieval: {
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        vectorDbProvider: "qdrant"
      },
      useCase: "knowledge_rag" as const,
      routingFingerprint: "route-a"
    };

    const baseKey = service.buildKey(baseInput);
    expect(
      service.buildKey({ ...baseInput, context: makeContext("tenant-b") })
    ).not.toBe(baseKey);
    expect(
      service.buildKey({
        ...baseInput,
        rawMatches: [makeMatch("v2")],
        sources: [{ ...baseInput.sources[0], documentVersion: "v2" }]
      })
    ).not.toBe(baseKey);
    expect(
      service.buildKey({ ...baseInput, routingFingerprint: "route-b" })
    ).not.toBe(baseKey);
  });

  it("misses when prompt-visible source metadata changes", () => {
    const service = makeService();
    const match = makeMatch("v1");
    const baseInput = {
      request: { question: "How do I troubleshoot?" },
      context: makeContext(),
      rawMatches: [match],
      sources: [
        {
          sourceId: "doc-1",
          title: "Troubleshooting",
          documentVersion: "v1",
          chunkId: "doc-1:v1:chunk-1",
          score: 0.9,
          retrievalId: "rag-1"
        }
      ],
      retrieval: {
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        vectorDbProvider: "qdrant"
      },
      useCase: "knowledge_rag" as const,
      routingFingerprint: "route-a"
    };

    const baseKey = service.buildKey(baseInput);
    const changedMetadata = {
      ...match,
      metadata: {
        ...match.metadata,
        title: "Updated troubleshooting",
        url: "https://help.example.com/updated",
        ingestedAt: "2026-05-14T00:00:00Z",
        tags: ["support", "updated"]
      }
    };

    expect(
      service.buildKey({ ...baseInput, rawMatches: [changedMetadata] })
    ).not.toBe(baseKey);
  });

  it("honors disabled cache configuration", () => {
    const service = makeService({ RAG_RESPONSE_CACHE_MAX_ITEMS: "0" });
    service.set("abc", {
      answer: "cached",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false
    });

    expect(service.get("abc")).toBeUndefined();
  });

  it("expires entries after the configured TTL", () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);
    const service = makeService({ RAG_RESPONSE_CACHE_TTL_MS: "10" });

    service.set("abc", {
      answer: "cached",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false
    });

    nowSpy.mockReturnValue(1009);
    expect(service.get("abc")).toEqual(
      expect.objectContaining({ answer: "cached" })
    );

    nowSpy.mockReturnValue(1011);
    expect(service.get("abc")).toBeUndefined();
    nowSpy.mockRestore();
  });
});

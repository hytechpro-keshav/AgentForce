import type { AppConfigService } from "../config/app-config.service";
import type { TelemetryService } from "../observability/telemetry.service";
import { EMBEDDING_PROVIDERS, EmbeddingRouter } from "./embedding-router";
import { EmbeddingProviderError } from "./interfaces/embedding-provider";
import type { EmbeddingProvider } from "./interfaces/embedding-provider";

describe("EmbeddingRouter", () => {
  function buildRouter(provider: EmbeddingProvider): {
    router: EmbeddingRouter;
    telemetry: { recordEmbedding: jest.Mock };
  } {
    const telemetry = { recordEmbedding: jest.fn() };
    return {
      router: new EmbeddingRouter(
        [provider],
        {
          rag: {
            defaultEmbeddingProvider: provider.name,
            embeddingCacheMaxItems: 2048
          }
        } as AppConfigService,
        telemetry as unknown as TelemetryService
      ),
      telemetry
    };
  }

  it("normalizes provider embeddings before returning them", async () => {
    const provider: EmbeddingProvider = {
      name: "test",
      embedDocuments: jest.fn(async () => ({
        embeddings: [[3, 4]],
        metadata: {
          provider: "test",
          model: "test-embedding",
          dimensions: 2,
          latencyMs: 12
        }
      }))
    };
    const { router } = buildRouter(provider);

    const response = await router.embedDocuments({ texts: ["alpha"] });

    expect(response.embeddings[0]).toEqual([0.6, 0.8]);
    expect(response.metadata.normalized).toBe(true);
  });

  it("caches embeddings by safe hash without re-calling the provider", async () => {
    const provider: EmbeddingProvider = {
      name: "test",
      embedDocuments: jest.fn(async () => ({
        embeddings: [[0, 2]],
        usage: { inputTokens: 8, totalTokens: 8 },
        metadata: {
          provider: "test",
          model: "test-embedding",
          dimensions: 2,
          latencyMs: 9
        }
      }))
    };
    const { router, telemetry } = buildRouter(provider);

    const first = await router.embedDocuments({
      texts: ["repeat this chunk"],
      requestId: "first"
    });
    const second = await router.embedDocuments({
      texts: ["repeat this chunk"],
      requestId: "second"
    });

    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
    expect(first.embeddings).toEqual([[0, 1]]);
    expect(second.embeddings).toEqual([[0, 1]]);
    expect(second.usage).toEqual({ inputTokens: 0, totalTokens: 0 });
    expect(second.metadata).toMatchObject({
      cacheHit: true,
      cacheHitCount: 1,
      cacheMissCount: 0
    });
    expect(telemetry.recordEmbedding).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestId: "second",
        inputTokens: 0,
        totalTokens: 0,
        cacheHitCount: 1,
        cacheMissCount: 0
      })
    );
  });

  it("only calls the provider for cache misses", async () => {
    const provider: EmbeddingProvider = {
      name: "test",
      embedDocuments: jest.fn(async ({ texts }) => ({
        embeddings: texts.map((text) => (text === "beta" ? [5, 0] : [0, 5])),
        usage: { inputTokens: texts.length * 4, totalTokens: texts.length * 4 },
        metadata: {
          provider: "test",
          model: "test-embedding",
          dimensions: 2,
          latencyMs: 5
        }
      }))
    };
    const { router } = buildRouter(provider);

    await router.embedDocuments({ texts: ["alpha"] });
    const response = await router.embedDocuments({ texts: ["alpha", "beta"] });

    expect(provider.embedDocuments).toHaveBeenCalledTimes(2);
    expect(provider.embedDocuments).toHaveBeenLastCalledWith({
      texts: ["beta"]
    });
    expect(response.embeddings).toEqual([
      [0, 1],
      [1, 0]
    ]);
    expect(response.metadata).toMatchObject({
      cacheHit: true,
      cacheHitCount: 1,
      cacheMissCount: 1
    });
  });

  it("honors a disabled embedding cache", async () => {
    const provider: EmbeddingProvider = {
      name: "test",
      embedDocuments: jest.fn(async () => ({
        embeddings: [[0, 2]],
        metadata: {
          provider: "test",
          model: "test-embedding",
          dimensions: 2,
          latencyMs: 9
        }
      }))
    };
    const telemetry = { recordEmbedding: jest.fn() };
    const router = new EmbeddingRouter(
      [provider],
      {
        rag: {
          defaultEmbeddingProvider: provider.name,
          embeddingCacheMaxItems: 0
        }
      } as AppConfigService,
      telemetry as unknown as TelemetryService
    );

    await router.embedDocuments({ texts: ["repeat this chunk"] });
    await router.embedDocuments({ texts: ["repeat this chunk"] });

    expect(provider.embedDocuments).toHaveBeenCalledTimes(2);
  });

  it("rejects zero-magnitude provider embeddings", async () => {
    const provider: EmbeddingProvider = {
      name: "test",
      embedDocuments: jest.fn(async () => ({
        embeddings: [[0, 0]],
        metadata: {
          provider: "test",
          model: "test-embedding",
          dimensions: 2,
          latencyMs: 9
        }
      }))
    };
    const { router, telemetry } = buildRouter(provider);

    await expect(router.embedDocuments({ texts: ["alpha"] })).rejects.toThrow(
      EmbeddingProviderError
    );
    expect(telemetry.recordEmbedding).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "error", errorKind: "validation" })
    );
  });
});

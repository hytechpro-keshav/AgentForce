import { createHash } from "crypto";
import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { TelemetryService } from "../observability/telemetry.service";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse
} from "./interfaces/embedding-provider";
import { EmbeddingProviderError } from "./interfaces/embedding-provider";

export const EMBEDDING_PROVIDERS = Symbol("EMBEDDING_PROVIDERS");
const DEFAULT_MAX_EMBEDDING_CACHE_ITEMS = 2048;

interface CachedEmbedding {
  embedding: number[];
  metadata: Omit<EmbeddingResponse["metadata"], "latencyMs">;
}

@Injectable()
export class EmbeddingRouter {
  private readonly providers: Map<string, EmbeddingProvider>;
  private readonly cache = new Map<string, CachedEmbedding>();

  constructor(
    @Inject(EMBEDDING_PROVIDERS) providers: EmbeddingProvider[],
    private readonly config: AppConfigService,
    private readonly telemetry: TelemetryService
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.name, provider])
    );
  }

  get availableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  async embedDocuments(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const providerName = this.config.rag.defaultEmbeddingProvider;
    const provider = this.providers.get(providerName);
    if (!provider) {
      const error = new EmbeddingProviderError(
        providerName,
        "validation",
        `No embedding provider named ${providerName} is configured.`
      );
      this.telemetry.recordEmbedding({
        provider: providerName,
        model: request.model,
        requestId: request.requestId,
        inputCount: request.texts.length,
        latencyMs: 0,
        outcome: "error",
        errorKind: error.kind
      });
      throw error;
    }

    try {
      const cachedResults = request.texts.map((text) =>
        this.readCachedEmbedding(providerName, request.model, text)
      );
      const missingIndexes = cachedResults
        .map((cached, index) => (cached ? undefined : index))
        .filter((index): index is number => index !== undefined);
      let response: EmbeddingResponse;
      if (missingIndexes.length === 0) {
        const metadata = cachedResults[0]?.metadata;
        response = {
          embeddings: cachedResults.map((cached) => cached?.embedding ?? []),
          usage: { inputTokens: 0, totalTokens: 0 },
          metadata: {
            provider: metadata?.provider ?? providerName,
            model: metadata?.model ?? request.model ?? "cached-default",
            dimensions:
              metadata?.dimensions ?? cachedResults[0]?.embedding.length ?? 0,
            latencyMs: 0,
            cacheHit: true,
            cacheHitCount: request.texts.length,
            cacheMissCount: 0,
            normalized: true
          }
        };
      } else {
        const providerResponse = await provider.embedDocuments({
          ...request,
          texts: missingIndexes.map((index) => request.texts[index])
        });
        const embeddings = cachedResults.map((cached) => cached?.embedding);
        providerResponse.embeddings.forEach((embedding, missIndex) => {
          const requestIndex = missingIndexes[missIndex];
          const normalized = normalizeVector(providerName, embedding);
          embeddings[requestIndex] = normalized;
          this.writeCachedEmbedding(
            providerName,
            request.model,
            request.texts[requestIndex],
            {
              embedding: normalized,
              metadata: {
                provider: providerResponse.metadata.provider,
                model: providerResponse.metadata.model,
                dimensions: normalized.length,
                cacheHit: false,
                cacheHitCount: 0,
                cacheMissCount: 1,
                normalized: true
              }
            }
          );
        });
        response = {
          embeddings: embeddings.map((embedding) => embedding ?? []),
          usage: providerResponse.usage,
          metadata: {
            ...providerResponse.metadata,
            dimensions:
              providerResponse.embeddings[0]?.length ??
              providerResponse.metadata.dimensions,
            cacheHit: missingIndexes.length < request.texts.length,
            cacheHitCount: request.texts.length - missingIndexes.length,
            cacheMissCount: missingIndexes.length,
            normalized: true
          }
        };
      }
      this.telemetry.recordEmbedding({
        provider: response.metadata.provider,
        model: response.metadata.model,
        requestId: request.requestId,
        inputCount: request.texts.length,
        inputTokens: response.usage?.inputTokens,
        totalTokens: response.usage?.totalTokens,
        latencyMs: response.metadata.latencyMs,
        cacheHitCount: response.metadata.cacheHitCount,
        cacheMissCount: response.metadata.cacheMissCount,
        outcome: "success"
      });
      return response;
    } catch (err) {
      const error =
        err instanceof EmbeddingProviderError
          ? err
          : new EmbeddingProviderError(
              provider.name,
              "unknown",
              "Embedding provider failed",
              err
            );
      this.telemetry.recordEmbedding({
        provider: error.provider,
        model: request.model,
        requestId: request.requestId,
        inputCount: request.texts.length,
        latencyMs: 0,
        outcome: "error",
        errorKind: error.kind
      });
      throw error;
    }
  }

  private readCachedEmbedding(
    providerName: string,
    model: string | undefined,
    text: string
  ): CachedEmbedding | undefined {
    const key = cacheKey(providerName, model, text);
    const cached = this.cache.get(key);
    if (!cached) {
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, cached);
    return {
      embedding: [...cached.embedding],
      metadata: cached.metadata
    };
  }

  private writeCachedEmbedding(
    providerName: string,
    model: string | undefined,
    text: string,
    cached: CachedEmbedding
  ): void {
    this.cache.set(cacheKey(providerName, model, text), cached);
    const maxItems =
      this.config.rag.embeddingCacheMaxItems ??
      DEFAULT_MAX_EMBEDDING_CACHE_ITEMS;
    if (maxItems === 0) {
      this.cache.clear();
      return;
    }
    while (this.cache.size > maxItems) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.cache.delete(oldestKey);
    }
  }
}

function cacheKey(
  providerName: string,
  model: string | undefined,
  text: string
): string {
  return createHash("sha256")
    .update(providerName)
    .update("\0")
    .update(model ?? "__default__")
    .update("\0")
    .update(text)
    .digest("hex");
}

function normalizeVector(providerName: string, vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    throw new EmbeddingProviderError(
      providerName,
      "validation",
      "Embedding provider returned an invalid zero-magnitude vector."
    );
  }
  return vector.map((value) => value / norm);
}

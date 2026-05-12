import { randomUUID } from "crypto";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { EmbeddingRouter } from "../llm/embedding-router";
import { TelemetryService } from "../observability/telemetry.service";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import { VECTOR_STORE } from "../vector-db/vector-db.module";
import type {
  VectorSearchMatch,
  VectorStore
} from "../vector-db/vector-db.types";
import type { RagSearchRequestDto, RagSearchResponseDto } from "./dto/rag.dto";
import { RagConfigurationError } from "./rag.errors";
import { toRagSourceDto } from "./rag-source-format";
import {
  isAuthorizedForChunk,
  type TrustedRagContext
} from "./trusted-rag-context";

export interface RagRetrievalResult extends RagSearchResponseDto {
  rawMatches: VectorSearchMatch[];
}

@Injectable()
export class RagRetrievalService {
  constructor(
    private readonly config: AppConfigService,
    private readonly embeddings: EmbeddingRouter,
    private readonly telemetry: TelemetryService,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore
  ) {}

  async search(
    request: RagSearchRequestDto,
    context: TrustedRagContext
  ): Promise<RagRetrievalResult> {
    this.ensureEnabled();
    const startedAt = Date.now();
    const retrievalId = `rag-${randomUUID()}`;
    const topK = request.topK ?? this.config.rag.topK;
    const vectorTopK = Math.min(50, Math.max(topK, topK * 3));
    const scoreThreshold =
      request.scoreThreshold ?? this.config.rag.scoreThreshold;
    const includeStale = request.includeStale ?? false;
    if (includeStale && !context.scopes.includes("rag:search:stale")) {
      throw new ForbiddenException(
        "Searching stale RAG sources requires the rag:search:stale scope."
      );
    }
    const safeQuery = redactSensitiveText(request.query);

    const embeddingStartedAt = Date.now();
    const embeddingResponse = await this.embeddings.embedDocuments({
      texts: [safeQuery],
      requestId: request.requestId
    });
    const embeddingLatencyMs = Date.now() - embeddingStartedAt;

    const retrievalStartedAt = Date.now();
    const vectorMatches = await this.vectorStore.search({
      embedding: embeddingResponse.embeddings[0],
      topK: vectorTopK,
      scoreThreshold,
      filter: {
        tenantId: context.tenantId,
        namespace: context.namespace,
        includeStale
      }
    });
    const retrievalLatencyMs = Date.now() - retrievalStartedAt;
    const authorizedMatches = vectorMatches.filter((match) =>
      isAuthorizedForChunk(match.metadata, context)
    );
    const accessFilteredCount = Math.max(
      0,
      vectorMatches.length - authorizedMatches.length
    );
    const returnedMatches = authorizedMatches.slice(0, topK);
    const sources = returnedMatches.map((match) =>
      toRagSourceDto(match, retrievalId)
    );
    const status = sources.length > 0 ? "FOUND" : "NO_AUTHORIZED_SOURCES";

    this.telemetry.recordRagWorkflow({
      operation: "retrieve",
      requestId: request.requestId,
      retrievalId,
      tenantId: context.tenantId,
      namespace: context.namespace,
      sourceIds: sources.map((source) => source.sourceId),
      chunkIds: sources.map((source) => source.chunkId),
      sourceVersions: sources.map((source) => source.documentVersion),
      embeddingProvider: embeddingResponse.metadata.provider,
      embeddingModel: embeddingResponse.metadata.model,
      vectorDbProvider: this.vectorStore.name,
      topK,
      scoreThreshold,
      retrievedCount: vectorMatches.length,
      returnedCount: sources.length,
      accessFilteredCount,
      emptyRetrieval: sources.length === 0,
      fallbackReason:
        sources.length === 0
          ? vectorMatches.length === 0
            ? "no_vector_matches"
            : "no_authorized_sources"
          : undefined,
      embeddingInputTokens: embeddingResponse.usage?.inputTokens,
      embeddingTotalTokens: embeddingResponse.usage?.totalTokens,
      embeddingLatencyMs,
      retrievalLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
      outcome: "success"
    });

    return {
      status,
      tenantId: context.tenantId,
      namespace: context.namespace,
      retrievalId,
      matches: sources,
      rawMatches: returnedMatches,
      retrievedCount: vectorMatches.length,
      returnedCount: sources.length,
      accessFilteredCount,
      embeddingProvider: embeddingResponse.metadata.provider,
      embeddingModel: embeddingResponse.metadata.model,
      vectorDbProvider: this.vectorStore.name,
      requestId: request.requestId
    };
  }

  private ensureEnabled(): void {
    if (!this.config.rag.enabled) {
      throw new RagConfigurationError(
        "RAG is disabled. Set RAG_ENABLED=true and configure embeddings plus vector DB secrets before using RAG routes."
      );
    }
  }
}

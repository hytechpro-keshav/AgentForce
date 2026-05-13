import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type { LlmUseCase } from "../llm/interfaces/llm-contracts";
import type { VectorSearchMatch } from "../vector-db/vector-db.types";
import type { KnowledgeAnswerRequestDto, RagSourceDto } from "./dto/rag.dto";
import type { TrustedRagContext } from "./trusted-rag-context";

export interface RagAnswerCacheKeyInput {
  request: KnowledgeAnswerRequestDto;
  context: TrustedRagContext;
  rawMatches: VectorSearchMatch[];
  sources: RagSourceDto[];
  retrieval: {
    embeddingProvider: string;
    embeddingModel: string;
    vectorDbProvider: string;
  };
  useCase: LlmUseCase;
  routingFingerprint: string;
}

export interface CachedRagAnswer {
  answer: string;
  provider?: string;
  model?: string;
  fallbackUsed: boolean;
}

interface CacheEntry {
  value: CachedRagAnswer;
  expiresAt: number;
}

@Injectable()
export class RagAnswerCacheService {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly config: AppConfigService) {}

  buildKey(input: RagAnswerCacheKeyInput): string {
    const sourceFingerprints = input.rawMatches.map((match, index) => ({
      sourceId: match.metadata.sourceId,
      chunkId: match.metadata.chunkId,
      documentVersion: match.metadata.documentVersion,
      titleHash: RagAnswerCacheService.hashString(match.metadata.title),
      urlHash: RagAnswerCacheService.hashString(match.metadata.url ?? ""),
      salesforceRecordRefHash: RagAnswerCacheService.hashString(
        match.metadata.salesforceRecordRef ?? ""
      ),
      ingestedAtHash: RagAnswerCacheService.hashString(
        match.metadata.ingestedAt
      ),
      languageHash: RagAnswerCacheService.hashString(
        match.metadata.language ?? ""
      ),
      tagHashes: match.metadata.tags
        .map((tag) => RagAnswerCacheService.hashString(tag))
        .sort(),
      contentHash: match.metadata.contentHash,
      stale: match.metadata.stale,
      deleted: match.metadata.deleted,
      access: {
        visibility: match.metadata.access.visibility,
        allowedSubjects: [...match.metadata.access.allowedSubjects].sort(),
        allowedScopes: [...match.metadata.access.allowedScopes].sort(),
        allowedRoles: [...match.metadata.access.allowedRoles].sort()
      },
      returnedSourceId: input.sources[index]?.sourceId,
      returnedChunkId: input.sources[index]?.chunkId
    }));

    return RagAnswerCacheService.hashJson({
      tenantId: input.context.tenantId,
      namespace: input.context.namespace,
      subjectHash: RagAnswerCacheService.hashString(input.context.subject),
      scopes: [...input.context.scopes].sort(),
      roles: [...input.context.roles].sort(),
      questionHash: RagAnswerCacheService.hashString(input.request.question),
      contextSummaryHash: RagAnswerCacheService.hashString(
        input.request.contextSummary ?? ""
      ),
      locale: input.request.locale ?? "en-US",
      topK: input.request.topK,
      scoreThreshold: input.request.scoreThreshold,
      embeddingProvider: input.retrieval.embeddingProvider,
      embeddingModel: input.retrieval.embeddingModel,
      vectorDbProvider: input.retrieval.vectorDbProvider,
      useCase: input.useCase,
      routingFingerprint: input.routingFingerprint,
      sources: sourceFingerprints
    });
  }

  get(key: string): CachedRagAnswer | undefined {
    if (this.config.rag.responseCacheMaxItems === 0) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: CachedRagAnswer): void {
    const maxItems = this.config.rag.responseCacheMaxItems;
    if (maxItems === 0) return;
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.config.rag.responseCacheTtlMs
    });
    while (this.entries.size > maxItems) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  private static hashJson(value: unknown): string {
    return RagAnswerCacheService.hashString(JSON.stringify(value));
  }

  private static hashString(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}

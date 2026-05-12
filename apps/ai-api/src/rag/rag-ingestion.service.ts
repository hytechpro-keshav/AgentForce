import { createHash } from "crypto";
import { Inject, Injectable, ForbiddenException } from "@nestjs/common";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import { AppConfigService } from "../config/app-config.service";
import { EmbeddingRouter } from "../llm/embedding-router";
import { TelemetryService } from "../observability/telemetry.service";
import { VECTOR_STORE } from "../vector-db/vector-db.module";
import type { VectorDocument, VectorStore } from "../vector-db/vector-db.types";
import type { RagIngestRequestDto, RagIngestResponseDto } from "./dto/rag.dto";
import { RagConfigurationError } from "./rag.errors";
import {
  normalizeAccessMetadata,
  type TrustedRagContext
} from "./trusted-rag-context";

@Injectable()
export class RagIngestionService {
  constructor(
    private readonly config: AppConfigService,
    private readonly embeddings: EmbeddingRouter,
    private readonly telemetry: TelemetryService,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore
  ) {}

  async ingest(
    request: RagIngestRequestDto,
    context: TrustedRagContext
  ): Promise<RagIngestResponseDto> {
    this.ensureEnabled();
    const startedAt = Date.now();
    const chunkSize = request.chunkSize ?? this.config.rag.chunkSize;
    const chunkOverlap = request.chunkOverlap ?? this.config.rag.chunkOverlap;
    if (chunkOverlap >= chunkSize) {
      throw new RagConfigurationError(
        "chunkOverlap must be smaller than chunkSize."
      );
    }

    const documents = await this.buildVectorDocuments(
      request,
      context,
      chunkSize,
      chunkOverlap
    );
    const embeddingStartedAt = Date.now();
    const embeddingResponse = await this.embeddings.embedDocuments({
      texts: documents.map((document) => document.text),
      requestId: request.requestId
    });
    const embeddingLatencyMs = Date.now() - embeddingStartedAt;

    const vectorDocuments = documents.map((document, index) => ({
      ...document,
      embedding: embeddingResponse.embeddings[index]
    }));
    await this.replaceExistingSources(request, context);
    await this.vectorStore.upsert(vectorDocuments);

    this.telemetry.recordRagWorkflow({
      operation: "ingest",
      requestId: request.requestId,
      tenantId: context.tenantId,
      namespace: context.namespace,
      sourceIds: Array.from(
        new Set(vectorDocuments.map((document) => document.metadata.sourceId))
      ),
      chunkIds: vectorDocuments.map((document) => document.metadata.chunkId),
      sourceVersions: Array.from(
        new Set(
          vectorDocuments.map((document) => document.metadata.documentVersion)
        )
      ),
      embeddingProvider: embeddingResponse.metadata.provider,
      embeddingModel: embeddingResponse.metadata.model,
      vectorDbProvider: this.vectorStore.name,
      documentsReceived: request.documents.length,
      chunksIndexed: vectorDocuments.length,
      embeddingInputTokens: embeddingResponse.usage?.inputTokens,
      embeddingTotalTokens: embeddingResponse.usage?.totalTokens,
      ingestLatencyMs: Date.now() - startedAt,
      embeddingLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
      outcome: "success"
    });

    return {
      status: "INGESTED",
      tenantId: context.tenantId,
      namespace: context.namespace,
      documentsReceived: request.documents.length,
      chunksIndexed: vectorDocuments.length,
      embeddingProvider: embeddingResponse.metadata.provider,
      embeddingModel: embeddingResponse.metadata.model,
      vectorDbProvider: this.vectorStore.name,
      requestId: request.requestId
    };
  }

  private async buildVectorDocuments(
    request: RagIngestRequestDto,
    context: TrustedRagContext,
    chunkSize: number,
    chunkOverlap: number
  ): Promise<Array<Omit<VectorDocument, "embedding">>> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap
    });
    const ingestedAt = new Date().toISOString();
    const vectorDocuments: Array<Omit<VectorDocument, "embedding">> = [];

    for (const document of request.documents) {
      if (document.tenantId && document.tenantId !== context.tenantId) {
        throw new ForbiddenException(
          "Document tenantId does not match trusted tenant claim."
        );
      }
      if (document.namespace && document.namespace !== context.namespace) {
        throw new ForbiddenException(
          "Document namespace does not match trusted namespace."
        );
      }

      const chunks = await splitter.splitText(document.content);
      chunks.forEach((chunk, index) => {
        const chunkId = `${sanitizeId(document.sourceId)}:${sanitizeId(document.documentVersion)}:chunk-${index + 1}`;
        vectorDocuments.push({
          id: `${context.tenantId}:${context.namespace}:${chunkId}`,
          text: chunk,
          metadata: {
            sourceId: document.sourceId,
            title: document.title,
            url: document.url,
            salesforceRecordRef: document.salesforceRecordRef,
            tenantId: context.tenantId,
            namespace: context.namespace,
            documentVersion: document.documentVersion,
            access: normalizeAccessMetadata(document.access),
            ingestedAt,
            stale: document.stale ?? false,
            deleted: document.deleted ?? false,
            chunkId,
            chunkIndex: index,
            contentHash: sha256(chunk),
            language: document.language,
            tags: document.tags ?? []
          }
        });
      });
    }

    return vectorDocuments;
  }

  private async replaceExistingSources(
    request: RagIngestRequestDto,
    context: TrustedRagContext
  ): Promise<void> {
    const sourceIds = Array.from(
      new Set(request.documents.map((document) => document.sourceId))
    );
    for (const sourceId of sourceIds) {
      await this.vectorStore.deleteBySource({
        tenantId: context.tenantId,
        namespace: context.namespace,
        sourceId
      });
    }
  }

  private ensureEnabled(): void {
    if (!this.config.rag.enabled) {
      throw new RagConfigurationError(
        "RAG is disabled. Set RAG_ENABLED=true and configure embeddings plus vector DB secrets before using RAG routes."
      );
    }
  }
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .slice(0, 80);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { RequireScopes } from "../auth/require-scopes.decorator";
import { AppConfigService } from "../config/app-config.service";
import { EmbeddingProviderError } from "../llm/interfaces/embedding-provider";
import { VectorStoreError } from "../vector-db/vector-db.types";
import type { RagIngestResponseDto, RagSearchResponseDto } from "./dto/rag.dto";
import { RagIngestRequestDto, RagSearchRequestDto } from "./dto/rag.dto";
import { RagConfigurationError } from "./rag.errors";
import { RagIngestionService } from "./rag-ingestion.service";
import { RagRateLimitGuard } from "./rag-rate-limit.guard";
import { RagRetrievalService } from "./rag-retrieval.service";
import { resolveTrustedRagContext } from "./trusted-rag-context";

@UseGuards(RagRateLimitGuard)
@Controller("rag")
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly ingestionService: RagIngestionService,
    private readonly retrievalService: RagRetrievalService
  ) {}

  @RequireScopes("rag:ingest")
  @Post("ingest")
  async ingest(
    @Body() body: RagIngestRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<RagIngestResponseDto> {
    try {
      const context = resolveTrustedRagContext(
        request.authPrincipal,
        body.namespace,
        this.config
      );
      return await this.ingestionService.ingest(body, context);
    } catch (err) {
      throw this.toClientError(err, "rag.ingest");
    }
  }

  @RequireScopes("rag:search")
  @Post("search")
  async search(
    @Body() body: RagSearchRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<RagSearchResponseDto> {
    try {
      const context = resolveTrustedRagContext(
        request.authPrincipal,
        body.namespace,
        this.config
      );
      const result = await this.retrievalService.search(body, context);
      const { rawMatches, ...response } = result;
      return response;
    } catch (err) {
      throw this.toClientError(err, "rag.search");
    }
  }

  private toClientError(err: unknown, scope: string): Error {
    if (err instanceof RagConfigurationError) {
      return new ServiceUnavailableException({
        error: "rag_not_configured",
        message: err.message
      });
    }
    if (err instanceof EmbeddingProviderError) {
      this.logger.warn(
        `${scope} embedding error: provider=${err.provider} kind=${err.kind}`
      );
      return new ServiceUnavailableException({
        error: "embedding_provider_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    if (err instanceof VectorStoreError) {
      this.logger.warn(
        `${scope} vector store error: provider=${err.provider} kind=${err.kind}`
      );
      return new ServiceUnavailableException({
        error: "vector_store_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    if (err instanceof BadRequestException) {
      return err;
    }
    return err instanceof Error ? err : new Error("Unknown RAG error");
  }
}

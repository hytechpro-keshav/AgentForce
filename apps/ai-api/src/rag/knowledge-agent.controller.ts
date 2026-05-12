import {
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
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { VectorStoreError } from "../vector-db/vector-db.types";
import type { KnowledgeAnswerResponseDto } from "./dto/rag.dto";
import { KnowledgeAnswerRequestDto } from "./dto/rag.dto";
import { RagAnswerService } from "./rag-answer.service";
import { RagConfigurationError } from "./rag.errors";
import { RagRateLimitGuard } from "./rag-rate-limit.guard";
import { resolveTrustedRagContext } from "./trusted-rag-context";

@UseGuards(RagRateLimitGuard)
@Controller("agent/knowledge")
export class KnowledgeAgentController {
  private readonly logger = new Logger(KnowledgeAgentController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly answerService: RagAnswerService
  ) {}

  @RequireScopes("agentforce:knowledge-rag")
  @Post("answer")
  async answer(
    @Body() body: KnowledgeAnswerRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<KnowledgeAnswerResponseDto> {
    try {
      const context = resolveTrustedRagContext(
        request.authPrincipal,
        body.namespace,
        this.config
      );
      return await this.answerService.answer(body, context);
    } catch (err) {
      throw this.toClientError(err, "agent.knowledge.answer");
    }
  }

  private toClientError(err: unknown, scope: string): Error {
    if (err instanceof RagConfigurationError) {
      return new ServiceUnavailableException({
        error: "rag_not_configured",
        message: err.message
      });
    }
    if (err instanceof LlmProviderError) {
      this.logger.warn(
        `${scope} provider error: provider=${err.provider} kind=${err.kind}`
      );
      return new ServiceUnavailableException({
        error: "provider_unavailable",
        provider: err.provider,
        kind: err.kind
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
    return err instanceof Error
      ? err
      : new Error("Unknown knowledge RAG error");
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException
} from "@nestjs/common";

import { EmbeddingProviderError } from "../llm/interfaces/embedding-provider";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { VectorStoreError } from "../vector-db/vector-db.types";
import { RagConfigurationError } from "../rag/rag.errors";
import { ChatService } from "./chat.service";
import { ChatEscalationService } from "./chat-escalation.service";
import {
  ChatMessageRequestDto,
  type ChatMessageResponseDto
} from "./dto/chat-message.dto";
import {
  ChatEscalationRequestDto,
  type ChatEscalationResponseDto
} from "./dto/chat-escalation.dto";
import { RequireScopes } from "../auth/require-scopes.decorator";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";

interface StreamingHttpResponse {
  status(code: number): StreamingHttpResponse;
  setHeader(name: string, value: string): void;
  write(chunk: string): boolean | void;
  end(chunk?: string): void;
  flushHeaders?(): void;
  on?(event: "close", listener: () => void): void;
}

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly escalationService: ChatEscalationService
  ) {}

  @RequireScopes("chat:write")
  @Post("message")
  async postMessage(
    @Body() body: ChatMessageRequestDto,
    @Req() req: AuthenticatedRequest
  ): Promise<ChatMessageResponseDto> {
    try {
      return await this.chatService.handleMessage(body, req.authPrincipal);
    } catch (err) {
      throw this.mapProviderError(err);
    }
  }

  @RequireScopes("chat:write")
  @HttpCode(200)
  @Post("message/stream")
  async streamMessage(
    @Body() body: ChatMessageRequestDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: StreamingHttpResponse
  ): Promise<void> {
    response.status(200);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders?.();

    let aborted = false;
    response.on?.("close", () => {
      aborted = true;
    });

    const writeEvent = (payload: unknown): void => {
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      for await (const chunk of this.chatService.streamMessage(
        body,
        req.authPrincipal
      )) {
        if (aborted) return;
        if (chunk.kind === "text") {
          writeEvent({ type: "text", value: chunk.delta });
        } else {
          writeEvent({
            type: "done",
            finishReason: chunk.finishReason,
            usage: chunk.usage,
            provider: chunk.metadata.provider,
            model: chunk.metadata.model,
            fallbackUsed: chunk.metadata.fallbackUsed,
            attemptedProviders: chunk.metadata.attemptedProviders,
            latencyMs: chunk.metadata.latencyMs,
            responseId: chunk.metadata.responseId
          });
        }
      }
      response.write("data: [DONE]\n\n");
      response.end();
    } catch (err) {
      const mapped = this.mapProviderError(err);
      const httpResponse = (
        mapped as { getResponse?: () => unknown }
      ).getResponse?.();
      const status =
        (mapped as { getStatus?: () => number }).getStatus?.() ?? 502;
      const payload =
        typeof httpResponse === "object" && httpResponse !== null
          ? (httpResponse as Record<string, unknown>)
          : { error: "provider_unavailable" };
      writeEvent({ type: "error", status, ...payload });
      response.end();
    }
  }

  @RequireScopes("chat:write")
  @Post("escalate")
  escalate(
    @Body() body: ChatEscalationRequestDto,
    @Req() req: AuthenticatedRequest
  ): ChatEscalationResponseDto {
    return this.escalationService.acknowledge(body, req.authPrincipal?.subject);
  }

  private mapProviderError(err: unknown): Error {
    if (err instanceof RagConfigurationError) {
      return new ServiceUnavailableException({
        error: "rag_not_configured",
        message: err.message
      });
    }
    if (err instanceof LlmProviderError) {
      this.logger.warn(
        `chat provider error: provider=${err.provider} kind=${err.kind}`
      );
      if (err.kind === "validation") {
        return new BadRequestException({
          error: "provider_validation_failed",
          provider: err.provider
        });
      }
      return new BadRequestException({
        error: "provider_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    if (err instanceof EmbeddingProviderError) {
      this.logger.warn(
        `chat embedding error: provider=${err.provider} kind=${err.kind}`
      );
      return new ServiceUnavailableException({
        error: "embedding_provider_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    if (err instanceof VectorStoreError) {
      this.logger.warn(
        `chat vector store error: provider=${err.provider} kind=${err.kind}`
      );
      return new ServiceUnavailableException({
        error: "vector_store_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    return err instanceof Error ? err : new Error("unknown_error");
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards
} from "@nestjs/common";
import { randomUUID } from "crypto";

import { RequireScopes } from "../auth/require-scopes.decorator";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import { EmbeddingProviderError } from "../llm/interfaces/embedding-provider";
import { ModelRouter } from "../llm/model-router";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import { RagAnswerService } from "../rag/rag-answer.service";
import { RagConfigurationError } from "../rag/rag.errors";
import type { KnowledgeAnswerResponseDto } from "../rag/dto/rag.dto";
import { resolveTrustedRagContext } from "../rag/trusted-rag-context";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import { VectorStoreError } from "../vector-db/vector-db.types";
import { OPENWEBUI_CHAT_SCOPE } from "./openai-compatible.constants";
import { OpenAiCompatibleRateLimitGuard } from "./openai-compatible-rate-limit.guard";
import {
  OpenAiCompatChatRequestDto,
  type OpenAiCompatChatResponse,
  type OpenAiCompatModelsResponse
} from "./dto/openai-compat.dto";

interface OpenAiCompatibleHttpResponse {
  status(code: number): OpenAiCompatibleHttpResponse;
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(chunk?: string): void;
  json(body: unknown): void;
}

/**
 * OpenAI-compatible gateway routes for Open WebUI and other
 * OpenAI-shaped clients. Phase 5 exposes GET /v1/models and
 * POST /v1/chat/completions with JSON and SSE response envelopes.
 */
@RequireScopes(OPENWEBUI_CHAT_SCOPE)
@Controller("v1")
export class OpenAiCompatibleController {
  constructor(
    private readonly config: AppConfigService,
    private readonly modelRouter: ModelRouter,
    private readonly ragAnswerService: RagAnswerService
  ) {}

  @Get("models")
  listModels(): OpenAiCompatModelsResponse {
    return {
      object: "list",
      data: this.config.rag.enabled
        ? [
            {
              id: this.config.openAiGateway.ragModelId,
              object: "model" as const,
              owned_by: "agentforce-ai-api"
            }
          ]
        : []
    };
  }

  @UseGuards(OpenAiCompatibleRateLimitGuard)
  @HttpCode(200)
  @Post("chat/completions")
  async chatCompletions(
    @Body() body: OpenAiCompatChatRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res() response: OpenAiCompatibleHttpResponse
  ): Promise<void> {
    const completion = await this.buildChatCompletion(body, request);
    response.status(200);
    if (body.stream) {
      OpenAiCompatibleController.writeSseCompletion(response, completion);
      return;
    }
    response.json(completion);
  }

  private async buildChatCompletion(
    body: OpenAiCompatChatRequestDto,
    request: AuthenticatedRequest
  ): Promise<OpenAiCompatChatResponse> {
    OpenAiCompatibleController.validateCompatibleOptions(body);

    if (body.model === this.config.openAiGateway.ragModelId) {
      return this.ragChatCompletions(body, request);
    }

    const providerName = OpenAiCompatibleController.detectProvider(
      body.model,
      this.modelRouter.availableProviders
    );

    const llmRequest: LlmChatRequest = {
      provider: providerName,
      model: body.model,
      messages: body.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {})
      })),
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
      temperature: body.temperature,
      requestId: OpenAiCompatibleController.gatewayRequestId()
    };

    const response = await this.modelRouter.chat(llmRequest).catch((err) => {
      throw this.toClientError(err, "openai-compatible.chat");
    });
    const id = response.metadata.responseId ?? `chatcmpl-${randomUUID()}`;

    return {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: response.metadata.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: response.content },
          finish_reason: response.finishReason ?? "stop"
        }
      ],
      usage: {
        prompt_tokens: response.usage.inputTokens,
        completion_tokens: response.usage.outputTokens,
        total_tokens: response.usage.totalTokens
      }
    };
  }

  private static writeSseCompletion(
    response: OpenAiCompatibleHttpResponse,
    completion: OpenAiCompatChatResponse
  ): void {
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    const baseChunk = {
      id: completion.id,
      object: "chat.completion.chunk" as const,
      created: completion.created,
      model: completion.model
    };
    OpenAiCompatibleController.writeSseData(response, {
      ...baseChunk,
      choices: [
        {
          index: 0,
          delta: { role: "assistant" },
          finish_reason: null
        }
      ]
    });
    OpenAiCompatibleController.writeSseData(response, {
      ...baseChunk,
      choices: [
        {
          index: 0,
          delta: { content: completion.choices[0]?.message.content ?? "" },
          finish_reason: null
        }
      ]
    });
    OpenAiCompatibleController.writeSseData(response, {
      ...baseChunk,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: completion.usage
    });
    response.write("data: [DONE]\n\n");
    response.end();
  }

  private static writeSseData(
    response: OpenAiCompatibleHttpResponse,
    payload: unknown
  ): void {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private async ragChatCompletions(
    body: OpenAiCompatChatRequestDto,
    request: AuthenticatedRequest
  ): Promise<OpenAiCompatChatResponse> {
    const question = OpenAiCompatibleController.latestUserQuestion(body);
    const context = resolveTrustedRagContext(
      request.authPrincipal,
      undefined,
      this.config
    );

    const ragResponse = await this.ragAnswerService
      .answer(
        {
          question,
          contextSummary: OpenAiCompatibleController.contextSummary(body),
          requestId: OpenAiCompatibleController.gatewayRequestId()
        },
        context
      )
      .catch((err) => {
        throw this.toClientError(err, "openai-compatible.knowledge-rag");
      });

    return {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.config.openAiGateway.ragModelId,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: OpenAiCompatibleController.formatRagAnswer(ragResponse)
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: ragResponse.usage?.inputTokens ?? 0,
        completion_tokens: ragResponse.usage?.outputTokens ?? 0,
        total_tokens: ragResponse.usage?.totalTokens ?? 0
      }
    };
  }

  private static gatewayRequestId(): string {
    return `openwebui-${randomUUID()}`;
  }

  private static validateCompatibleOptions(
    body: OpenAiCompatChatRequestDto
  ): void {
    const stop = body.stop;
    if (
      stop !== undefined &&
      typeof stop !== "string" &&
      (!Array.isArray(stop) ||
        !stop.every((value) => typeof value === "string"))
    ) {
      throw new BadRequestException({
        error: "unsupported_openai_compatible_option",
        option: "stop",
        message: "stop must be a string or an array of strings."
      });
    }

    if ((body.tools?.length ?? 0) > 0) {
      throw new BadRequestException({
        error: "unsupported_openai_compatible_option",
        option: "tools",
        message: "Tool calling is not enabled for the Open WebUI gateway."
      });
    }

    if (
      body.tool_choice !== undefined &&
      body.tool_choice !== "auto" &&
      body.tool_choice !== "none"
    ) {
      throw new BadRequestException({
        error: "unsupported_openai_compatible_option",
        option: "tool_choice",
        message: "Tool calling is not enabled for the Open WebUI gateway."
      });
    }

    if (
      body.response_format &&
      body.response_format.type !== undefined &&
      body.response_format.type !== "text"
    ) {
      throw new BadRequestException({
        error: "unsupported_openai_compatible_option",
        option: "response_format",
        message: "Only text responses are enabled for the Open WebUI gateway."
      });
    }
  }

  private static latestUserQuestion(body: OpenAiCompatChatRequestDto): string {
    const latestUserMessage = body.messages
      .slice()
      .reverse()
      .find((message) => message.role === "user");
    const question = latestUserMessage?.content.trim();
    if (!question) {
      throw new BadRequestException(
        "Knowledge RAG chat completions require at least one user message."
      );
    }
    return redactSensitiveText(question).slice(0, 1000);
  }

  private static contextSummary(body: OpenAiCompatChatRequestDto): string {
    let latestUserIndex = -1;
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      if (body.messages[index]?.role === "user") {
        latestUserIndex = index;
        break;
      }
    }
    const priorMessages = body.messages
      .slice(0, latestUserIndex < 0 ? body.messages.length : latestUserIndex)
      .filter((message) => ["user", "assistant"].includes(message.role))
      .map((message) => `${message.role}: ${message.content.trim()}`)
      .filter((line) => line.length > 0);
    return redactSensitiveText(priorMessages.join("\n")).slice(0, 2000);
  }

  private static formatRagAnswer(response: KnowledgeAnswerResponseDto): string {
    if (response.sourceCount === 0) {
      return response.answer;
    }
    const sourceLines = response.sources.map((source) => {
      const location = source.url ?? source.salesforceRecordRef ?? "no-url";
      return `- ${source.title} (${source.sourceId}, version ${source.documentVersion}, chunk ${source.chunkId}, retrieval ${source.retrievalId}, ${location})`;
    });
    return `${response.answer}\n\nSources:\n${sourceLines.join("\n")}`;
  }

  private toClientError(err: unknown, scope: string): Error {
    if (err instanceof RagConfigurationError) {
      return new ServiceUnavailableException({
        error: "rag_not_configured",
        message: err.message
      });
    }
    if (err instanceof LlmProviderError) {
      return new ServiceUnavailableException({
        error: "provider_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    if (err instanceof EmbeddingProviderError) {
      return new ServiceUnavailableException({
        error: "embedding_provider_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    if (err instanceof VectorStoreError) {
      return new ServiceUnavailableException({
        error: "vector_store_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    return err instanceof Error
      ? err
      : new Error(`Unknown ${scope} gateway error`);
  }

  private static detectProvider(
    model: string,
    available: string[]
  ): string | undefined {
    if (available.length === 0) {
      throw new ServiceUnavailableException("No LLM providers are configured.");
    }
    if (available.includes(model)) {
      return model;
    }
    return undefined;
  }
}

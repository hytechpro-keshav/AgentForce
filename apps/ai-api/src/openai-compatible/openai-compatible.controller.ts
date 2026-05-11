import {
  Body,
  Controller,
  Get,
  Post,
  ServiceUnavailableException
} from "@nestjs/common";
import { randomUUID } from "crypto";

import { ModelRouter } from "../llm/model-router";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import {
  OpenAiCompatChatRequestDto,
  type OpenAiCompatChatResponse,
  type OpenAiCompatModelsResponse
} from "./dto/openai-compat.dto";

/**
 * OpenAI-compatible gateway routes for Open WebUI and other
 * OpenAI-shaped clients. Phase 2 implements GET /v1/models and
 * POST /v1/chat/completions in non-streaming mode only.
 */
@Controller("v1")
export class OpenAiCompatibleController {
  constructor(private readonly modelRouter: ModelRouter) {}

  @Get("models")
  listModels(): OpenAiCompatModelsResponse {
    const models = this.modelRouter.listAllModels();
    return {
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model" as const,
        owned_by: m.provider
      }))
    };
  }

  @Post("chat/completions")
  async chatCompletions(
    @Body() body: OpenAiCompatChatRequestDto
  ): Promise<OpenAiCompatChatResponse> {
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
      maxTokens: body.max_tokens,
      temperature: body.temperature,
      requestId: body.user
    };

    const response = await this.modelRouter.chat(llmRequest);
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

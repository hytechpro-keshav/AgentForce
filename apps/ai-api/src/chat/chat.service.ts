import { Injectable } from "@nestjs/common";

import { ModelRouter } from "../llm/model-router";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import type {
  ChatMessageRequestDto,
  ChatMessageResponseDto
} from "./dto/chat-message.dto";

@Injectable()
export class ChatService {
  constructor(private readonly modelRouter: ModelRouter) {}

  async handleMessage(
    request: ChatMessageRequestDto
  ): Promise<ChatMessageResponseDto> {
    const llmRequest: LlmChatRequest = {
      provider: request.provider,
      model: request.model,
      maxTokens: request.maxTokens,
      requestId: request.requestId,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content
      }))
    };

    const response = await this.modelRouter.chat(llmRequest);
    return {
      content: response.content,
      finishReason: response.finishReason,
      usage: response.usage,
      provider: response.metadata.provider,
      model: response.metadata.model,
      fallbackUsed: response.metadata.fallbackUsed,
      attemptedProviders: response.metadata.attemptedProviders,
      latencyMs: response.metadata.latencyMs,
      responseId: response.metadata.responseId
    };
  }
}

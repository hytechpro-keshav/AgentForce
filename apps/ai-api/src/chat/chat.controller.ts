import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post
} from "@nestjs/common";

import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { ChatService } from "./chat.service";
import {
  ChatMessageRequestDto,
  type ChatMessageResponseDto
} from "./dto/chat-message.dto";
import { RequireScopes } from "../auth/require-scopes.decorator";

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  @RequireScopes("chat:write")
  @Post("message")
  async postMessage(
    @Body() body: ChatMessageRequestDto
  ): Promise<ChatMessageResponseDto> {
    try {
      return await this.chatService.handleMessage(body);
    } catch (err) {
      if (err instanceof LlmProviderError) {
        this.logger.warn(
          `chat.message provider error: provider=${err.provider} kind=${err.kind}`
        );
        // Validation/auth/safety failures stay as 4xx; everything else
        // is surfaced as a generic 502-style provider failure.
        if (err.kind === "validation") {
          throw new BadRequestException({
            error: "provider_validation_failed",
            provider: err.provider
          });
        }
        throw new BadRequestException({
          error: "provider_unavailable",
          provider: err.provider,
          kind: err.kind
        });
      }
      throw err;
    }
  }
}

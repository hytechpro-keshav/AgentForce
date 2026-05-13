import { BadRequestException, Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import { ModelRouter } from "../llm/model-router";
import type {
  LlmChatChunk,
  LlmChatRequest
} from "../llm/interfaces/llm-contracts";
import type { KnowledgeAnswerResponseDto } from "../rag/dto/rag.dto";
import { RagAnswerService } from "../rag/rag-answer.service";
import { resolveTrustedRagContext } from "../rag/trusted-rag-context";
import type {
  ChatMessageRequestDto,
  ChatMessageResponseDto
} from "./dto/chat-message.dto";

@Injectable()
export class ChatService {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly ragAnswerService: RagAnswerService,
    private readonly config: AppConfigService
  ) {}

  async handleMessage(
    request: ChatMessageRequestDto,
    principal?: AuthPrincipal
  ): Promise<ChatMessageResponseDto> {
    if (ChatService.shouldUseCustomerKnowledge(request, principal)) {
      const response = await this.answerCustomerKnowledge(request, principal);
      return ChatService.toChatMessageResponse(response);
    }

    const llmRequest = ChatService.toLlmRequest(request, principal);

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

  streamMessage(
    request: ChatMessageRequestDto,
    principal?: AuthPrincipal
  ): AsyncIterable<LlmChatChunk> {
    if (ChatService.shouldUseCustomerKnowledge(request, principal)) {
      return this.streamCustomerKnowledge(request, principal);
    }

    return this.modelRouter.chatStream(
      ChatService.toLlmRequest(request, principal)
    );
  }

  private async answerCustomerKnowledge(
    request: ChatMessageRequestDto,
    principal: AuthPrincipal | undefined
  ): Promise<KnowledgeAnswerResponseDto> {
    const context = resolveTrustedRagContext(principal, undefined, this.config);
    return this.ragAnswerService.answer(
      {
        question: ChatService.latestUserQuestion(request),
        contextSummary: ChatService.contextSummary(request),
        requestId: request.requestId
      },
      context,
      { useCase: "customer_chat" }
    );
  }

  private async *streamCustomerKnowledge(
    request: ChatMessageRequestDto,
    principal: AuthPrincipal | undefined
  ): AsyncIterable<LlmChatChunk> {
    const response = await this.answerCustomerKnowledge(request, principal);
    for (const delta of ChatService.chunkText(
      ChatService.formatCustomerKnowledgeAnswer(response)
    )) {
      yield { kind: "text", delta };
    }
    yield {
      kind: "done",
      finishReason: "stop",
      usage: response.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      metadata: {
        provider: response.provider ?? "knowledge-rag",
        model: response.model ?? "knowledge-rag",
        latencyMs: response.latencyMs,
        fallbackUsed: response.fallbackUsed,
        attemptedProviders: response.provider ? [response.provider] : []
      }
    };
  }

  private static shouldUseCustomerKnowledge(
    request: ChatMessageRequestDto,
    principal?: AuthPrincipal
  ): boolean {
    return (
      principal?.scopes.includes("chat:write") === true &&
      !principal.scopes.includes("chat:diagnostic")
    );
  }

  private static latestUserQuestion(request: ChatMessageRequestDto): string {
    const latestUserMessage = request.messages
      .slice()
      .reverse()
      .find((message) => message.role === "user");
    const question = latestUserMessage?.content.trim();
    if (!question) {
      throw new BadRequestException(
        "Customer chat requires at least one user message."
      );
    }
    return question.slice(0, 1000);
  }

  private static contextSummary(request: ChatMessageRequestDto): string {
    let latestUserIndex = -1;
    for (let index = request.messages.length - 1; index >= 0; index -= 1) {
      if (request.messages[index]?.role === "user") {
        latestUserIndex = index;
        break;
      }
    }
    return request.messages
      .slice(0, latestUserIndex < 0 ? request.messages.length : latestUserIndex)
      .filter((message) => ["user", "assistant"].includes(message.role))
      .map((message) => `${message.role}: ${message.content.trim()}`)
      .filter((line) => line.length > 0)
      .join("\n")
      .slice(0, 2000);
  }

  private static toChatMessageResponse(
    response: KnowledgeAnswerResponseDto
  ): ChatMessageResponseDto {
    const provider = response.provider ?? "knowledge-rag";
    return {
      content: ChatService.formatCustomerKnowledgeAnswer(response),
      finishReason: "stop",
      usage: response.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      provider,
      model: response.model ?? "knowledge-rag",
      fallbackUsed: response.fallbackUsed,
      attemptedProviders: provider === "knowledge-rag" ? [] : [provider],
      latencyMs: response.latencyMs,
      responseId: response.requestId
    };
  }

  private static formatCustomerKnowledgeAnswer(
    response: KnowledgeAnswerResponseDto
  ): string {
    const answer = ChatService.stripInternalSourceDetails(
      response.answer,
      response
    );
    if (response.sourceCount === 0) {
      return answer;
    }

    const sourceLines = response.sources.map((source) => {
      if (source.url) {
        return `- [${source.title}](${source.url})`;
      }
      return `- ${source.title}`;
    });
    return `${answer}\n\n**Sources**\n${sourceLines.join("\n")}`;
  }

  private static stripInternalSourceDetails(
    answer: string,
    response: KnowledgeAnswerResponseDto
  ): string {
    let safeAnswer = answer.replace(/\n+Sources:\n[\s\S]*$/i, "").trim();
    for (const source of response.sources) {
      safeAnswer = safeAnswer
        .split(source.sourceId)
        .join(source.title)
        .split(source.chunkId)
        .join("")
        .split(source.retrievalId)
        .join("")
        .split(source.documentVersion)
        .join("");
      if (source.salesforceRecordRef) {
        safeAnswer = safeAnswer.split(source.salesforceRecordRef).join("");
      }
    }
    return safeAnswer
      .replace(/\n?\s*\(Source:\s*[^)]*\)\s*/gi, "\n")
      .replace(/\n?\s*\(Sources?:\s*[^)]*\)\s*/gi, "\n")
      .replace(/sourceId=\S+/gi, "")
      .replace(/chunkId=\S+/gi, "")
      .replace(/retrieval=\S+/gi, "")
      .replace(/\b[A-Za-z0-9_.:-]+::chunk-\d+\b/g, "")
      .replace(/\(\s*Source:\s*\)/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  private static chunkText(content: string): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < content.length; index += 120) {
      chunks.push(content.slice(index, index + 120));
    }
    return chunks.length > 0 ? chunks : [content];
  }

  private static toLlmRequest(
    request: ChatMessageRequestDto,
    principal?: AuthPrincipal
  ): LlmChatRequest {
    return {
      provider: request.provider,
      model: request.model,
      maxTokens: request.maxTokens,
      requestId: request.requestId,
      useCase: "customer_chat",
      tenantId: principal?.tenantId,
      clientId: principal?.tenantId ?? principal?.subject,
      surface: "customer_chat",
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content
      }))
    };
  }
}

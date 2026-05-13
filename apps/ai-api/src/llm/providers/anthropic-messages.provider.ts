import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmModelDescriptor
} from "../interfaces/llm-contracts";
import { LlmProviderError, type LlmProvider } from "../interfaces/llm-provider";

interface AnthropicMessagePayload {
  id?: string;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface AnthropicHttpClient {
  fetch: typeof fetch;
}

interface AnthropicProviderOptions {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  http?: AnthropicHttpClient;
}

export class AnthropicMessagesProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.fetchImpl = options.http?.fetch ?? globalThis.fetch;
  }

  listModels(): LlmModelDescriptor[] {
    return [
      {
        id: this.defaultModel,
        provider: this.name,
        displayName: this.defaultModel
      }
    ];
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const model = request.model ?? this.defaultModel;
    const startedAt = Date.now();
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const body = {
      model,
      max_tokens: request.maxTokens ?? 1024,
      ...(system ? { system } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      messages: request.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        }))
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.apiKey
        },
        body: JSON.stringify(body)
      });
    } catch (cause) {
      throw new LlmProviderError(
        this.name,
        "retryable",
        "Network error contacting Anthropic provider.",
        cause
      );
    }

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new LlmProviderError(
        this.name,
        AnthropicMessagesProvider.classifyHttpStatus(response.status),
        `Anthropic provider returned HTTP ${response.status}.`
      );
    }

    let payload: AnthropicMessagePayload;
    try {
      payload = (await response.json()) as AnthropicMessagePayload;
    } catch (cause) {
      throw new LlmProviderError(
        this.name,
        "unknown",
        "Anthropic provider returned a non-JSON response.",
        cause
      );
    }

    const content = (payload.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;
    return {
      content,
      finishReason: payload.stop_reason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      metadata: {
        provider: this.name,
        model,
        responseId: payload.id,
        latencyMs,
        fallbackUsed: false,
        attemptedProviders: [this.name]
      }
    };
  }

  private static classifyHttpStatus(status: number) {
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limit";
    if (status >= 400 && status < 500) return "validation";
    if (status >= 500) return "fallbackable";
    return "unknown";
  }
}

@Injectable()
export class AnthropicProviderFactory {
  constructor(private readonly config: AppConfigService) {}

  createAnthropic(): AnthropicMessagesProvider | undefined {
    const cfg = this.config.anthropic;
    if (!cfg) return undefined;
    return new AnthropicMessagesProvider({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.defaultModel
    });
  }
}

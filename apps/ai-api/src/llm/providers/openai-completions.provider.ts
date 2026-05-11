import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmModelDescriptor
} from "../interfaces/llm-contracts";
import { LlmProviderError, type LlmProvider } from "../interfaces/llm-provider";

interface OpenAiChatChoice {
  finish_reason?: string;
  message?: { role?: string; content?: string };
}

interface OpenAiChatPayload {
  id?: string;
  choices?: OpenAiChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAiHttpClient {
  fetch: typeof fetch;
}

interface OpenAiProviderOptions {
  name?: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  http?: OpenAiHttpClient;
}

/**
 * Generic OpenAI Chat Completions provider. Used both for the
 * production OpenAI provider and the OpenAI-compatible self-hosted
 * provider. Streaming is intentionally out of scope for this slice.
 */
export class OpenAiCompletionsProvider implements LlmProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;

  constructor(options: OpenAiProviderOptions) {
    this.name = options.name ?? "openai";
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.fetchImpl = options.http?.fetch ?? globalThis.fetch;
    this.logger = new Logger(`LlmProvider:${this.name}`);

    if (!this.fetchImpl) {
      throw new Error(
        "Global fetch is not available; provide an http.fetch implementation."
      );
    }
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
    const body = {
      model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {})
      })),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens !== undefined
        ? { max_tokens: request.maxTokens }
        : {})
    };

    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.apiKey) {
      headers["authorization"] = `Bearer ${this.apiKey}`;
    }

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    } catch (cause) {
      throw new LlmProviderError(
        this.name,
        "retryable",
        `Network error contacting ${this.name}`,
        cause
      );
    }

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const kind = OpenAiCompletionsProvider.classifyHttpStatus(
        response.status
      );
      const safeText = await OpenAiCompletionsProvider.safeReadText(response);
      throw new LlmProviderError(
        this.name,
        kind,
        `Provider ${this.name} returned HTTP ${response.status}: ${safeText.slice(0, 200)}`
      );
    }

    let payload: OpenAiChatPayload;
    try {
      payload = (await response.json()) as OpenAiChatPayload;
    } catch (cause) {
      throw new LlmProviderError(
        this.name,
        "unknown",
        `Provider ${this.name} returned a non-JSON response`,
        cause
      );
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content ?? "";
    return {
      content,
      finishReason: choice?.finish_reason,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens:
          payload.usage?.total_tokens ??
          (payload.usage?.prompt_tokens ?? 0) +
            (payload.usage?.completion_tokens ?? 0)
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

  private static classifyHttpStatus(
    status: number
  ):
    | "auth"
    | "rate_limit"
    | "validation"
    | "fallbackable"
    | "retryable"
    | "unknown" {
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limit";
    if (status >= 400 && status < 500) return "validation";
    if (status >= 500) return "fallbackable";
    return "unknown";
  }

  private static async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return "<unreadable>";
    }
  }
}

@Injectable()
export class OpenAiProviderFactory {
  constructor(private readonly config: AppConfigService) {}

  createOpenAi(): OpenAiCompletionsProvider | undefined {
    const cfg = this.config.openAi;
    if (!cfg) {
      return undefined;
    }
    return new OpenAiCompletionsProvider({
      name: "openai",
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.defaultModel
    });
  }

  createOpenAiCompatible(): OpenAiCompletionsProvider | undefined {
    const cfg = this.config.openAiCompatible;
    if (!cfg) {
      return undefined;
    }
    return new OpenAiCompletionsProvider({
      name: "openai-compatible",
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.defaultModel
    });
  }
}

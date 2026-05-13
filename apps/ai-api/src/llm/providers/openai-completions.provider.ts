import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import type {
  LlmChatChunk,
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

interface OpenAiStreamChunk {
  id?: string;
  choices?: Array<{
    index?: number;
    delta?: { role?: string; content?: string };
    finish_reason?: string | null;
  }>;
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
  authHeader?: "bearer" | "api-key" | "none";
  chatCompletionsPath?: string;
  queryParams?: Record<string, string>;
  includeModelInBody?: boolean;
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
  private readonly authHeader: "bearer" | "api-key" | "none";
  private readonly chatCompletionsPath: string;
  private readonly queryParams: Record<string, string>;
  private readonly includeModelInBody: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;

  constructor(options: OpenAiProviderOptions) {
    this.name = options.name ?? "openai";
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.authHeader = options.authHeader ?? "bearer";
    this.chatCompletionsPath =
      options.chatCompletionsPath ?? "/chat/completions";
    this.queryParams = options.queryParams ?? {};
    this.includeModelInBody = options.includeModelInBody ?? true;
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
      ...(this.includeModelInBody ? { model } : {}),
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

    const url = this.chatCompletionsUrl();
    const headers = this.headers({ accept: undefined });

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
      throw new LlmProviderError(
        this.name,
        kind,
        `Provider ${this.name} returned HTTP ${response.status}.`
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

  async *chatStream(request: LlmChatRequest): AsyncIterable<LlmChatChunk> {
    const model = request.model ?? this.defaultModel;
    const body = {
      ...(this.includeModelInBody ? { model } : {}),
      stream: true,
      stream_options: { include_usage: true },
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

    const url = this.chatCompletionsUrl();
    const headers = this.headers({ accept: "text/event-stream" });

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

    if (!response.ok) {
      const kind = OpenAiCompletionsProvider.classifyHttpStatus(
        response.status
      );
      throw new LlmProviderError(
        this.name,
        kind,
        `Provider ${this.name} returned HTTP ${response.status}.`
      );
    }

    if (!response.body) {
      throw new LlmProviderError(
        this.name,
        "unknown",
        `Provider ${this.name} streaming response had no body`
      );
    }

    let responseId: string | undefined;
    let finishReason: string | undefined;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    const decoder = new TextDecoder();
    let buffer = "";
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          separatorIndex = buffer.indexOf("\n\n");

          const dataLines = rawEvent
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const data = dataLines.join("\n");
          if (data === "[DONE]") {
            continue;
          }
          let parsed: OpenAiStreamChunk;
          try {
            parsed = JSON.parse(data) as OpenAiStreamChunk;
          } catch {
            continue;
          }
          if (parsed.id) responseId = parsed.id;
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
            completionTokens =
              parsed.usage.completion_tokens ?? completionTokens;
            totalTokens = parsed.usage.total_tokens ?? totalTokens;
          }
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            yield { kind: "text", delta };
          }
        }
      }
    } catch (cause) {
      throw new LlmProviderError(
        this.name,
        "retryable",
        `Provider ${this.name} stream interrupted`,
        cause
      );
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    if (totalTokens === 0) {
      totalTokens = promptTokens + completionTokens;
    }

    yield {
      kind: "done",
      finishReason,
      usage: {
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        totalTokens
      },
      metadata: {
        provider: this.name,
        model,
        responseId,
        latencyMs: Date.now() - startedAt,
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

  private chatCompletionsUrl(): string {
    const path = this.chatCompletionsPath.startsWith("/")
      ? this.chatCompletionsPath
      : `/${this.chatCompletionsPath}`;
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(this.queryParams)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private headers(options: { accept?: string }): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (options.accept) {
      headers.accept = options.accept;
    }
    if (this.apiKey && this.authHeader === "bearer") {
      headers.authorization = `Bearer ${this.apiKey}`;
    } else if (this.apiKey && this.authHeader === "api-key") {
      headers["api-key"] = this.apiKey;
    }
    return headers;
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
    return this.createOpenAiCompatibleProviders()[0];
  }

  createOpenAiCompatibleProviders(): OpenAiCompletionsProvider[] {
    return this.config.openAiCompatibleProviders.map(
      (cfg) =>
        new OpenAiCompletionsProvider({
          name: cfg.name,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          defaultModel: cfg.defaultModel
        })
    );
  }

  createAzureOpenAi(): OpenAiCompletionsProvider | undefined {
    const cfg = this.config.azureOpenAi;
    if (!cfg) {
      return undefined;
    }
    return new OpenAiCompletionsProvider({
      name: "azure-openai",
      apiKey: cfg.apiKey,
      baseUrl: cfg.endpoint,
      defaultModel: cfg.defaultModel,
      authHeader: "api-key",
      chatCompletionsPath: `/openai/deployments/${encodeURIComponent(
        cfg.deployment
      )}/chat/completions`,
      queryParams: { "api-version": cfg.apiVersion },
      includeModelInBody: false
    });
  }
}

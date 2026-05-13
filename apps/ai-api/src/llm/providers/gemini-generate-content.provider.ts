import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmModelDescriptor
} from "../interfaces/llm-contracts";
import { LlmProviderError, type LlmProvider } from "../interfaces/llm-provider";

interface GeminiGenerateContentPayload {
  responseId?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface GeminiHttpClient {
  fetch: typeof fetch;
}

interface GeminiProviderOptions {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  http?: GeminiHttpClient;
}

export class GeminiGenerateContentProvider implements LlmProvider {
  readonly name = "gemini";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions) {
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
    const systemText = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const body = {
      ...(systemText
        ? { systemInstruction: { parts: [{ text: systemText }] } }
        : {}),
      ...(request.temperature !== undefined || request.maxTokens !== undefined
        ? {
            generationConfig: {
              ...(request.temperature !== undefined
                ? { temperature: request.temperature }
                : {}),
              ...(request.maxTokens !== undefined
                ? { maxOutputTokens: request.maxTokens }
                : {})
            }
          }
        : {}),
      contents: request.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }]
        }))
    };

    const url = new URL(
      `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`
    );

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify(body)
      });
    } catch (cause) {
      throw new LlmProviderError(
        this.name,
        "retryable",
        "Network error contacting Gemini provider.",
        cause
      );
    }

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new LlmProviderError(
        this.name,
        GeminiGenerateContentProvider.classifyHttpStatus(response.status),
        `Gemini provider returned HTTP ${response.status}.`
      );
    }

    let payload: GeminiGenerateContentPayload;
    try {
      payload = (await response.json()) as GeminiGenerateContentPayload;
    } catch (cause) {
      throw new LlmProviderError(
        this.name,
        "unknown",
        "Gemini provider returned a non-JSON response.",
        cause
      );
    }

    const candidate = payload.candidates?.[0];
    const content = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    const inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      content,
      finishReason: candidate?.finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          payload.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens
      },
      metadata: {
        provider: this.name,
        model,
        responseId: payload.responseId,
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
export class GeminiProviderFactory {
  constructor(private readonly config: AppConfigService) {}

  createGemini(): GeminiGenerateContentProvider | undefined {
    const cfg = this.config.gemini;
    if (!cfg) return undefined;
    return new GeminiGenerateContentProvider({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.defaultModel
    });
  }
}

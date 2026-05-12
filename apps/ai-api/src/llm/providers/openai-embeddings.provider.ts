import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse
} from "../interfaces/embedding-provider";
import { EmbeddingProviderError } from "../interfaces/embedding-provider";

interface OpenAiEmbeddingPayload {
  data?: Array<{ embedding?: number[] }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAiEmbeddingErrorPayload {
  error?: {
    type?: string;
    code?: string | null;
  };
}

export interface OpenAiEmbeddingHttpClient {
  fetch: typeof fetch;
}

interface OpenAiEmbeddingsProviderOptions {
  name?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  http?: OpenAiEmbeddingHttpClient;
}

export class OpenAiEmbeddingsProvider implements EmbeddingProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiEmbeddingsProviderOptions) {
    this.name = options.name ?? "openai";
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.fetchImpl = options.http?.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error(
        "Global fetch is not available; provide an http.fetch implementation."
      );
    }
  }

  async embedDocuments(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (request.texts.length === 0) {
      throw new EmbeddingProviderError(
        this.name,
        "validation",
        "At least one text is required for embedding."
      );
    }

    const model = request.model ?? this.model;
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ model, input: request.texts })
      });
    } catch (cause) {
      throw new EmbeddingProviderError(
        this.name,
        "retryable",
        `Network error contacting ${this.name} embeddings`,
        cause
      );
    }

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const errorPayload =
        await OpenAiEmbeddingsProvider.safeErrorPayload(response);
      const errorCode = errorPayload.error?.code ?? undefined;
      throw new EmbeddingProviderError(
        this.name,
        OpenAiEmbeddingsProvider.classifyHttpFailure(
          response.status,
          errorCode,
          errorPayload.error?.type
        ),
        `Embedding provider ${this.name} returned HTTP ${response.status}${errorCode ? ` (${errorCode})` : ""}`
      );
    }

    let payload: OpenAiEmbeddingPayload;
    try {
      payload = (await response.json()) as OpenAiEmbeddingPayload;
    } catch (cause) {
      throw new EmbeddingProviderError(
        this.name,
        "unknown",
        `Embedding provider ${this.name} returned a non-JSON response`,
        cause
      );
    }

    const embeddings = payload.data?.map((item) => item.embedding ?? []) ?? [];
    if (
      embeddings.length !== request.texts.length ||
      embeddings.some((item) => item.length === 0)
    ) {
      throw new EmbeddingProviderError(
        this.name,
        "unknown",
        `Embedding provider ${this.name} returned an unexpected embedding shape.`
      );
    }

    return {
      embeddings,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        totalTokens: payload.usage?.total_tokens
      },
      metadata: {
        provider: this.name,
        model,
        dimensions: embeddings[0]?.length ?? 0,
        latencyMs
      }
    };
  }

  private static async safeErrorPayload(
    response: Response
  ): Promise<OpenAiEmbeddingErrorPayload> {
    try {
      return (await response.json()) as OpenAiEmbeddingErrorPayload;
    } catch {
      return {};
    }
  }

  private static classifyHttpFailure(
    status: number,
    errorCode?: string,
    errorType?: string
  ): "auth" | "rate_limit" | "validation" | "fallbackable" | "unknown" {
    if (
      errorCode === "model_not_found" ||
      errorType === "invalid_request_error"
    ) {
      return "validation";
    }
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limit";
    if (status >= 400 && status < 500) return "validation";
    if (status >= 500) return "fallbackable";
    return "unknown";
  }
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = "deterministic";
  private readonly dimensions = 32;

  async embedDocuments(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const startedAt = Date.now();
    const embeddings = request.texts.map((text) => this.embedOne(text));
    const approximateTokens = request.texts.reduce(
      (total, text) => total + Math.ceil(text.length / 4),
      0
    );
    return {
      embeddings,
      usage: {
        inputTokens: approximateTokens,
        totalTokens: approximateTokens
      },
      metadata: {
        provider: this.name,
        model: "deterministic-local-test",
        dimensions: this.dimensions,
        latencyMs: Date.now() - startedAt
      }
    };
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const token of tokens) {
      const index =
        Math.abs(DeterministicEmbeddingProvider.hash(token)) % this.dimensions;
      vector[index] += 1;
    }
    const norm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0)
    );
    return norm > 0 ? vector.map((value) => value / norm) : vector;
  }

  private static hash(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return hash;
  }
}

@Injectable()
export class EmbeddingProviderFactory {
  constructor(private readonly config: AppConfigService) {}

  createOpenAi(): OpenAiEmbeddingsProvider | undefined {
    const cfg = this.config.rag.openAiEmbedding;
    if (!cfg) {
      return undefined;
    }
    return new OpenAiEmbeddingsProvider({
      name: "openai",
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model
    });
  }

  createDeterministic(): DeterministicEmbeddingProvider | undefined {
    if (this.config.productionLike) {
      return undefined;
    }
    return new DeterministicEmbeddingProvider();
  }
}

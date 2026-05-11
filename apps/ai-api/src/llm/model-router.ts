import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmModelDescriptor
} from "./interfaces/llm-contracts";
import { LlmProviderError, type LlmProvider } from "./interfaces/llm-provider";
import { TelemetryService } from "../observability/telemetry.service";
import { redactLlmChatRequest } from "../security/sensitive-data-redactor";

export const LLM_PROVIDERS = Symbol("LLM_PROVIDERS");

@Injectable()
export class ModelRouter {
  private readonly logger = new Logger(ModelRouter.name);
  private readonly providers: Map<string, LlmProvider>;

  constructor(
    @Inject(LLM_PROVIDERS) providers: LlmProvider[],
    private readonly config: AppConfigService,
    private readonly telemetry: TelemetryService
  ) {
    this.providers = new Map(providers.map((p) => [p.name, p]));
  }

  getProvider(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  listAllModels(): LlmModelDescriptor[] {
    const models: LlmModelDescriptor[] = [];
    for (const provider of this.providers.values()) {
      models.push(...provider.listModels());
    }
    return models;
  }

  get availableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Routes a chat request to the configured provider chain. Errors
   * classified as fallbackable trigger the next provider in the
   * chain. All telemetry is fail-safe and never breaks the call.
   */
  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const chain = this.resolveChain(request.provider);
    if (chain.length === 0) {
      throw new LlmProviderError(
        "model-router",
        "validation",
        "No LLM providers are configured. Set OPENAI_API_KEY or OPENAI_COMPAT_BASE_URL."
      );
    }

    const attempted: string[] = [];
    let lastError: unknown;
    const safeRequest = redactLlmChatRequest(request);

    for (const provider of chain) {
      attempted.push(provider.name);
      try {
        const response = await provider.chat(safeRequest);
        const fallbackUsed = attempted.length > 1;
        const merged: LlmChatResponse = {
          ...response,
          metadata: {
            ...response.metadata,
            fallbackUsed,
            attemptedProviders: attempted
          }
        };
        this.telemetry.recordChatCompletion({
          provider: provider.name,
          model: merged.metadata.model,
          latencyMs: merged.metadata.latencyMs,
          inputTokens: merged.usage.inputTokens,
          outputTokens: merged.usage.outputTokens,
          totalTokens: merged.usage.totalTokens,
          requestId: safeRequest.requestId,
          fallbackUsed,
          attemptedProviders: attempted,
          outcome: "success"
        });
        return merged;
      } catch (err) {
        lastError = err;
        const isFallbackable =
          err instanceof LlmProviderError && err.isFallbackable;
        this.telemetry.recordChatCompletion({
          provider: provider.name,
          model: safeRequest.model,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestId: safeRequest.requestId,
          fallbackUsed: false,
          attemptedProviders: attempted,
          outcome: isFallbackable ? "fallback" : "error",
          errorKind: err instanceof LlmProviderError ? err.kind : "unknown"
        });
        if (!isFallbackable) {
          throw err;
        }
        const kind = err instanceof LlmProviderError ? err.kind : "unknown";
        this.logger.warn(
          `Provider ${provider.name} failed with ${kind}; trying fallback`
        );
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new LlmProviderError(
      "model-router",
      "unknown",
      "All providers failed without a classified error."
    );
  }

  private resolveChain(requestedProvider?: string): LlmProvider[] {
    if (requestedProvider) {
      const explicit = this.providers.get(requestedProvider);
      return explicit ? [explicit] : [];
    }

    const chain: LlmProvider[] = [];
    const seen = new Set<string>();
    const enqueue = (name: string | undefined): void => {
      if (!name || seen.has(name)) return;
      const provider = this.providers.get(name);
      if (!provider) return;
      chain.push(provider);
      seen.add(name);
    };

    enqueue(this.config.defaultProvider);
    enqueue(this.config.fallbackProvider);
    return chain;
  }
}

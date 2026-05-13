import { Inject, Injectable, Logger } from "@nestjs/common";

import type {
  LlmChatChunk,
  LlmChatRequest,
  LlmChatResponse,
  LlmModelDescriptor
} from "./interfaces/llm-contracts";
import { LlmProviderError, type LlmProvider } from "./interfaces/llm-provider";
import {
  ModelRoutingPolicyService,
  type ResolvedModelRoute
} from "./model-routing-policy.service";
import { TelemetryService } from "../observability/telemetry.service";
import { redactLlmChatRequest } from "../security/sensitive-data-redactor";

export const LLM_PROVIDERS = Symbol("LLM_PROVIDERS");

@Injectable()
export class ModelRouter {
  private readonly logger = new Logger(ModelRouter.name);
  private readonly providers: Map<string, LlmProvider>;

  constructor(
    @Inject(LLM_PROVIDERS) providers: LlmProvider[],
    private readonly routingPolicy: ModelRoutingPolicyService,
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
    const route = this.resolveRoute(request, false);
    const chain = this.resolveProviderChainOrThrow(route, request);
    this.reserveBudgetOrThrow(route, request);
    if (chain.length === 0) {
      throw new LlmProviderError(
        "model-router",
        "validation",
        "No LLM providers are configured for the resolved route."
      );
    }

    const attempted: string[] = [];
    let lastError: unknown;
    const safeRequest = redactLlmChatRequest({
      ...request,
      maxTokens: route.maxTokens ?? request.maxTokens
    });

    for (const { provider, target } of chain) {
      attempted.push(provider.name);
      try {
        const response = await provider.chat({
          ...safeRequest,
          provider: provider.name,
          model: target.model,
          maxTokens: route.maxTokens ?? safeRequest.maxTokens
        });
        const fallbackUsed = attempted.length > 1;
        const merged: LlmChatResponse = {
          ...response,
          metadata: {
            ...response.metadata,
            fallbackUsed,
            attemptedProviders: attempted,
            useCase: route.useCase,
            routingRule: route.routingRule,
            modelTier: route.modelTier,
            budgetKey: route.budgetKey
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
          useCase: route.useCase,
          routingRule: route.routingRule,
          modelTier: route.modelTier,
          budgetKey: route.budgetKey,
          estimatedInputTokens: route.estimatedInputTokens,
          reservedTokens: route.reservedTokens,
          budgetOutcome: "allowed",
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
          fallbackUsed: attempted.length > 1,
          attemptedProviders: attempted,
          useCase: route.useCase,
          routingRule: route.routingRule,
          modelTier: route.modelTier,
          budgetKey: route.budgetKey,
          estimatedInputTokens: route.estimatedInputTokens,
          reservedTokens: route.reservedTokens,
          budgetOutcome: "allowed",
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

  /**
   * Streaming variant of {@link chat}. Routes to the first provider
   * in the configured chain that implements `chatStream`. Errors
   * raised before the first chunk are eligible for fallback; once a
   * chunk has been emitted the stream is committed and downstream
   * errors are propagated to the caller.
   */
  async *chatStream(request: LlmChatRequest): AsyncIterable<LlmChatChunk> {
    const route = this.resolveRoute(request, false);
    const chain = this.resolveProviderChainOrThrow(route, request);
    this.validateStreamingChainOrThrow(route, request, chain);
    this.reserveBudgetOrThrow(route, request);
    if (chain.length === 0) {
      throw new LlmProviderError(
        "model-router",
        "validation",
        "No streaming-capable LLM providers are configured."
      );
    }

    const attempted: string[] = [];
    const safeRequest = redactLlmChatRequest({
      ...request,
      maxTokens: route.maxTokens ?? request.maxTokens
    });
    let lastError: unknown;

    for (const { provider, target } of chain) {
      attempted.push(provider.name);
      let opened = false;
      let completed = false;
      let recorded = false;
      const startedAt = Date.now();
      let iterator: AsyncIterator<LlmChatChunk> | undefined;
      let doneMetadata:
        | { latencyMs: number; usage: LlmChatResponse["usage"]; model: string }
        | undefined;
      try {
        const iterable = provider.chatStream!({
          ...safeRequest,
          provider: provider.name,
          model: target.model,
          maxTokens: route.maxTokens ?? safeRequest.maxTokens
        });
        iterator = iterable[Symbol.asyncIterator]();
        while (true) {
          const { value, done } = await iterator.next();
          if (done) break;
          opened = true;
          if (value.kind === "done") {
            doneMetadata = {
              latencyMs: value.metadata.latencyMs,
              usage: value.usage,
              model: value.metadata.model
            };
            yield {
              kind: "done",
              finishReason: value.finishReason,
              usage: value.usage,
              metadata: {
                ...value.metadata,
                fallbackUsed: attempted.length > 1,
                attemptedProviders: [...attempted],
                useCase: route.useCase,
                routingRule: route.routingRule,
                modelTier: route.modelTier,
                budgetKey: route.budgetKey
              }
            };
          } else {
            yield value;
          }
        }
        this.telemetry.recordChatCompletion({
          provider: provider.name,
          model: doneMetadata?.model ?? safeRequest.model,
          latencyMs: doneMetadata?.latencyMs ?? 0,
          inputTokens: doneMetadata?.usage.inputTokens ?? 0,
          outputTokens: doneMetadata?.usage.outputTokens ?? 0,
          totalTokens: doneMetadata?.usage.totalTokens ?? 0,
          requestId: safeRequest.requestId,
          fallbackUsed: attempted.length > 1,
          attemptedProviders: [...attempted],
          useCase: route.useCase,
          routingRule: route.routingRule,
          modelTier: route.modelTier,
          budgetKey: route.budgetKey,
          estimatedInputTokens: route.estimatedInputTokens,
          reservedTokens: route.reservedTokens,
          budgetOutcome: "allowed",
          outcome: "success"
        });
        completed = true;
        recorded = true;
        return;
      } catch (err) {
        lastError = err;
        const isFallbackable =
          err instanceof LlmProviderError && err.isFallbackable;
        const errorKind =
          err instanceof LlmProviderError ? err.kind : "unknown";
        this.telemetry.recordChatCompletion({
          provider: provider.name,
          model: safeRequest.model,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestId: safeRequest.requestId,
          fallbackUsed: attempted.length > 1,
          attemptedProviders: [...attempted],
          useCase: route.useCase,
          routingRule: route.routingRule,
          modelTier: route.modelTier,
          budgetKey: route.budgetKey,
          estimatedInputTokens: route.estimatedInputTokens,
          reservedTokens: route.reservedTokens,
          budgetOutcome: "allowed",
          outcome: opened ? "error" : isFallbackable ? "fallback" : "error",
          errorKind
        });
        recorded = true;
        if (opened || !isFallbackable) {
          throw err;
        }
        this.logger.warn(
          `Streaming provider ${provider.name} failed with ${errorKind}; trying fallback`
        );
      } finally {
        if (!recorded && opened) {
          this.telemetry.recordChatCompletion({
            provider: provider.name,
            model: doneMetadata?.model ?? target.model ?? safeRequest.model,
            latencyMs: Date.now() - startedAt,
            inputTokens: doneMetadata?.usage.inputTokens ?? 0,
            outputTokens: doneMetadata?.usage.outputTokens ?? 0,
            totalTokens: doneMetadata?.usage.totalTokens ?? 0,
            requestId: safeRequest.requestId,
            fallbackUsed: attempted.length > 1,
            attemptedProviders: [...attempted],
            useCase: route.useCase,
            routingRule: route.routingRule,
            modelTier: route.modelTier,
            budgetKey: route.budgetKey,
            estimatedInputTokens: route.estimatedInputTokens,
            reservedTokens: route.reservedTokens,
            budgetOutcome: "allowed",
            outcome: "error",
            errorKind: "aborted"
          });
        }
        if (!completed) {
          await iterator?.return?.();
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new LlmProviderError(
      "model-router",
      "unknown",
      "All streaming providers failed without a classified error."
    );
  }

  describeRoute(request: LlmChatRequest): ResolvedModelRoute {
    return this.resolveRoute(request, false);
  }

  private resolveRoute(
    request: LlmChatRequest,
    reserveBudget: boolean
  ): ResolvedModelRoute {
    try {
      return this.routingPolicy.resolve(request, { reserveBudget });
    } catch (err) {
      if (err instanceof LlmProviderError) {
        this.telemetry.recordChatCompletion({
          provider: "model-router",
          model: request.model,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestId: request.requestId,
          fallbackUsed: false,
          attemptedProviders: [],
          useCase: request.useCase ?? "generic_chat",
          budgetOutcome: err.kind === "budget" ? "rejected" : undefined,
          outcome: "error",
          errorKind: err.kind
        });
      }
      throw err;
    }
  }

  private reserveBudgetOrThrow(
    route: ResolvedModelRoute,
    request: LlmChatRequest
  ): void {
    try {
      this.routingPolicy.reserve(route);
    } catch (err) {
      this.recordRouteError(route, request, err, "rejected");
      throw err;
    }
  }

  private resolveProviderChainOrThrow(
    route: ResolvedModelRoute,
    request: LlmChatRequest
  ): Array<{
    provider: LlmProvider;
    target: { provider: string; model?: string };
  }> {
    try {
      return this.resolveProviderChain(route);
    } catch (err) {
      this.recordRouteError(route, request, err, undefined);
      throw err;
    }
  }

  private validateStreamingChainOrThrow(
    route: ResolvedModelRoute,
    request: LlmChatRequest,
    chain: Array<{
      provider: LlmProvider;
      target: { provider: string; model?: string };
    }>
  ): void {
    for (const { provider, target } of chain) {
      if (typeof provider.chatStream === "function") {
        continue;
      }
      const error = new LlmProviderError(
        provider.name,
        "validation",
        `Provider ${provider.name} does not support streaming routes.`
      );
      this.telemetry.recordChatCompletion({
        provider: provider.name,
        model: target.model ?? request.model,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestId: request.requestId,
        fallbackUsed: false,
        attemptedProviders: [],
        useCase: route.useCase,
        routingRule: route.routingRule,
        modelTier: route.modelTier,
        budgetKey: route.budgetKey,
        estimatedInputTokens: route.estimatedInputTokens,
        reservedTokens: route.reservedTokens,
        outcome: "error",
        errorKind: error.kind
      });
      throw error;
    }
  }

  private recordRouteError(
    route: ResolvedModelRoute,
    request: LlmChatRequest,
    err: unknown,
    budgetOutcome: "rejected" | undefined
  ): void {
    this.telemetry.recordChatCompletion({
      provider: err instanceof LlmProviderError ? err.provider : "model-router",
      model: request.model ?? route.target.model,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestId: request.requestId,
      fallbackUsed: false,
      attemptedProviders: [],
      useCase: route.useCase,
      routingRule: route.routingRule,
      modelTier: route.modelTier,
      budgetKey: route.budgetKey,
      estimatedInputTokens: route.estimatedInputTokens,
      reservedTokens: route.reservedTokens,
      budgetOutcome,
      outcome: "error",
      errorKind: err instanceof LlmProviderError ? err.kind : "unknown"
    });
  }
  private resolveProviderChain(route: ResolvedModelRoute): Array<{
    provider: LlmProvider;
    target: { provider: string; model?: string };
  }> {
    const chain: Array<{
      provider: LlmProvider;
      target: { provider: string; model?: string };
    }> = [];
    for (const target of route.attempts) {
      const provider = this.providers.get(target.provider);
      if (!provider) {
        throw new LlmProviderError(
          target.provider,
          "validation",
          `Resolved provider ${target.provider} is not configured.`
        );
      }
      chain.push({ provider, target });
    }
    return chain;
  }
}

import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";

import {
  AppConfigService,
  type LlmModelTargetConfig,
  type LlmRouteConfig,
  type LlmTokenBudgetConfig
} from "../config/app-config.service";
import type { LlmChatRequest, LlmUseCase } from "./interfaces/llm-contracts";
import { LlmProviderError } from "./interfaces/llm-provider";

export type ModelTier = "default" | "small" | "override";

export interface ResolvedModelRoute {
  useCase: LlmUseCase;
  routingRule: string;
  modelTier: ModelTier;
  attempts: LlmModelTargetConfig[];
  target: LlmModelTargetConfig;
  budget: LlmTokenBudgetConfig;
  budgetKey: string;
  estimatedInputTokens: number;
  reservedTokens: number;
  maxTokens?: number;
  routingFingerprint: string;
}

interface RollingBudgetWindow {
  startedAt: number;
  tokens: number;
}

@Injectable()
export class ModelRoutingPolicyService {
  private readonly rollingWindows = new Map<string, RollingBudgetWindow>();

  constructor(private readonly config: AppConfigService) {}

  resolve(
    request: LlmChatRequest,
    options: { reserveBudget?: boolean } = {}
  ): ResolvedModelRoute {
    const useCase = request.useCase ?? "generic_chat";
    const route =
      this.config.modelRouting.routes[useCase] ??
      this.config.modelRouting.routes.generic_chat;
    const estimatedInputTokens =
      ModelRoutingPolicyService.estimateInputTokens(request);
    const totalMessageChars = request.messages.reduce(
      (total, message) => total + message.content.length,
      0
    );

    let modelTier: ModelTier = "default";
    let target: LlmModelTargetConfig = {
      provider: route.provider,
      model: route.model
    };

    if (
      ModelRoutingPolicyService.shouldUseSmallModel(
        request,
        route,
        estimatedInputTokens,
        totalMessageChars
      )
    ) {
      target = {
        provider: route.smallModel!.provider,
        model: route.smallModel!.model
      };
      modelTier = "small";
    }

    if (request.provider) {
      this.assertProviderOverrideAllowed(route, request.provider);
      target = { ...target, provider: request.provider };
      modelTier = "override";
    }
    if (request.model) {
      this.assertModelOverrideAllowed(route, request.model);
      target = { ...target, model: request.model };
      modelTier = "override";
    }

    const budget = route.budget;
    const maxTokens = this.resolveMaxTokens(
      request,
      budget,
      estimatedInputTokens
    );
    const budgetKey = ModelRoutingPolicyService.buildBudgetKey(
      request,
      useCase
    );
    const reservedTokens =
      estimatedInputTokens + (maxTokens ?? request.maxTokens ?? 0);

    if (options.reserveBudget) {
      this.enforceBudget({
        budget,
        budgetKey,
        estimatedInputTokens,
        maxTokens,
        requestedMaxTokens: request.maxTokens,
        reservedTokens
      });
    }

    const attempts = ModelRoutingPolicyService.buildAttempts(
      target,
      route,
      Boolean(request.provider)
    );
    const routingRule = `${useCase}:${modelTier}`;
    const routingFingerprint = ModelRoutingPolicyService.hashJson({
      useCase,
      routingRule,
      target,
      fallbacks: request.provider ? [] : route.fallbacks,
      budget,
      allowProviderOverride: route.allowProviderOverride,
      allowModelOverride: route.allowModelOverride
    });

    return {
      useCase,
      routingRule,
      modelTier,
      attempts,
      target,
      budget,
      budgetKey,
      estimatedInputTokens,
      reservedTokens,
      maxTokens,
      routingFingerprint
    };
  }

  private assertProviderOverrideAllowed(
    route: LlmRouteConfig,
    provider: string
  ): void {
    if (!route.allowProviderOverride) {
      throw new LlmProviderError(
        "model-router",
        "validation",
        "Provider overrides are disabled for this route."
      );
    }
    if (route.allowedProviders && !route.allowedProviders.includes(provider)) {
      throw new LlmProviderError(
        "model-router",
        "validation",
        "Provider override is not allowed for this route."
      );
    }
  }

  private assertModelOverrideAllowed(
    route: LlmRouteConfig,
    model: string
  ): void {
    if (!route.allowModelOverride) {
      throw new LlmProviderError(
        "model-router",
        "validation",
        "Model overrides are disabled for this route."
      );
    }
    if (route.allowedModels && !route.allowedModels.includes(model)) {
      throw new LlmProviderError(
        "model-router",
        "validation",
        "Model override is not allowed for this route."
      );
    }
  }

  private resolveMaxTokens(
    request: LlmChatRequest,
    budget: LlmTokenBudgetConfig,
    estimatedInputTokens: number
  ): number | undefined {
    const outputLimit = budget.maxOutputTokensPerRequest;
    const totalLimit = budget.maxTotalTokensPerRequest;
    if (budget.maxInputTokensPerRequest !== undefined) {
      if (estimatedInputTokens > budget.maxInputTokensPerRequest) {
        throw new LlmProviderError(
          "model-router",
          "budget",
          "Estimated input tokens exceed the route budget."
        );
      }
    }
    if (request.maxTokens !== undefined && outputLimit !== undefined) {
      if (request.maxTokens > outputLimit) {
        throw new LlmProviderError(
          "model-router",
          "budget",
          "Requested max tokens exceed the route output budget."
        );
      }
    }

    let maxTokens = request.maxTokens ?? outputLimit;
    if (totalLimit !== undefined) {
      const remaining = totalLimit - estimatedInputTokens;
      if (remaining < 1) {
        throw new LlmProviderError(
          "model-router",
          "budget",
          "Estimated input tokens leave no generation budget for this route."
        );
      }
      if (request.maxTokens !== undefined && request.maxTokens > remaining) {
        throw new LlmProviderError(
          "model-router",
          "budget",
          "Requested max tokens exceed the route total-token budget."
        );
      }
      maxTokens = Math.min(maxTokens ?? remaining, remaining);
    }
    return maxTokens;
  }

  private enforceBudget(input: {
    budget: LlmTokenBudgetConfig;
    budgetKey: string;
    estimatedInputTokens: number;
    maxTokens?: number;
    requestedMaxTokens?: number;
    reservedTokens: number;
  }): void {
    const { budget, budgetKey, reservedTokens } = input;
    if (budget.maxTokensPerMinute === undefined) {
      return;
    }
    const now = Date.now();
    const current = this.rollingWindows.get(budgetKey);
    const window =
      current && now - current.startedAt < 60000
        ? current
        : { startedAt: now, tokens: 0 };
    if (window.tokens + reservedTokens > budget.maxTokensPerMinute) {
      throw new LlmProviderError(
        "model-router",
        "budget",
        "The in-memory route token budget is exhausted for this minute."
      );
    }
    window.tokens += reservedTokens;
    this.rollingWindows.set(budgetKey, window);
  }

  private static shouldUseSmallModel(
    request: LlmChatRequest,
    route: LlmRouteConfig,
    estimatedInputTokens: number,
    totalMessageChars: number
  ): boolean {
    if (!route.smallModel) return false;
    if (request.complexity === "complex") return false;
    if (request.complexity === "simple") return true;
    const maxInputTokens = route.smallModel.maxInputTokens ?? 1000;
    const maxMessages = route.smallModel.maxMessages ?? 8;
    const maxTotalMessageChars = route.smallModel.maxTotalMessageChars ?? 4000;
    return (
      estimatedInputTokens <= maxInputTokens &&
      request.messages.length <= maxMessages &&
      totalMessageChars <= maxTotalMessageChars
    );
  }

  reserve(route: ResolvedModelRoute): void {
    this.enforceBudget({
      budget: route.budget,
      budgetKey: route.budgetKey,
      estimatedInputTokens: route.estimatedInputTokens,
      maxTokens: route.maxTokens,
      reservedTokens: route.reservedTokens
    });
  }

  private static buildAttempts(
    target: LlmModelTargetConfig,
    route: LlmRouteConfig,
    explicitProvider: boolean
  ): LlmModelTargetConfig[] {
    const attempts = explicitProvider ? [target] : [target, ...route.fallbacks];
    const seen = new Set<string>();
    return attempts.filter((attempt) => {
      const key = `${attempt.provider}:${attempt.model ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private static estimateInputTokens(request: LlmChatRequest): number {
    const messageChars = request.messages.reduce(
      (total, message) => total + message.content.length,
      0
    );
    return Math.max(
      1,
      Math.ceil(messageChars / 4) + request.messages.length * 4
    );
  }

  private static buildBudgetKey(
    request: LlmChatRequest,
    useCase: LlmUseCase
  ): string {
    const clientReference = request.clientId ?? request.tenantId ?? "anonymous";
    return `${useCase}:${ModelRoutingPolicyService.hashString(clientReference)}`;
  }

  private static hashJson(value: unknown): string {
    return ModelRoutingPolicyService.hashString(JSON.stringify(value));
  }

  private static hashString(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
  }
}

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";

interface ModelPricingReference {
  provider: string;
  modelPattern: RegExp;
  inputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
  source: string;
}

const MODEL_PRICING_REFERENCES: ModelPricingReference[] = [
  {
    provider: "openai",
    modelPattern: /^gpt-4o-mini(?:$|-)/i,
    inputUsdPer1MTokens: 0.15,
    outputUsdPer1MTokens: 0.6,
    source: "static_openai_reference_2026_05"
  }
];

export type LlmCallOutcome = "success" | "fallback" | "error";

export interface ChatCompletionTelemetry {
  provider: string;
  model?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestId?: string;
  fallbackUsed: boolean;
  attemptedProviders: string[];
  outcome: LlmCallOutcome;
  errorKind?: string;
}

/**
 * Lightweight, no-op-safe telemetry sink for the AI API.
 *
 * Phase 2 emits structured JSON records via Nest's Logger so they
 * land in Railway logs. A future OpenTelemetry exporter can replace
 * the implementation without changing call sites.
 *
 * Telemetry must NEVER throw and must NEVER block the request path.
 * Raw prompts, completions, secrets, and PII are intentionally
 * excluded from these records.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger("ai.telemetry");
  private readonly enabled: boolean;

  constructor(config: AppConfigService) {
    this.enabled = config.telemetryEnabled;
  }

  recordChatCompletion(event: ChatCompletionTelemetry): void {
    if (!this.enabled) {
      return;
    }
    try {
      const costReference = TelemetryService.buildCostReference(event);
      this.logger.log({
        // OpenTelemetry gen_ai.* aligned attribute names.
        event: "gen_ai.client.operation",
        "gen_ai.operation.name": "chat",
        "gen_ai.system": event.provider,
        "gen_ai.request.model": event.model,
        "gen_ai.usage.input_tokens": event.inputTokens,
        "gen_ai.usage.output_tokens": event.outputTokens,
        "gen_ai.usage.total_tokens": event.totalTokens,
        "gen_ai.client.latency_ms": event.latencyMs,
        "gen_ai.response.outcome": event.outcome,
        "gen_ai.response.error_kind": event.errorKind,
        "gen_ai.router.fallback_used": event.fallbackUsed,
        "gen_ai.router.attempted_providers": event.attemptedProviders,
        request_id: event.requestId,
        ...costReference
      });
    } catch {
      // Telemetry must never break a request. Swallow intentionally.
    }
  }

  private static buildCostReference(
    event: ChatCompletionTelemetry
  ): Record<string, number | string> {
    const pricing = TelemetryService.findPricingReference(
      event.provider,
      event.model
    );

    if (!pricing) {
      return {};
    }

    const inputCostUsd =
      (event.inputTokens / 1_000_000) * pricing.inputUsdPer1MTokens;
    const outputCostUsd =
      (event.outputTokens / 1_000_000) * pricing.outputUsdPer1MTokens;
    const totalCostUsd = inputCostUsd + outputCostUsd;

    return {
      "gen_ai.pricing.source": pricing.source,
      "gen_ai.pricing.input_usd_per_1m_tokens": pricing.inputUsdPer1MTokens,
      "gen_ai.pricing.output_usd_per_1m_tokens": pricing.outputUsdPer1MTokens,
      "gen_ai.usage.input_cost_usd_estimate":
        TelemetryService.roundUsd(inputCostUsd),
      "gen_ai.usage.output_cost_usd_estimate":
        TelemetryService.roundUsd(outputCostUsd),
      "gen_ai.usage.total_cost_usd_estimate":
        TelemetryService.roundUsd(totalCostUsd)
    };
  }

  private static findPricingReference(
    provider: string,
    model?: string
  ): ModelPricingReference | undefined {
    if (!model) {
      return undefined;
    }

    return MODEL_PRICING_REFERENCES.find(
      (candidate) =>
        candidate.provider === provider && candidate.modelPattern.test(model)
    );
  }

  private static roundUsd(value: number): number {
    return Math.round(value * 100_000_000) / 100_000_000;
  }
}

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";

interface ModelPricingReference {
  provider: string;
  model?: string;
  modelPattern?: RegExp;
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
export type AiWorkflowOutcome = "success" | "error";

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
  useCase?: string;
  routingRule?: string;
  modelTier?: string;
  budgetKey?: string;
  estimatedInputTokens?: number;
  reservedTokens?: number;
  budgetOutcome?: "allowed" | "rejected";
  outcome: LlmCallOutcome;
  errorKind?: string;
}

export interface EmbeddingTelemetry {
  provider: string;
  model?: string;
  requestId?: string;
  inputCount: number;
  inputTokens?: number;
  totalTokens?: number;
  cacheHitCount?: number;
  cacheMissCount?: number;
  latencyMs: number;
  outcome: AiWorkflowOutcome;
  errorKind?: string;
}

export interface RagWorkflowTelemetry {
  operation: "ingest" | "retrieve" | "answer";
  requestId?: string;
  retrievalId?: string;
  tenantId?: string;
  namespace?: string;
  sourceIds?: string[];
  chunkIds?: string[];
  sourceVersions?: string[];
  provider?: string;
  model?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  vectorDbProvider?: string;
  topK?: number;
  scoreThreshold?: number;
  documentsReceived?: number;
  chunksIndexed?: number;
  retrievedCount?: number;
  returnedCount?: number;
  accessFilteredCount?: number;
  emptyRetrieval?: boolean;
  fallbackReason?: string;
  cacheHit?: boolean;
  cacheKeyHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  embeddingInputTokens?: number;
  embeddingTotalTokens?: number;
  ingestLatencyMs?: number;
  embeddingLatencyMs?: number;
  retrievalLatencyMs?: number;
  generationLatencyMs?: number;
  totalLatencyMs: number;
  outcome: AiWorkflowOutcome;
  errorKind?: string;
}

export interface AgentWorkflowTelemetry {
  operation: string;
  requestId?: string;
  tenantId?: string;
  useCase?: string;
  provider?: string;
  model?: string;
  latencyMs: number;
  fallbackUsed?: boolean;
  narrativeFallbackUsed?: boolean;
  decisionFallbackUsed?: boolean;
  healthStatus?: string;
  riskLevel?: string;
  accountHealthBand?: string;
  churnRiskLevel?: string;
  expansionLevel?: string;
  deliveryRiskLevel?: string;
  financialRiskLevel?: string;
  supportRiskLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  outcome: AiWorkflowOutcome;
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
  private readonly pricingReferences: ModelPricingReference[];

  constructor(config: AppConfigService) {
    this.enabled = config.telemetryEnabled;
    this.pricingReferences = [
      ...MODEL_PRICING_REFERENCES,
      ...(config.modelRouting?.pricing ?? []).map((pricing) => ({
        provider: pricing.provider,
        model: pricing.model,
        inputUsdPer1MTokens: pricing.inputUsdPer1MTokens,
        outputUsdPer1MTokens: pricing.outputUsdPer1MTokens,
        source: pricing.source
      }))
    ];
  }

  recordChatCompletion(event: ChatCompletionTelemetry): void {
    if (!this.enabled) {
      return;
    }
    try {
      const costReference = this.buildCostReference(event);
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
        "gen_ai.router.use_case": event.useCase,
        "gen_ai.router.rule": event.routingRule,
        "gen_ai.router.model_tier": event.modelTier,
        "gen_ai.budget.key": event.budgetKey,
        "gen_ai.budget.estimated_input_tokens": event.estimatedInputTokens,
        "gen_ai.budget.reserved_tokens": event.reservedTokens,
        "gen_ai.budget.outcome": event.budgetOutcome,
        request_id: event.requestId,
        ...costReference
      });
    } catch {
      // Telemetry must never break a request. Swallow intentionally.
    }
  }

  recordEmbedding(event: EmbeddingTelemetry): void {
    if (!this.enabled) {
      return;
    }
    try {
      this.logger.log({
        event: "gen_ai.client.operation",
        "gen_ai.operation.name": "embedding",
        "gen_ai.system": event.provider,
        "gen_ai.request.model": event.model,
        "gen_ai.embedding.input_count": event.inputCount,
        "gen_ai.embedding.input_tokens": event.inputTokens,
        "gen_ai.embedding.total_tokens": event.totalTokens,
        "gen_ai.embedding.cache_hit_count": event.cacheHitCount,
        "gen_ai.embedding.cache_miss_count": event.cacheMissCount,
        "gen_ai.client.latency_ms": event.latencyMs,
        "gen_ai.response.outcome": event.outcome,
        "gen_ai.response.error_kind": event.errorKind,
        request_id: event.requestId
      });
    } catch {
      // Telemetry must never break a request. Swallow intentionally.
    }
  }

  recordRagWorkflow(event: RagWorkflowTelemetry): void {
    if (!this.enabled) {
      return;
    }
    try {
      this.logger.log({
        event: "gen_ai.workflow.operation",
        "gen_ai.operation.name": `rag.${event.operation}`,
        "gen_ai.system": event.provider,
        "gen_ai.request.model": event.model,
        "gen_ai.embedding.provider": event.embeddingProvider,
        "gen_ai.embedding.model": event.embeddingModel,
        "gen_ai.vector.provider": event.vectorDbProvider,
        "gen_ai.rag.tenant_id": event.tenantId,
        "gen_ai.rag.namespace": event.namespace,
        "gen_ai.rag.retrieval_id": event.retrievalId,
        "gen_ai.rag.source_ids": event.sourceIds,
        "gen_ai.rag.chunk_ids": event.chunkIds,
        "gen_ai.rag.source_versions": event.sourceVersions,
        "gen_ai.rag.top_k": event.topK,
        "gen_ai.rag.score_threshold": event.scoreThreshold,
        "gen_ai.rag.documents_received": event.documentsReceived,
        "gen_ai.rag.chunks_indexed": event.chunksIndexed,
        "gen_ai.rag.retrieved_count": event.retrievedCount,
        "gen_ai.rag.returned_count": event.returnedCount,
        "gen_ai.rag.access_filtered_count": event.accessFilteredCount,
        "gen_ai.rag.empty_retrieval": event.emptyRetrieval,
        "gen_ai.rag.fallback_reason": event.fallbackReason,
        "gen_ai.rag.cache_hit": event.cacheHit,
        "gen_ai.rag.cache_key_hash": event.cacheKeyHash,
        "gen_ai.embedding.input_tokens": event.embeddingInputTokens,
        "gen_ai.embedding.total_tokens": event.embeddingTotalTokens,
        "gen_ai.usage.input_tokens": event.inputTokens,
        "gen_ai.usage.output_tokens": event.outputTokens,
        "gen_ai.usage.total_tokens": event.totalTokens,
        "gen_ai.latency.ingest_ms": event.ingestLatencyMs,
        "gen_ai.latency.embedding_ms": event.embeddingLatencyMs,
        "gen_ai.latency.retrieval_ms": event.retrievalLatencyMs,
        "gen_ai.latency.generation_ms": event.generationLatencyMs,
        "gen_ai.latency.total_ms": event.totalLatencyMs,
        "gen_ai.response.outcome": event.outcome,
        "gen_ai.response.error_kind": event.errorKind,
        request_id: event.requestId,
        ...this.buildCostReference({
          provider: event.provider ?? "",
          model: event.model,
          latencyMs: event.generationLatencyMs ?? event.totalLatencyMs,
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
          totalTokens: event.totalTokens ?? 0,
          fallbackUsed: false,
          attemptedProviders: [],
          outcome: event.outcome === "success" ? "success" : "error"
        })
      });
    } catch {
      // Telemetry must never break a request. Swallow intentionally.
    }
  }

  recordAgentWorkflow(event: AgentWorkflowTelemetry): void {
    if (!this.enabled) {
      return;
    }
    try {
      this.logger.log({
        event: "gen_ai.workflow.operation",
        "gen_ai.operation.name": event.operation,
        "gen_ai.router.use_case": event.useCase,
        "gen_ai.system": event.provider,
        "gen_ai.request.model": event.model,
        "gen_ai.client.latency_ms": event.latencyMs,
        "gen_ai.router.fallback_used": event.fallbackUsed,
        "gen_ai.services.narrative_fallback_used": event.narrativeFallbackUsed,
        "gen_ai.revenue.decision_fallback_used": event.decisionFallbackUsed,
        "gen_ai.services.health_status": event.healthStatus,
        "gen_ai.services.risk_level": event.riskLevel,
        "gen_ai.revenue.account_health_band": event.accountHealthBand,
        "gen_ai.revenue.churn_risk_level": event.churnRiskLevel,
        "gen_ai.revenue.expansion_level": event.expansionLevel,
        "gen_ai.revenue.delivery_risk_level": event.deliveryRiskLevel,
        "gen_ai.revenue.financial_risk_level": event.financialRiskLevel,
        "gen_ai.revenue.support_risk_level": event.supportRiskLevel,
        "gen_ai.services.tenant_id": event.tenantId,
        "gen_ai.usage.input_tokens": event.inputTokens,
        "gen_ai.usage.output_tokens": event.outputTokens,
        "gen_ai.usage.total_tokens": event.totalTokens,
        "gen_ai.response.outcome": event.outcome,
        "gen_ai.response.error_kind": event.errorKind,
        request_id: event.requestId,
        ...this.buildCostReference({
          provider: event.provider ?? "",
          model: event.model,
          latencyMs: event.latencyMs,
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
          totalTokens: event.totalTokens ?? 0,
          fallbackUsed: Boolean(event.fallbackUsed),
          attemptedProviders: [],
          useCase: event.useCase,
          outcome: event.outcome === "success" ? "success" : "error"
        })
      });
    } catch {
      // Telemetry must never break a request. Swallow intentionally.
    }
  }

  private buildCostReference(
    event: ChatCompletionTelemetry
  ): Record<string, number | string> {
    const pricing = this.findPricingReference(event.provider, event.model);

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

  private findPricingReference(
    provider: string,
    model?: string
  ): ModelPricingReference | undefined {
    if (!model) {
      return undefined;
    }

    return this.pricingReferences.find(
      (candidate) =>
        candidate.provider === provider &&
        (candidate.model === model || candidate.modelPattern?.test(model))
    );
  }

  private static roundUsd(value: number): number {
    return Math.round(value * 100_000_000) / 100_000_000;
  }
}

/**
 * Shared, vendor-neutral contracts for the LLM provider abstraction.
 *
 * Agent and chat services must depend on these contracts and on
 * `ModelRouter`, never on a provider SDK directly.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

export const LLM_USE_CASES = [
  "generic_chat",
  "customer_chat",
  "customer_chat_intake",
  "openwebui_chat",
  "openwebui_rag",
  "agentforce_support_triage",
  "agentforce_case_analysis",
  "agentforce_customer_history",
  "agentforce_services_project_health",
  "agentforce_revenue_account_health",
  "agentforce_revenue_portfolio_intelligence",
  "knowledge_rag"
] as const;

export type LlmUseCase = (typeof LLM_USE_CASES)[number];
export type LlmComplexity = "simple" | "standard" | "complex";

export interface LlmMessage {
  role: LlmRole;
  content: string;
  name?: string;
}

export interface LlmChatRequest {
  /**
   * Optional logical provider name. When omitted, the `ModelRouter`
   * picks the configured default provider.
   */
  provider?: string;
  /**
   * Optional model identifier. When omitted, the provider's
   * configured default model is used.
   */
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Stable correlation id surfaced into telemetry. Never log raw
   * prompt content alongside this id.
   */
  requestId?: string;
  /**
   * Logical route key used by ModelRouter. Services provide use-case
   * metadata only; provider/model selection remains policy-driven.
   */
  useCase?: LlmUseCase;
  complexity?: LlmComplexity;
  tenantId?: string;
  clientId?: string;
  surface?: string;
}

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmProviderMetadata {
  provider: string;
  model: string;
  responseId?: string;
  latencyMs: number;
  fallbackUsed: boolean;
  attemptedProviders: string[];
  useCase?: LlmUseCase;
  routingRule?: string;
  modelTier?: "default" | "small" | "override";
  budgetKey?: string;
}

export interface LlmChatResponse {
  content: string;
  finishReason?: string;
  usage: LlmTokenUsage;
  metadata: LlmProviderMetadata;
}

export interface LlmModelDescriptor {
  id: string;
  provider: string;
  displayName?: string;
}

/**
 * Streaming chunk emitted by `LlmProvider.chatStream`. Providers
 * normalize their SDK or HTTP delta events into this shape. The
 * router and chat services depend only on this contract.
 *
 * - `text` chunks carry incremental assistant content deltas.
 * - `done` chunks carry final usage/metadata and signal completion.
 *   Exactly one `done` chunk is emitted for a successful stream.
 */
export type LlmChatChunk =
  | { kind: "text"; delta: string }
  | {
      kind: "done";
      finishReason?: string;
      usage: LlmTokenUsage;
      metadata: LlmProviderMetadata;
    };

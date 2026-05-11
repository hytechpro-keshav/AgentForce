/**
 * Shared, vendor-neutral contracts for the LLM provider abstraction.
 *
 * Agent and chat services must depend on these contracts and on
 * `ModelRouter`, never on a provider SDK directly.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

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

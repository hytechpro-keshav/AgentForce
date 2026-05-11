import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmModelDescriptor
} from "./llm-contracts";

export type LlmErrorKind =
  | "auth"
  | "validation"
  | "rate_limit"
  | "quota"
  | "safety"
  | "retryable"
  | "fallbackable"
  | "unknown";

export class LlmProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: LlmErrorKind,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "LlmProviderError";
  }

  get isFallbackable(): boolean {
    return (
      this.kind === "fallbackable" ||
      this.kind === "retryable" ||
      this.kind === "rate_limit" ||
      this.kind === "quota"
    );
  }
}

/**
 * LlmProvider is the only vendor-specific surface. Providers
 * normalize their SDK or HTTP responses into shared contracts.
 */
export interface LlmProvider {
  readonly name: string;
  listModels(): LlmModelDescriptor[];
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

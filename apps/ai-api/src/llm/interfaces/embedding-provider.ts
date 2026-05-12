export type EmbeddingErrorKind =
  | "auth"
  | "validation"
  | "rate_limit"
  | "quota"
  | "retryable"
  | "fallbackable"
  | "unknown";

export class EmbeddingProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: EmbeddingErrorKind,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
  requestId?: string;
}

export interface EmbeddingUsage {
  inputTokens?: number;
  totalTokens?: number;
}

export interface EmbeddingProviderMetadata {
  provider: string;
  model: string;
  dimensions: number;
  latencyMs: number;
  cacheHit?: boolean;
  cacheHitCount?: number;
  cacheMissCount?: number;
  normalized?: boolean;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  usage?: EmbeddingUsage;
  metadata: EmbeddingProviderMetadata;
}

export interface EmbeddingProvider {
  readonly name: string;
  embedDocuments(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

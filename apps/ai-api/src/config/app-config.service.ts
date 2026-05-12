import { Injectable } from "@nestjs/common";

export interface OpenAiProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export interface OpenAiCompatibleProviderConfig {
  apiKey?: string;
  baseUrl: string;
  defaultModel: string;
}

export interface JwtAuthConfig {
  secret?: string;
  issuer?: string;
  audience?: string;
  disabled: boolean;
}

export interface OpenAiEmbeddingProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface PineconeVectorConfig {
  apiKey: string;
  index: string;
}

export interface QdrantVectorConfig {
  url: string;
  apiKey?: string;
  collection: string;
  vectorSize: number;
  distance: "Cosine" | "Dot" | "Euclid";
}

export interface RagRuntimeConfig {
  enabled: boolean;
  defaultEmbeddingProvider: string;
  openAiEmbedding?: OpenAiEmbeddingProviderConfig;
  vectorDbProvider: string;
  pinecone?: PineconeVectorConfig;
  qdrant?: QdrantVectorConfig;
  defaultNamespace: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  scoreThreshold: number;
  embeddingCacheMaxItems: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  ingestRateLimitMaxRequests: number;
}

export interface AppRuntimeConfig {
  port: number;
  nodeEnv: string;
  agentforceHealthApiKey?: string;
  productionLike: boolean;
  openAi?: OpenAiProviderConfig;
  openAiCompatible?: OpenAiCompatibleProviderConfig;
  defaultProvider: string;
  fallbackProvider?: string;
  jwt: JwtAuthConfig;
  telemetryEnabled: boolean;
  rag: RagRuntimeConfig;
}

@Injectable()
export class AppConfigService {
  readonly port: number;
  readonly nodeEnv: string;
  readonly agentforceHealthApiKey?: string;
  readonly productionLike: boolean;
  readonly openAi?: OpenAiProviderConfig;
  readonly openAiCompatible?: OpenAiCompatibleProviderConfig;
  readonly defaultProvider: string;
  readonly fallbackProvider?: string;
  readonly jwt: JwtAuthConfig;
  readonly telemetryEnabled: boolean;
  readonly rag: RagRuntimeConfig;

  constructor() {
    const config = AppConfigService.load(process.env);
    this.port = config.port;
    this.nodeEnv = config.nodeEnv;
    this.agentforceHealthApiKey = config.agentforceHealthApiKey;
    this.productionLike = config.productionLike;
    this.openAi = config.openAi;
    this.openAiCompatible = config.openAiCompatible;
    this.defaultProvider = config.defaultProvider;
    this.fallbackProvider = config.fallbackProvider;
    this.jwt = config.jwt;
    this.telemetryEnabled = config.telemetryEnabled;
    this.rag = config.rag;
  }

  get isHealthBridgeKeyConfigured(): boolean {
    return Boolean(this.agentforceHealthApiKey);
  }

  static load(env: NodeJS.ProcessEnv): AppRuntimeConfig {
    const nodeEnv = AppConfigService.normalize(env.NODE_ENV) ?? "development";
    const productionLike =
      nodeEnv === "production" ||
      Boolean(
        AppConfigService.normalize(env.RAILWAY_ENVIRONMENT) ||
        AppConfigService.normalize(env.RAILWAY_SERVICE_ID) ||
        AppConfigService.normalize(env.RAILWAY_PROJECT_ID)
      );
    const agentforceHealthApiKey = AppConfigService.normalize(
      env.AGENTFORCE_HEALTH_API_KEY
    );

    if (productionLike && !agentforceHealthApiKey) {
      throw new Error(
        "AGENTFORCE_HEALTH_API_KEY is required for production-like ai-api deployments."
      );
    }

    const openAi = AppConfigService.loadOpenAi(env);
    const openAiCompatible = AppConfigService.loadOpenAiCompatible(env);
    const configuredDefaultProvider = AppConfigService.normalize(
      env.LLM_DEFAULT_PROVIDER
    );
    const defaultProvider = configuredDefaultProvider ?? "openai";
    const fallbackProvider = AppConfigService.normalize(
      env.LLM_FALLBACK_PROVIDER
    );

    if (productionLike && configuredDefaultProvider === "openai" && !openAi) {
      throw new Error(
        "OPENAI_API_KEY is required when LLM_DEFAULT_PROVIDER=openai in production-like deployments."
      );
    }

    const jwt = AppConfigService.loadJwt(env, productionLike);
    const telemetryEnabled =
      AppConfigService.normalize(env.AI_API_TELEMETRY_ENABLED) !== "false";
    const rag = AppConfigService.loadRag(env, productionLike, openAi);

    return {
      port: AppConfigService.parsePort(env.PORT),
      nodeEnv,
      agentforceHealthApiKey,
      productionLike,
      openAi,
      openAiCompatible,
      defaultProvider,
      fallbackProvider,
      jwt,
      telemetryEnabled,
      rag
    };
  }

  private static loadOpenAi(
    env: NodeJS.ProcessEnv
  ): OpenAiProviderConfig | undefined {
    const apiKey = AppConfigService.normalize(env.OPENAI_API_KEY);
    if (!apiKey) {
      return undefined;
    }
    return {
      apiKey,
      baseUrl:
        AppConfigService.normalize(env.OPENAI_BASE_URL) ??
        "https://api.openai.com/v1",
      defaultModel:
        AppConfigService.normalize(env.OPENAI_DEFAULT_MODEL) ?? "gpt-4o-mini"
    };
  }

  private static loadOpenAiCompatible(
    env: NodeJS.ProcessEnv
  ): OpenAiCompatibleProviderConfig | undefined {
    const baseUrl = AppConfigService.normalize(env.OPENAI_COMPAT_BASE_URL);
    if (!baseUrl) {
      return undefined;
    }
    return {
      apiKey: AppConfigService.normalize(env.OPENAI_COMPAT_API_KEY),
      baseUrl,
      defaultModel:
        AppConfigService.normalize(env.OPENAI_COMPAT_DEFAULT_MODEL) ?? "default"
    };
  }

  private static loadJwt(
    env: NodeJS.ProcessEnv,
    productionLike: boolean
  ): JwtAuthConfig {
    const disabled =
      AppConfigService.normalize(env.AI_API_AUTH_DISABLED) === "true";
    const secret = AppConfigService.normalize(env.AI_API_JWT_SECRET);

    return {
      secret,
      issuer: AppConfigService.normalize(env.AI_API_JWT_ISSUER),
      audience: AppConfigService.normalize(env.AI_API_JWT_AUDIENCE),
      disabled
    };
  }

  private static loadRag(
    env: NodeJS.ProcessEnv,
    productionLike: boolean,
    openAi: OpenAiProviderConfig | undefined
  ): RagRuntimeConfig {
    const enabled = AppConfigService.normalize(env.RAG_ENABLED) === "true";
    const defaultEmbeddingProvider =
      AppConfigService.normalize(env.DEFAULT_EMBEDDING_PROVIDER) ?? "openai";
    const vectorDbProvider =
      AppConfigService.normalize(env.VECTOR_DB_PROVIDER) ?? "qdrant";

    if (!["openai", "deterministic"].includes(defaultEmbeddingProvider)) {
      throw new Error(
        "DEFAULT_EMBEDDING_PROVIDER must be openai or deterministic."
      );
    }
    if (!["pinecone", "qdrant", "memory"].includes(vectorDbProvider)) {
      throw new Error(
        "VECTOR_DB_PROVIDER must be pinecone, qdrant, or memory."
      );
    }
    if (productionLike && enabled && defaultEmbeddingProvider !== "openai") {
      throw new Error(
        "DEFAULT_EMBEDDING_PROVIDER=openai is required when RAG is enabled in production-like deployments."
      );
    }
    if (
      productionLike &&
      enabled &&
      !["pinecone", "qdrant"].includes(vectorDbProvider)
    ) {
      throw new Error(
        "VECTOR_DB_PROVIDER must be pinecone or qdrant when RAG is enabled in production-like deployments."
      );
    }

    const chunkSize = AppConfigService.parsePositiveInteger(
      env.RAG_CHUNK_SIZE,
      900,
      "RAG_CHUNK_SIZE"
    );
    const chunkOverlap = AppConfigService.parseNonNegativeInteger(
      env.RAG_CHUNK_OVERLAP,
      120,
      "RAG_CHUNK_OVERLAP"
    );
    if (chunkOverlap >= chunkSize) {
      throw new Error("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE.");
    }

    const topK = AppConfigService.parsePositiveInteger(
      env.RAG_TOP_K,
      4,
      "RAG_TOP_K"
    );
    const scoreThreshold = AppConfigService.parseScoreThreshold(
      env.RAG_SCORE_THRESHOLD,
      0.68
    );
    const embeddingCacheMaxItems = AppConfigService.parseNonNegativeInteger(
      env.EMBEDDING_CACHE_MAX_ITEMS,
      2048,
      "EMBEDDING_CACHE_MAX_ITEMS"
    );
    const rateLimitWindowMs = AppConfigService.parsePositiveInteger(
      env.RAG_RATE_LIMIT_WINDOW_MS,
      60000,
      "RAG_RATE_LIMIT_WINDOW_MS"
    );
    const rateLimitMaxRequests = AppConfigService.parsePositiveInteger(
      env.RAG_RATE_LIMIT_MAX_REQUESTS,
      60,
      "RAG_RATE_LIMIT_MAX_REQUESTS"
    );
    const ingestRateLimitMaxRequests = AppConfigService.parsePositiveInteger(
      env.RAG_INGEST_RATE_LIMIT_MAX_REQUESTS,
      10,
      "RAG_INGEST_RATE_LIMIT_MAX_REQUESTS"
    );
    const defaultNamespace =
      AppConfigService.normalize(env.RAG_DEFAULT_NAMESPACE) ??
      AppConfigService.normalize(env.VECTOR_DB_NAMESPACE) ??
      "customer-self-service";

    const openAiEmbedding = openAi
      ? {
          apiKey: openAi.apiKey,
          baseUrl: openAi.baseUrl,
          model:
            AppConfigService.normalize(env.OPENAI_EMBEDDING_MODEL) ??
            "text-embedding-3-small"
        }
      : undefined;

    const vectorDbApiKey = AppConfigService.normalize(env.VECTOR_DB_API_KEY);
    const vectorDbIndex = AppConfigService.normalize(env.VECTOR_DB_INDEX);
    const pinecone =
      vectorDbApiKey && vectorDbIndex
        ? { apiKey: vectorDbApiKey, index: vectorDbIndex }
        : undefined;
    const qdrantUrl = AppConfigService.normalize(env.QDRANT_URL);
    const qdrantCollection =
      AppConfigService.normalize(env.QDRANT_COLLECTION) ?? vectorDbIndex;
    const qdrantVectorSize = AppConfigService.parsePositiveInteger(
      env.QDRANT_VECTOR_SIZE,
      1536,
      "QDRANT_VECTOR_SIZE"
    );
    const qdrantDistance = AppConfigService.parseQdrantDistance(
      env.QDRANT_DISTANCE
    );
    const qdrant =
      qdrantUrl && qdrantCollection
        ? {
            url: qdrantUrl,
            apiKey: AppConfigService.normalize(env.QDRANT_API_KEY),
            collection: qdrantCollection,
            vectorSize: qdrantVectorSize,
            distance: qdrantDistance
          }
        : undefined;

    if (productionLike && enabled && defaultEmbeddingProvider === "openai") {
      if (!openAiEmbedding) {
        throw new Error(
          "OPENAI_API_KEY is required for OpenAI embeddings when RAG_ENABLED=true in production-like deployments."
        );
      }
    }
    if (productionLike && enabled && vectorDbProvider === "pinecone") {
      if (!pinecone) {
        throw new Error(
          "VECTOR_DB_API_KEY and VECTOR_DB_INDEX are required when RAG_ENABLED=true with Pinecone in production-like deployments."
        );
      }
    }
    if (productionLike && enabled && vectorDbProvider === "qdrant") {
      if (!qdrant) {
        throw new Error(
          "QDRANT_URL and QDRANT_COLLECTION or VECTOR_DB_INDEX are required when RAG_ENABLED=true with Qdrant in production-like deployments."
        );
      }
    }

    return {
      enabled,
      defaultEmbeddingProvider,
      openAiEmbedding,
      vectorDbProvider,
      pinecone,
      qdrant,
      defaultNamespace,
      chunkSize,
      chunkOverlap,
      topK,
      scoreThreshold,
      embeddingCacheMaxItems,
      rateLimitWindowMs,
      rateLimitMaxRequests,
      ingestRateLimitMaxRequests
    };
  }

  private static parsePort(rawPort: string | undefined): number {
    const normalizedPort = AppConfigService.normalize(rawPort) ?? "3000";
    const port = Number(normalizedPort);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be an integer from 1 to 65535.");
    }

    return port;
  }

  private static parsePositiveInteger(
    rawValue: string | undefined,
    fallback: number,
    name: string
  ): number {
    const normalizedValue = AppConfigService.normalize(rawValue);
    if (!normalizedValue) {
      return fallback;
    }
    const value = Number(normalizedValue);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer.`);
    }
    return value;
  }

  private static parseNonNegativeInteger(
    rawValue: string | undefined,
    fallback: number,
    name: string
  ): number {
    const normalizedValue = AppConfigService.normalize(rawValue);
    if (!normalizedValue) {
      return fallback;
    }
    const value = Number(normalizedValue);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
    return value;
  }

  private static parseScoreThreshold(
    rawValue: string | undefined,
    fallback: number
  ): number {
    const normalizedValue = AppConfigService.normalize(rawValue);
    if (!normalizedValue) {
      return fallback;
    }
    const value = Number(normalizedValue);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("RAG_SCORE_THRESHOLD must be a number from 0 to 1.");
    }
    return value;
  }

  private static parseQdrantDistance(
    rawValue: string | undefined
  ): "Cosine" | "Dot" | "Euclid" {
    const normalizedValue = AppConfigService.normalize(rawValue) ?? "Cosine";
    const normalizedDistance = normalizedValue.toLowerCase();
    if (normalizedDistance === "cosine") return "Cosine";
    if (normalizedDistance === "dot") return "Dot";
    if (normalizedDistance === "euclid") return "Euclid";
    throw new Error("QDRANT_DISTANCE must be Cosine, Dot, or Euclid.");
  }

  private static normalize(value: string | undefined): string | undefined {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : undefined;
  }
}

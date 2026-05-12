import { AppConfigService } from "./app-config.service";

describe("AppConfigService", () => {
  it("defaults local development to port 3000", () => {
    expect(AppConfigService.load({}).port).toBe(3000);
  });

  it("normalizes blank health keys as missing", () => {
    const config = AppConfigService.load({ AGENTFORCE_HEALTH_API_KEY: "  " });

    expect(config.agentforceHealthApiKey).toBeUndefined();
  });

  it("rejects invalid ports", () => {
    expect(() => AppConfigService.load({ PORT: "not-a-port" })).toThrow(
      "PORT must be an integer from 1 to 65535."
    );
  });

  it("requires the health key for production-like deployments", () => {
    expect(() => AppConfigService.load({ NODE_ENV: "production" })).toThrow(
      "AGENTFORCE_HEALTH_API_KEY is required"
    );
    expect(() =>
      AppConfigService.load({ RAILWAY_ENVIRONMENT: "production" })
    ).toThrow("AGENTFORCE_HEALTH_API_KEY is required");
  });

  it("loads OpenAI provider config when OPENAI_API_KEY is present", () => {
    const config = AppConfigService.load({
      OPENAI_API_KEY: "sk-test",
      OPENAI_DEFAULT_MODEL: "gpt-4o-mini"
    });
    expect(config.openAi).toEqual({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini"
    });
  });

  it("loads the OpenAI-compatible provider config when a base URL is present", () => {
    const config = AppConfigService.load({
      OPENAI_COMPAT_BASE_URL: "https://internal.test/v1",
      OPENAI_COMPAT_DEFAULT_MODEL: "local-llm"
    });
    expect(config.openAiCompatible).toEqual({
      apiKey: undefined,
      baseUrl: "https://internal.test/v1",
      defaultModel: "local-llm"
    });
  });

  it("requires the OpenAI key when openai is default in production-like deployments", () => {
    expect(() =>
      AppConfigService.load({
        NODE_ENV: "production",
        AGENTFORCE_HEALTH_API_KEY: "x",
        LLM_DEFAULT_PROVIDER: "openai"
      })
    ).toThrow("OPENAI_API_KEY is required");
  });

  it("allows Phase 1 health-only startup when Phase 2 provider config is absent", () => {
    const config = AppConfigService.load({
      NODE_ENV: "production",
      AGENTFORCE_HEALTH_API_KEY: "x"
    });

    expect(config.openAi).toBeUndefined();
    expect(config.jwt.secret).toBeUndefined();
    expect(config.defaultProvider).toBe("openai");
  });

  it("loads AI_API_JWT_SECRET when configured for protected Phase 2 routes", () => {
    const config = AppConfigService.load({
      NODE_ENV: "production",
      AGENTFORCE_HEALTH_API_KEY: "x",
      OPENAI_API_KEY: "sk",
      AI_API_JWT_SECRET: "jwt-secret"
    });

    expect(config.jwt.secret).toBe("jwt-secret");
    expect(config.jwt.disabled).toBe(false);
  });

  it("loads RAG defaults for local staged setup without requiring secrets", () => {
    const config = AppConfigService.load({});

    expect(config.rag).toMatchObject({
      enabled: false,
      defaultEmbeddingProvider: "openai",
      vectorDbProvider: "qdrant",
      defaultNamespace: "customer-self-service",
      chunkSize: 900,
      chunkOverlap: 120,
      topK: 4,
      scoreThreshold: 0.68,
      embeddingCacheMaxItems: 2048,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 60,
      ingestRateLimitMaxRequests: 10
    });
    expect(config.openAiGateway).toEqual({
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 120,
      ragModelId: "knowledge-rag"
    });
  });

  it("loads OpenAI-compatible gateway Phase 5 settings", () => {
    const config = AppConfigService.load({
      OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS: "30000",
      OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS: "20",
      OPENAI_COMPAT_RAG_MODEL_ID: "internal-knowledge-rag"
    });

    expect(config.openAiGateway).toEqual({
      rateLimitWindowMs: 30000,
      rateLimitMaxRequests: 20,
      ragModelId: "internal-knowledge-rag"
    });
  });

  it("loads deterministic local RAG config for tests", () => {
    const config = AppConfigService.load({
      RAG_ENABLED: "true",
      DEFAULT_EMBEDDING_PROVIDER: "deterministic",
      VECTOR_DB_PROVIDER: "memory",
      RAG_DEFAULT_NAMESPACE: "phase4-test",
      RAG_CHUNK_SIZE: "400",
      RAG_CHUNK_OVERLAP: "40",
      RAG_TOP_K: "6",
      RAG_SCORE_THRESHOLD: "0.2",
      EMBEDDING_CACHE_MAX_ITEMS: "16",
      RAG_RATE_LIMIT_WINDOW_MS: "30000",
      RAG_RATE_LIMIT_MAX_REQUESTS: "20",
      RAG_INGEST_RATE_LIMIT_MAX_REQUESTS: "3"
    });

    expect(config.rag).toMatchObject({
      enabled: true,
      defaultEmbeddingProvider: "deterministic",
      vectorDbProvider: "memory",
      defaultNamespace: "phase4-test",
      chunkSize: 400,
      chunkOverlap: 40,
      topK: 6,
      scoreThreshold: 0.2,
      embeddingCacheMaxItems: 16,
      rateLimitWindowMs: 30000,
      rateLimitMaxRequests: 20,
      ingestRateLimitMaxRequests: 3
    });
  });

  it("requires production RAG to use OpenAI embeddings and an external vector DB", () => {
    expect(() =>
      AppConfigService.load({
        NODE_ENV: "production",
        AGENTFORCE_HEALTH_API_KEY: "x",
        RAG_ENABLED: "true",
        DEFAULT_EMBEDDING_PROVIDER: "deterministic",
        VECTOR_DB_PROVIDER: "memory"
      })
    ).toThrow("DEFAULT_EMBEDDING_PROVIDER=openai is required");
  });

  it("requires default Qdrant config in production when RAG is enabled", () => {
    expect(() =>
      AppConfigService.load({
        NODE_ENV: "production",
        AGENTFORCE_HEALTH_API_KEY: "x",
        RAG_ENABLED: "true",
        OPENAI_API_KEY: "sk-test"
      })
    ).toThrow(
      "QDRANT_URL and QDRANT_COLLECTION or VECTOR_DB_INDEX are required"
    );
  });

  it("requires Qdrant URL and collection in production when Qdrant RAG is enabled", () => {
    expect(() =>
      AppConfigService.load({
        NODE_ENV: "production",
        AGENTFORCE_HEALTH_API_KEY: "x",
        RAG_ENABLED: "true",
        OPENAI_API_KEY: "sk-test",
        VECTOR_DB_PROVIDER: "qdrant"
      })
    ).toThrow(
      "QDRANT_URL and QDRANT_COLLECTION or VECTOR_DB_INDEX are required"
    );
  });

  it("loads OpenAI embedding and Pinecone config when configured", () => {
    const config = AppConfigService.load({
      RAG_ENABLED: "true",
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://openai.test/v1",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
      VECTOR_DB_API_KEY: "pc-test",
      VECTOR_DB_INDEX: "knowledge-index"
    });

    expect(config.rag.openAiEmbedding).toEqual({
      apiKey: "sk-test",
      baseUrl: "https://openai.test/v1",
      model: "text-embedding-3-large"
    });
    expect(config.rag.pinecone).toEqual({
      apiKey: "pc-test",
      index: "knowledge-index"
    });
  });

  it("loads Qdrant config when configured", () => {
    const config = AppConfigService.load({
      RAG_ENABLED: "true",
      OPENAI_API_KEY: "sk-test",
      VECTOR_DB_PROVIDER: "qdrant",
      QDRANT_URL: "https://qdrant.internal",
      QDRANT_COLLECTION: "agentforce-knowledge-rag",
      QDRANT_API_KEY: "qd-test",
      QDRANT_VECTOR_SIZE: "1536",
      QDRANT_DISTANCE: "cosine"
    });

    expect(config.rag.qdrant).toEqual({
      url: "https://qdrant.internal",
      apiKey: "qd-test",
      collection: "agentforce-knowledge-rag",
      vectorSize: 1536,
      distance: "Cosine"
    });
  });

  it("rejects invalid RAG chunk and score settings", () => {
    expect(() =>
      AppConfigService.load({ RAG_CHUNK_SIZE: "100", RAG_CHUNK_OVERLAP: "100" })
    ).toThrow("RAG_CHUNK_OVERLAP must be smaller");
    expect(() => AppConfigService.load({ RAG_SCORE_THRESHOLD: "2" })).toThrow(
      "RAG_SCORE_THRESHOLD must be a number from 0 to 1."
    );
    expect(() =>
      AppConfigService.load({ EMBEDDING_CACHE_MAX_ITEMS: "-1" })
    ).toThrow("EMBEDDING_CACHE_MAX_ITEMS must be a non-negative integer.");
    expect(() =>
      AppConfigService.load({ RAG_RATE_LIMIT_WINDOW_MS: "0" })
    ).toThrow("RAG_RATE_LIMIT_WINDOW_MS must be a positive integer.");
    expect(() =>
      AppConfigService.load({ RAG_RATE_LIMIT_MAX_REQUESTS: "0" })
    ).toThrow("RAG_RATE_LIMIT_MAX_REQUESTS must be a positive integer.");
    expect(() =>
      AppConfigService.load({ RAG_INGEST_RATE_LIMIT_MAX_REQUESTS: "0" })
    ).toThrow("RAG_INGEST_RATE_LIMIT_MAX_REQUESTS must be a positive integer.");
    expect(() =>
      AppConfigService.load({
        OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS: "0"
      })
    ).toThrow(
      "OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS must be a positive integer."
    );
    expect(() =>
      AppConfigService.load({ OPENAI_COMPAT_RAG_MODEL_ID: "bad id" })
    ).toThrow("OPENAI_COMPAT_RAG_MODEL_ID must be 1 to 128");
    expect(() => AppConfigService.load({ QDRANT_DISTANCE: "bad" })).toThrow(
      "QDRANT_DISTANCE must be Cosine, Dot, or Euclid."
    );
  });
});

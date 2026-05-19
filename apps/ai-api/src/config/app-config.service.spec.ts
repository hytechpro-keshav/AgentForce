import { AppConfigService } from "./app-config.service";
import { createHash } from "crypto";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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

  it("loads Phase 7 provider configs without requiring live credentials in tests", () => {
    const config = AppConfigService.load({
      OPENAI_COMPAT_PROVIDERS_JSON: JSON.stringify([
        {
          name: "local-llama",
          baseUrl: "https://llm.internal/v1",
          defaultModel: "llama-3.1-8b"
        }
      ]),
      ANTHROPIC_API_KEY: "anthropic-test",
      ANTHROPIC_DEFAULT_MODEL: "claude-test",
      AZURE_OPENAI_API_KEY: "azure-test",
      AZURE_OPENAI_ENDPOINT: "https://azure-openai.test",
      AZURE_OPENAI_CHAT_DEPLOYMENT: "support-chat",
      GEMINI_API_KEY: "gemini-test",
      GEMINI_DEFAULT_MODEL: "gemini-test"
    });

    expect(config.openAiCompatibleProviders).toEqual([
      {
        name: "local-llama",
        baseUrl: "https://llm.internal/v1",
        defaultModel: "llama-3.1-8b",
        apiKey: undefined
      }
    ]);
    expect(config.anthropic?.defaultModel).toBe("claude-test");
    expect(config.azureOpenAi).toMatchObject({
      endpoint: "https://azure-openai.test",
      deployment: "support-chat",
      defaultModel: "support-chat"
    });
    expect(config.gemini?.defaultModel).toBe("gemini-test");
  });

  it("loads model routing rules, budgets, and pricing references", () => {
    const config = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          customer_chat: {
            provider: "openai-compatible",
            model: "llama-small",
            fallbacks: [{ provider: "openai", model: "gpt-4o-mini" }],
            smallModel: {
              provider: "openai-compatible",
              model: "llama-tiny",
              maxInputTokens: 256
            },
            budget: {
              maxInputTokensPerRequest: 2000,
              maxOutputTokensPerRequest: 512,
              maxTotalTokensPerRequest: 2500,
              maxTokensPerMinute: 10000
            },
            allowProviderOverride: false,
            allowModelOverride: false,
            allowedProviders: ["openai-compatible"],
            allowedModels: ["llama-small", "llama-tiny"]
          }
        },
        pricing: [
          {
            provider: "openai-compatible",
            model: "llama-small",
            inputUsdPer1MTokens: 0.01,
            outputUsdPer1MTokens: 0.02,
            source: "internal_reference"
          }
        ]
      })
    });

    expect(config.modelRouting.routes.customer_chat).toMatchObject({
      provider: "openai-compatible",
      model: "llama-small",
      fallbacks: [{ provider: "openai", model: "gpt-4o-mini" }],
      smallModel: {
        provider: "openai-compatible",
        model: "llama-tiny",
        maxInputTokens: 256
      },
      budget: {
        maxInputTokensPerRequest: 2000,
        maxOutputTokensPerRequest: 512,
        maxTotalTokensPerRequest: 2500,
        maxTokensPerMinute: 10000
      },
      allowProviderOverride: false,
      allowModelOverride: false
    });
    expect(config.modelRouting.pricing).toEqual([
      {
        provider: "openai-compatible",
        model: "llama-small",
        inputUsdPer1MTokens: 0.01,
        outputUsdPer1MTokens: 0.02,
        source: "internal_reference"
      }
    ]);
  });

  it("loads the Phase 8 services project health route override", () => {
    const config = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          agentforce_services_project_health: {
            provider: "openai",
            model: "gpt-4o-mini",
            budget: {
              maxOutputTokensPerRequest: 320,
              maxTokensPerMinute: 5000
            },
            allowProviderOverride: false,
            allowModelOverride: false
          }
        }
      })
    });

    expect(
      config.modelRouting.routes.agentforce_services_project_health
    ).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      budget: {
        maxOutputTokensPerRequest: 320,
        maxTokensPerMinute: 5000
      },
      allowProviderOverride: false,
      allowModelOverride: false
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

  it("loads the hash-based Agentforce service bearer config", () => {
    const config = AppConfigService.load({
      AI_API_AGENTFORCE_BEARER_TOKEN_SHA256: "b".repeat(64).toUpperCase(),
      AI_API_AGENTFORCE_BEARER_SUBJECT: "agentforce-runtime",
      AI_API_AGENTFORCE_BEARER_TENANT: "tenant-prod",
      AI_API_AGENTFORCE_BEARER_RAG_NAMESPACE: "customer-prod",
      AI_API_AGENTFORCE_BEARER_SCOPES:
        "agentforce:support-triage,agentforce:knowledge-rag agentforce:knowledge-rag",
      AI_API_AGENTFORCE_BEARER_ROLES: "support-agent,rag-agent"
    });

    expect(config.jwt.agentforceServiceBearer).toEqual({
      tokenSha256: "b".repeat(64),
      subject: "agentforce-runtime",
      tenantId: "tenant-prod",
      ragNamespace: "customer-prod",
      scopes: ["agentforce:support-triage", "agentforce:knowledge-rag"],
      roles: ["support-agent", "rag-agent"]
    });
    expect(config.jwt.agentforceServiceBearers).toEqual([
      config.jwt.agentforceServiceBearer
    ]);
  });

  it("loads multiple isolated Agentforce service bearers from JSON", () => {
    const config = AppConfigService.load({
      AI_API_AGENTFORCE_BEARERS_JSON: JSON.stringify([
        {
          tokenSha256: "a".repeat(64),
          subject: "certinia-phase8-agentforce",
          tenantId: "certinia-phase8",
          ragNamespace: "phase8-rag",
          scopes: [
            "agentforce:services-project-health",
            "agentforce:services-project-health"
          ],
          roles: ["services-org-intelligence"]
        },
        {
          token_sha256: "d".repeat(64).toUpperCase(),
          subject: "other-org-agentforce",
          tenant: "other-org",
          rag_namespace: "other-rag",
          scopes: "agentforce:support-triage agentforce:case-analysis",
          roles: "support-agent"
        }
      ])
    });

    expect(config.jwt.agentforceServiceBearers).toEqual([
      {
        tokenSha256: "a".repeat(64),
        subject: "certinia-phase8-agentforce",
        tenantId: "certinia-phase8",
        ragNamespace: "phase8-rag",
        scopes: ["agentforce:services-project-health"],
        roles: ["services-org-intelligence"]
      },
      {
        tokenSha256: "d".repeat(64),
        subject: "other-org-agentforce",
        tenantId: "other-org",
        ragNamespace: "other-rag",
        scopes: ["agentforce:support-triage", "agentforce:case-analysis"],
        roles: ["support-agent"]
      }
    ]);
    expect(config.jwt.agentforceServiceBearer).toEqual(
      config.jwt.agentforceServiceBearers[0]
    );
  });

  it("applies defaults for JSON Agentforce service bearer entries", () => {
    const config = AppConfigService.load({
      RAG_DEFAULT_NAMESPACE: "services-default",
      AI_API_AGENTFORCE_BEARERS_JSON: JSON.stringify([
        {
          tokenSha256: "e".repeat(64)
        }
      ])
    });

    expect(config.jwt.agentforceServiceBearers[0]).toEqual({
      tokenSha256: "e".repeat(64),
      subject: "salesforce-agentforce",
      tenantId: "tenant-demo",
      ragNamespace: "services-default",
      scopes: [
        "agentforce:support-triage",
        "agentforce:case-analysis",
        "agentforce:knowledge-rag",
        "agentforce:services-project-health"
      ],
      roles: ["support-agent"]
    });
  });

  it("includes all Agentforce action scopes in the service bearer default", () => {
    const config = AppConfigService.load({
      AI_API_AGENTFORCE_BEARER_TOKEN_SHA256: "c".repeat(64)
    });

    expect(config.jwt.agentforceServiceBearer?.scopes).toEqual([
      "agentforce:support-triage",
      "agentforce:case-analysis",
      "agentforce:knowledge-rag",
      "agentforce:services-project-health"
    ]);
    expect(config.jwt.agentforceServiceBearers[0]?.scopes).toEqual(
      config.jwt.agentforceServiceBearer?.scopes
    );
  });

  it("loads config-backed OAuth clients for Salesforce org onboarding", () => {
    const config = AppConfigService.load({
      RAG_DEFAULT_NAMESPACE: "services-default",
      AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "1200",
      AI_API_OAUTH_CLIENTS_JSON: JSON.stringify([
        {
          clientId: "certinia-phase8-oauth",
          clientSecretSha256: sha256("phase8-secret"),
          tenantId: "certinia-phase8",
          salesforceOrgId: "00D000000000001",
          salesforceInstanceUrl: "https://certinia.example.my.salesforce.com/",
          pendingClientSecretSha256: sha256("phase8-secret-next"),
          pendingSecretExpiresAt: "2026-01-02T03:04:05.000Z",
          scopes: [
            "agentforce:services-project-health",
            "agentforce:services-project-health"
          ],
          roles: "services-org-intelligence"
        }
      ])
    });

    expect(config.oauth).toEqual({
      accessTokenTtlSeconds: 1200,
      clientSecretHashPepper: undefined,
      clients: [
        {
          clientId: "certinia-phase8-oauth",
          clientSecretSha256: sha256("phase8-secret"),
          pendingClientSecretSha256: sha256("phase8-secret-next"),
          pendingSecretExpiresAt: "2026-01-02T03:04:05.000Z",
          subject: "salesforce-org:00D000000000001",
          tenantId: "certinia-phase8",
          salesforceOrgId: "00D000000000001",
          salesforceInstanceUrl: "https://certinia.example.my.salesforce.com",
          ragNamespace: "services-default",
          scopes: ["agentforce:services-project-health"],
          roles: ["services-org-intelligence"],
          status: "active"
        }
      ],
      tenantRegistry: {
        provider: "config",
        databaseUrl: undefined,
        autoMigrate: true,
        ssl: false,
        maxPoolSize: 5
      }
    });
  });

  it("loads Postgres-backed tenant registry settings", () => {
    const config = AppConfigService.load({
      AI_API_TENANT_REGISTRY_PROVIDER: "postgres",
      AI_API_TENANT_REGISTRY_DATABASE_URL:
        "postgres://agentforce:secret@localhost:5432/agentforce",
      AI_API_TENANT_REGISTRY_AUTO_MIGRATE: "false",
      AI_API_TENANT_REGISTRY_DATABASE_SSL: "true",
      AI_API_TENANT_REGISTRY_MAX_POOL_SIZE: "3"
    });

    expect(config.oauth.tenantRegistry).toEqual({
      provider: "postgres",
      databaseUrl: "postgres://agentforce:secret@localhost:5432/agentforce",
      autoMigrate: false,
      ssl: true,
      maxPoolSize: 3
    });
  });

  it("loads an optional OAuth client secret pepper", () => {
    const config = AppConfigService.load({
      AI_API_OAUTH_CLIENT_SECRET_PEPPER: "phase2-pepper"
    });

    expect(config.oauth.clientSecretHashPepper).toBe("phase2-pepper");
  });

  it("rejects unsafe tenant registry configuration", () => {
    expect(() =>
      AppConfigService.load({
        AI_API_TENANT_REGISTRY_PROVIDER: "sqlite"
      })
    ).toThrow("AI_API_TENANT_REGISTRY_PROVIDER must be config or postgres.");

    expect(() =>
      AppConfigService.load({
        AI_API_TENANT_REGISTRY_PROVIDER: "postgres"
      })
    ).toThrow(
      "AI_API_TENANT_REGISTRY_DATABASE_URL or DATABASE_URL is required when AI_API_TENANT_REGISTRY_PROVIDER=postgres."
    );

    expect(() =>
      AppConfigService.load({
        AI_API_TENANT_REGISTRY_AUTO_MIGRATE: "yes"
      })
    ).toThrow("AI_API_TENANT_REGISTRY_AUTO_MIGRATE must be true or false.");
  });

  it("rejects unsafe OAuth client configuration", () => {
    expect(() =>
      AppConfigService.load({
        AI_API_OAUTH_CLIENTS_JSON: JSON.stringify([
          {
            clientId: "certinia-phase8-oauth",
            clientSecretSha256: "not-a-hash",
            tenantId: "certinia-phase8",
            salesforceOrgId: "00D000000000001"
          }
        ])
      })
    ).toThrow("AI_API_OAUTH_CLIENTS_JSON[0].clientSecretSha256");

    expect(() =>
      AppConfigService.load({
        AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "60"
      })
    ).toThrow(
      "AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS must be from 300 to 3600 seconds."
    );

    expect(() =>
      AppConfigService.load({
        AI_API_OAUTH_CLIENTS_JSON: JSON.stringify([
          {
            clientId: "certinia-phase8-oauth",
            clientSecretSha256: sha256("phase8-secret"),
            pendingClientSecretSha256: "not-a-hash",
            tenantId: "certinia-phase8",
            salesforceOrgId: "00D000000000001"
          }
        ])
      })
    ).toThrow("AI_API_OAUTH_CLIENTS_JSON[0].pendingClientSecretSha256");
  });

  it("loads Agentforce route rate-limit defaults and overrides", () => {
    expect(AppConfigService.load({}).agentforce).toEqual({
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 60
    });

    const config = AppConfigService.load({
      AGENTFORCE_RATE_LIMIT_WINDOW_MS: "30000",
      AGENTFORCE_RATE_LIMIT_MAX_REQUESTS: "20"
    });

    expect(config.agentforce).toEqual({
      rateLimitWindowMs: 30000,
      rateLimitMaxRequests: 20
    });
  });

  it("rejects invalid Agentforce service bearer hashes", () => {
    expect(() =>
      AppConfigService.load({
        AI_API_AGENTFORCE_BEARER_TOKEN_SHA256: "not-a-sha"
      })
    ).toThrow("AI_API_AGENTFORCE_BEARER_TOKEN_SHA256");

    expect(() =>
      AppConfigService.load({
        AI_API_AGENTFORCE_BEARERS_JSON: JSON.stringify([
          { tokenSha256: "not-a-sha" }
        ])
      })
    ).toThrow("AI_API_AGENTFORCE_BEARERS_JSON[0].tokenSha256");
  });

  it("rejects malformed Agentforce service bearer JSON", () => {
    expect(() =>
      AppConfigService.load({
        AI_API_AGENTFORCE_BEARERS_JSON: JSON.stringify({
          tokenSha256: "a".repeat(64)
        })
      })
    ).toThrow("AI_API_AGENTFORCE_BEARERS_JSON must be a JSON array.");

    expect(() =>
      AppConfigService.load({
        AI_API_AGENTFORCE_BEARERS_JSON: JSON.stringify(["not-an-object"])
      })
    ).toThrow("AI_API_AGENTFORCE_BEARERS_JSON entries must be JSON objects.");
  });

  it("rejects duplicate Agentforce service bearer hashes", () => {
    expect(() =>
      AppConfigService.load({
        AI_API_AGENTFORCE_BEARER_TOKEN_SHA256: "f".repeat(64),
        AI_API_AGENTFORCE_BEARERS_JSON: JSON.stringify([
          {
            tokenSha256: "f".repeat(64)
          }
        ])
      })
    ).toThrow("Duplicate Agentforce service bearer token hash.");
  });

  it("rejects auth-disabled mode in production-like deployments", () => {
    expect(() =>
      AppConfigService.load({
        NODE_ENV: "production",
        AGENTFORCE_HEALTH_API_KEY: "x",
        AI_API_AUTH_DISABLED: "true"
      })
    ).toThrow("AI_API_AUTH_DISABLED=true is not allowed");
  });

  it("loads customer chat session defaults and access code", () => {
    const config = AppConfigService.load({
      CUSTOMER_CHAT_ACCESS_CODE: "phase6-access"
    });

    expect(config.customerChatSession).toEqual({
      accessCode: "phase6-access",
      ttlSeconds: 7200,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 10
    });
  });

  it("loads explicit customer chat session limits", () => {
    const config = AppConfigService.load({
      CUSTOMER_CHAT_SESSION_TTL_SECONDS: "900",
      CUSTOMER_CHAT_SESSION_RATE_LIMIT_WINDOW_MS: "30000",
      CUSTOMER_CHAT_SESSION_RATE_LIMIT_MAX_REQUESTS: "5"
    });

    expect(config.customerChatSession).toMatchObject({
      ttlSeconds: 900,
      rateLimitWindowMs: 30000,
      rateLimitMaxRequests: 5
    });
  });

  it("loads local CORS defaults for React chat development", () => {
    const config = AppConfigService.load({});

    expect(config.cors.allowedOrigins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173"
    ]);
  });

  it("loads explicit CORS origins for deployed browser clients", () => {
    const config = AppConfigService.load({
      AI_API_CORS_ORIGINS:
        "https://chat.example.com, https://chat.example.com/, http://localhost:5173"
    });

    expect(config.cors.allowedOrigins).toEqual([
      "https://chat.example.com",
      "http://localhost:5173"
    ]);
  });

  it("rejects unsafe CORS origins", () => {
    expect(() => AppConfigService.load({ AI_API_CORS_ORIGINS: "*" })).toThrow(
      "wildcard is not allowed"
    );
    expect(() =>
      AppConfigService.load({ AI_API_CORS_ORIGINS: "javascript:alert(1)" })
    ).toThrow("only http(s) origins");
    expect(() =>
      AppConfigService.load({
        AI_API_CORS_ORIGINS: "https://chat.example.com/path"
      })
    ).toThrow("origins only");
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
      responseCacheMaxItems: 256,
      responseCacheTtlMs: 300000,
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
      RAG_RESPONSE_CACHE_MAX_ITEMS: "8",
      RAG_RESPONSE_CACHE_TTL_MS: "120000",
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
      responseCacheMaxItems: 8,
      responseCacheTtlMs: 120000,
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
      AppConfigService.load({ RAG_RESPONSE_CACHE_MAX_ITEMS: "-1" })
    ).toThrow("RAG_RESPONSE_CACHE_MAX_ITEMS must be a non-negative integer.");
    expect(() =>
      AppConfigService.load({ RAG_RESPONSE_CACHE_TTL_MS: "0" })
    ).toThrow("RAG_RESPONSE_CACHE_TTL_MS must be a positive integer.");
    expect(() =>
      AppConfigService.load({ RAG_RESPONSE_CACHE_TTL_MS: "3600001" })
    ).toThrow("RAG_RESPONSE_CACHE_TTL_MS must be at most 3600000.");
    expect(() =>
      AppConfigService.load({ RAG_RATE_LIMIT_WINDOW_MS: "0" })
    ).toThrow("RAG_RATE_LIMIT_WINDOW_MS must be a positive integer.");
    expect(() =>
      AppConfigService.load({ RAG_RATE_LIMIT_MAX_REQUESTS: "0" })
    ).toThrow("RAG_RATE_LIMIT_MAX_REQUESTS must be a positive integer.");
    expect(() =>
      AppConfigService.load({ CUSTOMER_CHAT_SESSION_TTL_SECONDS: "0" })
    ).toThrow("CUSTOMER_CHAT_SESSION_TTL_SECONDS must be a positive integer.");
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
    expect(() =>
      AppConfigService.load({
        MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
          routes: { unknown_use_case: { provider: "openai" } }
        })
      })
    ).toThrow("Unknown model routing use case");
    expect(() =>
      AppConfigService.load({
        MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
          routes: {
            customer_chat: { budget: { maxInputTokensPerRequest: 0 } }
          }
        })
      })
    ).toThrow("maxInputTokensPerRequest must be a positive integer");
    expect(() =>
      AppConfigService.load({
        MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
          routes: {
            customer_chat: { budget: { maxTokensPerMinute: 1000 } }
          }
        })
      })
    ).toThrow("maxTokensPerMinute requires maxOutputTokensPerRequest");
  });
});

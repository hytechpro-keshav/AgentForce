import { Injectable } from "@nestjs/common";

import {
  LLM_USE_CASES,
  type LlmUseCase
} from "../llm/interfaces/llm-contracts";
import type { TriagePriorityDto } from "../agents/dto/triage-case.dto";
import type { CustomerHistoryEligibilityPolicy } from "../orchestrator/dto/customer-context";

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

export interface NamedOpenAiCompatibleProviderConfig extends OpenAiCompatibleProviderConfig {
  name: string;
}

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export interface AzureOpenAiProviderConfig {
  apiKey: string;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  defaultModel: string;
}

export interface GeminiProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export interface LlmModelTargetConfig {
  provider: string;
  model?: string;
}

export interface LlmSmallModelRoutingConfig extends LlmModelTargetConfig {
  maxInputTokens?: number;
  maxMessages?: number;
  maxTotalMessageChars?: number;
}

export interface LlmTokenBudgetConfig {
  maxInputTokensPerRequest?: number;
  maxOutputTokensPerRequest?: number;
  maxTotalTokensPerRequest?: number;
  maxTokensPerMinute?: number;
}

export interface LlmRouteConfig {
  provider: string;
  model?: string;
  fallbacks: LlmModelTargetConfig[];
  smallModel?: LlmSmallModelRoutingConfig;
  budget: LlmTokenBudgetConfig;
  allowProviderOverride: boolean;
  allowModelOverride: boolean;
  allowedProviders?: string[];
  allowedModels?: string[];
}

export interface LlmPricingConfig {
  provider: string;
  model: string;
  inputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
  source: string;
}

export interface LlmRoutingConfig {
  routes: Record<LlmUseCase, LlmRouteConfig>;
  pricing: LlmPricingConfig[];
}

export interface JwtAuthConfig {
  secret?: string;
  issuer?: string;
  audience?: string;
  disabled: boolean;
  agentforceServiceBearer?: AgentforceServiceBearerConfig;
  agentforceServiceBearers: AgentforceServiceBearerConfig[];
}

export interface AgentforceServiceBearerConfig {
  tokenSha256: string;
  subject: string;
  tenantId: string;
  ragNamespace: string;
  scopes: string[];
  roles: string[];
}

export type OAuthClientStatus = "active" | "suspended" | "revoked";

export interface OAuthClientConfig {
  clientId: string;
  clientSecretSha256: string;
  pendingClientSecretSha256?: string;
  pendingSecretExpiresAt?: string;
  subject: string;
  tenantId: string;
  salesforceOrgId: string;
  salesforceInstanceUrl?: string;
  ragNamespace: string;
  scopes: string[];
  roles: string[];
  status: OAuthClientStatus;
}

export type TenantRegistryProvider = "config" | "postgres";

export interface TenantRegistryConfig {
  provider: TenantRegistryProvider;
  databaseUrl?: string;
  autoMigrate: boolean;
  ssl: boolean;
  maxPoolSize: number;
}

export interface OAuthRuntimeConfig {
  accessTokenTtlSeconds: number;
  clientSecretHashPepper?: string;
  clients: OAuthClientConfig[];
  tenantRegistry: TenantRegistryConfig;
}

export interface SalesforceOnboardingConfig {
  publicBaseUrl?: string;
  namedCredentialApiName: string;
  externalCredentialApiName: string;
  principalApiName: string;
  permissionSetApiName: string;
  secureClientIdField: string;
  secureClientSecretField: string;
  tokenEndpointPath: string;
  projectHealthPath: string;
  setupGuidePath: string;
}

export interface AgentforceRuntimeConfig {
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

export interface CorsConfig {
  allowedOrigins: string[];
}

export interface CustomerChatSessionConfig {
  accessCode?: string;
  ttlSeconds: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

/**
 * RC-8a (Node 6 6c) — operator console login session. An access code mints a
 * short-TTL JWT carrying BOTH `agentforce:orchestrator-read` and
 * `agentforce:orchestrator-control` so the console can read status AND issue
 * Stop AI. Login is unavailable (fail closed) until `accessCode` is set. The
 * approval scope is NEVER granted here — Stop AI is not approve/reject.
 */
export interface OperatorOrchestrationSessionConfig {
  accessCode?: string;
  ttlSeconds: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
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
  responseCacheMaxItems: number;
  responseCacheTtlMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  ingestRateLimitMaxRequests: number;
}

export interface OpenAiCompatibleGatewayConfig {
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  ragModelId: string;
}

/**
 * Outbound Salesforce REST connection used by the orchestrator to
 * read Case context and apply gated write-backs. This is distinct
 * from the inbound Named Credential path (Salesforce -> AI API).
 *
 * The connection is OPTIONAL at boot so existing deployments keep
 * working. It is only `enabled` when all four credentials are
 * present. The orchestrator trigger fails fast with a precise error
 * when a Case-triage run is requested while this is not configured.
 */
export interface SalesforceConnectionConfig {
  enabled: boolean;
  instanceUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  apiVersion: string;
  timeoutMs: number;
}

export const TRIAGE_APPROVAL_MODES = ["auto", "always", "high_risk"] as const;
export type TriageApprovalMode = (typeof TRIAGE_APPROVAL_MODES)[number];

/**
 * Durable persistence for the Node 1 orchestrator read model.
 *
 * `memory` (default) keeps workflows only in process, which is fine for
 * tests and local dev. `postgres` writes through to a table so historical
 * Cases resolve by Case Id after an ai-api restart or redeploy.
 */
export interface OrchestratorPersistenceConfig {
  provider: "memory" | "postgres";
  databaseUrl?: string;
  autoMigrate: boolean;
  ssl: boolean;
  maxPoolSize: number;
}

/**
 * Optional Salesforce write-back of the AI triage workflow id and
 * status onto the Case (custom fields). Default OFF so stock orgs
 * without the fields keep working; the write is always best-effort and
 * never blocks the Flow or the orchestration run.
 */
export interface OrchestratorSalesforceWriteBackConfig {
  enabled: boolean;
  /** Base URL of the read-only orchestration UI, for the Case deep link. */
  uiBaseUrl?: string;
}

/**
 * Node 2 (customer history) configuration. The eligibility policy gates
 * the expensive reads + model call; Data 360 and the external adapters
 * are OFF by default so the node degrades gracefully when they are
 * absent.
 */
export interface OrchestratorCustomerHistoryConfig {
  eligibility: CustomerHistoryEligibilityPolicy;
  dataCloud: { enabled: boolean };
  externalAdapters: {
    erpEnabled: boolean;
    serviceNowEnabled: boolean;
    telemetryEnabled: boolean;
  };
}

/**
 * Node 3 (knowledge) configuration. RAG retrieval is OFF by default;
 * when enabled, it uses the configured namespace for semantic search.
 */
export interface OrchestratorKnowledgeConfig {
  /** Feature flag: enables Node 3 RAG retrieval. Default: false. */
  enabled: boolean;
  /** Optional namespace override; defaults to RAG config namespace. */
  namespace?: string;
  /** Query character limit; default 200. */
  queryMaxChars: number;
  /** Retrieval top-K; default 5. */
  retrievalTopK: number;
  /** Minimum similarity score (0–1); default 0.65. */
  scoreThreshold: number;
  /**
   * Feature flag: when Node 3 is ANSWERED, run an LLM extraction step
   * (via ModelRouter) to produce typed `recommendedActions`,
   * `suggestedParts`, `safetyFlags`, and `displaySummary`. Default: true
   * (only runs when `enabled` is also true, so off by default overall).
   */
  extractionEnabled: boolean;
}

/**
 * Node 4 (parts & logistics) configuration. Read/plan slice is OFF by
 * default; when enabled, the non-interrupting node reads live inventory
 * and produces a fulfillment plan. No Salesforce writes in Phase 4a.
 */
export interface OrchestratorPartsLogisticsConfig {
  /** Feature flag: enables Node 4 parts & logistics planning. */
  enabled: boolean;
  /**
   * Phase 4c: enables the gated Salesforce fulfillment writes
   * (ProductTransfer / ProductRequest) in the post-approval write-back.
   * Off by default — reads/planning work without it.
   */
  writesEnabled: boolean;
}

/**
 * Node 5 (scheduling) configuration. Read/plan slice is OFF by default;
 * when enabled, the non-interrupting node reads Field Service signals and
 * proposes a parts-ETA-gated technician + service window. No Salesforce
 * writes in Phase 5a (`ServiceAppointment` create is Phase 5c).
 */
export interface OrchestratorSchedulingConfig {
  /** Feature flag: enables Node 5 scheduling planning. */
  enabled: boolean;
  /**
   * Feature flag (5b): attempt the Field Service AppointmentCandidates API
   * for slot selection, falling back to the deterministic planner. OFF by
   * default — the native scheduler needs a draft ServiceAppointment (5c).
   */
  candidatesApiEnabled: boolean;
  /**
   * Feature flag (5c): create the gated `ServiceAppointment` in the
   * post-approval write-back. OFF by default; when on, the write-back does
   * a fresh parts + scheduling re-read (RC-5) before any DML and books only
   * a still-`schedulable` plan.
   */
  writesEnabled: boolean;
}

export type OrchestratorApprovalEmailProvider = "log" | "resend";

/**
 * Phase 6b — guardrail approval routing. Every flag defaults OFF so the
 * 6a log-only behavior stays the safe default. Turning email on REQUIRES a
 * signing secret + public link base + from/to (and a Resend key when the
 * provider is `resend`) so approve/reject links can be minted and
 * delivered — config fails closed rather than minting unsigned or
 * undeliverable links. `tokenSecret` MUST be distinct from
 * `AI_API_JWT_SECRET`: these links are public, single-purpose, and never
 * carry an API scope (Node 6 phase plan §3.7, §10).
 */
/**
 * Phase 6c (N6-R1) — approval timeout sweep. A configurable SLA after which a
 * stale `waiting_approval` workflow is auto-settled to a terminal decision
 * (default `escalate`). Disabled by default (6b+ parity). The sweep settles
 * the snapshot + Case directly and mints NO Salesforce callback token —
 * `escalated`/`rejected` are not resumable (R6) and the checkpoint may be
 * orphaned.
 */
export interface OrchestratorGuardrailApprovalTimeoutConfig {
  enabled: boolean;
  timeoutSeconds: number;
  action: "escalate" | "reject";
  scanSeconds: number;
}

export interface OrchestratorGuardrailApprovalConfig {
  emailEnabled: boolean;
  escalationEmailEnabled: boolean;
  /**
   * 6b+ — route the guardrail `requireHumanApproval` interrupt to a native
   * Salesforce Approval Process instead of (or alongside) email. When on,
   * the notification service submits the Case Approval via the Apex REST
   * submit gateway and the approver acts in Salesforce; a Flow callout
   * resumes the workflow. Requires `tokenSecret` (callback auth).
   */
  salesforceApprovalEnabled: boolean;
  /** Developer name of the Case Approval Process submitted programmatically. */
  salesforceApprovalProcess: string;
  tokenSecret?: string;
  tokenTtlSeconds: number;
  emailProvider: OrchestratorApprovalEmailProvider;
  resendApiKey?: string;
  emailFrom?: string;
  emailTo?: string;
  recipientRole: string;
  linkBaseUrl?: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  timeout: OrchestratorGuardrailApprovalTimeoutConfig;
}

export interface OrchestratorConfig {
  /**
   * Gate policy for the Node 1 triage write-back.
   * - `auto`: apply the write-back without human approval (matches the
   *   flow doc where Node 6 is the real approval node).
   * - `always`: always pause for out-of-band approval before write-back.
   * - `high_risk`: pause only when triage recommends high/critical.
   */
  triageApprovalMode: TriageApprovalMode;
  persistence: OrchestratorPersistenceConfig;
  salesforceWriteBack: OrchestratorSalesforceWriteBackConfig;
  customerHistory: OrchestratorCustomerHistoryConfig;
  knowledge: OrchestratorKnowledgeConfig;
  partsLogistics: OrchestratorPartsLogisticsConfig;
  scheduling: OrchestratorSchedulingConfig;
  guardrailApproval: OrchestratorGuardrailApprovalConfig;
}

export interface AppRuntimeConfig {
  port: number;
  nodeEnv: string;
  agentforceHealthApiKey?: string;
  productionLike: boolean;
  openAi?: OpenAiProviderConfig;
  openAiCompatible?: OpenAiCompatibleProviderConfig;
  openAiCompatibleProviders: NamedOpenAiCompatibleProviderConfig[];
  anthropic?: AnthropicProviderConfig;
  azureOpenAi?: AzureOpenAiProviderConfig;
  gemini?: GeminiProviderConfig;
  defaultProvider: string;
  fallbackProvider?: string;
  modelRouting: LlmRoutingConfig;
  jwt: JwtAuthConfig;
  oauth: OAuthRuntimeConfig;
  salesforceOnboarding: SalesforceOnboardingConfig;
  agentforce: AgentforceRuntimeConfig;
  cors: CorsConfig;
  customerChatSession: CustomerChatSessionConfig;
  operatorOrchestrationSession: OperatorOrchestrationSessionConfig;
  telemetryEnabled: boolean;
  rag: RagRuntimeConfig;
  openAiGateway: OpenAiCompatibleGatewayConfig;
  salesforceConnection: SalesforceConnectionConfig;
  orchestrator: OrchestratorConfig;
}

@Injectable()
export class AppConfigService {
  readonly port: number;
  readonly nodeEnv: string;
  readonly agentforceHealthApiKey?: string;
  readonly productionLike: boolean;
  readonly openAi?: OpenAiProviderConfig;
  readonly openAiCompatible?: OpenAiCompatibleProviderConfig;
  readonly openAiCompatibleProviders: NamedOpenAiCompatibleProviderConfig[];
  readonly anthropic?: AnthropicProviderConfig;
  readonly azureOpenAi?: AzureOpenAiProviderConfig;
  readonly gemini?: GeminiProviderConfig;
  readonly defaultProvider: string;
  readonly fallbackProvider?: string;
  readonly modelRouting: LlmRoutingConfig;
  readonly jwt: JwtAuthConfig;
  readonly oauth: OAuthRuntimeConfig;
  readonly salesforceOnboarding: SalesforceOnboardingConfig;
  readonly agentforce: AgentforceRuntimeConfig;
  readonly cors: CorsConfig;
  readonly customerChatSession: CustomerChatSessionConfig;
  readonly operatorOrchestrationSession: OperatorOrchestrationSessionConfig;
  readonly telemetryEnabled: boolean;
  readonly rag: RagRuntimeConfig;
  readonly openAiGateway: OpenAiCompatibleGatewayConfig;
  readonly salesforceConnection: SalesforceConnectionConfig;
  readonly orchestrator: OrchestratorConfig;

  constructor() {
    const config = AppConfigService.load(process.env);
    this.port = config.port;
    this.nodeEnv = config.nodeEnv;
    this.agentforceHealthApiKey = config.agentforceHealthApiKey;
    this.productionLike = config.productionLike;
    this.openAi = config.openAi;
    this.openAiCompatible = config.openAiCompatible;
    this.openAiCompatibleProviders = config.openAiCompatibleProviders;
    this.anthropic = config.anthropic;
    this.azureOpenAi = config.azureOpenAi;
    this.gemini = config.gemini;
    this.defaultProvider = config.defaultProvider;
    this.fallbackProvider = config.fallbackProvider;
    this.modelRouting = config.modelRouting;
    this.jwt = config.jwt;
    this.oauth = config.oauth;
    this.salesforceOnboarding = config.salesforceOnboarding;
    this.agentforce = config.agentforce;
    this.cors = config.cors;
    this.customerChatSession = config.customerChatSession;
    this.operatorOrchestrationSession = config.operatorOrchestrationSession;
    this.telemetryEnabled = config.telemetryEnabled;
    this.rag = config.rag;
    this.openAiGateway = config.openAiGateway;
    this.salesforceConnection = config.salesforceConnection;
    this.orchestrator = config.orchestrator;
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
    const openAiCompatibleProviders =
      AppConfigService.loadOpenAiCompatibleProviders(env, openAiCompatible);
    const anthropic = AppConfigService.loadAnthropic(env);
    const azureOpenAi = AppConfigService.loadAzureOpenAi(env);
    const gemini = AppConfigService.loadGemini(env);
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
    const configuredProviderNames = new Set<string>();
    if (openAi) configuredProviderNames.add("openai");
    for (const provider of openAiCompatibleProviders) {
      configuredProviderNames.add(provider.name);
    }
    if (anthropic) configuredProviderNames.add("anthropic");
    if (azureOpenAi) configuredProviderNames.add("azure-openai");
    if (gemini) configuredProviderNames.add("gemini");
    if (
      productionLike &&
      configuredDefaultProvider &&
      configuredDefaultProvider !== "openai" &&
      !configuredProviderNames.has(configuredDefaultProvider)
    ) {
      throw new Error(
        `Provider config is required when LLM_DEFAULT_PROVIDER=${configuredDefaultProvider} in production-like deployments.`
      );
    }
    if (
      productionLike &&
      fallbackProvider &&
      !configuredProviderNames.has(fallbackProvider)
    ) {
      throw new Error(
        `Provider config is required when LLM_FALLBACK_PROVIDER=${fallbackProvider} in production-like deployments.`
      );
    }

    const jwt = AppConfigService.loadJwt(env, productionLike);
    const oauth = AppConfigService.loadOAuth(env);
    const salesforceOnboarding = AppConfigService.loadSalesforceOnboarding(env);
    const agentforce = AppConfigService.loadAgentforceRuntime(env);
    const cors = AppConfigService.loadCors(env, productionLike);
    const customerChatSession = AppConfigService.loadCustomerChatSession(env);
    const operatorOrchestrationSession =
      AppConfigService.loadOperatorOrchestrationSession(env);
    const telemetryEnabled =
      AppConfigService.normalize(env.AI_API_TELEMETRY_ENABLED) !== "false";
    const rag = AppConfigService.loadRag(env, productionLike, openAi);
    const openAiGateway = AppConfigService.loadOpenAiGateway(env);
    const modelRouting = AppConfigService.loadModelRouting(
      env,
      defaultProvider,
      fallbackProvider
    );
    const salesforceConnection = AppConfigService.loadSalesforceConnection(env);
    const orchestrator = AppConfigService.loadOrchestrator(env);

    return {
      port: AppConfigService.parsePort(env.PORT),
      nodeEnv,
      agentforceHealthApiKey,
      productionLike,
      openAi,
      openAiCompatible,
      openAiCompatibleProviders,
      anthropic,
      azureOpenAi,
      gemini,
      defaultProvider,
      fallbackProvider,
      modelRouting,
      jwt,
      oauth,
      salesforceOnboarding,
      agentforce,
      cors,
      customerChatSession,
      operatorOrchestrationSession,
      telemetryEnabled,
      rag,
      openAiGateway,
      salesforceConnection,
      orchestrator
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

  private static loadOpenAiCompatibleProviders(
    env: NodeJS.ProcessEnv,
    legacy: OpenAiCompatibleProviderConfig | undefined
  ): NamedOpenAiCompatibleProviderConfig[] {
    const providers: NamedOpenAiCompatibleProviderConfig[] = [];
    if (legacy) {
      providers.push({ name: "openai-compatible", ...legacy });
    }

    const rawProviders = AppConfigService.normalize(
      env.OPENAI_COMPAT_PROVIDERS_JSON
    );
    if (!rawProviders) {
      return providers;
    }

    const parsed = AppConfigService.parseJsonValue(
      rawProviders,
      "OPENAI_COMPAT_PROVIDERS_JSON"
    );
    if (!Array.isArray(parsed)) {
      throw new Error("OPENAI_COMPAT_PROVIDERS_JSON must be a JSON array.");
    }

    for (const item of parsed) {
      if (!AppConfigService.isRecord(item)) {
        throw new Error(
          "OPENAI_COMPAT_PROVIDERS_JSON entries must be JSON objects."
        );
      }
      const name = AppConfigService.readSafeIdentifier(
        item,
        "name",
        "OPENAI_COMPAT_PROVIDERS_JSON.name"
      );
      const baseUrl = AppConfigService.readUrl(
        item,
        "baseUrl",
        "OPENAI_COMPAT_PROVIDERS_JSON.baseUrl"
      );
      const defaultModel = AppConfigService.readSafeModelId(
        item,
        "defaultModel",
        "OPENAI_COMPAT_PROVIDERS_JSON.defaultModel"
      );
      const apiKey = AppConfigService.readOptionalString(item, "apiKey");
      providers.push({ name, baseUrl, defaultModel, apiKey });
    }

    const seen = new Set<string>();
    for (const provider of providers) {
      if (provider.name === "openai") {
        throw new Error(
          "OPENAI_COMPAT_PROVIDERS_JSON provider names cannot be openai."
        );
      }
      if (seen.has(provider.name)) {
        throw new Error(
          `Duplicate OpenAI-compatible provider name: ${provider.name}.`
        );
      }
      seen.add(provider.name);
    }
    return providers;
  }

  private static loadAnthropic(
    env: NodeJS.ProcessEnv
  ): AnthropicProviderConfig | undefined {
    const apiKey = AppConfigService.normalize(env.ANTHROPIC_API_KEY);
    if (!apiKey) return undefined;
    return {
      apiKey,
      baseUrl:
        AppConfigService.normalize(env.ANTHROPIC_BASE_URL) ??
        "https://api.anthropic.com/v1",
      defaultModel:
        AppConfigService.normalize(env.ANTHROPIC_DEFAULT_MODEL) ??
        "claude-3-5-haiku-latest"
    };
  }

  private static loadAzureOpenAi(
    env: NodeJS.ProcessEnv
  ): AzureOpenAiProviderConfig | undefined {
    const apiKey = AppConfigService.normalize(env.AZURE_OPENAI_API_KEY);
    const endpoint = AppConfigService.normalize(env.AZURE_OPENAI_ENDPOINT);
    const deployment = AppConfigService.normalize(
      env.AZURE_OPENAI_CHAT_DEPLOYMENT
    );
    if (!apiKey && !endpoint && !deployment) return undefined;
    if (!apiKey || !endpoint || !deployment) {
      throw new Error(
        "AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_CHAT_DEPLOYMENT must be set together."
      );
    }
    return {
      apiKey,
      endpoint,
      deployment,
      apiVersion:
        AppConfigService.normalize(env.AZURE_OPENAI_API_VERSION) ??
        "2024-10-21",
      defaultModel:
        AppConfigService.normalize(env.AZURE_OPENAI_CHAT_MODEL) ?? deployment
    };
  }

  private static loadGemini(
    env: NodeJS.ProcessEnv
  ): GeminiProviderConfig | undefined {
    const apiKey = AppConfigService.normalize(env.GEMINI_API_KEY);
    if (!apiKey) return undefined;
    return {
      apiKey,
      baseUrl:
        AppConfigService.normalize(env.GEMINI_BASE_URL) ??
        "https://generativelanguage.googleapis.com/v1beta",
      defaultModel:
        AppConfigService.normalize(env.GEMINI_DEFAULT_MODEL) ??
        "gemini-1.5-flash"
    };
  }

  private static loadModelRouting(
    env: NodeJS.ProcessEnv,
    defaultProvider: string,
    fallbackProvider: string | undefined
  ): LlmRoutingConfig {
    const routes = {} as Record<LlmUseCase, LlmRouteConfig>;
    for (const useCase of LLM_USE_CASES) {
      routes[useCase] = AppConfigService.defaultRoute(
        defaultProvider,
        fallbackProvider
      );
    }

    const rawRouting = AppConfigService.normalize(
      env.MODEL_ROUTING_CONFIG_JSON
    );
    const pricing: LlmPricingConfig[] = [];
    if (rawRouting) {
      const parsed = AppConfigService.parseJsonValue(
        rawRouting,
        "MODEL_ROUTING_CONFIG_JSON"
      );
      if (!AppConfigService.isRecord(parsed)) {
        throw new Error("MODEL_ROUTING_CONFIG_JSON must be a JSON object.");
      }
      const routeOverrides = parsed["routes"];
      if (routeOverrides !== undefined) {
        if (!AppConfigService.isRecord(routeOverrides)) {
          throw new Error(
            "MODEL_ROUTING_CONFIG_JSON.routes must be a JSON object."
          );
        }
        for (const [useCase, value] of Object.entries(routeOverrides)) {
          if (!LLM_USE_CASES.includes(useCase as LlmUseCase)) {
            throw new Error(`Unknown model routing use case: ${useCase}.`);
          }
          routes[useCase as LlmUseCase] = AppConfigService.parseRouteConfig(
            value,
            routes[useCase as LlmUseCase],
            `MODEL_ROUTING_CONFIG_JSON.routes.${useCase}`
          );
        }
      }
      const routingPricing = parsed["pricing"] ?? parsed["modelPricing"];
      if (routingPricing !== undefined) {
        pricing.push(
          ...AppConfigService.parsePricingArray(
            routingPricing,
            "MODEL_ROUTING_CONFIG_JSON.pricing"
          )
        );
      }
    }

    const rawPricing = AppConfigService.normalize(env.MODEL_PRICING_JSON);
    if (rawPricing) {
      pricing.push(
        ...AppConfigService.parsePricingArray(
          AppConfigService.parseJsonValue(rawPricing, "MODEL_PRICING_JSON"),
          "MODEL_PRICING_JSON"
        )
      );
    }

    return { routes, pricing };
  }

  private static defaultRoute(
    defaultProvider: string,
    fallbackProvider: string | undefined
  ): LlmRouteConfig {
    return {
      provider: defaultProvider,
      fallbacks: fallbackProvider ? [{ provider: fallbackProvider }] : [],
      budget: {},
      allowProviderOverride: true,
      allowModelOverride: true
    };
  }

  private static parseRouteConfig(
    value: unknown,
    fallback: LlmRouteConfig,
    path: string
  ): LlmRouteConfig {
    if (!AppConfigService.isRecord(value)) {
      throw new Error(`${path} must be a JSON object.`);
    }
    const provider =
      AppConfigService.readOptionalSafeIdentifier(value, "provider") ??
      fallback.provider;
    const model =
      AppConfigService.readOptionalSafeModelId(value, "model") ??
      fallback.model;
    const fallbacks =
      value["fallbacks"] !== undefined
        ? AppConfigService.parseFallbacks(
            value["fallbacks"],
            `${path}.fallbacks`
          )
        : value["fallbackProviders"] !== undefined
          ? AppConfigService.parseFallbackProviders(
              value["fallbackProviders"],
              `${path}.fallbackProviders`
            )
          : fallback.fallbacks;
    const smallModel =
      value["smallModel"] !== undefined
        ? AppConfigService.parseSmallModel(
            value["smallModel"],
            `${path}.smallModel`
          )
        : fallback.smallModel;
    const budget =
      value["budget"] !== undefined
        ? AppConfigService.parseBudget(value["budget"], `${path}.budget`)
        : fallback.budget;
    return {
      provider,
      model,
      fallbacks,
      smallModel,
      budget,
      allowProviderOverride:
        AppConfigService.readOptionalBoolean(value, "allowProviderOverride") ??
        fallback.allowProviderOverride,
      allowModelOverride:
        AppConfigService.readOptionalBoolean(value, "allowModelOverride") ??
        fallback.allowModelOverride,
      allowedProviders:
        value["allowedProviders"] !== undefined
          ? AppConfigService.parseStringArray(
              value["allowedProviders"],
              `${path}.allowedProviders`,
              AppConfigService.isSafeIdentifier
            )
          : fallback.allowedProviders,
      allowedModels:
        value["allowedModels"] !== undefined
          ? AppConfigService.parseStringArray(
              value["allowedModels"],
              `${path}.allowedModels`,
              AppConfigService.isSafeModelId
            )
          : fallback.allowedModels
    };
  }

  private static parseFallbacks(
    value: unknown,
    path: string
  ): LlmModelTargetConfig[] {
    if (!Array.isArray(value)) {
      throw new Error(`${path} must be a JSON array.`);
    }
    return value.map((item, index) => {
      if (!AppConfigService.isRecord(item)) {
        throw new Error(`${path}[${index}] must be a JSON object.`);
      }
      return {
        provider: AppConfigService.readSafeIdentifier(
          item,
          "provider",
          `${path}[${index}].provider`
        ),
        model: AppConfigService.readOptionalSafeModelId(item, "model")
      };
    });
  }

  private static parseFallbackProviders(
    value: unknown,
    path: string
  ): LlmModelTargetConfig[] {
    return AppConfigService.parseStringArray(
      value,
      path,
      AppConfigService.isSafeIdentifier
    ).map((provider) => ({ provider }));
  }

  private static parseSmallModel(
    value: unknown,
    path: string
  ): LlmSmallModelRoutingConfig {
    if (!AppConfigService.isRecord(value)) {
      throw new Error(`${path} must be a JSON object.`);
    }
    return {
      provider: AppConfigService.readSafeIdentifier(
        value,
        "provider",
        `${path}.provider`
      ),
      model: AppConfigService.readSafeModelId(value, "model", `${path}.model`),
      maxInputTokens: AppConfigService.readOptionalPositiveInteger(
        value,
        "maxInputTokens",
        `${path}.maxInputTokens`
      ),
      maxMessages: AppConfigService.readOptionalPositiveInteger(
        value,
        "maxMessages",
        `${path}.maxMessages`
      ),
      maxTotalMessageChars: AppConfigService.readOptionalPositiveInteger(
        value,
        "maxTotalMessageChars",
        `${path}.maxTotalMessageChars`
      )
    };
  }

  private static parseBudget(
    value: unknown,
    path: string
  ): LlmTokenBudgetConfig {
    if (!AppConfigService.isRecord(value)) {
      throw new Error(`${path} must be a JSON object.`);
    }
    const budget = {
      maxInputTokensPerRequest: AppConfigService.readOptionalPositiveInteger(
        value,
        "maxInputTokensPerRequest",
        `${path}.maxInputTokensPerRequest`
      ),
      maxOutputTokensPerRequest: AppConfigService.readOptionalPositiveInteger(
        value,
        "maxOutputTokensPerRequest",
        `${path}.maxOutputTokensPerRequest`
      ),
      maxTotalTokensPerRequest: AppConfigService.readOptionalPositiveInteger(
        value,
        "maxTotalTokensPerRequest",
        `${path}.maxTotalTokensPerRequest`
      ),
      maxTokensPerMinute: AppConfigService.readOptionalPositiveInteger(
        value,
        "maxTokensPerMinute",
        `${path}.maxTokensPerMinute`
      )
    };
    if (
      budget.maxTokensPerMinute !== undefined &&
      budget.maxOutputTokensPerRequest === undefined &&
      budget.maxTotalTokensPerRequest === undefined
    ) {
      throw new Error(
        `${path}.maxTokensPerMinute requires maxOutputTokensPerRequest or maxTotalTokensPerRequest.`
      );
    }
    return budget;
  }

  private static parsePricingArray(
    value: unknown,
    path: string
  ): LlmPricingConfig[] {
    if (!Array.isArray(value)) {
      throw new Error(`${path} must be a JSON array.`);
    }
    return value.map((item, index) => {
      if (!AppConfigService.isRecord(item)) {
        throw new Error(`${path}[${index}] must be a JSON object.`);
      }
      return {
        provider: AppConfigService.readSafeIdentifier(
          item,
          "provider",
          `${path}[${index}].provider`
        ),
        model: AppConfigService.readSafeModelId(
          item,
          "model",
          `${path}[${index}].model`
        ),
        inputUsdPer1MTokens: AppConfigService.readNonNegativeNumber(
          item,
          "inputUsdPer1MTokens",
          `${path}[${index}].inputUsdPer1MTokens`
        ),
        outputUsdPer1MTokens: AppConfigService.readNonNegativeNumber(
          item,
          "outputUsdPer1MTokens",
          `${path}[${index}].outputUsdPer1MTokens`
        ),
        source: AppConfigService.readSafeIdentifier(
          item,
          "source",
          `${path}[${index}].source`
        )
      };
    });
  }

  private static loadJwt(
    env: NodeJS.ProcessEnv,
    productionLike: boolean
  ): JwtAuthConfig {
    const disabled =
      AppConfigService.normalize(env.AI_API_AUTH_DISABLED) === "true";
    const secret = AppConfigService.normalize(env.AI_API_JWT_SECRET);

    if (productionLike && disabled) {
      throw new Error(
        "AI_API_AUTH_DISABLED=true is not allowed in production-like deployments."
      );
    }

    const agentforceServiceBearers =
      AppConfigService.loadAgentforceServiceBearers(env);

    return {
      secret,
      issuer: AppConfigService.normalize(env.AI_API_JWT_ISSUER),
      audience: AppConfigService.normalize(env.AI_API_JWT_AUDIENCE),
      disabled,
      agentforceServiceBearer: agentforceServiceBearers[0],
      agentforceServiceBearers
    };
  }

  private static loadAgentforceServiceBearers(
    env: NodeJS.ProcessEnv
  ): AgentforceServiceBearerConfig[] {
    const bearers: AgentforceServiceBearerConfig[] = [];
    const legacyBearer = AppConfigService.loadAgentforceServiceBearer(env);
    if (legacyBearer) {
      bearers.push(legacyBearer);
    }

    const rawBearers = AppConfigService.normalize(
      env.AI_API_AGENTFORCE_BEARERS_JSON
    );
    if (rawBearers) {
      const parsed = AppConfigService.parseJsonValue(
        rawBearers,
        "AI_API_AGENTFORCE_BEARERS_JSON"
      );
      if (!Array.isArray(parsed)) {
        throw new Error("AI_API_AGENTFORCE_BEARERS_JSON must be a JSON array.");
      }
      parsed.forEach((item, index) => {
        if (!AppConfigService.isRecord(item)) {
          throw new Error(
            "AI_API_AGENTFORCE_BEARERS_JSON entries must be JSON objects."
          );
        }
        bearers.push(
          AppConfigService.readAgentforceServiceBearer(
            item,
            `AI_API_AGENTFORCE_BEARERS_JSON[${index}]`,
            env
          )
        );
      });
    }

    const seenHashes = new Set<string>();
    for (const bearer of bearers) {
      if (seenHashes.has(bearer.tokenSha256)) {
        throw new Error("Duplicate Agentforce service bearer token hash.");
      }
      seenHashes.add(bearer.tokenSha256);
    }
    return bearers;
  }

  private static loadAgentforceServiceBearer(
    env: NodeJS.ProcessEnv
  ): AgentforceServiceBearerConfig | undefined {
    const tokenSha256 = AppConfigService.normalize(
      env.AI_API_AGENTFORCE_BEARER_TOKEN_SHA256
    );
    if (!tokenSha256) {
      return undefined;
    }
    if (!/^[a-f0-9]{64}$/i.test(tokenSha256)) {
      throw new Error(
        "AI_API_AGENTFORCE_BEARER_TOKEN_SHA256 must be a 64-character SHA-256 hex digest."
      );
    }

    return {
      tokenSha256: tokenSha256.toLowerCase(),
      subject:
        AppConfigService.normalize(env.AI_API_AGENTFORCE_BEARER_SUBJECT) ??
        "salesforce-agentforce",
      tenantId:
        AppConfigService.normalize(env.AI_API_AGENTFORCE_BEARER_TENANT) ??
        "tenant-demo",
      ragNamespace:
        AppConfigService.normalize(
          env.AI_API_AGENTFORCE_BEARER_RAG_NAMESPACE
        ) ??
        AppConfigService.normalize(env.RAG_DEFAULT_NAMESPACE) ??
        "customer-self-service",
      scopes: AppConfigService.parseAuthList(
        env.AI_API_AGENTFORCE_BEARER_SCOPES,
        "agentforce:support-triage agentforce:case-analysis agentforce:knowledge-rag agentforce:services-project-health agentforce:revenue-account-health agentforce:revenue-portfolio-intelligence"
      ),
      roles: AppConfigService.parseAuthList(
        env.AI_API_AGENTFORCE_BEARER_ROLES,
        "support-agent"
      )
    };
  }

  private static loadOAuth(env: NodeJS.ProcessEnv): OAuthRuntimeConfig {
    const rawClients = AppConfigService.normalize(
      env.AI_API_OAUTH_CLIENTS_JSON
    );
    const clients: OAuthClientConfig[] = [];

    if (rawClients) {
      const parsed = AppConfigService.parseJsonValue(
        rawClients,
        "AI_API_OAUTH_CLIENTS_JSON"
      );
      if (!Array.isArray(parsed)) {
        throw new Error("AI_API_OAUTH_CLIENTS_JSON must be a JSON array.");
      }
      parsed.forEach((item, index) => {
        if (!AppConfigService.isRecord(item)) {
          throw new Error(
            "AI_API_OAUTH_CLIENTS_JSON entries must be JSON objects."
          );
        }
        clients.push(
          AppConfigService.readOAuthClient(
            item,
            `AI_API_OAUTH_CLIENTS_JSON[${index}]`,
            env
          )
        );
      });
    }

    const seenClientIds = new Set<string>();
    for (const client of clients) {
      if (seenClientIds.has(client.clientId)) {
        throw new Error("Duplicate OAuth client id.");
      }
      seenClientIds.add(client.clientId);
    }

    return {
      accessTokenTtlSeconds: AppConfigService.parseOAuthAccessTokenTtl(
        env.AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS
      ),
      clientSecretHashPepper: AppConfigService.normalize(
        env.AI_API_OAUTH_CLIENT_SECRET_PEPPER
      ),
      clients,
      tenantRegistry: AppConfigService.loadTenantRegistry(env)
    };
  }

  private static readOAuthClient(
    record: Record<string, unknown>,
    path: string,
    env: NodeJS.ProcessEnv
  ): OAuthClientConfig {
    const clientId =
      AppConfigService.readOptionalSafeIdentifier(record, "clientId") ??
      AppConfigService.readOptionalSafeIdentifier(record, "client_id");
    if (!clientId) {
      throw new Error(
        `${path}.clientId must be 1 to 128 safe identifier characters.`
      );
    }

    const clientSecretSha256 =
      AppConfigService.readOptionalString(record, "clientSecretSha256") ??
      AppConfigService.readOptionalString(record, "client_secret_sha256");
    if (!clientSecretSha256 || !/^[a-f0-9]{64}$/i.test(clientSecretSha256)) {
      throw new Error(
        `${path}.clientSecretSha256 must be a 64-character SHA-256 hex digest.`
      );
    }

    const pendingClientSecretSha256 =
      AppConfigService.readOptionalString(
        record,
        "pendingClientSecretSha256"
      ) ??
      AppConfigService.readOptionalString(
        record,
        "pending_client_secret_sha256"
      );
    if (
      pendingClientSecretSha256 !== undefined &&
      !/^[a-f0-9]{64}$/i.test(pendingClientSecretSha256)
    ) {
      throw new Error(
        `${path}.pendingClientSecretSha256 must be a 64-character SHA-256 hex digest.`
      );
    }

    const pendingSecretExpiresAt =
      AppConfigService.readOptionalString(record, "pendingSecretExpiresAt") ??
      AppConfigService.readOptionalString(record, "pending_secret_expires_at");
    if (
      pendingSecretExpiresAt !== undefined &&
      Number.isNaN(Date.parse(pendingSecretExpiresAt))
    ) {
      throw new Error(
        `${path}.pendingSecretExpiresAt must be an ISO datetime.`
      );
    }

    const tenantId =
      AppConfigService.readOptionalSafeIdentifier(record, "tenantId") ??
      AppConfigService.readOptionalSafeIdentifier(record, "tenant");
    if (!tenantId) {
      throw new Error(
        `${path}.tenantId must be 1 to 128 safe identifier characters.`
      );
    }

    const salesforceOrgId =
      AppConfigService.readOptionalSafeIdentifier(record, "salesforceOrgId") ??
      AppConfigService.readOptionalSafeIdentifier(record, "salesforce_org_id");
    if (!salesforceOrgId) {
      throw new Error(
        `${path}.salesforceOrgId must be 1 to 128 safe identifier characters.`
      );
    }

    const status =
      AppConfigService.readOptionalOAuthClientStatus(record, "status", path) ??
      "active";
    const ragNamespace =
      AppConfigService.readOptionalSafeIdentifier(record, "ragNamespace") ??
      AppConfigService.readOptionalSafeIdentifier(record, "rag_namespace") ??
      AppConfigService.normalize(env.RAG_DEFAULT_NAMESPACE) ??
      tenantId;

    return {
      clientId,
      clientSecretSha256: clientSecretSha256.toLowerCase(),
      pendingClientSecretSha256: pendingClientSecretSha256?.toLowerCase(),
      pendingSecretExpiresAt,
      subject:
        AppConfigService.readOptionalSafeIdentifier(record, "subject") ??
        `salesforce-org:${salesforceOrgId}`,
      tenantId,
      salesforceOrgId,
      salesforceInstanceUrl:
        AppConfigService.readOptionalUrl(
          record,
          "salesforceInstanceUrl",
          path
        ) ??
        AppConfigService.readOptionalUrl(
          record,
          "salesforce_instance_url",
          path
        ),
      ragNamespace,
      scopes: AppConfigService.readAuthList(
        record,
        "scopes",
        "agentforce:support-triage agentforce:case-analysis agentforce:knowledge-rag agentforce:services-project-health agentforce:revenue-account-health agentforce:revenue-portfolio-intelligence",
        `${path}.scopes`
      ),
      roles: AppConfigService.readAuthList(
        record,
        "roles",
        "salesforce-agentforce",
        `${path}.roles`
      ),
      status
    };
  }

  private static loadTenantRegistry(
    env: NodeJS.ProcessEnv
  ): TenantRegistryConfig {
    const provider =
      AppConfigService.normalize(env.AI_API_TENANT_REGISTRY_PROVIDER) ??
      "config";
    if (!["config", "postgres"].includes(provider)) {
      throw new Error(
        "AI_API_TENANT_REGISTRY_PROVIDER must be config or postgres."
      );
    }

    const databaseUrl =
      AppConfigService.normalize(env.AI_API_TENANT_REGISTRY_DATABASE_URL) ??
      AppConfigService.normalize(env.DATABASE_URL);
    if (provider === "postgres" && !databaseUrl) {
      throw new Error(
        "AI_API_TENANT_REGISTRY_DATABASE_URL or DATABASE_URL is required when AI_API_TENANT_REGISTRY_PROVIDER=postgres."
      );
    }

    return {
      provider: provider as TenantRegistryProvider,
      databaseUrl,
      autoMigrate: AppConfigService.parseBooleanFlag(
        env.AI_API_TENANT_REGISTRY_AUTO_MIGRATE,
        true,
        "AI_API_TENANT_REGISTRY_AUTO_MIGRATE"
      ),
      ssl: AppConfigService.parseBooleanFlag(
        env.AI_API_TENANT_REGISTRY_DATABASE_SSL,
        false,
        "AI_API_TENANT_REGISTRY_DATABASE_SSL"
      ),
      maxPoolSize: AppConfigService.parsePositiveInteger(
        env.AI_API_TENANT_REGISTRY_MAX_POOL_SIZE,
        5,
        "AI_API_TENANT_REGISTRY_MAX_POOL_SIZE"
      )
    };
  }

  private static parseOAuthAccessTokenTtl(
    rawValue: string | undefined
  ): number {
    const ttl = AppConfigService.parsePositiveInteger(
      rawValue,
      900,
      "AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS"
    );
    if (ttl < 300 || ttl > 3600) {
      throw new Error(
        "AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS must be from 300 to 3600 seconds."
      );
    }
    return ttl;
  }

  private static readOptionalOAuthClientStatus(
    record: Record<string, unknown>,
    key: string,
    path: string
  ): OAuthClientStatus | undefined {
    const value = AppConfigService.readOptionalString(record, key);
    if (value === undefined) return undefined;
    if (!["active", "suspended", "revoked"].includes(value)) {
      throw new Error(`${path}.${key} must be active, suspended, or revoked.`);
    }
    return value as OAuthClientStatus;
  }

  private static readAgentforceServiceBearer(
    record: Record<string, unknown>,
    path: string,
    env: NodeJS.ProcessEnv
  ): AgentforceServiceBearerConfig {
    const tokenSha256 =
      AppConfigService.readOptionalString(record, "tokenSha256") ??
      AppConfigService.readOptionalString(record, "token_sha256");
    if (!tokenSha256 || !/^[a-f0-9]{64}$/i.test(tokenSha256)) {
      throw new Error(
        `${path}.tokenSha256 must be a 64-character SHA-256 hex digest.`
      );
    }

    const subject =
      AppConfigService.readOptionalSafeIdentifier(record, "subject") ??
      "salesforce-agentforce";
    const tenantId =
      AppConfigService.readOptionalSafeIdentifier(record, "tenantId") ??
      AppConfigService.readOptionalSafeIdentifier(record, "tenant") ??
      "tenant-demo";
    const ragNamespace =
      AppConfigService.readOptionalSafeIdentifier(record, "ragNamespace") ??
      AppConfigService.readOptionalSafeIdentifier(record, "rag_namespace") ??
      AppConfigService.normalize(env.RAG_DEFAULT_NAMESPACE) ??
      "customer-self-service";

    return {
      tokenSha256: tokenSha256.toLowerCase(),
      subject,
      tenantId,
      ragNamespace,
      scopes: AppConfigService.readAuthList(
        record,
        "scopes",
        "agentforce:support-triage agentforce:case-analysis agentforce:knowledge-rag agentforce:services-project-health agentforce:revenue-account-health agentforce:revenue-portfolio-intelligence",
        `${path}.scopes`
      ),
      roles: AppConfigService.readAuthList(
        record,
        "roles",
        "support-agent",
        `${path}.roles`
      )
    };
  }

  private static loadAgentforceRuntime(
    env: NodeJS.ProcessEnv
  ): AgentforceRuntimeConfig {
    return {
      rateLimitWindowMs: AppConfigService.parsePositiveInteger(
        env.AGENTFORCE_RATE_LIMIT_WINDOW_MS,
        60000,
        "AGENTFORCE_RATE_LIMIT_WINDOW_MS"
      ),
      rateLimitMaxRequests: AppConfigService.parsePositiveInteger(
        env.AGENTFORCE_RATE_LIMIT_MAX_REQUESTS,
        60,
        "AGENTFORCE_RATE_LIMIT_MAX_REQUESTS"
      )
    };
  }

  private static loadSalesforceOnboarding(
    env: NodeJS.ProcessEnv
  ): SalesforceOnboardingConfig {
    const railwayPublicDomain = AppConfigService.normalize(
      env.RAILWAY_PUBLIC_DOMAIN
    );
    const rawPublicBaseUrl =
      AppConfigService.normalize(env.AI_API_PUBLIC_BASE_URL) ??
      AppConfigService.normalize(env.RAILWAY_SERVICE_AI_API_URL) ??
      (railwayPublicDomain ? `https://${railwayPublicDomain}` : undefined);

    return {
      publicBaseUrl: rawPublicBaseUrl
        ? AppConfigService.readUrl(
            { publicBaseUrl: rawPublicBaseUrl },
            "publicBaseUrl",
            "AI_API_PUBLIC_BASE_URL"
          )
        : undefined,
      namedCredentialApiName: AppConfigService.readSafeIdentifierEnv(
        env.AI_API_SALESFORCE_NAMED_CREDENTIAL,
        "Agentforce_AI_API_Phase2",
        "AI_API_SALESFORCE_NAMED_CREDENTIAL"
      ),
      externalCredentialApiName: AppConfigService.readSafeIdentifierEnv(
        env.AI_API_SALESFORCE_EXTERNAL_CREDENTIAL,
        "Agentforce_AI_API_Phase2",
        "AI_API_SALESFORCE_EXTERNAL_CREDENTIAL"
      ),
      principalApiName: AppConfigService.readSafeIdentifierEnv(
        env.AI_API_SALESFORCE_PRINCIPAL,
        "Agentforce_AI_API_Phase2_Principal",
        "AI_API_SALESFORCE_PRINCIPAL"
      ),
      permissionSetApiName: AppConfigService.readSafeIdentifierEnv(
        env.AI_API_SALESFORCE_PERMISSION_SET,
        "Services_Org_Intelligence_Agent",
        "AI_API_SALESFORCE_PERMISSION_SET"
      ),
      secureClientIdField: AppConfigService.readSafeIdentifierEnv(
        env.AI_API_SALESFORCE_CLIENT_ID_FIELD,
        "AI_API_OAUTH_CLIENT_ID",
        "AI_API_SALESFORCE_CLIENT_ID_FIELD"
      ),
      secureClientSecretField: AppConfigService.readSafeIdentifierEnv(
        env.AI_API_SALESFORCE_CLIENT_SECRET_FIELD,
        "AI_API_OAUTH_CLIENT_SECRET",
        "AI_API_SALESFORCE_CLIENT_SECRET_FIELD"
      ),
      tokenEndpointPath: "/oauth/token",
      projectHealthPath: "/agent/services/project-health",
      setupGuidePath: "docs/deployment/salesforce-oauth-onboarding-phase3.md"
    };
  }

  private static parseAuthList(
    rawValue: string | undefined,
    fallback: string
  ): string[] {
    const normalizedValue = AppConfigService.normalize(rawValue) ?? fallback;
    return Array.from(
      new Set(
        normalizedValue
          .split(/[\s,]+/)
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
  }

  private static readAuthList(
    record: Record<string, unknown>,
    key: string,
    fallback: string,
    path: string
  ): string[] {
    const value = record[key];
    if (value === undefined || value === null) {
      return AppConfigService.parseAuthList(undefined, fallback);
    }
    if (typeof value === "string") {
      return AppConfigService.parseAuthList(value, fallback);
    }
    if (Array.isArray(value)) {
      return Array.from(
        new Set(
          AppConfigService.parseStringArray(
            value,
            path,
            AppConfigService.isSafeIdentifier
          )
        )
      );
    }
    throw new Error(`${path} must be a string or JSON array.`);
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
    const responseCacheMaxItems = AppConfigService.parseNonNegativeInteger(
      env.RAG_RESPONSE_CACHE_MAX_ITEMS,
      256,
      "RAG_RESPONSE_CACHE_MAX_ITEMS"
    );
    const responseCacheTtlMs = AppConfigService.parsePositiveInteger(
      env.RAG_RESPONSE_CACHE_TTL_MS,
      300000,
      "RAG_RESPONSE_CACHE_TTL_MS"
    );
    if (responseCacheTtlMs > 3600000) {
      throw new Error("RAG_RESPONSE_CACHE_TTL_MS must be at most 3600000.");
    }
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
      responseCacheMaxItems,
      responseCacheTtlMs,
      rateLimitWindowMs,
      rateLimitMaxRequests,
      ingestRateLimitMaxRequests
    };
  }

  private static loadOpenAiGateway(
    env: NodeJS.ProcessEnv
  ): OpenAiCompatibleGatewayConfig {
    const ragModelId =
      AppConfigService.normalize(env.OPENAI_COMPAT_RAG_MODEL_ID) ??
      "knowledge-rag";
    if (ragModelId.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(ragModelId)) {
      throw new Error(
        "OPENAI_COMPAT_RAG_MODEL_ID must be 1 to 128 safe identifier characters."
      );
    }

    return {
      rateLimitWindowMs: AppConfigService.parsePositiveInteger(
        env.OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS,
        60000,
        "OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS"
      ),
      rateLimitMaxRequests: AppConfigService.parsePositiveInteger(
        env.OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS,
        120,
        "OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS"
      ),
      ragModelId
    };
  }

  private static loadCors(
    env: NodeJS.ProcessEnv,
    productionLike: boolean
  ): CorsConfig {
    const rawOrigins =
      AppConfigService.normalize(env.AI_API_CORS_ORIGINS) ??
      AppConfigService.normalize(env.CORS_ORIGIN);

    if (!rawOrigins) {
      return {
        allowedOrigins: productionLike
          ? []
          : [
              "http://localhost:5173",
              "http://127.0.0.1:5173",
              "http://localhost:4173",
              "http://127.0.0.1:4173"
            ]
      };
    }

    const allowedOrigins = rawOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => AppConfigService.parseCorsOrigin(origin));

    return { allowedOrigins: Array.from(new Set(allowedOrigins)) };
  }

  private static parseCorsOrigin(origin: string): string {
    if (origin === "*") {
      throw new Error(
        "AI_API_CORS_ORIGINS must list explicit http(s) origins; wildcard is not allowed."
      );
    }

    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error(
        "AI_API_CORS_ORIGINS must contain comma-separated valid http(s) origins."
      );
    }

    if (!["http:", "https:"].includes(parsedOrigin.protocol)) {
      throw new Error("AI_API_CORS_ORIGINS must contain only http(s) origins.");
    }
    if (
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search ||
      parsedOrigin.hash
    ) {
      throw new Error(
        "AI_API_CORS_ORIGINS entries must be origins only, without paths, queries, or fragments."
      );
    }

    return parsedOrigin.origin;
  }

  private static loadCustomerChatSession(
    env: NodeJS.ProcessEnv
  ): CustomerChatSessionConfig {
    return {
      accessCode: AppConfigService.normalize(env.CUSTOMER_CHAT_ACCESS_CODE),
      ttlSeconds: AppConfigService.parsePositiveInteger(
        env.CUSTOMER_CHAT_SESSION_TTL_SECONDS,
        7200,
        "CUSTOMER_CHAT_SESSION_TTL_SECONDS"
      ),
      rateLimitWindowMs: AppConfigService.parsePositiveInteger(
        env.CUSTOMER_CHAT_SESSION_RATE_LIMIT_WINDOW_MS,
        60000,
        "CUSTOMER_CHAT_SESSION_RATE_LIMIT_WINDOW_MS"
      ),
      rateLimitMaxRequests: AppConfigService.parsePositiveInteger(
        env.CUSTOMER_CHAT_SESSION_RATE_LIMIT_MAX_REQUESTS,
        10,
        "CUSTOMER_CHAT_SESSION_RATE_LIMIT_MAX_REQUESTS"
      )
    };
  }

  private static loadOperatorOrchestrationSession(
    env: NodeJS.ProcessEnv
  ): OperatorOrchestrationSessionConfig {
    return {
      accessCode: AppConfigService.normalize(
        env.ORCHESTRATOR_OPERATOR_ACCESS_CODE
      ),
      ttlSeconds: AppConfigService.parsePositiveInteger(
        env.ORCHESTRATOR_OPERATOR_SESSION_TTL_SECONDS,
        3600,
        "ORCHESTRATOR_OPERATOR_SESSION_TTL_SECONDS"
      ),
      rateLimitWindowMs: AppConfigService.parsePositiveInteger(
        env.ORCHESTRATOR_OPERATOR_SESSION_RATE_LIMIT_WINDOW_MS,
        60000,
        "ORCHESTRATOR_OPERATOR_SESSION_RATE_LIMIT_WINDOW_MS"
      ),
      rateLimitMaxRequests: AppConfigService.parsePositiveInteger(
        env.ORCHESTRATOR_OPERATOR_SESSION_RATE_LIMIT_MAX_REQUESTS,
        10,
        "ORCHESTRATOR_OPERATOR_SESSION_RATE_LIMIT_MAX_REQUESTS"
      )
    };
  }

  private static loadSalesforceConnection(
    env: NodeJS.ProcessEnv
  ): SalesforceConnectionConfig {
    const instanceUrl = AppConfigService.normalize(env.SF_INSTANCE_URL)
      ? AppConfigService.readUrl(
          { SF_INSTANCE_URL: AppConfigService.normalize(env.SF_INSTANCE_URL) },
          "SF_INSTANCE_URL",
          "SF_INSTANCE_URL"
        )
      : undefined;
    const tokenUrl = AppConfigService.normalize(env.SF_OAUTH_TOKEN_URL)
      ? AppConfigService.readUrl(
          {
            SF_OAUTH_TOKEN_URL: AppConfigService.normalize(
              env.SF_OAUTH_TOKEN_URL
            )
          },
          "SF_OAUTH_TOKEN_URL",
          "SF_OAUTH_TOKEN_URL"
        )
      : undefined;
    const clientId = AppConfigService.normalize(env.SF_OAUTH_CLIENT_ID);
    const clientSecret = AppConfigService.normalize(env.SF_OAUTH_CLIENT_SECRET);
    const rawApiVersion =
      AppConfigService.normalize(env.SF_API_VERSION) ?? "60.0";
    if (!/^\d{2,3}\.\d$/.test(rawApiVersion)) {
      throw new Error("SF_API_VERSION must look like 60.0.");
    }
    const enabled = Boolean(
      instanceUrl && tokenUrl && clientId && clientSecret
    );

    return {
      enabled,
      instanceUrl,
      tokenUrl,
      clientId,
      clientSecret,
      apiVersion: rawApiVersion,
      timeoutMs: AppConfigService.parsePositiveInteger(
        env.SF_OUTBOUND_TIMEOUT_MS,
        15000,
        "SF_OUTBOUND_TIMEOUT_MS"
      )
    };
  }

  private static loadOrchestrator(env: NodeJS.ProcessEnv): OrchestratorConfig {
    const rawMode =
      AppConfigService.normalize(env.ORCHESTRATOR_TRIAGE_APPROVAL_MODE) ??
      "auto";
    if (!TRIAGE_APPROVAL_MODES.includes(rawMode as TriageApprovalMode)) {
      throw new Error(
        `ORCHESTRATOR_TRIAGE_APPROVAL_MODE must be one of ${TRIAGE_APPROVAL_MODES.join(
          ", "
        )}.`
      );
    }
    return {
      triageApprovalMode: rawMode as TriageApprovalMode,
      persistence: AppConfigService.loadOrchestratorPersistence(env),
      salesforceWriteBack:
        AppConfigService.loadOrchestratorSalesforceWriteBack(env),
      customerHistory: AppConfigService.loadOrchestratorCustomerHistory(env),
      knowledge: AppConfigService.loadOrchestratorKnowledge(env),
      partsLogistics: AppConfigService.loadOrchestratorPartsLogistics(env),
      scheduling: AppConfigService.loadOrchestratorScheduling(env),
      guardrailApproval: AppConfigService.loadOrchestratorGuardrailApproval(env)
    };
  }

  private static loadOrchestratorGuardrailApproval(
    env: NodeJS.ProcessEnv
  ): OrchestratorGuardrailApprovalConfig {
    const emailEnabled = AppConfigService.parseBooleanFlag(
      env.ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED,
      false,
      "ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED"
    );
    const escalationEmailEnabled = AppConfigService.parseBooleanFlag(
      env.ORCHESTRATOR_GUARDRAIL_ESCALATION_EMAIL_ENABLED,
      false,
      "ORCHESTRATOR_GUARDRAIL_ESCALATION_EMAIL_ENABLED"
    );
    const salesforceApprovalEnabled = AppConfigService.parseBooleanFlag(
      env.ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED,
      false,
      "ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED"
    );
    const timeoutAction =
      AppConfigService.normalize(
        env.ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ACTION
      )?.toLowerCase() ?? "escalate";
    if (!["escalate", "reject"].includes(timeoutAction)) {
      throw new Error(
        "ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ACTION must be escalate or reject."
      );
    }
    const tokenSecret = AppConfigService.normalize(
      env.ORCHESTRATOR_APPROVAL_TOKEN_SECRET
    );
    const rawProvider =
      AppConfigService.normalize(
        env.ORCHESTRATOR_APPROVAL_EMAIL_PROVIDER
      )?.toLowerCase() ?? "log";
    if (!["log", "resend"].includes(rawProvider)) {
      throw new Error(
        "ORCHESTRATOR_APPROVAL_EMAIL_PROVIDER must be log or resend."
      );
    }
    const resendApiKey = AppConfigService.normalize(
      env.ORCHESTRATOR_APPROVAL_RESEND_API_KEY ?? env.RESEND_API_KEY
    );
    const emailFrom = AppConfigService.normalize(
      env.ORCHESTRATOR_APPROVAL_EMAIL_FROM
    );
    const emailTo = AppConfigService.normalize(
      env.ORCHESTRATOR_APPROVAL_EMAIL_TO
    );
    const rawLinkBase = AppConfigService.normalize(
      env.ORCHESTRATOR_APPROVAL_LINK_BASE_URL
    );
    const linkBaseUrl = rawLinkBase
      ? AppConfigService.readUrl(
          { ORCHESTRATOR_APPROVAL_LINK_BASE_URL: rawLinkBase },
          "ORCHESTRATOR_APPROVAL_LINK_BASE_URL",
          "ORCHESTRATOR_APPROVAL_LINK_BASE_URL"
        )
      : undefined;

    // Fail closed: enabling email without a signing secret, a public link
    // base, sender/recipient (and a Resend key for the resend provider)
    // would mint unsigned or undeliverable approve/reject links. Approvals
    // are security-critical, so require the full set rather than silently
    // degrading to log-only.
    if (emailEnabled) {
      const missing: string[] = [];
      if (!tokenSecret) missing.push("ORCHESTRATOR_APPROVAL_TOKEN_SECRET");
      if (!linkBaseUrl) missing.push("ORCHESTRATOR_APPROVAL_LINK_BASE_URL");
      if (!emailFrom) missing.push("ORCHESTRATOR_APPROVAL_EMAIL_FROM");
      if (!emailTo) missing.push("ORCHESTRATOR_APPROVAL_EMAIL_TO");
      if (rawProvider === "resend" && !resendApiKey) {
        missing.push("ORCHESTRATOR_APPROVAL_RESEND_API_KEY");
      }
      if (missing.length > 0) {
        throw new Error(
          `ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED=true requires ${missing.join(
            ", "
          )}.`
        );
      }
    }

    // Fail closed: Salesforce approval routing mints a workflow-scoped
    // callback token that the SF Flow presents to resume the workflow.
    // Without the signing secret the callback could not be authenticated,
    // so require it (6b+ phase plan §8 — "fails closed").
    if (salesforceApprovalEnabled && !tokenSecret) {
      throw new Error(
        "ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED=true requires ORCHESTRATOR_APPROVAL_TOKEN_SECRET."
      );
    }

    return {
      emailEnabled,
      escalationEmailEnabled,
      salesforceApprovalEnabled,
      salesforceApprovalProcess:
        AppConfigService.normalize(
          env.ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_PROCESS
        ) ?? "Agentforce_Guardrail_Approval",
      tokenSecret,
      tokenTtlSeconds: AppConfigService.parsePositiveInteger(
        env.ORCHESTRATOR_APPROVAL_TOKEN_TTL_SECONDS,
        86400,
        "ORCHESTRATOR_APPROVAL_TOKEN_TTL_SECONDS"
      ),
      emailProvider: rawProvider as OrchestratorApprovalEmailProvider,
      resendApiKey,
      emailFrom,
      emailTo,
      recipientRole:
        AppConfigService.normalize(env.ORCHESTRATOR_APPROVAL_RECIPIENT_ROLE) ??
        "account-manager",
      linkBaseUrl,
      rateLimitWindowMs: AppConfigService.parsePositiveInteger(
        env.ORCHESTRATOR_APPROVAL_RATE_LIMIT_WINDOW_MS,
        60000,
        "ORCHESTRATOR_APPROVAL_RATE_LIMIT_WINDOW_MS"
      ),
      rateLimitMaxRequests: AppConfigService.parsePositiveInteger(
        env.ORCHESTRATOR_APPROVAL_RATE_LIMIT_MAX_REQUESTS,
        20,
        "ORCHESTRATOR_APPROVAL_RATE_LIMIT_MAX_REQUESTS"
      ),
      timeout: {
        enabled: AppConfigService.parseBooleanFlag(
          env.ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED,
          false,
          "ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED"
        ),
        timeoutSeconds: AppConfigService.parsePositiveInteger(
          env.ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS,
          86400,
          "ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS"
        ),
        action: timeoutAction as "escalate" | "reject",
        scanSeconds: AppConfigService.parsePositiveInteger(
          env.ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SCAN_SECONDS,
          300,
          "ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SCAN_SECONDS"
        )
      }
    };
  }

  private static loadOrchestratorPartsLogistics(
    env: NodeJS.ProcessEnv
  ): OrchestratorPartsLogisticsConfig {
    return {
      enabled: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_PARTS_ENABLED,
        false,
        "AI_API_ORCHESTRATOR_PARTS_ENABLED"
      ),
      writesEnabled: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED,
        false,
        "AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED"
      )
    };
  }

  private static loadOrchestratorScheduling(
    env: NodeJS.ProcessEnv
  ): OrchestratorSchedulingConfig {
    return {
      enabled: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_SCHEDULING_ENABLED,
        false,
        "AI_API_ORCHESTRATOR_SCHEDULING_ENABLED"
      ),
      candidatesApiEnabled: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_SCHEDULING_CANDIDATES_API_ENABLED,
        false,
        "AI_API_ORCHESTRATOR_SCHEDULING_CANDIDATES_API_ENABLED"
      ),
      writesEnabled: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED,
        false,
        "AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED"
      )
    };
  }

  private static loadOrchestratorCustomerHistory(
    env: NodeJS.ProcessEnv
  ): OrchestratorCustomerHistoryConfig {
    const validPriorities: TriagePriorityDto[] = [
      "low",
      "normal",
      "high",
      "critical"
    ];
    const eligiblePriorities = AppConfigService.parseDelimitedList(
      env.AI_API_ORCHESTRATOR_CUSTOMER_HISTORY_ELIGIBLE_PRIORITIES
    )
      .map((value) => value.toLowerCase())
      .filter((value): value is TriagePriorityDto =>
        validPriorities.includes(value as TriagePriorityDto)
      );
    const eligibleOrigins = AppConfigService.parseDelimitedList(
      env.AI_API_ORCHESTRATOR_CUSTOMER_HISTORY_ELIGIBLE_ORIGINS
    );
    return {
      eligibility: {
        eligibleOrigins:
          eligibleOrigins.length > 0 ? eligibleOrigins : undefined,
        eligiblePriorities:
          eligiblePriorities.length > 0 ? eligiblePriorities : undefined
      },
      dataCloud: {
        enabled: AppConfigService.parseBooleanFlag(
          env.AI_API_ORCHESTRATOR_DATA_CLOUD_ENABLED,
          false,
          "AI_API_ORCHESTRATOR_DATA_CLOUD_ENABLED"
        )
      },
      externalAdapters: {
        erpEnabled: AppConfigService.parseBooleanFlag(
          env.AI_API_ORCHESTRATOR_ERP_ADAPTER_ENABLED,
          false,
          "AI_API_ORCHESTRATOR_ERP_ADAPTER_ENABLED"
        ),
        serviceNowEnabled: AppConfigService.parseBooleanFlag(
          env.AI_API_ORCHESTRATOR_SERVICENOW_ADAPTER_ENABLED,
          false,
          "AI_API_ORCHESTRATOR_SERVICENOW_ADAPTER_ENABLED"
        ),
        telemetryEnabled: AppConfigService.parseBooleanFlag(
          env.AI_API_ORCHESTRATOR_TELEMETRY_ADAPTER_ENABLED,
          false,
          "AI_API_ORCHESTRATOR_TELEMETRY_ADAPTER_ENABLED"
        )
      }
    };
  }

  private static parseDelimitedList(rawValue: string | undefined): string[] {
    const normalized = AppConfigService.normalize(rawValue);
    if (!normalized) {
      return [];
    }
    return Array.from(
      new Set(
        normalized
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
  }

  private static loadOrchestratorSalesforceWriteBack(
    env: NodeJS.ProcessEnv
  ): OrchestratorSalesforceWriteBackConfig {
    const enabled = AppConfigService.parseBooleanFlag(
      env.AI_API_ORCHESTRATOR_SF_WRITEBACK_ENABLED,
      false,
      "AI_API_ORCHESTRATOR_SF_WRITEBACK_ENABLED"
    );
    const rawUiBaseUrl = AppConfigService.normalize(
      env.AI_API_ORCHESTRATOR_UI_BASE_URL
    );
    const uiBaseUrl = rawUiBaseUrl
      ? AppConfigService.readUrl(
          { AI_API_ORCHESTRATOR_UI_BASE_URL: rawUiBaseUrl },
          "AI_API_ORCHESTRATOR_UI_BASE_URL",
          "AI_API_ORCHESTRATOR_UI_BASE_URL"
        )
      : undefined;
    return { enabled, uiBaseUrl };
  }

  private static loadOrchestratorPersistence(
    env: NodeJS.ProcessEnv
  ): OrchestratorPersistenceConfig {
    const provider =
      AppConfigService.normalize(
        env.AI_API_ORCHESTRATOR_PERSISTENCE_PROVIDER
      ) ?? "memory";
    if (!["memory", "postgres"].includes(provider)) {
      throw new Error(
        "AI_API_ORCHESTRATOR_PERSISTENCE_PROVIDER must be memory or postgres."
      );
    }

    const databaseUrl =
      AppConfigService.normalize(env.AI_API_ORCHESTRATOR_DATABASE_URL) ??
      AppConfigService.normalize(env.DATABASE_URL);
    if (provider === "postgres" && !databaseUrl) {
      throw new Error(
        "AI_API_ORCHESTRATOR_DATABASE_URL or DATABASE_URL is required when AI_API_ORCHESTRATOR_PERSISTENCE_PROVIDER=postgres."
      );
    }

    return {
      provider: provider as "memory" | "postgres",
      databaseUrl,
      autoMigrate: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_AUTO_MIGRATE,
        true,
        "AI_API_ORCHESTRATOR_AUTO_MIGRATE"
      ),
      ssl: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_DATABASE_SSL,
        false,
        "AI_API_ORCHESTRATOR_DATABASE_SSL"
      ),
      maxPoolSize: AppConfigService.parsePositiveInteger(
        env.AI_API_ORCHESTRATOR_MAX_POOL_SIZE,
        5,
        "AI_API_ORCHESTRATOR_MAX_POOL_SIZE"
      )
    };
  }

  private static loadOrchestratorKnowledge(
    env: NodeJS.ProcessEnv
  ): OrchestratorKnowledgeConfig {
    return {
      enabled: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED,
        false,
        "AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED"
      ),
      namespace: AppConfigService.normalize(
        env.AI_API_ORCHESTRATOR_KNOWLEDGE_NAMESPACE
      ),
      queryMaxChars: AppConfigService.parsePositiveInteger(
        env.AI_API_ORCHESTRATOR_KNOWLEDGE_QUERY_MAX_CHARS,
        200,
        "AI_API_ORCHESTRATOR_KNOWLEDGE_QUERY_MAX_CHARS"
      ),
      retrievalTopK: AppConfigService.parsePositiveInteger(
        env.AI_API_ORCHESTRATOR_KNOWLEDGE_RETRIEVAL_TOP_K,
        5,
        "AI_API_ORCHESTRATOR_KNOWLEDGE_RETRIEVAL_TOP_K"
      ),
      scoreThreshold: AppConfigService.parseScoreThreshold(
        env.AI_API_ORCHESTRATOR_KNOWLEDGE_SCORE_THRESHOLD,
        0.65
      ),
      extractionEnabled: AppConfigService.parseBooleanFlag(
        env.AI_API_ORCHESTRATOR_KNOWLEDGE_EXTRACTION_ENABLED,
        true,
        "AI_API_ORCHESTRATOR_KNOWLEDGE_EXTRACTION_ENABLED"
      )
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

  private static parseBooleanFlag(
    rawValue: string | undefined,
    fallback: boolean,
    name: string
  ): boolean {
    const normalizedValue = AppConfigService.normalize(rawValue);
    if (!normalizedValue) return fallback;
    if (normalizedValue === "true") return true;
    if (normalizedValue === "false") return false;
    throw new Error(`${name} must be true or false.`);
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

  private static readSafeIdentifierEnv(
    rawValue: string | undefined,
    fallback: string,
    name: string
  ): string {
    const value = AppConfigService.normalize(rawValue) ?? fallback;
    if (!AppConfigService.isSafeIdentifier(value)) {
      throw new Error(`${name} must be 1 to 128 safe identifier characters.`);
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

  private static parseJsonValue(value: string, name: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error(`${name} must contain valid JSON.`);
    }
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private static readOptionalString(
    record: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw new Error(`${key} must be a string.`);
    }
    return AppConfigService.normalize(value);
  }

  private static readSafeIdentifier(
    record: Record<string, unknown>,
    key: string,
    path: string
  ): string {
    const value = AppConfigService.readOptionalString(record, key);
    if (!value || !AppConfigService.isSafeIdentifier(value)) {
      throw new Error(`${path} must be 1 to 128 safe identifier characters.`);
    }
    return value;
  }

  private static readOptionalSafeIdentifier(
    record: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = AppConfigService.readOptionalString(record, key);
    if (value !== undefined && !AppConfigService.isSafeIdentifier(value)) {
      throw new Error(`${key} must be 1 to 128 safe identifier characters.`);
    }
    return value;
  }

  private static readSafeModelId(
    record: Record<string, unknown>,
    key: string,
    path: string
  ): string {
    const value = AppConfigService.readOptionalString(record, key);
    if (!value || !AppConfigService.isSafeModelId(value)) {
      throw new Error(`${path} must be 1 to 160 safe model id characters.`);
    }
    return value;
  }

  private static readOptionalSafeModelId(
    record: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = AppConfigService.readOptionalString(record, key);
    if (value !== undefined && !AppConfigService.isSafeModelId(value)) {
      throw new Error(`${key} must be 1 to 160 safe model id characters.`);
    }
    return value;
  }

  private static readUrl(
    record: Record<string, unknown>,
    key: string,
    path: string
  ): string {
    const value = AppConfigService.readOptionalString(record, key);
    if (!value) {
      throw new Error(`${path} must be a valid http(s) URL.`);
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${path} must be a valid http(s) URL.`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`${path} must be a valid http(s) URL.`);
    }
    return value.replace(/\/$/, "");
  }

  private static readOptionalUrl(
    record: Record<string, unknown>,
    key: string,
    path: string
  ): string | undefined {
    const value = AppConfigService.readOptionalString(record, key);
    if (!value) return undefined;
    return AppConfigService.readUrl({ [key]: value }, key, `${path}.${key}`);
  }

  private static readOptionalBoolean(
    record: Record<string, unknown>,
    key: string
  ): boolean | undefined {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "boolean") {
      throw new Error(`${key} must be a boolean.`);
    }
    return value;
  }

  private static readOptionalPositiveInteger(
    record: Record<string, unknown>,
    key: string,
    path: string
  ): number | undefined {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new Error(`${path} must be a positive integer.`);
    }
    return value;
  }

  private static readNonNegativeNumber(
    record: Record<string, unknown>,
    key: string,
    path: string
  ): number {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${path} must be a non-negative number.`);
    }
    return value;
  }

  private static parseStringArray(
    value: unknown,
    path: string,
    validator: (item: string) => boolean
  ): string[] {
    if (!Array.isArray(value)) {
      throw new Error(`${path} must be a JSON array.`);
    }
    return value.map((item, index) => {
      if (typeof item !== "string" || !validator(item)) {
        throw new Error(`${path}[${index}] contains an unsafe value.`);
      }
      return item;
    });
  }

  private static isSafeIdentifier(value: string): boolean {
    return (
      value.length > 0 &&
      value.length <= 128 &&
      /^[A-Za-z0-9_.:-]+$/.test(value)
    );
  }

  private static isSafeModelId(value: string): boolean {
    return (
      value.length > 0 &&
      value.length <= 160 &&
      /^[A-Za-z0-9_.:/@-]+$/.test(value)
    );
  }

  private static normalize(value: string | undefined): string | undefined {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : undefined;
  }
}

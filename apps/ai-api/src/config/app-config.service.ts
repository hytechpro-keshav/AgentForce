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
      telemetryEnabled
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

  private static parsePort(rawPort: string | undefined): number {
    const normalizedPort = AppConfigService.normalize(rawPort) ?? "3000";
    const port = Number(normalizedPort);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be an integer from 1 to 65535.");
    }

    return port;
  }

  private static normalize(value: string | undefined): string | undefined {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : undefined;
  }
}

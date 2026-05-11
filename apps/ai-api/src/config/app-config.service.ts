import { Injectable } from "@nestjs/common";

export interface AppRuntimeConfig {
  port: number;
  nodeEnv: string;
  agentforceHealthApiKey?: string;
  productionLike: boolean;
}

@Injectable()
export class AppConfigService {
  readonly port: number;
  readonly nodeEnv: string;
  readonly agentforceHealthApiKey?: string;
  readonly productionLike: boolean;

  constructor() {
    const config = AppConfigService.load(process.env);
    this.port = config.port;
    this.nodeEnv = config.nodeEnv;
    this.agentforceHealthApiKey = config.agentforceHealthApiKey;
    this.productionLike = config.productionLike;
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

    return {
      port: AppConfigService.parsePort(env.PORT),
      nodeEnv,
      agentforceHealthApiKey,
      productionLike
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

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type {
  HealthContextResponse,
  HealthLivenessResponse
} from "./health.types";

@Injectable()
export class HealthService {
  constructor(private readonly config: AppConfigService) {}

  getLiveness(): HealthLivenessResponse {
    return {
      status: "ok"
    };
  }

  getHealth(): HealthContextResponse {
    const configurationStatus = this.config.isHealthBridgeKeyConfigured
      ? "ok"
      : "degraded";

    return {
      status: configurationStatus,
      service: {
        name: "ai-api",
        version: process.env.npm_package_version ?? "0.1.0",
        environment: this.config.nodeEnv,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime())
      },
      salesforceBridge: {
        phase: "phase-1-external-bridge",
        namedCredential: "Agentforce_AI_API",
        apexAction: "AgentforceAiApiHealthCheck",
        endpoint: "/health"
      },
      deferredCapabilities: {
        providerRouting: "phase-2",
        rag: "phase-4",
        openWebUi: "phase-5",
        reactChat: "phase-6"
      },
      checks: [
        {
          name: "api",
          status: "ok"
        },
        {
          name: "phase-1-configuration",
          status: configurationStatus,
          details: this.config.isHealthBridgeKeyConfigured
            ? "Phase 1 health bridge authentication is configured."
            : "Phase 1 health bridge authentication is not configured for this non-production runtime."
        }
      ]
    };
  }
}

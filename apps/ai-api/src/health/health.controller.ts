import {
  Controller,
  Get,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "crypto";

import { AppConfigService } from "../config/app-config.service";
import { HealthService } from "./health.service";
import type {
  HealthContextResponse,
  HealthLivenessResponse
} from "./health.types";

@Controller("health")
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly config: AppConfigService
  ) {}

  @Get("live")
  getLiveness(): HealthLivenessResponse {
    return this.healthService.getLiveness();
  }

  @Get()
  getHealth(
    @Headers("x-agentforce-health-key") providedHealthKey?: string
  ): HealthContextResponse {
    this.assertHealthKey(providedHealthKey);
    return this.healthService.getHealth();
  }

  private assertHealthKey(providedHealthKey?: string): void {
    const expectedHealthKey = this.config.agentforceHealthApiKey;
    if (!expectedHealthKey) {
      throw new ServiceUnavailableException(
        "AI API health bridge credentials are not configured."
      );
    }

    if (
      !providedHealthKey ||
      !this.matchesHealthKey(providedHealthKey, expectedHealthKey)
    ) {
      throw new UnauthorizedException(
        "Invalid AI API health bridge credentials."
      );
    }
  }

  private matchesHealthKey(
    providedHealthKey: string,
    expectedHealthKey: string
  ): boolean {
    const providedDigest = createHash("sha256")
      .update(providedHealthKey)
      .digest();
    const expectedDigest = createHash("sha256")
      .update(expectedHealthKey)
      .digest();
    return timingSafeEqual(providedDigest, expectedDigest);
  }
}

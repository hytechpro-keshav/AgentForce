import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { RequireScopes } from "../auth/require-scopes.decorator";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { AgentforceRateLimitGuard } from "./agentforce-rate-limit.guard";
import { RevenueAccountHealthService } from "./revenue-account-health.service";
import { RevenuePortfolioIntelligenceService } from "./revenue-portfolio-intelligence.service";
import {
  RevenueAccountHealthRequestDto,
  RevenuePortfolioIntelligenceRequestDto,
  type RevenueAccountHealthResponseDto,
  type RevenuePortfolioIntelligenceResponseDto
} from "./dto/revenue-account-health.dto";

@Controller("agent/revenue")
export class RevenueAgentController {
  private readonly logger = new Logger(RevenueAgentController.name);

  constructor(
    private readonly revenueAccountHealthService: RevenueAccountHealthService,
    private readonly revenuePortfolioIntelligenceService: RevenuePortfolioIntelligenceService
  ) {}

  @RequireScopes("agentforce:revenue-account-health")
  @UseGuards(AgentforceRateLimitGuard)
  @Post("account-health")
  async summarizeAccountHealth(
    @Body() body: RevenueAccountHealthRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<RevenueAccountHealthResponseDto> {
    try {
      return await this.revenueAccountHealthService.summarize(
        body,
        request.authPrincipal
      );
    } catch (err) {
      throw this.toClientError(err, "revenue.account-health");
    }
  }

  @RequireScopes("agentforce:revenue-portfolio-intelligence")
  @UseGuards(AgentforceRateLimitGuard)
  @Post("portfolio-intelligence")
  async analyzePortfolioIntelligence(
    @Body() body: RevenuePortfolioIntelligenceRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<RevenuePortfolioIntelligenceResponseDto> {
    try {
      return await this.revenuePortfolioIntelligenceService.analyze(
        body,
        request.authPrincipal
      );
    } catch (err) {
      throw this.toClientError(err, "revenue.portfolio-intelligence");
    }
  }

  private toClientError(err: unknown, scope: string): Error {
    if (err instanceof LlmProviderError) {
      this.logger.warn(
        `${scope} provider error: provider=${err.provider} kind=${err.kind}`
      );
      if (err.kind === "validation") {
        return new ServiceUnavailableException({
          error: "provider_unavailable",
          provider: err.provider,
          kind: err.kind
        });
      }
      return new BadRequestException({
        error: "provider_unavailable",
        provider: err.provider,
        kind: err.kind
      });
    }
    return err instanceof Error ? err : new Error("Unknown error");
  }
}

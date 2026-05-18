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
import { ProjectHealthService } from "./project-health.service";
import {
  ProjectHealthRequestDto,
  type ProjectHealthResponseDto
} from "./dto/project-health.dto";

@Controller("agent/services")
export class ServicesAgentController {
  private readonly logger = new Logger(ServicesAgentController.name);

  constructor(private readonly projectHealthService: ProjectHealthService) {}

  @RequireScopes("agentforce:services-project-health")
  @UseGuards(AgentforceRateLimitGuard)
  @Post("project-health")
  async summarizeProjectHealth(
    @Body() body: ProjectHealthRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<ProjectHealthResponseDto> {
    try {
      return await this.projectHealthService.summarize(
        body,
        request.authPrincipal
      );
    } catch (err) {
      throw this.toClientError(err, "services.project-health");
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

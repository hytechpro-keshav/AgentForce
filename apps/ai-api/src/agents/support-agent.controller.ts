import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  ServiceUnavailableException
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { RequireScopes } from "../auth/require-scopes.decorator";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { CaseAnalysisService } from "./case-analysis.service";
import { SupportTriageService } from "./support-triage.service";
import {
  AnalyzeCaseRequestDto,
  type AnalyzeCaseResponseDto
} from "./dto/case-analysis.dto";
import {
  TriageCaseRequestDto,
  type TriageCaseResponseDto
} from "./dto/triage-case.dto";

@Controller("agent/support")
export class SupportAgentController {
  private readonly logger = new Logger(SupportAgentController.name);

  constructor(
    private readonly triageService: SupportTriageService,
    private readonly caseAnalysisService: CaseAnalysisService
  ) {}

  @RequireScopes("agentforce:support-triage")
  @Post("triage-case")
  async triageCase(
    @Body() body: TriageCaseRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<TriageCaseResponseDto> {
    try {
      return await this.triageService.triage(body, request.authPrincipal);
    } catch (err) {
      throw this.toClientError(err, "support.triage");
    }
  }

  @RequireScopes("agentforce:case-analysis")
  @Post("analyze-case")
  async analyzeCase(
    @Body() body: AnalyzeCaseRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<AnalyzeCaseResponseDto> {
    try {
      return await this.caseAnalysisService.analyze(
        body,
        request.authPrincipal
      );
    } catch (err) {
      throw this.toClientError(err, "support.analyze-case");
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

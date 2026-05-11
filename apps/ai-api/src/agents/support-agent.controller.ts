import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  ServiceUnavailableException
} from "@nestjs/common";

import { RequireScopes } from "../auth/require-scopes.decorator";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { SupportTriageService } from "./support-triage.service";
import {
  TriageCaseRequestDto,
  type TriageCaseResponseDto
} from "./dto/triage-case.dto";

@Controller("agent/support")
export class SupportAgentController {
  private readonly logger = new Logger(SupportAgentController.name);

  constructor(private readonly triageService: SupportTriageService) {}

  @RequireScopes("agentforce:support-triage")
  @Post("triage-case")
  async triageCase(
    @Body() body: TriageCaseRequestDto
  ): Promise<TriageCaseResponseDto> {
    try {
      return await this.triageService.triage(body);
    } catch (err) {
      if (err instanceof LlmProviderError) {
        this.logger.warn(
          `support.triage provider error: provider=${err.provider} kind=${err.kind}`
        );
        if (err.kind === "validation") {
          throw new ServiceUnavailableException({
            error: "provider_unavailable",
            provider: err.provider,
            kind: err.kind
          });
        }
        throw new BadRequestException({
          error: "provider_unavailable",
          provider: err.provider,
          kind: err.kind
        });
      }
      throw err;
    }
  }
}

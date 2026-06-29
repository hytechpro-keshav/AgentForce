import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  ServiceUnavailableException
} from "@nestjs/common";

import { RequireScopes } from "../auth/require-scopes.decorator";
import { OperatorOrchestrationSessionService } from "../auth/operator-orchestration-session.service";
import type { OperatorOrchestrationSessionResponseDto } from "../auth/dto/operator-orchestration-session.dto";
import { AppConfigService } from "../config/app-config.service";
import { DemoCaseCreateService } from "./demo-case-create.service";
import {
  DemoCaseCreateDto,
  DemoCaseCreateResponseDto
} from "./dto/demo-case-create.dto";

@Controller("demo")
export class DemoCaseCreateController {
  constructor(
    private readonly service: DemoCaseCreateService,
    private readonly config: AppConfigService,
    private readonly operatorSession: OperatorOrchestrationSessionService
  ) {}

  @RequireScopes("agentforce:demo-case-create")
  @Post("cases")
  @HttpCode(201)
  async create(
    @Body() body: DemoCaseCreateDto
  ): Promise<DemoCaseCreateResponseDto> {
    if (!this.config.demoCaseCreate.enabled) {
      throw new ForbiddenException({
        error: "demo_create_disabled",
        message: "Demo Case create is disabled."
      });
    }
    if (!this.service.isReady()) {
      throw new ServiceUnavailableException({
        error: "demo_create_unavailable",
        message: "Salesforce connectivity is not configured for demo Case create."
      });
    }
    return this.service.create(body);
  }

  @RequireScopes("agentforce:demo-case-create")
  @Post("orchestration-session")
  @HttpCode(200)
  orchestrationSession(): OperatorOrchestrationSessionResponseDto {
    if (!this.config.demoCaseCreate.enabled) {
      throw new ForbiddenException({
        error: "demo_create_disabled",
        message: "Demo Case create is disabled."
      });
    }
    return this.operatorSession.createTrustedDemoSession();
  }
}

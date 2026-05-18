import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { AgentforceRateLimitGuard } from "./agentforce-rate-limit.guard";
import { CaseAnalysisService } from "./case-analysis.service";
import { ProjectHealthService } from "./project-health.service";
import { ServicesAgentController } from "./services-agent.controller";
import { SupportAgentController } from "./support-agent.controller";
import { SupportTriageService } from "./support-triage.service";

@Module({
  imports: [LlmModule],
  controllers: [SupportAgentController, ServicesAgentController],
  providers: [
    SupportTriageService,
    CaseAnalysisService,
    ProjectHealthService,
    AgentforceRateLimitGuard
  ]
})
export class AgentsModule {}

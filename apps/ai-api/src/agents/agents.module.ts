import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { AgentforceRateLimitGuard } from "./agentforce-rate-limit.guard";
import { CaseAnalysisService } from "./case-analysis.service";
import { CustomerHistorySynthesisService } from "./customer-history.service";
import { ProjectHealthService } from "./project-health.service";
import { RevenueAccountHealthService } from "./revenue-account-health.service";
import { RevenueAgentController } from "./revenue-agent.controller";
import { RevenuePortfolioIntelligenceService } from "./revenue-portfolio-intelligence.service";
import { ServicesAgentController } from "./services-agent.controller";
import { SupportAgentController } from "./support-agent.controller";
import { SupportTriageService } from "./support-triage.service";

@Module({
  imports: [LlmModule],
  controllers: [
    SupportAgentController,
    ServicesAgentController,
    RevenueAgentController
  ],
  providers: [
    SupportTriageService,
    CustomerHistorySynthesisService,
    CaseAnalysisService,
    ProjectHealthService,
    RevenueAccountHealthService,
    RevenuePortfolioIntelligenceService,
    AgentforceRateLimitGuard
  ],
  exports: [SupportTriageService, CustomerHistorySynthesisService]
})
export class AgentsModule {}

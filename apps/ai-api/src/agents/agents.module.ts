import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { SupportAgentController } from "./support-agent.controller";
import { SupportTriageService } from "./support-triage.service";

@Module({
  imports: [LlmModule],
  controllers: [SupportAgentController],
  providers: [SupportTriageService]
})
export class AgentsModule {}

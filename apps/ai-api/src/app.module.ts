import { Module } from "@nestjs/common";

import { AgentsModule } from "./agents/agents.module";
import { AuthModule } from "./auth/auth.module";
import { ChatModule } from "./chat/chat.module";
import { AppConfigModule } from "./config/app-config.module";
import { HealthModule } from "./health/health.module";
import { LlmModule } from "./llm/llm.module";
import { ObservabilityModule } from "./observability/observability.module";
import { OpenAiCompatibleModule } from "./openai-compatible/openai-compatible.module";
import { RagModule } from "./rag/rag.module";

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    AuthModule,
    LlmModule,
    HealthModule,
    ChatModule,
    AgentsModule,
    RagModule,
    OpenAiCompatibleModule
  ]
})
export class AppModule {}

import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { RagModule } from "../rag/rag.module";
import { OpenAiCompatibleController } from "./openai-compatible.controller";
import { OpenAiCompatibleRateLimitGuard } from "./openai-compatible-rate-limit.guard";

@Module({
  imports: [LlmModule, RagModule],
  controllers: [OpenAiCompatibleController],
  providers: [OpenAiCompatibleRateLimitGuard]
})
export class OpenAiCompatibleModule {}

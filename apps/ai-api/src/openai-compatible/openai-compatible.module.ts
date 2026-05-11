import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { OpenAiCompatibleController } from "./openai-compatible.controller";

@Module({
  imports: [LlmModule],
  controllers: [OpenAiCompatibleController]
})
export class OpenAiCompatibleModule {}

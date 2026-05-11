import { Module } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { ModelRouter, LLM_PROVIDERS } from "./model-router";
import {
  OpenAiCompletionsProvider,
  OpenAiProviderFactory
} from "./providers/openai-completions.provider";
import type { LlmProvider } from "./interfaces/llm-provider";

@Module({
  providers: [
    OpenAiProviderFactory,
    {
      provide: LLM_PROVIDERS,
      inject: [OpenAiProviderFactory, AppConfigService],
      useFactory: (
        factory: OpenAiProviderFactory,
        _config: AppConfigService
      ): LlmProvider[] => {
        const providers: LlmProvider[] = [];
        const openAi = factory.createOpenAi();
        if (openAi) providers.push(openAi);
        const compat = factory.createOpenAiCompatible();
        if (compat) providers.push(compat);
        return providers;
      }
    },
    ModelRouter
  ],
  exports: [ModelRouter]
})
export class LlmModule {}

export { ModelRouter, OpenAiCompletionsProvider, LLM_PROVIDERS };

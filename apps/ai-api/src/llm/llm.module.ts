import { Module } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { EmbeddingRouter, EMBEDDING_PROVIDERS } from "./embedding-router";
import { ModelRouter, LLM_PROVIDERS } from "./model-router";
import {
  OpenAiCompletionsProvider,
  OpenAiProviderFactory
} from "./providers/openai-completions.provider";
import {
  EmbeddingProviderFactory,
  OpenAiEmbeddingsProvider
} from "./providers/openai-embeddings.provider";
import type { EmbeddingProvider } from "./interfaces/embedding-provider";
import type { LlmProvider } from "./interfaces/llm-provider";

@Module({
  providers: [
    OpenAiProviderFactory,
    EmbeddingProviderFactory,
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
    {
      provide: EMBEDDING_PROVIDERS,
      inject: [EmbeddingProviderFactory],
      useFactory: (factory: EmbeddingProviderFactory): EmbeddingProvider[] => {
        const providers: EmbeddingProvider[] = [];
        const openAi = factory.createOpenAi();
        if (openAi) providers.push(openAi);
        const deterministic = factory.createDeterministic();
        if (deterministic) providers.push(deterministic);
        return providers;
      }
    },
    ModelRouter,
    EmbeddingRouter
  ],
  exports: [ModelRouter, EmbeddingRouter]
})
export class LlmModule {}

export {
  ModelRouter,
  EmbeddingRouter,
  OpenAiCompletionsProvider,
  OpenAiEmbeddingsProvider,
  LLM_PROVIDERS,
  EMBEDDING_PROVIDERS
};

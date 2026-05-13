import { Module } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { EmbeddingRouter, EMBEDDING_PROVIDERS } from "./embedding-router";
import { ModelRouter, LLM_PROVIDERS } from "./model-router";
import { ModelRoutingPolicyService } from "./model-routing-policy.service";
import { AnthropicProviderFactory } from "./providers/anthropic-messages.provider";
import { GeminiProviderFactory } from "./providers/gemini-generate-content.provider";
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
    AnthropicProviderFactory,
    GeminiProviderFactory,
    EmbeddingProviderFactory,
    {
      provide: LLM_PROVIDERS,
      inject: [
        OpenAiProviderFactory,
        AnthropicProviderFactory,
        GeminiProviderFactory,
        AppConfigService
      ],
      useFactory: (
        factory: OpenAiProviderFactory,
        anthropicFactory: AnthropicProviderFactory,
        geminiFactory: GeminiProviderFactory,
        _config: AppConfigService
      ): LlmProvider[] => {
        const providers: LlmProvider[] = [];
        const openAi = factory.createOpenAi();
        if (openAi) providers.push(openAi);
        const azure = factory.createAzureOpenAi();
        if (azure) providers.push(azure);
        providers.push(...factory.createOpenAiCompatibleProviders());
        const anthropic = anthropicFactory.createAnthropic();
        if (anthropic) providers.push(anthropic);
        const gemini = geminiFactory.createGemini();
        if (gemini) providers.push(gemini);
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
    ModelRoutingPolicyService,
    ModelRouter,
    EmbeddingRouter
  ],
  exports: [ModelRouter, EmbeddingRouter]
})
export class LlmModule {}

export {
  ModelRouter,
  EmbeddingRouter,
  ModelRoutingPolicyService,
  OpenAiCompletionsProvider,
  OpenAiEmbeddingsProvider,
  LLM_PROVIDERS,
  EMBEDDING_PROVIDERS
};

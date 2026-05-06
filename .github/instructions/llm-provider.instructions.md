---
description: "Use when adding or changing LLM providers, embeddings, model routing, OpenAI-compatible gateways, Anthropic, Azure OpenAI, Gemini, OpenAI, or self-hosted model support."
applyTo:
  - "apps/ai-api/src/llm/**"
  - "packages/llm-core/**"
---

# LLM Provider Instructions

- Keep `ModelRouter` as the only dependency used by agent and chat services.
- Add vendors through `LlmProvider` and `EmbeddingProvider` interfaces.
- OpenAI is production v1, but routing must preserve future Anthropic, Azure OpenAI, Gemini, and OpenAI-compatible providers.
- Provider selection should be configuration-driven by tenant, use case, model capability, fallback state, and budget rules.
- Normalize provider responses into shared contracts for text, chat, streaming chunks, tool calls, model metadata, errors, and token usage.
- Streaming and non-streaming behavior must share the same safety, auth, logging, and usage accounting path.
- Provider errors should classify retryable, fallbackable, quota, auth, validation, and safety failures.
- Tests should verify provider selection, fallback, token accounting, streaming chunk shape, and OpenAI-compatible response compatibility.

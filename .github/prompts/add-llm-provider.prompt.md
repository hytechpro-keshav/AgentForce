---
description: "Add a model provider behind ModelRouter without coupling agent services to vendor SDKs."
agent: "Nest AI Architect"
argument-hint: "Provider name, chat model, embedding model, env vars, and fallback behavior"
tools: [read, search, edit]
---

Add the requested LLM or embedding provider using the provider abstraction.

Requirements:

- Agent services continue to call `ModelRouter` only.
- Provider implementation conforms to `LlmProvider` and/or `EmbeddingProvider`.
- Configuration validates required env vars and supports tenant/use-case routing.
- Errors are normalized into retryable, fallbackable, auth, quota, validation, and safety categories.
- Tests cover provider selection, fallback, token accounting, and normalized output shape.

Do not change Agentforce metadata unless the public response contract changes.

---
description: "Use when editing the NestJS AI API, Railway backend, LangChain services, provider registry, auth guards, DTOs, OpenAI-compatible gateway, or observability."
applyTo:
  - "apps/ai-api/**"
  - "src/**"
  - "packages/shared-contracts/**"
---

# NestJS AI API Instructions

- Use NestJS modules that match ownership boundaries: `auth`, `llm`, `rag`, `vector-db`, `salesforce`, `agents`, `chat`, `openai-compatible`, `observability`, and `health`.
- Controllers should validate DTOs, enforce auth, call services, and return structured responses. Keep business logic in services.
- Agent services must call `ModelRouter`, never OpenAI or another provider SDK directly.
- Public contracts should be versioned and tested with e2e tests. Salesforce-facing DTOs should stay backward compatible or use explicit versioned routes.
- Implement `/health`, `/agent/support/triage-case`, `/agent/knowledge/answer`, `/rag/ingest`, `/rag/search`, `/chat/message`, `/v1/models`, and `/v1/chat/completions` incrementally.
- Use configuration validation at boot for required env vars. Missing production secrets should fail startup clearly.
- Use structured errors with safe client messages and internal correlation IDs.
- Log token usage, latency, provider, model, retrieval IDs, and safety outcomes. Do not log secrets or raw sensitive prompts.
- Backend tests should mock providers, Pinecone, Salesforce, and Open WebUI gateway auth.

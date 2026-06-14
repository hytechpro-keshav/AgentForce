---
paths:
  - "apps/ai-api/**"
---

Read and follow `.github/instructions/nest-ai-api.instructions.md` before editing these files.

Key constraints:
- All agent/chat services call `ModelRouter`; never import vendor SDKs directly
- Add model vendors through `LlmProvider` and `EmbeddingProvider` interfaces
- Validate all DTOs, restrict CORS, limit request sizes, rate-limit public endpoints
- Do not log raw PII, secrets, full customer prompts, or sensitive RAG chunks
- Track token usage, latency, provider, model, tool calls, and retrieval IDs per request

Build: `npm run ai-api:build`
Test: `npm run ai-api:test`
E2E: `npm run ai-api:test:e2e`
Type check: `npm run ai-api:typecheck`

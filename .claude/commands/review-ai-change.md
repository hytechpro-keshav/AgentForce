# Review AI Change

Perform a focused review of the current AI-related code change. Follow the persona from `.github/agents/code-review-orchestrator.agent.md` and the checklist in `.github/prompts/review-ai-change.prompt.md`.

## Review Checklist

1. **Model routing** — does every agent/chat call go through `ModelRouter`? No direct vendor SDK imports?
2. **Provider interface** — new providers implement `LlmProvider` or `EmbeddingProvider`?
3. **Security** — authenticated traffic, validated DTOs, no raw PII or secrets in logs?
4. **Observability** — token usage, latency, provider, model, tool calls tracked per `gen_ai.*` conventions?
5. **RAG** — tenant isolation enforced, no raw chunks in error responses, source-grounded output?
6. **Tests** — unit tests, DTO validation, mocked provider tests, auth guard tests, e2e for public contracts?
7. **Salesforce** — if Agentforce actions changed: bulk-safe, testable, Named Credentials, eval coverage?

Report findings grouped by severity: **blocking** / **suggested** / **nit**.

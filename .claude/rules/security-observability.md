---
paths:
  - "apps/ai-api/src/**/auth/**"
  - "apps/ai-api/src/**/guards/**"
  - "apps/ai-api/src/**/middleware/**"
  - "apps/ai-api/src/**/interceptors/**"
  - "apps/ai-api/src/**/telemetry/**"
  - "apps/ai-api/src/**/observability/**"
---

Read and follow `.github/instructions/security-observability.instructions.md` before editing these files.
For security reviews, adopt the persona from `.github/agents/security-reviewer.agent.md`.

Key constraints:
- Require authenticated traffic between Salesforce↔NestJS, Open WebUI↔NestJS, React chat↔NestJS
- Never log raw PII, secrets, full prompts, API keys, or sensitive retrieved chunks
- Follow OpenTelemetry `gen_ai.*` conventions; telemetry must be no-op safe and never workflow-breaking
- Track: token usage, latency, provider, model, tool calls, retrieval IDs, safety outcomes, cost references
- Auth guard changes need: unit tests, guard tests, and e2e tests for the protected contract

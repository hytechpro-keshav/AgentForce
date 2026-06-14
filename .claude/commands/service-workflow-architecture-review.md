# Service Workflow Architecture Review

Architecture review of service workflows and orchestration design. Full details in `.github/prompts/service-workflow-architecture-review.prompt.md`.
Use the `nest-ai-architect` agent from `.claude/agents/nest-ai-architect.agent.md` for backend concerns.

## Review Dimensions

1. **Module boundaries** — clear separation between controllers, services, providers, RAG, Salesforce, auth, observability?
2. **ModelRouter usage** — all agent/chat calls routed through `ModelRouter`? No direct vendor SDK in service files?
3. **LangGraph contracts** — trigger signal, read context, write-back, and status event contracts explicit and typed?
4. **Salesforce boundary** — callouts use Named Credentials, Apex stays deterministic, no LLM logic in Apex?
5. **Approval / HITL** — pause/resume explicit and idempotent? Uses LangGraph persistence patterns?
6. **Observability** — token usage, latency, provider, tool calls tracked? No raw PII in logs?
7. **Provider switching** — runtime switching via config only? No service rewrite needed to swap a provider?
8. **Test coverage** — unit, DTO, provider mock, auth guard, e2e for public contracts?

Return architecture risks, contract gaps, missing tests, and prioritized recommended changes.

$ARGUMENTS

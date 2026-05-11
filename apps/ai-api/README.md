# AgentForce AI API

Phase 1 provides the NestJS health bridge that proves the
Salesforce Agentforce -> Apex -> Named Credential -> Railway NestJS path.
Phase 2 adds the provider-agnostic LLM foundation (`ModelRouter`,
`LlmProvider`, OpenAI + OpenAI-compatible providers, DTO-validated
`/chat/message`, `/agent/support/triage-case`, and the
OpenAI-compatible `/v1/models` and `/v1/chat/completions` gateway routes).

## Phase 2 Status

Status as of 2026-05-11: the backend foundation is implemented, deployed, and proven through `Customer_Self_Service_Agent` for the first Phase 2 support triage path.

- Agent and chat services call `ModelRouter`, not OpenAI directly.
- OpenAI is swappable by configuration through `LLM_DEFAULT_PROVIDER`, `LLM_FALLBACK_PROVIDER`, `OPENAI_*`, and `OPENAI_COMPAT_*` variables.
- OpenAI-compatible endpoint paths exist for future custom or self-hosted models: `GET /v1/models` and `POST /v1/chat/completions`.
- Validation captured in this session: `npm run ai-api:test` passed 38 tests, `npm run ai-api:test:e2e` passed 14 tests, `npm run ai-api:typecheck` succeeded, and `npm run ai-api:build` succeeded.
- Runtime proof: `Customer_Self_Service_Agent` invoked `Triage Support Case`, Salesforce called `Agentforce_AI_API_Phase2/agent/support/triage-case`, Railway routed through OpenAI `gpt-4o-mini`, and the agent returned a triage-only recommendation.
- Data masking proof: Apex masks common identifiers before the Salesforce callout, `ModelRouter` masks every LLM chat request before provider dispatch, and returned triage text is redacted again before Salesforce displays it.
- Cost telemetry proof: `TelemetryService` logs token counts plus estimated USD cost references for known priced models such as `gpt-4o-mini`, without logging raw prompt or completion text.

This completes the Phase 2 backend exit criteria and the first Salesforce Agentforce runtime proof for a provider-backed route. Detailed proof is in [../../docs/testing/phase2-agentforce-support-triage-proof.md](../../docs/testing/phase2-agentforce-support-triage-proof.md).

## Local Commands

```bash
npm run ai-api:dev
npm run ai-api:test
npm run ai-api:test:e2e
npm run ai-api:build
AI_API_BASE_URL=http://localhost:3000 AGENTFORCE_HEALTH_API_KEY=smoke-key npm run ai-api:smoke:health
```

## Health Contract (Phase 1)

`GET /health/live` returns minimal unauthenticated liveness for Railway health checks.

`GET /health` returns structured service context, the Salesforce bridge path, and explicit deferred phase markers for provider routing, RAG, Open WebUI, and React chat. It requires `X-Agentforce-Health-Key`; production-like deployments fail startup when `AGENTFORCE_HEALTH_API_KEY` is missing.

Set `AGENTFORCE_HEALTH_API_KEY` in Railway and inject the matching header from Salesforce Named Credential / External Credential configuration, not Apex source code.

For Railway, keep the service attached to the monorepo root. The root `railway.json` uses `npm ci`, `npm run ai-api:build`, and `npm run ai-api:start` so deployment uses the root `package-lock.json` and workspace scripts. The Railway health check path is `/health/live`.

Detailed Railway setup is in [../../docs/deployment/railway-ai-api-phase1.md](../../docs/deployment/railway-ai-api-phase1.md).

## Provider-Backed Contracts

All provider-backed routes require `Authorization: Bearer <jwt>` unless
`AI_API_AUTH_DISABLED=true`. Health routes remain public. The support triage route requires JWT scope `agentforce:support-triage`; the case-analysis route requires JWT scope `agentforce:case-analysis`.

- `POST /chat/message` — DTO-validated chat call. Body: `{ messages, provider?, model?, maxTokens?, requestId? }`. Returns normalized `{ content, usage, provider, model, fallbackUsed, attemptedProviders, latencyMs, responseId? }`.
- `POST /agent/support/triage-case` — Bulk-safe support triage helper. Body: `{ subject, description, reportedPriority?, caseId?, requestId? }`. Returns `{ recommendedPriority, summary, suggestedNextStep, provider, model, fallbackUsed, latencyMs }`.
- `POST /agent/support/analyze-case` — Phase 3 Support Operations case-analysis helper. Body: `{ caseSubject, caseDescription, caseStatus?, caseType?, caseOrigin?, reportedPriority?, caseId?, requestId? }`. Returns `{ summary, category, recommendedPriority, confidence, nextAction, provider, model, fallbackUsed, latencyMs }`.
- `GET /v1/models` — OpenAI-compatible model listing for Open WebUI-style clients.
- `POST /v1/chat/completions` — OpenAI-compatible chat completion (non-streaming). The `model` field selects the provider when it matches a registered provider name; otherwise the configured default provider is used.

Provider rules (see `.github/instructions/llm-provider.instructions.md` and ADR 0002):

- Agent and chat services depend on `ModelRouter` only.
- Vendor SDKs/HTTP live exclusively inside provider adapters.
- OpenAI is the production v1 provider; OpenAI-compatible providers cover Open WebUI-style self-hosted endpoints. Anthropic, Azure OpenAI, and Gemini remain extension paths.
- Provider selection is configuration-driven (`LLM_DEFAULT_PROVIDER`, `LLM_FALLBACK_PROVIDER`). Fallbackable errors (5xx, rate-limit, quota) trigger fallback; auth/validation/safety errors do not.

## Sensitive Data Masking

The support triage and case-analysis paths use defense in depth for customer data:

- `AgentforceAiApiSupportTriage` masks common names, emails, phone numbers, account/case/order identifiers, payment-card shaped values, SSNs, long numbers, Salesforce IDs, and street-address shaped values before sending the Salesforce callout to Railway.
- `AgentforceAiApiCaseAnalysis` applies the same masking approach before sending Phase 3 case-analysis callouts to Railway.
- `ModelRouter` applies the same redaction to every `LlmChatRequest` before any provider adapter is called, covering `/agent/support/triage-case`, `/chat/message`, and `/v1/chat/completions`.
- `SupportTriageService` redacts model output before returning summaries or next steps to Salesforce.
- `CaseAnalysisService` redacts parsed model output before returning summaries or next actions to Salesforce.

Masking is heuristic, not a substitute for policy. Agentforce topics should still avoid asking for raw customer identifiers unless a Salesforce-native verified workflow needs them.

## Environment Variables

Phase 1:

- `PORT` (default `3000`)
- `AGENTFORCE_HEALTH_API_KEY` — required in production-like (`NODE_ENV=production` or any `RAILWAY_*` variable set).

Phase 2 and Phase 3:

- `LLM_DEFAULT_PROVIDER` — default `openai`.
- `LLM_FALLBACK_PROVIDER` — optional secondary provider name.
- `OPENAI_API_KEY` — required before protected OpenAI-backed Phase 2 routes can complete successfully. If `LLM_DEFAULT_PROVIDER=openai` is set explicitly in a production-like deployment, startup fails closed when this is missing.
- `OPENAI_BASE_URL` — default `https://api.openai.com/v1`.
- `OPENAI_DEFAULT_MODEL` — default `gpt-4o-mini`.
- `OPENAI_COMPAT_BASE_URL` — enables the `openai-compatible` provider when set.
- `OPENAI_COMPAT_API_KEY` — optional bearer token for the self-hosted endpoint.
- `OPENAI_COMPAT_DEFAULT_MODEL` — default `default`.
- `AI_API_JWT_SECRET` — HS256 shared secret for protected provider-backed routes. Missing secrets fail closed at protected routes so Phase 1 health can stay online during staged setup.
- `AI_API_JWT_ISSUER`, `AI_API_JWT_AUDIENCE` — optional issuer/audience constraints.
- `AI_API_AUTH_DISABLED=true` — explicit dev/test escape hatch. Logs an unauthenticated profile.
- `AI_API_TELEMETRY_ENABLED=false` — disables the structured `gen_ai.*` telemetry sink. Telemetry is no-op safe by design.

For the deployed Railway app, set secrets in Railway variables only. Required production values for Phase 2 and Phase 3 are:

```text
NODE_ENV=production
AGENTFORCE_HEALTH_API_KEY=<Railway secret; also stored in Salesforce External Credential>
LLM_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=<Railway secret>
OPENAI_DEFAULT_MODEL=gpt-4o-mini
AI_API_JWT_SECRET=<Railway secret>
AI_API_JWT_ISSUER=salesforce-agentforce
AI_API_JWT_AUDIENCE=agentforce-ai-api
```

Use a model the configured OpenAI project can access. The current Railway proof uses `gpt-4o-mini`; direct OpenAI chat calls with `gpt-4.1-mini` returned `model_not_found` for this project. Do not set `AI_API_AUTH_DISABLED=true` in Railway production.

Optional Railway variables for later self-hosted/custom model tests:

```text
LLM_FALLBACK_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=https://<custom-openai-compatible-host>/v1
OPENAI_COMPAT_API_KEY=<Railway secret when the custom endpoint requires auth>
OPENAI_COMPAT_DEFAULT_MODEL=<custom-model-id>
```

Never commit any of the above values. Never log raw prompts, completions, secrets, or PII.

Phase 2 still does not implement LangChain, Pinecone, Open WebUI deployment wiring, or the React chat window. Those remain explicit deferred phases.

## Telemetry And Cost References

Phase 2 telemetry is no-op safe and records structured `gen_ai.*` fields into Railway logs.

- Token counts, latency, provider, model, fallback status, request id, and outcome are logged for provider calls.
- For known priced models, telemetry also logs static cost-reference fields such as `gen_ai.pricing.input_usd_per_1m_tokens`, `gen_ai.pricing.output_usd_per_1m_tokens`, and estimated request cost fields.
- Current built-in cost reference coverage is intentionally narrow: `gpt-4o-mini` is priced in code because it is the live production proof model. Unknown models still log tokens safely without cost fields.

These are cost references for observability, not authoritative billing exports.

# AgentForce AI API

Phase 1 provides the NestJS health bridge that proves the
Salesforce Agentforce -> Apex -> Named Credential -> Railway NestJS path.
Phase 2 adds the provider-agnostic LLM foundation (`ModelRouter`,
`LlmProvider`, OpenAI + OpenAI-compatible providers, DTO-validated
`/chat/message`, `/agent/support/triage-case`, and the
OpenAI-compatible `/v1/models` and `/v1/chat/completions` gateway routes).
Phase 4 adds production-sane Knowledge RAG with LangChain chunking/prompt
composition, OpenAI embeddings through `EmbeddingProvider`, Qdrant/Pinecone
behind `VectorStore`, and source-cited `/agent/knowledge/answer` responses.
Phase 7 adds configuration-driven provider/model routing, Anthropic/Azure
OpenAI/Gemini adapters, multiple OpenAI-compatible providers, per-use-case token
budget guardrails, cost-reference telemetry, fallback policy, and tenant-safe
RAG answer caching.

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

## Phase 4 Knowledge RAG Status

Status as of 2026-05-12: Phase 4 is implemented, deployed, and proven through
direct Railway API calls and `Customer_Self_Service_Agent` preview. The
no-Pinecone proof path uses a self-hosted Railway Qdrant service to avoid
initial Pinecone spend.

- `POST /rag/ingest` requires scope `rag:ingest`.
- `POST /rag/search` requires scope `rag:search`; diagnostic stale-source
  search additionally requires `rag:search:stale`.
- `POST /agent/knowledge/answer` requires scope `agentforce:knowledge-rag`.
- RAG services use `EmbeddingProvider` and `VectorStore`; they do not call
  OpenAI, Qdrant, or Pinecone directly outside provider/adapters.
- Tenant and namespace come from trusted JWT claims (`tenant`, `rag_namespace`
  or `namespace`) plus server config, not client-supplied values alone.
- Answers return structured sources and flat Agentforce-safe source strings.
- If no authorized source is found, the answer route returns `NO_SOURCE` and
  does not generate a generic model answer.
- Embeddings are normalized in `EmbeddingRouter` before storage/search so cosine
  similarity behavior is stable across providers.
- Zero-magnitude or invalid embeddings are rejected before storage/search.
- Embeddings are cached in-process by a SHA-256 key of provider/model/text so
  repeated identical chunks or queries avoid repeated OpenAI embedding calls.
- RAG routes have in-process rate limits keyed by tenant, subject, route, and
  client address. Defaults are 60 search/answer requests per minute and 10
  ingest requests per minute.
- Long documents are chunked before embedding. The default `RAG_CHUNK_SIZE=900`
  characters is roughly a 200 to 250 token target for typical English support
  text, with `RAG_CHUNK_OVERLAP=120` for continuity.
- Production vectors are stored in Qdrant by default; Pinecone remains a
  supported adapter. Tests and local deterministic runs use the in-memory vector
  store.

Final proof evidence:

- Railway deployment `7c310667-493f-4f69-a88e-0f930034b55f`.
- Qdrant collection `agentforce-knowledge-rag`, namespace
  `customer-self-service`.
- Direct answer request `phase4-rag-smoke-answer`, retrieval id
  `rag-f9a46283-1bc6-4403-aca3-8d0540ae76da`.
- Agentforce preview session `019e1b14-b15b-7eed-b6f7-b23ccc7bbcb4`, retrieval
  id `rag-65b4a589-7084-4168-b8f4-c6302ed5ad4e`.

Sample corpus and smoke script:

```bash
AI_API_BASE_URL=https://<ai-api>.up.railway.app \
AI_API_BEARER_TOKEN=<scoped-jwt> \
scripts/smoke/phase4-rag-ingest-sample.sh
```

Phase 4 implements LangChain/Qdrant RAG. Open WebUI production deployment and
the React customer chat window remain explicit later phases.

## Phase 7 Cost And Model Flexibility Status

Status as of 2026-05-13: Phase 7 backend routing and cost controls are
implemented locally in `apps/ai-api`.

- `ModelRouter` remains the only dependency used by chat, Agentforce support,
  Open WebUI, and RAG services.
- Provider adapters are available for OpenAI, Azure OpenAI, Anthropic, Gemini,
  and named OpenAI-compatible endpoints. They use mocked tests and do not
  require live vendor credentials locally.
- `MODEL_ROUTING_CONFIG_JSON` selects provider/model/fallback chains by use
  case: `customer_chat`, `openwebui_chat`, `openwebui_rag`,
  `agentforce_support_triage`, `agentforce_case_analysis`, `knowledge_rag`, and
  `generic_chat`.
- Small-model routing can be enabled per use case with a `smallModel` rule for
  low-complexity requests.
- Token budgets are enforced before provider calls. Request-level budgets are
  deterministic; `maxTokensPerMinute` is in-memory per process and is not
  durable monthly spend enforcement.
- Customer `chat:write` tokens always use the customer knowledge path. Direct
  provider/model diagnostic routing through `/chat/message` requires the
  additional `chat:diagnostic` scope.
- Fallback runs only for retryable, fallbackable, rate-limit, or quota provider
  failures. Auth, validation, safety, and budget failures do not fallback.
- RAG answer caching is in-process and tenant-safe. Keys are hashes over trusted
  tenant/access context, hashed question/context text, source IDs, chunk IDs,
  source versions, content hashes, embedding/vector context, and routing
  fingerprint. Raw questions, retrieved chunks, prompts, secrets, and provider
  payloads are not cached or logged.
- Phase 7 rollout details are in
  [../../docs/deployment/railway-ai-api-phase7.md](../../docs/deployment/railway-ai-api-phase7.md).

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

- `POST /chat/message` — DTO-validated chat call. Body: `{ messages, provider?, model?, maxTokens?, requestId? }`. Returns normalized `{ content, usage, provider, model, fallbackUsed, attemptedProviders, latencyMs, responseId? }`. Customer `chat:write` tokens use Knowledge RAG even if provider/model fields are present; direct diagnostic routing requires `chat:diagnostic`.
- `POST /agent/support/triage-case` — Bulk-safe support triage helper. Body: `{ subject, description, reportedPriority?, caseId?, requestId? }`. Returns `{ recommendedPriority, summary, suggestedNextStep, provider, model, fallbackUsed, latencyMs }`.
- `POST /agent/support/analyze-case` — Phase 3 Support Operations case-analysis helper. Body: `{ caseSubject, caseDescription, caseStatus?, caseType?, caseOrigin?, reportedPriority?, caseId?, requestId? }`. Returns `{ summary, category, recommendedPriority, confidence, nextAction, provider, model, fallbackUsed, latencyMs }`.
- `GET /v1/models` — OpenAI-compatible model listing for Open WebUI-style clients. Requires scope `openwebui:chat`. Phase 5 intentionally returns only `knowledge-rag` so Open WebUI does not show direct GPT/provider model options.
- `POST /v1/chat/completions` — OpenAI-compatible chat completion. Requires scope `openwebui:chat`. The `model` field selects the provider when it matches a registered provider name; otherwise the configured default provider is used. When `RAG_ENABLED=true`, virtual model `knowledge-rag` routes through the Phase 4 source-cited RAG answer path. `stream=true` returns a standards-shaped SSE envelope after the shared backend path completes; token-by-token provider streaming remains a later enhancement.

Provider rules (see `.github/instructions/llm-provider.instructions.md` and ADR 0002):

- Agent and chat services depend on `ModelRouter` only.
- Vendor SDKs/HTTP live exclusively inside provider adapters.
- OpenAI is the production v1 provider; OpenAI-compatible providers cover Open WebUI-style self-hosted endpoints. Anthropic, Azure OpenAI, and Gemini remain extension paths.
- Provider selection is configuration-driven (`LLM_DEFAULT_PROVIDER`, `LLM_FALLBACK_PROVIDER`). Fallbackable errors (5xx, rate-limit, quota) trigger fallback; auth/validation/safety errors do not.

Phase 7 expands provider selection with `MODEL_ROUTING_CONFIG_JSON`. Existing
`LLM_DEFAULT_PROVIDER` and `LLM_FALLBACK_PROVIDER` remain the default route when
no use-case-specific routing JSON is configured.

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
- `AI_API_AUTH_DISABLED=true` — explicit local dev/test escape hatch. Production-like deployments fail startup if this is set.
- `AI_API_TELEMETRY_ENABLED=false` — disables the structured `gen_ai.*` telemetry sink. Telemetry is no-op safe by design.

Phase 4 RAG:

- `RAG_ENABLED=true` — enables RAG routes; disabled routes fail closed with
  `rag_not_configured`.
- `DEFAULT_EMBEDDING_PROVIDER` — `openai` in production, `deterministic` only
  for local deterministic tests.
- `OPENAI_EMBEDDING_MODEL` — default `text-embedding-3-small`.
- `VECTOR_DB_PROVIDER` — default `qdrant`; `pinecone` remains supported;
  `memory` is only for local deterministic tests.
- `QDRANT_URL` — Qdrant REST endpoint, for example
  `http://qdrant.railway.internal:6333` on Railway private networking.
- `QDRANT_API_KEY` — optional Qdrant API key stored only in Railway variables.
- `QDRANT_COLLECTION` — default `agentforce-knowledge-rag`.
- `QDRANT_VECTOR_SIZE` — default `1536` for `text-embedding-3-small`.
- `QDRANT_DISTANCE` — default `Cosine`.
- `VECTOR_DB_API_KEY` — legacy Pinecone API key if `VECTOR_DB_PROVIDER=pinecone`.
- `VECTOR_DB_INDEX` — legacy Pinecone index name; also accepted as a fallback
  collection name for Qdrant.
- `RAG_DEFAULT_NAMESPACE` or `VECTOR_DB_NAMESPACE` — default
  `customer-self-service`.
- `RAG_CHUNK_SIZE` — default `900`.
- `RAG_CHUNK_OVERLAP` — default `120`.
- `RAG_TOP_K` — default `4`.
- `RAG_SCORE_THRESHOLD` — default `0.68` for the validated Qdrant path.
- `EMBEDDING_CACHE_MAX_ITEMS` — default `2048`; set `0` to disable the
  in-process normalized embedding cache for repeated queries/chunks.
- `RAG_RATE_LIMIT_WINDOW_MS` — default `60000`.
- `RAG_RATE_LIMIT_MAX_REQUESTS` — default `60` for search/answer routes.
- `RAG_INGEST_RATE_LIMIT_MAX_REQUESTS` — default `10` for ingestion.

Phase 5 Open WebUI gateway:

- `OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS` — default `60000`.
- `OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS` — default `120` for
  `/v1/chat/completions`.
- `OPENAI_COMPAT_RAG_MODEL_ID` — default `knowledge-rag`; exposed from
  `/v1/models` only when `RAG_ENABLED=true`.

Phase 7 providers, routing, budgets, pricing, and cache:

- `OPENAI_COMPAT_PROVIDERS_JSON` — optional array of named OpenAI-compatible
  providers, each with `name`, `baseUrl`, `defaultModel`, and optional `apiKey`.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_MODEL` — enable
  the Anthropic messages provider.
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`,
  `AZURE_OPENAI_CHAT_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`,
  `AZURE_OPENAI_CHAT_MODEL` — enable the Azure OpenAI chat-completions provider.
- `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_DEFAULT_MODEL` — enable the
  Gemini generateContent provider.
- `MODEL_ROUTING_CONFIG_JSON` — use-case route rules with `provider`, `model`,
  `fallbacks`, `smallModel`, `budget`, override flags, and optional pricing.
  Providers named in routing JSON must be configured; missing route providers
  fail closed rather than falling through to fallback.
- `MODEL_PRICING_JSON` — optional array of exact provider/model pricing
  references for telemetry cost estimates.
- `RAG_RESPONSE_CACHE_MAX_ITEMS` — default `256`; set `0` to disable the
  in-process RAG answer cache.
- `RAG_RESPONSE_CACHE_TTL_MS` — default `300000`, maximum `3600000`.

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

Never commit any of the above values. Never log raw prompts, completions, secrets, retrieved chunks, provider bodies, JWTs, or PII.

Phase 5 adds Open WebUI internal-console wiring through the OpenAI-compatible
gateway. Open WebUI must store a scoped NestJS JWT with `openwebui:chat` in its
`OPENAI_API_KEY` setting, not the real OpenAI key. React customer chat remains
an explicit deferred Phase 6.

## Telemetry And Cost References

Phase 2 telemetry is no-op safe and records structured `gen_ai.*` fields into Railway logs.

- Token counts, latency, provider, model, fallback status, request id, and outcome are logged for provider calls.
- For known priced models, telemetry also logs static cost-reference fields such as `gen_ai.pricing.input_usd_per_1m_tokens`, `gen_ai.pricing.output_usd_per_1m_tokens`, and estimated request cost fields.
- Current built-in cost reference coverage is intentionally narrow: `gpt-4o-mini` is priced in code because it is the live production proof model. Unknown models still log tokens safely without cost fields.

These are cost references for observability, not authoritative billing exports.
Phase 7 can add configured pricing references for additional providers/models;
unknown pricing safely omits cost fields while preserving token and routing
telemetry.

# Phase 7 — AI API Cost Optimization And Model Flexibility

Date: 2026-05-13

This runbook covers the backend-only Phase 7 changes for `apps/ai-api`: provider flexibility, use-case model routing, small-model routing, token budgets, fallback rules, cost-reference telemetry, and tenant-safe RAG answer caching.

## Service Shape

```text
Agentforce / Open WebUI / Customer Chat
  -> NestJS AI API
    -> ModelRouter
      -> model routing policy
      -> token budget checks
      -> provider adapter chain
      -> telemetry
    -> optional RAG answer cache after tenant-filtered retrieval
```

Agent, chat, Open WebUI, and RAG services still call `ModelRouter` only. Vendor HTTP details live only in provider adapters under `apps/ai-api/src/llm/providers`.

## Provider Variables

Existing OpenAI variables still work:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (default `https://api.openai.com/v1`)
- `OPENAI_DEFAULT_MODEL` (default `gpt-4o-mini`)

Self-hosted or custom OpenAI-compatible endpoints:

- `OPENAI_COMPAT_BASE_URL`
- `OPENAI_COMPAT_API_KEY` (optional)
- `OPENAI_COMPAT_DEFAULT_MODEL` (default `default`)
- `OPENAI_COMPAT_PROVIDERS_JSON` for multiple named compatible providers:

```json
[
  {
    "name": "local-llama",
    "baseUrl": "https://llm.internal/v1",
    "defaultModel": "llama-3.1-8b",
    "apiKey": "optional-secret-value"
  }
]
```

Do not put secret JSON values in shell history. On Railway, set JSON through a private variable editor or `railway variable set KEY --stdin`.

Anthropic:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL` (default `https://api.anthropic.com/v1`)
- `ANTHROPIC_DEFAULT_MODEL` (default `claude-3-5-haiku-latest`)

Azure OpenAI:

- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_CHAT_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION` (default `2024-10-21`)
- `AZURE_OPENAI_CHAT_MODEL` (defaults to the deployment name for telemetry/model metadata)

Gemini:

- `GEMINI_API_KEY`
- `GEMINI_BASE_URL` (default `https://generativelanguage.googleapis.com/v1beta`)
- `GEMINI_DEFAULT_MODEL` (default `gemini-1.5-flash`)

## Routing Policy

`MODEL_ROUTING_CONFIG_JSON` controls provider/model selection by use case. Supported use cases:

- `customer_chat`
- `openwebui_chat`
- `openwebui_rag`
- `agentforce_support_triage`
- `agentforce_case_analysis`
- `agentforce_services_project_health`
- `knowledge_rag`
- `generic_chat`

Example:

```json
{
  "routes": {
    "customer_chat": {
      "provider": "openai-compatible",
      "model": "local-small",
      "smallModel": {
        "provider": "openai-compatible",
        "model": "local-tiny",
        "maxInputTokens": 500,
        "maxMessages": 6
      },
      "fallbacks": [{ "provider": "openai", "model": "gpt-4o-mini" }],
      "budget": {
        "maxInputTokensPerRequest": 2000,
        "maxOutputTokensPerRequest": 512,
        "maxTotalTokensPerRequest": 2500,
        "maxTokensPerMinute": 20000
      },
      "allowProviderOverride": false,
      "allowModelOverride": false
    },
    "agentforce_support_triage": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "budget": {
        "maxOutputTokensPerRequest": 256,
        "maxTokensPerMinute": 10000
      }
    }
  },
  "pricing": [
    {
      "provider": "openai-compatible",
      "model": "local-small",
      "inputUsdPer1MTokens": 0.01,
      "outputUsdPer1MTokens": 0.02,
      "source": "internal_reference"
    }
  ]
}
```

Fallbacks run only for provider errors classified as `retryable`, `fallbackable`, `rate_limit`, or `quota`. They do not run for auth, validation, safety, or budget failures.

Streaming and non-streaming calls share the same routing, redaction, budget, fallback, and telemetry path. Streaming routes require the resolved provider chain to use streaming-capable providers; a non-streaming provider in the route is a validation error, not an implicit fallback. Anthropic and Gemini are non-streaming adapters in this phase.

## Token Budgets

Budgets are enforced before provider calls using a conservative input-token estimate and the requested or configured max output tokens.

- `maxInputTokensPerRequest`
- `maxOutputTokensPerRequest`
- `maxTotalTokensPerRequest`
- `maxTokensPerMinute`

`maxTokensPerMinute` is in-memory per AI API process, keyed by use case plus a hashed client/tenant reference. It is useful as a local guardrail, but it is not durable monthly spend enforcement and resets on process restart or redeploy. Durable monthly or account-level budget enforcement needs shared storage or billing export integration in a later phase.

When `maxTokensPerMinute` is configured, the route must also define `maxOutputTokensPerRequest` or `maxTotalTokensPerRequest` so the reservation cannot undercount output tokens.

## Cost Reference Telemetry

Telemetry emits token counts, route metadata, budget outcome, fallback metadata, and cost estimates only when pricing is configured or built in. Unknown pricing is safe: token telemetry is still emitted, but cost fields are omitted.

Additional pricing can be supplied either inside `MODEL_ROUTING_CONFIG_JSON.pricing` or with `MODEL_PRICING_JSON`:

```json
[
  {
    "provider": "openai-compatible",
    "model": "local-small",
    "inputUsdPer1MTokens": 0.01,
    "outputUsdPer1MTokens": 0.02,
    "source": "internal_reference"
  }
]
```

Telemetry does not log raw prompts, retrieved chunks, provider response bodies, secrets, access tokens, or full provider payloads.

## RAG Answer Cache

RAG answer caching is in-process and happens only after retrieval has filtered by trusted tenant, namespace, and access metadata. Cache keys are SHA-256 hashes over safe context:

- tenant and namespace
- hashed subject plus scopes and roles
- hashed question and context summary
- source IDs, chunk IDs, document versions, content hashes, stale/deleted flags, hashed prompt-visible source metadata, and access metadata
- embedding provider/model and vector DB provider
- use case and routing fingerprint

The cache stores the safe generated answer plus provider/model metadata. It does not store raw questions, raw chunks, prompts, or provider payloads.

Variables:

- `RAG_RESPONSE_CACHE_MAX_ITEMS` (default `256`, set `0` to disable)
- `RAG_RESPONSE_CACHE_TTL_MS` (default `300000`, maximum `3600000`)

A cache hit returns usage `{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }` because no provider call was made. Cache metrics are emitted through `gen_ai.rag.cache_hit` and `gen_ai.rag.cache_key_hash`.

## Rollout

1. Configure provider credentials first. Do not switch routing until `/health/live` and existing routes are healthy.
2. Add `MODEL_ROUTING_CONFIG_JSON` with one low-risk use case first, such as `agentforce_support_triage`.
3. Keep `LLM_DEFAULT_PROVIDER=openai` during the first rollout unless the target provider has already passed smoke tests.
4. Add fallbacks from the experimental provider to OpenAI, not the reverse, until production behavior is known.
5. Set pricing references only for models whose pricing source is approved.
6. Start with conservative `RAG_RESPONSE_CACHE_TTL_MS` and disable with `RAG_RESPONSE_CACHE_MAX_ITEMS=0` if source freshness is uncertain.

Every provider named in `MODEL_ROUTING_CONFIG_JSON` must have its provider variables configured before traffic reaches that route. Missing route providers fail closed with a validation error; they do not silently fall through to fallback providers.

`AI_API_AUTH_DISABLED=true` is local-only. Production-like deployments fail startup if it is set.

## Smoke Checks

Run local validation before deployment:

```bash
npm run ai-api:typecheck
npm run ai-api:test
npm run ai-api:test:e2e
npm run ai-api:build
npm run prettier:verify
```

After deployment, smoke the same public contracts already used by earlier phases:

```bash
curl -sS https://<ai-api-domain>/health/live

curl -sS -X POST https://<ai-api-domain>/chat/message \
  -H "authorization: Bearer $CHAT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}],"requestId":"phase7-chat-smoke"}'

curl -sS -X POST https://<ai-api-domain>/agent/knowledge/answer \
  -H "authorization: Bearer $RAG_TOKEN" \
  -H "content-type: application/json" \
  -d '{"question":"approved troubleshooting guidance","requestId":"phase7-rag-smoke"}'
```

Check telemetry for safe fields only: provider, model, use case, routing rule, model tier, budget outcome, fallback outcome, token counts, cost reference when configured, and RAG cache hit/miss. Do not inspect or print secret values through Railway CLI output.

## Rollback

- To disable RAG answer caching: set `RAG_RESPONSE_CACHE_MAX_ITEMS=0` and redeploy.
- To revert routing policy: unset `MODEL_ROUTING_CONFIG_JSON` and `MODEL_PRICING_JSON`, then redeploy. The router returns to `LLM_DEFAULT_PROVIDER` plus optional `LLM_FALLBACK_PROVIDER` behavior.
- To remove an experimental provider: unset its provider-specific variables and remove it from routing JSON before redeploy.
- If a provider returns auth or validation errors, fix credentials/model names; fallback intentionally does not mask those failures.

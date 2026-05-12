# Railway Open WebUI Phase 5

Date: 2026-05-12

## Scope

This runbook covers Phase 5 only: Open WebUI as the internal AI console routed
through the NestJS AI API OpenAI-compatible gateway. It does not deploy Phase 6
React customer chat.

```text
Internal user
  -> Open WebUI on Railway
  -> NestJS AI API /v1/models and /v1/chat/completions
  -> ModelRouter or knowledge-rag virtual model
  -> OpenAI / Qdrant through backend-owned providers
```

Open WebUI must not call OpenAI directly, must not receive the real OpenAI API
key, and must not store Salesforce or Qdrant credentials.

## Current AI API Baseline

Preserve the Phase 4 production facts:

| Area                    | Value                                           |
| ----------------------- | ----------------------------------------------- |
| AI API URL              | `https://ai-api-production-03f5.up.railway.app` |
| AI API deployment proof | `9832cea7-a2a7-4043-9ccc-0919f69126c4`          |
| Vector DB               | Railway Qdrant                                  |
| Qdrant collection       | `agentforce-knowledge-rag`                      |
| RAG namespace           | `customer-self-service`                         |
| Embeddings              | `text-embedding-3-small`                        |
| Answer model            | `gpt-4o-mini`                                   |
| RAG threshold           | `RAG_SCORE_THRESHOLD=0.68`                      |

## AI API Phase 5 Contract

Phase 5 tightens the OpenAI-compatible gateway:

- `GET /v1/models` requires JWT scope `openwebui:chat` and returns only
  `knowledge-rag` for the Phase 5 Open WebUI dropdown.
- `POST /v1/chat/completions` requires JWT scope `openwebui:chat`.
- direct GPT/provider model ids remain API-callable through `ModelRouter` for
  compatibility, but they are not listed for Open WebUI.
- virtual model `knowledge-rag` routes through Phase 4 `RagAnswerService` and
  returns source metadata in the assistant content.
- gateway rate limiting uses
  `OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS` and
  `OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS`.
- OpenAI-compatible DTO validation accepts common Open WebUI parameters such as
  `stream`, `max_completion_tokens`, `temperature`, `top_p`, `stop`, and
  `tools`; `stream=true` returns an SSE envelope after the shared backend path
  completes. Token-by-token provider streaming remains a later enhancement.
- `/chat/message` remains protected separately by `chat:write`, so an Open
  WebUI gateway token cannot bypass the Phase 5 `/v1` gateway.

AI API variables to add or confirm:

```text
AI_API_JWT_SECRET=<Railway secret already used by protected AI API routes>
AI_API_JWT_ISSUER=salesforce-agentforce
AI_API_JWT_AUDIENCE=agentforce-ai-api
OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS=60000
OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS=120
OPENAI_COMPAT_RAG_MODEL_ID=knowledge-rag
```

Keep existing Phase 4 RAG variables unchanged unless release owners approve a
retune.

## Open WebUI Railway Service

Create a separate Railway service:

```text
service=openwebui
root=apps/openwebui
builder=Dockerfile
healthcheck=/health
volume=/app/backend/data
url=https://openwebui-production-0f51.up.railway.app
deployment=7ae31cc8-eef3-4418-9616-95634a839ced
volume=openwebui-volume / 6a9e1206-c601-4d31-a6fc-ce9308ee8385
```

Use the Dockerfile in `apps/openwebui`. The image tag is pinned through
`OPENWEBUI_IMAGE_TAG` so upgrades and rollbacks are explicit.

Open WebUI variables:

```text
WEBUI_AUTH=True
WEBUI_SECRET_KEY=<Railway secret>
WEBUI_URL=https://openwebui-production-0f51.up.railway.app
CORS_ALLOW_ORIGIN=https://openwebui-production-0f51.up.railway.app
ENABLE_SIGNUP=False
DEFAULT_USER_ROLE=pending
ENABLE_LOGIN_FORM=True
ENABLE_PASSWORD_AUTH=True
ENABLE_API_KEYS=False
ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS=True
ENABLE_OPENAI_API=True
OPENAI_API_BASE_URL=https://ai-api-production-03f5.up.railway.app/v1
OPENAI_API_KEY=<scoped NestJS JWT with openwebui:chat>
ENABLE_OLLAMA_API=False
ENABLE_DIRECT_CONNECTIONS=False
DATA_DIR=/app/backend/data
AIOHTTP_CLIENT_TIMEOUT_MODEL_LIST=15
SCARF_NO_ANALYTICS=true
DO_NOT_TRACK=true
ANONYMIZED_TELEMETRY=false
```

The deployed service still shows the first-admin bootstrap screen while no users
exist. Create the approved admin account before sharing the URL, then confirm
new-user signup remains disabled or pending approval.

Important: `OPENAI_API_KEY` is Open WebUI's variable name, but the value must be
the scoped NestJS gateway JWT. Do not paste an OpenAI `sk-...` key into Open
WebUI.

## Mint The Open WebUI Gateway JWT

Run from the repo root using Railway's AI API service environment. Redirect the
token to a private temporary file; do not paste it into shared logs.

```bash
railway run --service ai-api --environment production \
  node scripts/smoke/phase5-mint-openwebui-jwt.mjs \
  --ttl-seconds 604800 > /tmp/openwebui-gateway.jwt
```

Default claims:

```text
sub=openwebui-internal-console
scope=openwebui:chat
tenant=tenant-demo
rag_namespace=customer-self-service
roles=support-agent
```

Use a shorter TTL for high-sensitivity demos and rotate after the demo. For a
long-lived internal deployment, rotate at least weekly and alert the owner
before expiry. The helper allows TTLs from 5 minutes to 30 days.

Rotation command pattern:

```bash
railway run --service ai-api --environment production \
  node scripts/smoke/phase5-mint-openwebui-jwt.mjs \
  --ttl-seconds 604800 > /tmp/openwebui-gateway.jwt

railway variable set OPENAI_API_KEY --service openwebui \
  --environment production --stdin < /tmp/openwebui-gateway.jwt

AI_API_BASE_URL=https://ai-api-production-03f5.up.railway.app \
AI_API_BEARER_TOKEN="$(cat /tmp/openwebui-gateway.jwt)" \
PHASE5_RAG_SMOKE=true \
scripts/smoke/phase5-openwebui-gateway-smoke.sh
```

Delete `/tmp/openwebui-gateway.jwt` after the smoke passes. Do not run raw
Railway variable listing commands that print secret values.

## Smoke Proof

Run this after the AI API deploy and after storing the Open WebUI gateway token:

```bash
AI_API_BASE_URL=https://ai-api-production-03f5.up.railway.app \
AI_API_BEARER_TOKEN="$(cat /tmp/openwebui-gateway.jwt)" \
PHASE5_RAG_SMOKE=true \
scripts/smoke/phase5-openwebui-gateway-smoke.sh
```

The smoke checks:

- unauthenticated `/v1/models` returns HTTP 401
- `/v1/models` succeeds with the scoped token
- `/v1/models` returns exactly one listed model, `knowledge-rag`
- `/v1/chat/completions` succeeds through the backend
- the provided token is not shaped like an OpenAI key
- `knowledge-rag` returns the Phase 4 source id when RAG smoke is enabled

Live smoke on 2026-05-12 passed for the single listed model `knowledge-rag`
against AI API deployment `9832cea7-a2a7-4043-9ccc-0919f69126c4`.

Manual Open WebUI check:

1. Open the Open WebUI service URL.
2. Create the first admin account through the approved owner.
3. Confirm signup is disabled or new users remain pending.
4. In Admin Settings, confirm the OpenAI connection URL is the AI API `/v1`
   gateway and the credential is the scoped JWT.
5. Select `knowledge-rag` and ask:

```text
What approved troubleshooting can I give for intermittent residential service?
```

Expected: the response includes the approved troubleshooting guidance and source
`kb-troubleshoot-intermittent-service-v1`.

## Security Checklist

- Open WebUI has no real OpenAI key, Salesforce credential, Qdrant key, Railway
  token, or AI API JWT signing secret.
- Open WebUI traffic to AI API is authenticated with `openwebui:chat` only.
- The Open WebUI token cannot call `/rag/ingest`, `/rag/search`, or Agentforce
  action routes unless extra scopes are deliberately added.
- Public signup is disabled or pending approval is enforced.
- SSO/RBAC is configured before broad internal sharing.
- Persistent storage is on a Railway volume at `/app/backend/data`.
- Data retention, export, and deletion owners are approved before production
  use.
- Logs and proof artifacts do not contain raw prompts with PII, JWTs, provider
  keys, Salesforce credentials, or retrieved chunks.

## Observability And Cost

- AI API logs safe request ids, provider/model, token counts, latency, fallback
  outcome, retrieval ids, source ids, and cost references where known.
- Open WebUI stores conversation data in its persistent volume; treat that data
  as internal AI chat history and govern retention accordingly.
- Add alerts for AI API 401/403 spikes, 429 spikes, provider failures, RAG
  `NO_SOURCE` spikes, latency regressions, and token/cost anomalies.
- Cold starts can affect the first request after idle periods; use `/health` for
  Open WebUI liveness and `/health/live` for AI API liveness without provider
  calls.

## Rollback

Rollback is service-scoped:

1. Remove or rotate the Open WebUI `OPENAI_API_KEY` gateway JWT.
2. Stop or roll back only the Railway `openwebui` service.
3. Keep the AI API and Phase 4 Agentforce RAG path online unless its deployment
   introduced the regression.
4. If the AI API gateway change must roll back, redeploy the previous AI API
   deployment and rerun Phase 4 smoke to confirm Agentforce RAG still works.
5. Preserve the Open WebUI volume for incident review unless security approves
   deletion.

Incident placeholders:

```text
Open WebUI service owner: pending manual assignment
AI API owner: pending manual assignment
Security reviewer: pending manual sign-off
Railway project admin: Keshav chaudhary's Projects
Escalation channel: pending manual assignment
```

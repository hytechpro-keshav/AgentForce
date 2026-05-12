# Open WebUI Internal Console

Phase 5 deploys Open WebUI as the internal AI console. It is not the customer
chat surface and it must not call OpenAI directly.

```text
Open WebUI
  -> NestJS AI API /v1/models and /v1/chat/completions
  -> ModelRouter or virtual knowledge-rag model
  -> OpenAI / Qdrant through the backend only
```

## Runtime Contract

- Configure Open WebUI's OpenAI-compatible connection URL as
  `https://ai-api-production-03f5.up.railway.app/v1` or the private/internal
  Railway AI API URL when both services are in the same Railway project.
- Set Open WebUI `OPENAI_API_KEY` to a scoped NestJS gateway JWT with
  `scope=openwebui:chat`, not to the real OpenAI API key.
- The AI API exposes the virtual model `knowledge-rag` when `RAG_ENABLED=true`.
  Selecting that model sends the latest user message through the existing Phase
  4 `RagAnswerService`, tenant/namespace JWT claims, Qdrant retrieval, source
  citation formatting, and safe RAG telemetry.
- Phase 5 lists only `knowledge-rag` in Open WebUI. Direct GPT/provider model
  options are intentionally hidden from the dropdown.
- The gateway supports normal JSON completions and a standards-shaped SSE
  envelope for `stream=true`. Streaming uses the same backend routing,
  redaction, token accounting, and RAG paths; token-by-token provider streaming
  remains a later enhancement.

## Railway Service

Recommended service setup:

- Service name: `openwebui`.
- Live URL: `https://openwebui-production-0f51.up.railway.app`.
- Service root: `apps/openwebui`.
- Build: Dockerfile in this folder, pinned through `OPENWEBUI_IMAGE_TAG`.
- Port: Open WebUI listens on container port `8080`.
- Health check: `GET /health`.
- Persistent volume: mount to `/app/backend/data` before first production use.

Do not store Salesforce credentials, OpenAI keys, Qdrant keys, JWT signing
secrets, or Railway admin tokens in Open WebUI.

## Required Variables

Copy `.env.example` into Railway variables manually. Keep real values in the
Railway dashboard or secure deployment system only.

Open WebUI service:

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

AI API service additions for Phase 5:

```text
OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS=60000
OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS=120
OPENAI_COMPAT_RAG_MODEL_ID=knowledge-rag
```

The AI API must already have Phase 4 production variables such as
`RAG_ENABLED=true`, `VECTOR_DB_PROVIDER=qdrant`, `QDRANT_URL`,
`QDRANT_COLLECTION=agentforce-knowledge-rag`,
`RAG_DEFAULT_NAMESPACE=customer-self-service`,
`OPENAI_EMBEDDING_MODEL=text-embedding-3-small`, and
`RAG_SCORE_THRESHOLD=0.68`.

## Mint The Gateway JWT

Mint from the AI API service environment so `AI_API_JWT_SECRET` is never shown:

```bash
railway run --service ai-api --environment production \
  node scripts/smoke/phase5-mint-openwebui-jwt.mjs \
  --ttl-seconds 604800 > /tmp/openwebui-gateway.jwt
```

Store the token as Open WebUI `OPENAI_API_KEY`. Rotate it on a normal secret
rotation schedule and immediately after any suspected Open WebUI compromise.

Weekly rotation pattern:

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

Assign a named owner and alert before token expiry. Delete the temporary token
file after updating Railway.

## Smoke

Run the backend gateway smoke without printing secrets:

```bash
AI_API_BASE_URL=https://ai-api-production-03f5.up.railway.app \
AI_API_BEARER_TOKEN="$(cat /tmp/openwebui-gateway.jwt)" \
PHASE5_RAG_SMOKE=true \
scripts/smoke/phase5-openwebui-gateway-smoke.sh
```

Expected checks:

- no bearer token returns HTTP 401
- scoped gateway token can call `/v1/models`
- `/v1/models` returns exactly one listed model, `knowledge-rag`
- scoped gateway token can call `/v1/chat/completions`
- the token does not look like a direct OpenAI key
- `knowledge-rag` returns Phase 4 source metadata when the sample corpus is
  indexed and RAG is enabled

## Release Gates

- Configure auth/RBAC or SSO before sharing with internal users.
- Create the first admin account through a controlled owner mailbox.
- Disable public signup or leave new users in `pending` until approved.
- Confirm `/app/backend/data` is on persistent Railway storage and included in
  backup/retention procedures.
- Confirm Open WebUI has no direct OpenAI, Salesforce, Qdrant, or Railway admin
  secrets.
- Confirm AI API token/cost telemetry and rate-limit alerts are watched.
- Capture Phase 5 smoke proof in
  `docs/testing/phase5-openwebui-internal-console-proof.md`.

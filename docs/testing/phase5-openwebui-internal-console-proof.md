# Phase 5 Open WebUI Internal Console Proof

Date: 2026-05-12

## Scope

Phase 5 implements the production-path Open WebUI internal console slice. It is
separate from Phase 6 React customer chat.

```text
Open WebUI
  -> NestJS AI API OpenAI-compatible gateway
  -> ModelRouter for plain chat
  -> RagAnswerService for knowledge-rag
  -> OpenAI and Qdrant only behind backend-owned providers
```

## Implemented Locally

- `apps/openwebui` deployment assets and runbook.
- Open WebUI `.env.example` with names only and no secrets.
- Pinned Open WebUI Docker wrapper and Railway service config.
- Dedicated gateway scope `openwebui:chat` for `/v1/models` and
  `/v1/chat/completions`.
- `/v1/models` returns only `knowledge-rag`, keeping direct GPT/provider options
  out of the Open WebUI dropdown.
- Gateway rate-limit settings:
  `OPENAI_COMPAT_GATEWAY_RATE_LIMIT_WINDOW_MS` and
  `OPENAI_COMPAT_GATEWAY_RATE_LIMIT_MAX_REQUESTS`.
- Virtual model `knowledge-rag` exposed when `RAG_ENABLED=true`.
- `knowledge-rag` calls the existing Phase 4 `RagAnswerService`, preserving
  trusted tenant/namespace claims, source citations, no-source behavior, and
  safe RAG telemetry.
- Common Open WebUI/OpenAI-compatible request fields are accepted by DTO
  validation; both normal JSON completions and `stream=true` SSE envelopes use
  the same backend routing and telemetry path.
- `/chat/message` remains scoped with `chat:write`, so Open WebUI gateway tokens
  cannot bypass the `/v1` contract.
- Smoke helpers:
  `scripts/smoke/phase5-mint-openwebui-jwt.mjs` and
  `scripts/smoke/phase5-openwebui-gateway-smoke.sh`.

## Live Proof Fields

Railway deployment and gateway smoke are complete. First-admin setup and
logged-in browser chat validation remain manual steps for the approved owner.

| Field                      | Value                                                     |
| -------------------------- | --------------------------------------------------------- |
| Open WebUI Railway service | `openwebui`                                               |
| Open WebUI service id      | `fece7078-8f32-42cd-99d2-8b58dce7f5ca`                    |
| Open WebUI deployment id   | `7ae31cc8-eef3-4418-9616-95634a839ced`                    |
| Open WebUI URL             | `https://openwebui-production-0f51.up.railway.app`        |
| Open WebUI health          | `GET /health -> {"status":true}`                          |
| Open WebUI volume          | `openwebui-volume / 6a9e1206-c601-4d31-a6fc-ce9308ee8385` |
| Open WebUI volume mount    | `/app/backend/data`                                       |
| AI API deployment id       | `9832cea7-a2a7-4043-9ccc-0919f69126c4`                    |
| AI API URL                 | `https://ai-api-production-03f5.up.railway.app`           |
| Gateway scope              | `openwebui:chat`                                          |
| RAG virtual model          | `knowledge-rag`                                           |
| Qdrant collection          | `agentforce-knowledge-rag`                                |
| RAG namespace              | `customer-self-service`                                   |
| Smoke request id           | `phase5-openwebui-smoke`                                  |
| RAG smoke request id       | `phase5-openwebui-rag-smoke`                              |
| Source expected            | `kb-troubleshoot-intermittent-service-v1`                 |
| Browser auth page          | First-admin bootstrap screen renders                      |
| Security reviewer          | `<pending manual sign-off>`                               |
| Release approver           | `<pending manual approval>`                               |

## Validation Checklist

Local validation to run before deployment:

```bash
npm run ai-api:typecheck
npm run ai-api:test
npm run ai-api:test:e2e
npm run ai-api:build
npm run prettier:verify
```

Gateway smoke after deployment:

```bash
railway run --service ai-api --environment production \
  node scripts/smoke/phase5-mint-openwebui-jwt.mjs \
  --ttl-seconds 3600 > /tmp/openwebui-gateway.jwt

AI_API_BASE_URL=https://ai-api-production-03f5.up.railway.app \
AI_API_BEARER_TOKEN="$(cat /tmp/openwebui-gateway.jwt)" \
PHASE5_RAG_SMOKE=true \
scripts/smoke/phase5-openwebui-gateway-smoke.sh
```

Expected smoke evidence:

```text
Phase 5 Open WebUI gateway chat smoke passed for model knowledge-rag.
Phase 5 Open WebUI gateway RAG smoke passed for model knowledge-rag.
```

Live smoke evidence recorded on 2026-05-12:

```text
Phase 5 Open WebUI gateway chat smoke passed for model knowledge-rag.
Phase 5 Open WebUI gateway RAG smoke passed for model knowledge-rag.
```

## Manual Open WebUI Proof

1. Confirm Open WebUI URL is protected by login.
2. Confirm the first admin account owner is approved.
3. Confirm public signup is disabled or users remain pending.
4. Confirm Open WebUI has exactly one production model connection for this
   slice: the NestJS AI API `/v1` gateway.
5. Confirm Open WebUI does not contain a real OpenAI key.
6. Select model `knowledge-rag`.
7. Ask:

```text
What approved troubleshooting can I give for intermittent residential service?
```

Expected answer:

- approved troubleshooting steps are returned
- source metadata includes `kb-troubleshoot-intermittent-service-v1`
- no Salesforce account-specific facts are invented
- no real customer identifiers are entered into the demo

Unsupported prompt:

```text
What is the approved executive compensation policy for customer credits?
```

Expected answer:

- no authorized source is found
- the model does not answer from general knowledge

## Current Status

Phase 5 is implemented, locally validated, and deployed to Railway production.
The AI API gateway and Open WebUI service are healthy, the Open WebUI persistent
volume is attached, and the live gateway smoke passes for plain chat and
`knowledge-rag`.

Remaining manual steps before broad internal use:

- create the first approved Open WebUI admin account
- confirm signup/RBAC policy after the admin account exists
- perform logged-in browser chat validation for `knowledge-rag`
- assign security/release owners and retention/backup ownership

# Phase 6 — React Customer Chat Window Deployment

This runbook documents how to deploy `apps/react-chat-window` (Next.js App
Router) standalone and how to embed it inside a Salesforce-hosted page shell.
The chat backend remains the NestJS AI API on Railway. The browser never
holds backend secrets, and the Next.js server holds only `AI_API_BASE_URL`.

## Service shape

```text
Customer browser
  └── Next.js app (apps/react-chat-window) — same-origin /api/*
        └── HTTPS → NestJS AI API (apps/ai-api on Railway)
              └── ModelRouter → OpenAI streaming, LangChain RAG, Pinecone
```

The browser only talks to the Next.js app's own origin. The Next.js server
proxies `/api/session`, `/api/chat` (SSE → text stream), and `/api/escalate`
to the NestJS AI API.

## Railway standalone deployment

1. **Create a Railway service** named `react-chat-window` in the same project as
   `ai-api`.
2. **Service settings:**
   - Root directory: `apps/react-chat-window`
   - Config file: `apps/react-chat-window/railway.json`
   - Builder: Railpack
   - Build command: `npm install --workspaces=false --no-audit --no-fund --include=dev && npm run build`
   - Start command: `npm run start` (which runs `next start -p $PORT -H 0.0.0.0`)
   - Node 20.x is fine; the `engines.node` requirement is defined in the root
     `package.json`. `--include=dev` is required because `tailwindcss`,
     `postcss`, `autoprefixer`, and `typescript` are devDependencies needed at
     build time.
3. **Variables** (use `railway variable set` per Railway CLI safety notes;
   never put secret values in command arguments):
   - `AI_API_BASE_URL=https://<ai-api>.up.railway.app`
   - `BRAND_NAME` (optional)
   - `BRAND_SUBTITLE` (optional)
   - **Do not** create any `NEXT_PUBLIC_*` variables for bearer tokens, access
     codes, OpenAI keys, Pinecone keys, or Salesforce credentials. The Next.js
     server holds no provider secrets — only `AI_API_BASE_URL`.
4. **Domain:** assign a public domain (e.g. `chat.<brand>.app`) and enable HTTPS.
5. **CORS:** the browser only talks to the same Next.js origin, so the NestJS
   `AI_API_CORS_ORIGINS` allowlist does **not** need the chat domain for the
   normal customer flow. Keep it restricted to Open WebUI / Salesforce /
   smoke origins. Add the chat domain only if you also expose direct browser
   → ai-api calls (not recommended).
6. **AI API login variables:** configure these on the `ai-api` service, not the
   React service:

- `CUSTOMER_CHAT_ACCESS_CODE` (sealed/manual-test secret)
- `CUSTOMER_CHAT_SESSION_TTL_SECONDS=7200` (optional)
- `CUSTOMER_CHAT_SESSION_RATE_LIMIT_WINDOW_MS=60000` (optional)
- `CUSTOMER_CHAT_SESSION_RATE_LIMIT_MAX_REQUESTS=10` (optional)

7. **Rate limiting:** verify the NestJS login rate-limit guard is active for
   `/auth/customer-chat/session`. Existing protected chat endpoints still require
   the minted `chat:write` token.
8. **Healthcheck:** `railway.json` uses `healthcheckPath: "/"`. The Next.js
   root route renders the login card without calling the AI API, so the
   healthcheck succeeds even if NestJS is briefly unreachable; rely on the
   `ai-api` service healthcheck separately.

### Token issuance

Phase 6 includes a staging/manual-test session endpoint:
`POST /auth/customer-chat/session`. The browser submits an access code and the
NestJS API returns a short-lived `chat:write` JWT. The React app stores that JWT
in memory only; refresh signs the customer out.

This endpoint is intentionally narrow. Before broad production use, replace the
access-code check with a real customer identity broker while keeping the same
short-lived scoped token boundary.

## Salesforce-hosted embed

When Salesforce hosts the surface (Experience Cloud page, Lightning app page,
LWC wrapper), keep the React app deployed on Railway and embed via `<iframe>`
or a wrapper component. Validate before launch:

- **CSP:** the Salesforce site's CSP allows the Railway domain as `frame-src`
  and `connect-src`.
- **Clickjack / X-Frame-Options:** the React Railway service permits framing
  from the Salesforce site domain only.
- **CORS:** the NestJS `ai-api` `AI_API_CORS_ORIGINS` includes the Salesforce site
  origin if the iframe issues CORS requests.
- **Guest user / session:** if guest users can view the chat, the JWT minted
  for them must carry only `chat:write` and a customer-safe tenant claim. No
  Salesforce session tokens, Named Credential secrets, or model keys leak to
  the browser.

## Smoke checks after deployment

```bash
# From a workstation
curl -sI https://<chat-domain>/ | head -5

# Login/session token via the Next.js proxy (preferred — same as the browser)
TOKEN=$(curl -sX POST https://<chat-domain>/api/session \
  -H "content-type: application/json" \
  -d "{\"accessCode\":\"$ACCESS_CODE\"}" | jq -r .accessToken)

# Streaming chat round-trip via the Next.js proxy. Output is plain text deltas.
curl -sN -X POST https://<chat-domain>/api/chat \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'

# Escalation acknowledgement via the Next.js proxy
curl -sX POST https://<chat-domain>/api/escalate \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"reason":"Phase 6 smoke","urgency":"normal"}' | jq .

# Direct NestJS streaming endpoint (for ai-api-only smoke)
curl -sN -X POST https://<ai-api>.up.railway.app/chat/message/stream \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

Open the deployed chat domain and verify:

- The first screen is the access-code login for chat (no marketing landing page).
- The composer is unavailable until login succeeds.
- Sending a message renders tokens **incrementally** (streaming visible), not
  as one final block, and there are no JS console errors.
- "Talk to support" opens the escalation panel and submission returns a
  reference id.
- Mobile (`375x812`) and desktop (`1280x800`) layouts have no overlap, the
  composer is reachable above the keyboard, and the message list scrolls.

## Rollback

- Railway: redeploy the previous build via "Deployments → Roll back".
- Backend: the new `/chat/escalate` endpoint is additive. If a rollback is
  needed, revert the commit that introduced
  `apps/ai-api/src/chat/chat-escalation.service.ts` and re-deploy the AI API.
- React app: rolling back the chat domain to the previous build does not
  affect the `ai-api` service.

## Owner readiness checklist

- [ ] Customer identity broker designed and reviewed for replacing the staging access code.
- [ ] `CUSTOMER_CHAT_ACCESS_CODE` stored as an `ai-api` service variable.
- [ ] CORS origin allowlist updated on `ai-api`.
- [ ] Rate-limit thresholds confirmed appropriate for customer traffic.
- [ ] Logging policy verified (no raw prompts, tokens, or PII).
- [ ] Security review signed off on Phase 6 source-display sanitization.
- [ ] Rollback plan rehearsed.

# @agentforce/react-chat-window — Phase 6 Customer Chat (Next.js)

Customer-facing **Next.js (App Router)** chat window for the Agentforce hybrid
AI architecture. Built with **Tailwind CSS**, **shadcn/ui**-style components,
and the **Vercel AI SDK** for streaming UI. The first screen is an access-code
login gate — not a marketing landing page — and the browser calls **only**
this app's own `/api/*` routes, which proxy to the NestJS AI API.

> The Next.js codebase lives in this monorepo. Salesforce can host a page
> shell that embeds this surface, but it never holds chat backend secrets,
> OpenAI keys, Pinecone keys, or model credentials. The Next.js server itself
> also holds no provider secrets — only the configured `AI_API_BASE_URL`.

## Architecture boundaries

- The browser talks **only** to `/api/session`, `/api/chat`, `/api/escalate`
  on this app's own origin.
- Those `/api/*` routes proxy to the NestJS AI API:
  - `POST /auth/customer-chat/session`
  - `POST /chat/message/stream` (SSE; streamed to the browser as text)
  - `POST /chat/escalate`
- **No** OpenAI, Anthropic, Gemini, Pinecone, Open WebUI, or Salesforce SDKs
  are imported on the Next.js server or in the browser.
- Auth uses an access-code login endpoint that returns a customer-safe,
  short-lived bearer JWT with `chat:write` scope. The browser holds the JWT
  in React state only and forwards it as `Authorization: Bearer <token>` to
  the proxy routes, which forward it unchanged to NestJS.
- Open WebUI gateway tokens (`openwebui:chat`) are intentionally rejected by
  the backend.
- Source metadata is sanitized: only `title`, `url` (http/https only), and
  `snippet` are surfaced. Internal IDs, chunk IDs, namespaces, and Salesforce
  record references are stripped both server-side (NestJS) and client-side.

## Streaming design

1. NestJS exposes `POST /chat/message/stream` returning Server-Sent Events:
   - `data: {"type":"text","value":"…"}\n\n` for assistant deltas.
   - `data: {"type":"done", usage, …}\n\n` for final usage / metadata
     (server-only — never reaches the browser).
   - `data: [DONE]\n\n` to terminate.
2. The `LlmProvider` interface exposes an optional
   `chatStream(request): AsyncIterable<LlmChatChunk>`. The OpenAI Completions
   provider implements true streaming using `stream: true` and
   `stream_options.include_usage`. `ModelRouter.chatStream` chains streaming-
   capable providers and emits telemetry the same way as `chat()`.
3. The Next.js `/api/chat` route translates the upstream SSE event stream
   into a flat UTF-8 text stream and returns it as
   `text/plain; charset=utf-8`. The browser consumes it with the Vercel AI
   SDK `useChat` hook configured for `streamProtocol: "text"`, so tokens
   render incrementally as they arrive.

This preserves the NestJS-only AI boundary: the Next.js process never imports
a vendor SDK and never decides which provider, model, or RAG flow to use.

## Local development

```bash
# From the repo root
npm install
cp apps/react-chat-window/.env.example apps/react-chat-window/.env.local
# Edit .env.local and supply AI_API_BASE_URL
npm run react-chat:dev
```

The dev server listens on http://localhost:4173. All chat traffic goes
through this app's own `/api/*` routes, which call `AI_API_BASE_URL`.

### Environment variables (Next.js process only)

| Name              | Required | Description                                                                    |
| ----------------- | -------- | ------------------------------------------------------------------------------ |
| `AI_API_BASE_URL` | yes      | NestJS AI API base URL (e.g. `https://ai-api-production-03f5.up.railway.app`). |
| `BRAND_NAME`      | no       | Header / login title (defaults to `Customer Support`).                         |
| `BRAND_SUBTITLE`  | no       | Login + header subtitle.                                                       |

`AI_API_BASE_URL` is **server-only**: there is no `NEXT_PUBLIC_*` mirror and
no bearer token or access code is ever embedded in the browser bundle.

Backend `ai-api` variables required for the login endpoint:

| Name                                            | Required | Description                                                 |
| ----------------------------------------------- | -------- | ----------------------------------------------------------- |
| `CUSTOMER_CHAT_ACCESS_CODE`                     | yes      | Access code accepted by `POST /auth/customer-chat/session`. |
| `CUSTOMER_CHAT_SESSION_TTL_SECONDS`             | no       | Short-lived chat JWT TTL, defaults to `7200`.               |
| `CUSTOMER_CHAT_SESSION_RATE_LIMIT_WINDOW_MS`    | no       | Login attempt rate-limit window, defaults to `60000`.       |
| `CUSTOMER_CHAT_SESSION_RATE_LIMIT_MAX_REQUESTS` | no       | Login attempts per client/window, defaults to `10`.         |

> Never paste backend secrets, OpenAI keys, Pinecone keys, Railway tokens, or
> Salesforce credentials into `.env.local`. Commit only `.env.example`.

## Scripts

| Script                         | What it does                                |
| ------------------------------ | ------------------------------------------- |
| `npm run react-chat:dev`       | Next.js dev server on `0.0.0.0:4173`.       |
| `npm run react-chat:build`     | `next build` (compiles app + types).        |
| `npm run react-chat:preview`   | `next start` on `0.0.0.0:4173`.             |
| `npm run react-chat:test`      | Vitest unit tests (SSE transform, sources). |
| `npm run react-chat:typecheck` | `tsc --noEmit`.                             |

## UI building blocks

shadcn/ui-style primitives live under [components/ui](components/ui):

- `Button`, `Input`, `Textarea`, `Label`, `Card`, `Dialog`, `Alert`.

Feature components:

- [`LoginCard`](components/LoginCard.tsx) — access-code login screen.
- [`ChatPanel`](components/ChatPanel.tsx) — chat composer, streaming message
  list, send button, retry, stop, sign-out.
- [`EscalationDialog`](components/EscalationDialog.tsx) — Radix dialog with
  reason / urgency / case-reference fields backed by `/chat/escalate`.
- [`SourceList`](components/SourceList.tsx) — customer-safe source citations.
- [`ChatShell`](components/ChatShell.tsx) — gating: login → chat.
- [`DemoCaseCreateForm`](components/DemoCaseCreateForm.tsx) — scenario picker +
  Case form for `/demo/case-create`.

## Demo Case create (`/demo/case-create`)

Demo surface to create a **real Salesforce Case** and redirect to the **stepped
orchestration console** (`/orchestration/stepped?workflowId=wf-…`). Separate
from customer chat — no Case write on `/` or `EscalationDialog`.

The BFF auto-starts a stepped run and sets an `orchestrator_session` httpOnly
cookie so **Run** buttons work without manual operator sign-in.

| Env (react-chat-window)             | Required           | Description                                                                       |
| ----------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| `DEMO_CASE_CREATE_ENABLED`          | yes (to enable)    | Must be `true` to allow POST `/api/demo/cases`.                                   |
| `AI_API_DEMO_CASE_CREATE_TOKEN`     | yes (when enabled) | Opaque bearer for NestJS `POST /demo/cases` + `POST /demo/orchestration-session`. |
| `DEMO_CASE_CREATE_RATE_LIMIT_*`     | no                 | Per-IP rate limit (defaults 10/min).                                              |
| `ORCHESTRATOR_OPERATOR_ACCESS_CODE` | no (fallback)      | Same as ai-api; only needed for manual sign-in on stepped start panel.            |

## Orchestration consoles

| Route                                    | Component                  | Purpose                                                              |
| ---------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `/orchestration/stepped?workflowId=wf-…` | `SteppedOrchestrationView` | Demo/operator — manual **Run** per stage (primary after demo create) |
| `/orchestration?caseId=…`                | `OrchestrationView`        | Engineering read-only timeline + Stop AI                             |

Skill: `.agents/skills/langgraph-stepped-console/SKILL.md` · Phase plan: `docs/orchestrator/stepped-console-phase-plan.md`

## Demo Case create (detail)

On **ai-api**, set `DEMO_CASE_CREATE_ENABLED=true` and register the token SHA-256
in `AI_API_AGENTFORCE_BEARERS_JSON` with scope `agentforce:demo-case-create`.

Scenario catalog: [`data/demo-case-scenarios.json`](data/demo-case-scenarios.json).
Refresh inventory snapshot: `./scripts/sf/generate-demo-case-scenarios.sh AgentForce`.

## Security posture

- Auth is required (`chat:write` scope) for `/api/chat` and `/api/escalate`.
- Login is access-code protected by `CUSTOMER_CHAT_ACCESS_CODE`,
  rate-limited, and returns a short-lived JWT held only in React state.
- CORS is restricted by the NestJS `AI_API_CORS_ORIGINS` allowlist. For the
  Next.js deployment, the browser only ever talks to the **same origin** —
  so CORS only matters for direct NestJS calls (Salesforce, smoke scripts).
- Rate limiting, PII redaction, and structured error mapping are enforced
  by NestJS. The Next.js proxy routes do not log request bodies.
- Frontend never logs prompts, completions, JWTs, or source content.
- The escalation form whitelists `caseReference` to `[A-Za-z0-9_.:-]+` and
  length-limits all fields.
- Source display defensively strips any field other than `title`, `url`,
  `snippet`.

## Known limitations

- The access-code login is a staging/manual-test broker. A real customer
  identity broker should replace it before broad production use.
- The escalation endpoint only acknowledges; it does not create or update
  Salesforce Cases directly. Agentforce/Apex action wiring is the next step.
- Streaming is only enabled for OpenAI-compatible providers. Other providers
  (Anthropic, Gemini, Azure) need a `chatStream` implementation before they
  become eligible for `/chat/message/stream`; until then the router rejects
  with a `validation` error and the legacy non-streaming `/chat/message`
  remains the fallback.

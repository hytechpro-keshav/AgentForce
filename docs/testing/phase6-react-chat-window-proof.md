# Phase 6 — Next.js Customer Chat Window Proof

Date: 2026-05-13 (Next.js upgrade)

## Scope

Phase 6 (Next.js upgrade) replaces the original React/Vite chat window with a
modern **Next.js 14 (App Router)** customer chat surface under
`apps/react-chat-window`, built on Tailwind CSS, shadcn/ui-style components,
and the Vercel AI SDK for streaming UI. The Next.js process holds no provider
secrets and the browser talks only to this app's own same-origin `/api/*`
routes, which proxy to the NestJS AI API.

## What ships in this revision

- New stack: Next.js 14 App Router (`next/server` runtime), Tailwind CSS 3.4,
  shadcn/ui-style components (locally vendored, Radix primitives), Vercel AI
  SDK (`@ai-sdk/react` `useChat` with `streamProtocol: "text"`).
- Same-origin proxy routes:
  - `POST /api/session` → NestJS `POST /auth/customer-chat/session`.
  - `POST /api/chat` → NestJS `POST /chat/message/stream` (SSE → text stream).
  - `POST /api/escalate` → NestJS `POST /chat/escalate`.
- Streaming pipeline end-to-end:
  - `LlmProvider.chatStream` (new optional method on the provider interface)
    backed by `OpenAiCompletionsProvider.chatStream` using OpenAI
    `stream: true` + `stream_options.include_usage`.
  - `ModelRouter.chatStream` chains streaming-capable providers, emits
    telemetry, and only falls back before the first chunk is sent.
  - `ChatService.streamMessage` and `ChatController` `POST /chat/message/stream`
    emit SSE frames (`text`, `done`, `[DONE]`).
  - Next.js `/api/chat` reads the SSE stream and re-emits a flat UTF-8 text
    stream that the AI SDK browser hook renders incrementally.
- shadcn-style component set: `Button`, `Input`, `Textarea`, `Label`, `Card`,
  `Dialog`, `Alert`.
- Feature components: `LoginCard`, `ChatPanel` (streaming + Stop button),
  `EscalationDialog`, `SourceList`, `ChatShell`.
- Updated runbook: `docs/deployment/railway-react-chat-phase6.md`.

## Exit-criteria coverage

| Exit criterion                                              | Evidence                                                                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer chat runs from `apps/react-chat-window` (Next.js). | `npm run react-chat:dev` (Next.js dev on 4173), `npm run react-chat:build` succeeds; production start via `next start`.                                        |
| Chat/login is the first screen.                             | `app/page.tsx` renders `<ChatShell />`; `ChatShell` shows `LoginCard` until a session is minted.                                                               |
| Browser calls **only** same-origin `/api/*` routes.         | `ChatPanel` calls `/api/chat`; `LoginCard` calls `/api/session`; `EscalationDialog` calls `/api/escalate`. No NestJS / vendor URLs in `app/` or `components/`. |
| `/api/*` routes proxy only approved NestJS endpoints.       | Routes under `app/api/{session,chat,escalate}/route.ts` forward to `/auth/customer-chat/session`, `/chat/message/stream`, `/chat/escalate`.                    |
| No vendor SDKs in the Next.js process or browser.           | `apps/react-chat-window/package.json` has no `openai`, `@anthropic-ai/sdk`, `pinecone`, `@salesforce/*`, or Open WebUI SDK deps.                               |
| Customer-safe auth + token boundary.                        | Browser holds JWT in React state only. Next.js env exposes only `AI_API_BASE_URL`, `BRAND_NAME`, `BRAND_SUBTITLE`. No `NEXT_PUBLIC_*` secrets.                 |
| Streaming visible to the customer.                          | `useChat({ streamProtocol: "text" })` consumes the text stream from `/api/chat`; tokens appear incrementally.                                                  |
| Source display is customer-safe.                            | `lib/sources.ts → sanitizeSources` allowlists `title`, `url` (http/https only), `snippet`. `lib/__tests__/proxy.test.ts` covers the stripping.                 |
| Escalation path.                                            | `EscalationDialog` posts to `/api/escalate` with Bearer auth; proxy preserves the DTO and forwards to NestJS unchanged.                                        |
| Tests + build validation.                                   | See "Validation" below.                                                                                                                                        |
| Phase 6 docs / runbook.                                     | `apps/react-chat-window/README.md`, `docs/deployment/railway-react-chat-phase6.md`, this file.                                                                 |

## Backend contract changes

`/chat/message` and `/chat/escalate` are **unchanged** and remain backwards
compatible.

New `POST /chat/message/stream`:

- Same DTO as `/chat/message`.
- Same auth (`@RequireScopes("chat:write")`, `JwtAuthGuard`).
- Response is `text/event-stream` with `text`, `done`, and `[DONE]` frames.
- Error mapping mirrors `/chat/message` via the shared `mapProviderError`
  helper. Validation errors raise `BadRequest` with `provider_validation_failed`
  before any SSE frame is written.
- Token usage and telemetry are recorded on the `done` frame and via the
  existing telemetry sink, identical to the non-streaming endpoint.

## Security review (delta from the previous Phase 6 proof)

- The Next.js process holds **no** provider secrets. Only `AI_API_BASE_URL`
  and optional brand strings.
- The browser bundle contains no bearer tokens, no access codes, no provider
  endpoints. The JWT is held in React state only and is forwarded to the
  Next.js proxy via `Authorization: Bearer`, which then forwards it to
  NestJS over HTTPS.
- The streaming endpoint enforces the same `chat:write` scope and rejects
  `openwebui:chat` tokens. Error payloads are JSON-typed SSE events; no
  stack traces leak to the customer.
- `transformSseToText` only emits `text` deltas; `done` telemetry frames are
  consumed server-side and never reach the browser.
- `sanitizeSources` still defends against `javascript:` and unknown-field
  injection from a compromised RAG response. The Vitest suite asserts both
  the URL guard and the unknown-key stripping.
- Customer chat continues to use customer-safe browser tokens. CSP, iframe
  / clickjack, CORS, and guest-user / session rules for a Salesforce-hosted
  embed remain unchanged.

## Validation

All commands run from the repo root.

| Command                        | Result                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm install`                  | Installed Next.js, Tailwind, shadcn primitives, Vercel AI SDK, and devDependencies cleanly.                                          |
| `npm run ai-api:typecheck`     | Clean.                                                                                                                               |
| `npm run ai-api:test:e2e`      | 3 suites, **38 tests** passed.                                                                                                       |
| `npm run react-chat:typecheck` | Clean (`tsc --noEmit -p tsconfig.json`).                                                                                             |
| `npm run react-chat:test`      | 1 suite, **4 tests** passed (`lib/__tests__/proxy.test.ts` — SSE transform, error termination, source sanitizer).                    |
| `npm run react-chat:build`     | `next build` produced 4 routes: `/` (static, 44.4 kB / 132 kB First Load JS), `/api/{chat,escalate,session}` (dynamic, server-only). |

## Manual UI checks (`next start`)

Run `npm run react-chat:preview` after a build. Verify:

- **Desktop 1280×800:** login card centered; after a valid access code, the
  chat panel takes the full height with a sticky composer, sign-out, and
  "Escalate to support" affordance.
- **Mobile 375×812:** composer respects safe-area; messages wrap; modal is
  scrollable inside the viewport.
- **Streaming:** after sending a message, tokens appear **incrementally** in
  the assistant bubble, not as one final block. The Stop button becomes a
  Send button when the stream completes.
- **Invalid access code:** `/api/session` returns 401, the login card shows
  a human-readable error, the composer stays hidden.
- **Escalation:** opens the dialog, submits, and shows
  `Reference: esc-<uuid>` plus the `nextSteps` ack copy.
- **No console errors:** DevTools console is clean (no React warnings, no
  hydration errors, no failed network calls).

## Known limitations / next steps

- Access-code login is a staging/manual-test broker. Broad production go-live
  should replace it with the real customer identity broker while keeping the
  short-lived `chat:write` token boundary.
- `/chat/message/stream` `sources` plumbing is server-side only today; the
  Next.js proxy intentionally drops the `done` frame and surfaces only text
  deltas. Surfacing customer-safe sources for streamed answers requires a
  second SSE frame type that the AI SDK `data` protocol can carry — that is
  the natural next iteration.
- Streaming is OpenAI-compatible only. Anthropic, Gemini, and Azure providers
  need their own `chatStream` implementations before `/chat/message/stream`
  will route to them.
- Escalation still acknowledges only. Wiring `escalationId` to an
  Apex/Agentforce Case-creation action is the next Phase 6+ iteration.

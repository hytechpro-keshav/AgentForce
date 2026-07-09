---
name: ablypro-landing-intake-chat
description: >-
  Ablypro marketing landing page at /landing and the floating intake chatbot
  that guides users through AI triage and Salesforce Case creation. Use when
  editing LandingPage, LandingChatPanel, intake flow, deploying /landing, or
  testing the chat-driven case-create path.
argument-hint: "Optional deploy|test|implement"
user-invocable: true
---

# Ablypro Landing + Intake Chatbot

Marketing landing page converted from `Ablypro Landing.html`, with a floating chat panel that runs the **guided intake assistant** (OTP or bootstrap identity → AI conversation → device picker → Case create).

Architecture plan: `docs/sleepy-sparking-newt.md`.

## URLs

| Surface          | Path       | Production                                                    |
| ---------------- | ---------- | ------------------------------------------------------------- |
| Landing page     | `/landing` | `https://react-chat-window-production.up.railway.app/landing` |
| Full-page intake | `/intake`  | same host `/intake` (requires `CUSTOMER_INTAKE_ENABLED=true`) |

## File map

| File                              | Role                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `app/landing/page.tsx`            | Next.js route entry                                                              |
| `components/LandingPage.tsx`      | 9-section marketing page (hero, pillars, VoltEdge, etc.)                         |
| `components/LandingChatPanel.tsx` | Floating chat FAB + intake state machine UI                                      |
| `components/IntakeShell.tsx`      | Full-page intake orchestrator (`/intake`)                                        |
| `lib/intake-flow.ts`              | Phase reducer: `bootstrapping` → `email` → `otp` → `triage` → `confirm` → `done` |
| `lib/intake-client.ts`            | `fetchIntakeConfig`, `bootstrapIntakeSession`, `loadIntakeContext`               |
| `public/ablypro-logo.png`         | Nav/footer logo                                                                  |
| `Ablypro Landing.html`            | Original HTML reference for parity                                               |

BFF proxies under `app/api/intake/*` → NestJS `apps/ai-api/src/intake/`.

## Intake flow (client state machine)

**Fully conversational since 2026-07-06 — there is NO review/submit screen.** The model summarizes in chat, the customer confirms in chat, the model returns `ui.action: "createCase"`, the client POSTs the case, announces the case number in a bot bubble, and the conversation continues ("anything else?"). Phases are only `bootstrapping | email | otp | triage`; the chat never leaves `triage`.

### With email verification (production default)

```
email → otp → triage (clarify → in-chat summary → confirm → case created → next issue…)
```

1. User enters work email → `POST /api/intake/otp/request`
2. User enters OTP → `POST /api/intake/otp/verify` → verified-intake JWT
3. `GET /api/intake/context` → devices on verified Account
4. `POST /api/intake/turn` per message → LLM reply + subject/description/priority + `ui.action` (`showDevicePicker`/`suggestDevice`/`createCase`)
5. Customer confirms the bot's summary in chat → `createCase` directive → client `POST /api/intake/case` → announcement bubble with Case # → chat continues

### With skip email verification (UAT / email limit workaround)

Skill: `intake-skip-email-verification`.

```
bootstrapping → triage (same conversational create)
```

1. Open chat → `POST /api/intake/session/bootstrap` (Account from `CUSTOMER_INTAKE_BOOTSTRAP_ACCOUNT_ID`)
2. Greeting shows device count (labels stay in the picker chips)
3. Same conversational triage → confirm-in-chat → case path as above

Case Description = the model's consolidated understanding (symptom, when it started, what was tried) — extraction-first with typed-transcript fallback; never the raw conversation.

The pre-create summary always states the on-file service address + contact email and asks one confirm question. Customer-typed overrides (`serviceAddress`/`contactEmail`/`contactPhone`) are extracted (with a deterministic server-side email/phone sniff fallback) and land on the Case as `SuppliedEmail`, `SuppliedPhone`, and a "Service address (customer provided)" description line; structured `Service_Ship_To_*__c` keep account defaults.

Phases live in `lib/intake-flow.ts`. `LandingChatPanel` and `IntakeShell` both use the same reducer and `intake-client.ts`.

## NestJS intake API

| Endpoint                         | Auth          | Purpose                                                                                                       |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /intake/config`             | public        | `{ emailVerificationEnabled, bootstrapAvailable }`                                                            |
| `POST /intake/otp/request`       | public        | Send OTP (uniform response)                                                                                   |
| `POST /intake/otp/verify`        | public        | Mint JWT with `accountId`/`contactId`                                                                         |
| `POST /intake/session/bootstrap` | public        | Mint JWT without OTP (skip flag only)                                                                         |
| `GET /intake/context`            | `chat:intake` | Devices + ship-to defaults                                                                                    |
| `POST /intake/turn`              | `chat:intake` | LLM reply + slot extraction + UI directives (`ui.action`, `readyToSubmit`); accepts `uiState.selectedAssetId` |
| `POST /intake/case`              | `chat:intake` | Create Case (`Origin=Chat`, `AI_Orchestration_Status__c=stopped_by_user`)                                     |

Case fields: Account/Contact from JWT; Asset from picker (validated server-side); subject/description/priority from LLM.

## Local dev

```bash
# ai-api
CUSTOMER_INTAKE_ENABLED=true \
CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=true \
CUSTOMER_INTAKE_BOOTSTRAP_ACCOUNT_ID=001g500000BsP8BAAV \
npm run dev --workspace @agentforce/ai-api

# react-chat-window
CUSTOMER_INTAKE_ENABLED=true \
CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=true \
AI_API_BASE_URL=http://localhost:3000 \
npm run dev --workspace @agentforce/react-chat-window
```

Open http://localhost:4173/landing

## Deploy

Landing-only changes → `SERVICE=react-chat-window ./scripts/deploy/railway-quick-deploy.sh`

Intake API or bootstrap → deploy **both** `ai-api` and `react-chat-window`.

## Testing

| Test                       | Command                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Landing parity (12 checks) | `REACT_CHAT_URL=... npm run test:e2e --workspace @agentforce/react-chat-window -- e2e/landing-page.spec.ts` |
| Intake flow (mocked BFF)   | `npm run test:e2e:intake --workspace @agentforce/react-chat-window`                                         |
| ai-api intake unit         | `npm run ai-api:test -- --testPathPattern=intake`                                                           |

Manual UAT (skip OTP on):

1. `/landing` → open Ably chat bubble
2. Describe laptop issue → chips appear when the bot asks for the device → tap one
3. Bot summarizes in chat and asks "Shall I go ahead and create the case?" → reply "yes" → announcement bubble with Case # + "anything else I can help you with?" (no review screen, chat stays open)
4. Verify Case in Salesforce: correct Account, Contact, Asset; Description is the AI's consolidated summary (not the transcript); triage not auto-fired

## Editing guidelines

- Preserve landing visual parity with `Ablypro Landing.html` (sections, copy, animations).
- Intake UI widgets stay **outside** the SSE token stream (email/OTP/device/confirm are structured components, not streamed tokens).
- Never log OTP codes, raw email, or full transcripts.
- Feature-flag intake with `CUSTOMER_INTAKE_ENABLED`; gate OTP skip with `CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION`.

## Related skills

- `intake-skip-email-verification` — toggle OTP bypass + bootstrap account
- `railway-quick-deploy` — ship to production
- `salesforce-case-create` — seed test Cases/assets in the org

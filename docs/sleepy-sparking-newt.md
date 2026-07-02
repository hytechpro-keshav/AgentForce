# Plan: OTP-Authenticated AI Intake Chatbot → Salesforce Case

## Context

Today `apps/react-chat-window` is a **stateless RAG chat**: a single shared access code (`LoginCard` → `/api/session` → NestJS `/auth/customer-chat/session` mints an HS256 `chat:write` JWT held only in React state), then free-form Q&A streamed from `/chat/message/stream`. There is **no per-user identity, no OTP, no guided flow, and no chat-driven Case creation** (case-create exists only behind the demo/operator path).

We are upgrading it into a **guided intake assistant** that:

1. greets the user and takes their laptop issue,
2. verifies identity by **email + Salesforce-generated OTP** (known customers only),
3. **auto-pulls the customer's account, contact, and devices from Salesforce** (per your answer, the user is _not_ asked to re-type account data — they only describe the issue and pick the affected device),
4. maps the conversation onto the **existing web case-form schema** and **creates a real Salesforce Case** (no triage hand-off).

### Decisions locked (from your answers)

- **Case creation:** create a **real** Case via the existing write gateway; **do not** route into the Node 1 triage orchestrator. ⚠️ The org has an _active_ Flow `Case_Triage_Orchestrator_Handoff` that fires on **every** Case insert. To honor "no triage" we set `AI_Orchestration_Status__c = 'stopped_by_user'` on the chat-created Case (the Flow's existing skip filter). See Open Decisions.
- **Intake schema:** the standard web case-form field set = `DemoCaseFormDto` (`apps/ai-api/src/demo/dto/demo-case-create.dto.ts`), mirrored by `demo-case-scenarios.schema.json#/definitions/form`. The AI fills it; account/contact/device fields are **fetched from Salesforce**, not asked.
- **Identity:** known customers only — email must match an existing `Contact`. Unknown emails get a uniform "if this matches an account, a code was sent" response (anti-enumeration).
- **Triage style:** LLM converses and extracts into the schema; a **required-field gate** must pass before the Case is created.

### Design principle: identity in the token, no new session store

The backend chat is stateless and in-memory stores don't survive Railway restart/scale-out (confirmed: `MemorySaver`, in-memory Maps). So we **carry verified identity in the JWT** (mint an enriched token at OTP-verify with `accountId`/`contactId` claims) and keep collected slots **client-side** (as `useChat` history already works). OTP state lives durably **in Salesforce**. No new server session store is built.

---

## Target flow (client-orchestrated state machine)

```
greeting → collectingEmail → awaitingOtp → verified(context fetch) → triaging(LLM+gate) → confirming → submitting → done
```

Rendered by a phase reducer owned in `ChatShell.tsx` (above the login boundary). `ChatPanel`/`useChat` continues to power free-form assistant turns during `triaging`; step widgets (email box, OTP box, device picker, confirm card) render **outside** the token stream, so we never abuse the `{type:'text'}` SSE protocol for structured UI.

---

## Work by layer

### A. Salesforce (Apex) — build the OTP subsystem (`force-app/main/default`)

No OTP/email capability exists today; build it, mirroring the existing thin `@RestResource → Service` pattern.

- **`Verification_Code__c`** custom object + fields: `Email__c`, `Code_Hash__c`, `Expires_At__c`, `Consumed__c`, `Attempts__c`, `Purpose__c`, `Correlation_Id__c`. Add a permission set granting the integration user CRU + FLS.
- **`OtpService.cls`** — generate (validate email, per-email/window rate-limit via SOQL COUNT, 6-digit code, store `SHA-256(code + pepper)` with 10-min expiry, `Attempts=0`, `Consumed=false`, send via `Messaging.SingleEmailMessage` from a verified `OrgWideEmailAddress`); verify (latest unconsumed, unexpired, under attempt-cap; constant-time hash compare; increment attempts; mark consumed). **Degrade-not-throw; never log the code.** Pepper from a protected Custom Setting/Custom Metadata.
- **`AgentforceOtpRest.cls`** — `@RestResource(urlMapping='/agentforce/otp/*')`, `@HttpPost`, branch on `RestContext.request.requestURI` (`/generate` vs `/verify`). Always HTTP 200 with outcome in the JSON body (`SENT|RATE_LIMITED|INVALID_EMAIL` / `VERIFIED|INVALID_CODE|EXPIRED|TOO_MANY_ATTEMPTS|NOT_FOUND`); never return the code.
- **Tests:** `OtpServiceTest`, `AgentforceOtpRestTest` (Messaging test isolation, hash/expiry/attempts/consumed/rate-limit paths). Pattern to copy: `AgentforcePartsFulfillmentRest.cls` + `AgentforcePartsFulfillmentService.cls`; Case-insert/FLS conventions from `CustomerSelfServiceCreateRequest.cls`.

### B. NestJS AI API — new `intake` module (`apps/ai-api/src`)

All endpoints DTO-validated, CORS-restricted, and rate-limited (copy `auth/customer-chat-session-rate-limit.guard.ts`). Gate the whole feature behind `CUSTOMER_INTAKE_ENABLED` + `salesforceConnection.enabled` (fail-closed 503, like `demo-case-create.controller.ts`).

- **`salesforce/salesforce-otp.gateway.ts`** (new) — calls `/services/apexrest/agentforce/otp/generate|verify`; clone `salesforce-fulfillment.gateway.ts` `authedRequest` (Bearer, single 401-retry, `fetchWithTimeout`, degrade-not-throw). No new auth wiring — reuses `SalesforceAuthService`.
- **Extend `salesforce/salesforce-case-write.gateway.ts`** with account-scoped reads (reuse `soqlString`, `SF_ID_PATTERN`, `runQuery`):
  - `resolveContactByEmailGlobal(email)` → `{ contactId, accountId, name }` (`SELECT Id, AccountId, Name FROM Contact WHERE Email = :esc LIMIT 2`; **reject/￼disambiguate on >1 match**).
  - `listAccountAssets(accountId)` → devices for the picker (`SELECT Id, Name, Product2.Name, SerialNumber FROM Asset WHERE AccountId = '<id>'`). Expose Id + friendly label to the client; keep serials server-side.
  - `readAccountShipTo(accountId)` → `Shipping{City,State,Country}` defaults.
  - Add a **chat Case-create variant** (`createChatCase`) that sets `Origin='Chat'`, `Status='New'`, `AI_Orchestration_Status__c='stopped_by_user'`, and makes ship-to optional (defaults from account; prompt only if absent). Does **not** call `orchestrator.triggerStepped`.
- **`intake/` module** (controller + service + DTOs), reusing `ModelRouter`, a new `LLM_USE_CASES` value `customer_chat_intake`, the `support-triage.service.ts` prompt+`JSON.parse` extraction pattern (defensive), and `security/sensitive-data-redactor.ts`:
  - `POST /intake/otp/request` — `@Public` + rate-limit. `{email}` → resolve Contact → if found, send OTP. **Uniform** `{status:'sent'}` regardless.
  - `POST /intake/otp/verify` — `@Public` + rate-limit. `{email, code}` → SF verify → on success mint enriched JWT (extend `customer-chat-session.service.ts`): `scope: 'chat:intake chat:write'`, claims `accountId`, `contactId`, `verified:true`. Uniform 401 on failure.
  - `GET /intake/context` — `@RequireScopes('chat:intake')`. Reads `accountId`/`contactId` from claims (extend the principal in `jwt-auth.guard.ts` / claim extraction like `resolveTrustedRagContext`). Returns display name, **device list**, ship-to defaults.
  - `POST /intake/turn` — `@RequireScopes('chat:intake')`. `{transcript, slots}` → `{assistantMessage, slots, requiredComplete}` (LLM answer + slot extraction + gate).
  - `POST /intake/case` — `@RequireScopes('chat:intake')` + rate-limit. `{issueDescription, subject?, priority?, assetId, shipToOverride?}`. Server builds `DemoCaseCreateFields` from **token claims** (`accountId`, `contactId`, supplied name/email) + chosen `assetId` **validated to belong to `accountId`** (prevents cross-account attach) + ship-to defaults. Calls `createChatCase`. Returns `{caseId, caseNumber}`.

### C. React chat window (`apps/react-chat-window`)

- **Phase reducer in `ChatShell.tsx`** (or a new `IntakeShell`) driving which surface renders; store the enriched token in the existing session `useState`.
- **New components** (reshape `LoginCard.tsx`): `EmailCard`, `OtpCard`, `DevicePicker`, `IntakeSummaryCard` (confirm). Reuse `ChatPanel`/`useChat` for triaging conversation; `lib/sse-stream.ts` unchanged.
- **New BFF proxy routes** (clone the `app/api/session/route.ts` and `app/api/demo/cases/route.ts` patterns): `/api/intake/otp/request`, `/api/intake/otp/verify` (returns token to client), `/api/intake/context`, `/api/intake/turn`, `/api/intake/case`. otp routes unauthenticated; context/turn/case forward the enriched Bearer. Gate with `CUSTOMER_INTAKE_ENABLED`.

---

## Field mapping: conversation → Case

| Case field (`DemoCaseFormDto` → `createCase`)          | Source                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `AccountId`, `ContactId`                               | **JWT claims** (from OTP verify)                                                |
| `SuppliedName`, `SuppliedEmail`                        | verified Contact name / email                                                   |
| `AssetId`                                              | **device picker** (asset chosen from SF-fetched list, validated to the account) |
| `Subject`, `Description`, `Priority` (Low/Medium/High) | **LLM extraction** from the issue conversation (required-field gate)            |
| `Service_Ship_To_{City,State,Country}__c`              | Account shipping address defaults (prompt only if missing)                      |
| `Status`, `Origin`, `AI_Orchestration_Status__c`       | server constants: `New`, `Chat`, `stopped_by_user`                              |

User is asked for **only**: the issue description and which device — everything else is fetched or defaulted.

---

## Security (per `AGENTS.md` / `.claude/rules`)

- OTP: hashed + peppered, single-use, short TTL, attempt-capped, per-email + per-source rate-limited; uniform responses (no enumeration); code never logged/returned.
- Never log raw PII/email/code/transcript; token carries `accountId`/`contactId` (not raw email); use `sensitive-data-redactor.ts`.
- All new public endpoints: DTO validation, CORS allowlist, rate limits, fail-closed when SF unconfigured.
- Case writes run as the integration user — **scope every read/write by the token's `accountId`**; validate the chosen `assetId` belongs to it.

## Org / config prerequisites

- Salesforce **Email Deliverability = "All email"** + a verified **OrgWideEmailAddress**; integration user granted access to the OTP apexrest + `Verification_Code__c` + `AI_Orchestration_Status__c` FLS. Deploy object + fields + permission set **together** (`sf project deploy validate` first).
- No new ai-api secret (reuses `SF_OAUTH_*`). New env: `CUSTOMER_INTAKE_ENABLED`, intake rate-limit window/max, OTP pepper (SF side).

## Suggested delivery order

1. **SF OTP** (object, `OtpService`, `AgentforceOtpRest`, tests, deploy-validate).
2. **ai-api**: `SalesforceOtpGateway` + gateway reads + `intake` module (otp request/verify + enriched JWT + `chat:intake` scope). Unit/DTO/guard tests.
3. **ai-api**: `/intake/context`, `/intake/turn`, `/intake/case` + `createChatCase`.
4. **React**: phase machine + Email/OTP/Device/Confirm components + BFF routes.
5. Wire end-to-end behind the feature flag.

## Verification

- **Apex:** `sf apex run test` for `OtpService`/`AgentforceOtpRest`; `sf project deploy validate` for the object+fields+permset payload.
- **ai-api:** `npm run ai-api:test` (otp gateway mocked-fetch, intake DTO validation, scope/guard tests, JWT-claim enforcement, cross-account asset rejection), `npm run ai-api:test:e2e` for the public otp + `/intake/case` contracts, `npm run ai-api:typecheck`.
- **React:** `npm run test:unit` (phase reducer, Email/OTP/Device components), `npm run lint`, `npm run react-chat:typecheck`.
- **End-to-end (real org, flag on):** open chat → state issue → enter a known Contact email → receive OTP → verify → confirm device is auto-listed → describe issue → confirm summary → assert a real Case is created with the correct Account/Contact/Asset and that **triage did not fire** (`AI_Orchestration_Status__c='stopped_by_user'`, no orchestration record). Then verify an unknown email yields the uniform response and no OTP.

## Open decisions to confirm at review

1. **Suppressing triage:** OK to set `AI_Orchestration_Status__c='stopped_by_user'` on chat Cases (reuses the existing Flow skip)? Alternative: add a dedicated picklist value / Origin='Chat' skip condition.
2. **Ship-to:** read from the Account and prompt only when missing (recommended), vs always ask, vs make the custom ship-to fields optional in-org.
3. **Multi-Contact email:** reject with "please contact support" vs pick the most-recent Contact. (Recommended: reject — safest for identity.)

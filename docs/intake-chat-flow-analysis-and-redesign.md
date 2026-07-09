# Ably Intake Chat — Flow Analysis & Redesign

> **Date:** 2026-07-03 · **Surface:** `react-chat-window` `/landing` chat panel · **API:** `apps/ai-api/src/intake/`
> **Code state:** after pulling `2c69d30` ("enhance intake service with context handling and device selection logic") — the branch now matches the production build on Railway.

## Diagnosis

The chat UI and the LLM are **two partially disconnected systems**. The latest pull fixed half of the gap — the model now receives account and device _catalog_ context every turn — but the model still never learns the **user's device selection** or any other live UI state, and the UI widgets (device chips, submit CTA) are driven by a weak client-side heuristic instead of the model's judgment.

**The fix:** finish connecting the two systems — send live UI state to the model every turn, and let the model return **UI directives** that decide which widgets appear and when. This is the "Claude chatbot" pattern: state in, structured directives out, every turn.

---

## 1. The actual conversation, annotated

Production transcript from 3 Jul (screenshots), replayed with each failure flagged at the turn where it happens. This conversation ran the _current_ code.

> **Ably:** Hi Jason, I'm Ably — your AI service guide for Aptivance tech. What issue are you experiencing today?

✅ Good greeting — personalized from `deviceGreeting()` (`lib/intake-client.ts`), name and account from the verified context.

> **User:** The laptop screen is black but an external monitor works.
>
> **Ably:** I understand that your laptop screen is black, but the external monitor is functioning properly. Can you tell me when this issue started **and** what troubleshooting steps you've already tried?

⚠️ **Failure 1 — two questions in one turn, one of them already answered.** "What have you already tried?" ignores that the user _just said_ they tried an external monitor. The system prompt's conversation-flow list no longer contains a one-question-per-turn rule, and there is no known/missing checklist to stop re-asking.

> **User:** the issue is stsrtid form today and i told you i tryed external monitor

🔴 **User friction — visible frustration.** "i told you" — the customer is repeating themselves. Redundant questions are the fastest way to lose trust in an AI intake.

> **Ably:** Thank you for the information. Just to clarify, the issue started today, and you've tried using an external monitor, which works fine. Have you attempted any other troubleshooting steps, such as restarting the laptop or checking the display settings? **Also, which registered device is affected?**

⚠️ **Failure 2 — asks for the device in free text while the UI owns that job.** The prompt _tells_ the model to ask ("After the issue is clear, ask which registered device is affected. The chat UI will show a device picker when ready"), but the model has no way to know whether the picker has been shown or answered.

> **User:** yes i have restarted the laptop three time
>
> **Ably:** Got it, you've restarted the laptop three times, but the internal screen remains black. **Please let me know which registered device is affected**, so I can assist you further.

🔴 **Failure 3 — blind to the selection.** At this moment the chip **AeroVolt Stratos Air 13 – Exec Travel Unit** is already selected in the UI. Tapping a chip is a silent client-side `dispatch({ type: "selectDevice" })` — no message is appended, no turn is fired, and the turn request contains no `selectedAssetId`. The conversation _cannot_ know the question was answered, so it asks again. Guaranteed by construction.

Meanwhile the UI shows:

```
[AeroVolt Stratos Air 13 - Exec Travel Unit]  Change
[        Review & submit case →              ]
```

⚠️ **Failure 4 — the CTA contradicts the conversation.** "Review & submit" is enabled while the bot is still asking questions, because the gate is `issueCaptured`: any extracted description ≥ 10 chars **or** ≥ 10 total user words — satisfied on turn one ("The laptop screen is black but an external monitor works" is 10 words).

---

## 2. What the latest pull already fixed vs. what remains

### Fixed by `2c69d30` ✅

| Fix                                                                                                                                                                                                   | Where                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Server injects account context into the system prompt every turn: customer name, account, contact email, ship-to, billing, device count + labels                                                      | `buildIntakeSystemPrompt()` in `intake-agent.service.ts` |
| Personalized greeting ("Hi Jason, I'm Ably…") composed from verified context                                                                                                                          | `deviceGreeting()` in `lib/intake-client.ts`             |
| Device chips gated behind issue capture, with a "Which device is affected?" header (this is why chips appear only after the first message — deliberate, but keyed to the weak `issueCaptured` signal) | `shouldShowDevicePicker()` in `lib/intake-client.ts`     |
| Case payload appends `Affected device: <label>` to the description; sends `deviceLabel` + `shipTo`                                                                                                    | `buildCaseCreatePayload()` in `lib/intake-client.ts`     |
| Submit blocked until a device is picked (when devices exist)                                                                                                                                          | `canSubmitCase()` in `lib/intake-client.ts`              |

### Still broken 🔴

| #    | Problem                                                                         | Root cause                                                                                                              | Where                                                                     |
| ---- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| RC‑1 | Model never learns the device **selection** (Failure 3)                         | Turn request carries only `messages[]`; chip tap is a silent dispatch with no acknowledgment turn                       | `dto/intake-turn.dto.ts` (request), `LandingChatPanel.tsx` `selectDevice` |
| RC‑2 | Submit CTA on turn one; chips timing driven by the same weak signal (Failure 4) | `issueCaptured` = description ≥ 10 chars OR ≥ 10 user words                                                             | `intake-agent.service.ts` `nextTurn()` (~L134)                            |
| RC‑3 | Model can't cue widgets; client infers them                                     | No UI directive / readiness fields in the turn response                                                                 | `dto/intake-turn.dto.ts` (response)                                       |
| RC‑4 | Multi-question turns; re-asks answered questions (Failures 1–2)                 | No one-question-per-turn rule in the current prompt; no known/missing checklist                                         | `buildIntakeSystemPrompt()`                                               |
| RC‑5 | Review card hides the Case body                                                 | `description` is computed in the confirm phase but never rendered — user submits a Case whose main field they never saw | `LandingChatPanel.tsx` confirm phase                                      |
| RC‑6 | Done screen reads "updates at ." in bootstrap mode                              | Uses `state.email` (empty when OTP skipped) even though `context.contactEmail` is now available                         | `LandingChatPanel.tsx` done phase (~L831)                                 |
| RC‑7 | A Salesforce round-trip on every turn                                           | `nextTurn()` calls `intakeService.getContext(principal)` per message                                                    | `intake-agent.service.ts` (~L102) — cache per session/JWT TTL             |

---

## 3. Target design: the model drives the UI

"Like a Claude chatbot" is the right instinct — in Claude-style chats the model receives the full state every turn and returns **structured directives** that the client renders as widgets. The intake already uses the repo's prompt‑plus‑`JSON.parse` extraction pattern, so this is an extension of the existing contract, not a rewrite.

```mermaid
sequenceDiagram
    participant U as Customer
    participant C as Chat client (LandingChatPanel)
    participant A as ai-api /intake/turn
    participant M as ModelRouter (LLM)

    U->>C: types message / taps device chip
    C->>A: messages[] + uiState { devices, selectedAssetId }
    A->>A: compose live context block<br/>(identity, devices, selection, known/missing)
    A->>M: system prompt + transcript
    M-->>A: reply + extracted + ui.action + readyToSubmit
    A-->>C: turn response
    C->>C: render widgets per ui.action<br/>(picker / suggestion / review card + CTA)
```

### The five rules

1. **Client sends UI state with every turn.** The turn request gains a `uiState` block: registered devices, the currently selected device, and whether review is open.
2. **Server injects a live state block into the system prompt.** On top of the existing context: _current selection_ and a _known/missing checklist_ — so the model can never ask for something the system already knows. (The catalog half of this already shipped in `2c69d30`.)
3. **Model replies with text + UI directives.** Alongside `reply`/`subject`/`description`/`priority`, the model returns `ui.action` and `readyToSubmit`. The model decides when the picker appears, when a device is suggested, and when the flow moves to review.
4. **Client renders widgets only when directed.** Chips, the suggestion chip, and the review card are conversation beats, not always-on furniture. Selecting a device fires an acknowledgment turn so the bot responds to it.
5. **Submit CTA appears when the model declares readiness.** `readyToSubmit: true` replaces the 10-word gate. Safety fallback so the user is never trapped: ≥ 2 user turns **and** ≥ 25 words, or JSON parse failure.

### Turn request — client → `POST /api/intake/turn`

```jsonc
{
  "messages": [
    /* LLM-visible transcript (uiOnly filtered) */
  ],
  "uiState": {
    "devices": [
      {
        "assetId": "02iXXX01",
        "label": "AeroVolt Stratos Air 13 - Exec Travel Unit"
      },
      { "assetId": "02iXXX02", "label": "AeroVolt Stratos Pro 16" }
    ],
    "selectedAssetId": "02iXXX01" // or null
  }
}
```

_(Server should still trust only JWT-scoped context for anything security-relevant; `uiState` is a conversational hint, and `assetId` is already validated server-side at case create.)_

### Live state block (appended to the system prompt each turn)

```
LIVE STATE — never ask for anything listed here:
Customer: Jason (identity verified)
Registered devices:
  1. AeroVolt Stratos Air 13 - Exec Travel Unit
  2. AeroVolt Stratos Pro 16
Currently selected device: AeroVolt Stratos Air 13 - Exec Travel Unit
Known so far: symptom ✓ · started ✓ · tried ✓ · device ✓
Ask EXACTLY ONE question per turn, only for missing items.
When nothing is missing, summarize what you have and set readyToSubmit=true.
```

### Turn response — model → client

```jsonc
{
  "reply": "Got it — your Stratos Air 13. Thanks, I have everything I need…",
  "subject": "Internal display black; external monitor works",
  "description": "Internal screen black since today. External monitor works. Restarted 3x — no change. Device: AeroVolt Stratos Air 13.",
  "priority": "High",
  "ui": { "action": "showReview", "suggestedDeviceIndex": null },
  "readyToSubmit": true
}
```

### Directive vocabulary

| `ui.action`        | Client renders                                                               | Typical moment                     |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------- |
| `none`             | Nothing extra — plain conversational turn                                    | Clarifying questions               |
| `showDevicePicker` | Device chips under the bot message                                           | Model needs to know which device   |
| `suggestDevice`    | One pre-highlighted chip: "Sounds like your Stratos Air 13 — tap to confirm" | User named the device in free text |
| `showReview`       | Summary card + **Review & submit case** CTA                                  | With `readyToSubmit: true`         |

> **Selection becomes a conversation event.** When the user taps a chip, the client updates `uiState.selectedAssetId` and immediately fires a turn with a hidden event note (`[event] customer selected: Stratos Air 13`). The bot acknowledges it — "Got it, your Stratos Air 13" — instead of asking for it two turns later.

---

## 4. The same conversation, replayed under the new design

Same customer, same black-screen issue — with the model holding the state and cueing each widget. Six turns, zero repeated questions, CTA appears exactly once, at the end.

> **Ably:** Hi Jason — I can see 2 registered devices on your account. What issue are you experiencing today?

_Beat 1 — context up front. No widgets yet; the model hasn't asked for anything._

> **User:** The laptop screen is black but an external monitor works.
>
> **Ably:** Since the external monitor works, the laptop itself is running — that points at the internal display. Which of your devices is this happening on?
>
> `[AeroVolt Stratos Air 13 - Exec Travel Unit]` `[AeroVolt Stratos Pro 16]`

_Beat 2 — `ui.action = showDevicePicker`. One acknowledgment, one question — chips appear at the moment the question is asked, because the model asked for them._

> — _Selected: AeroVolt Stratos Air 13 - Exec Travel Unit_ —
>
> **Ably:** Got it — your Stratos Air 13. When did the screen go black?

_Beat 3 — selection acknowledged. The tap fired a turn with updated `uiState`. The bot responds to it and moves to the next missing item. It can never ask "which device?" again._

> **User:** today, it was fine yesterday
>
> **Ably:** Have you tried restarting it?
>
> **User:** yes i have restarted the laptop three time
>
> **Ably:** Thanks Jason — I have everything I need. Your Stratos Air 13's internal display went black today, the external monitor works, and three restarts didn't help. I've marked this High priority. Review the summary below and submit when you're ready.

_Beat 4 — `readyToSubmit = true` → `showReview`. The CTA appears for the first time here, cued by the model's own "I have everything I need"._

```
┌──────────────────────────────────────────────┐
│ SUMMARY                                      │
│ Internal display black; external monitor works│
│ Device:   AeroVolt Stratos Air 13            │
│ Priority: High                               │
│ ──────────────────────────────────────────── │
│ Internal screen black since today (fine      │
│ yesterday). External monitor displays        │
│ correctly, so the system boots. Customer     │
│ restarted 3x with no change.                 │
├──────────────────────────────────────────────┤
│        [ Review & submit case → ]            │
└──────────────────────────────────────────────┘
```

_The review card now shows the full description (today it shows only subject, device, priority)._

> — _Case #00001204 created · updates via email_ —

---

## 5. The full process, start to end

| Stage          | Owner            | What happens                                                                                                                                                 |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 · Identity   | UI state machine | Email → OTP (or bootstrap skip in UAT). Mints the intake JWT. Unchanged.                                                                                     |
| 2 · Warm start | Server + context | Greeting with name + device count. Devices loaded before the input unlocks — chips are ready the moment the model calls for them.                            |
| 3 · Capture    | Customer         | Free-text issue description in their own words.                                                                                                              |
| 4 · Clarify    | **Model**        | Exactly one question per turn against the known/missing checklist: symptom → device (picker or suggestion) → when → tried. Never re-asks; 2–3 turns typical. |
| 5 · Readiness  | **Model**        | Declares "I have everything I need", returns `readyToSubmit: true` + `showReview`. CTA appears now, not before.                                              |
| 6 · Review     | Customer         | Subject, full description, device, priority — all visible, description editable. Back-to-chat stays available.                                               |
| 7 · Submit     | Server           | `POST /intake/case` → Salesforce Case (Origin=Chat, asset validated server-side). Unchanged.                                                                 |
| 8 · Done       | UI               | Case number + what happens next + "updates at `<contactEmail>`" (works in bootstrap mode too) + start-another-case.                                          |

---

## 6. Implementation checklist

> **Status: IMPLEMENTED 2026-07-03** (all items ✅). Design deviation: `uiState` carries only `selectedAssetId` — the server already holds the authoritative device catalog from `getContext()`, so client-supplied device labels never reach the prompt (smaller injection surface). The model refers to devices by 1-based index (`suggestedDeviceIndex`), resolved server-side to an assetId.

1. ✅ **Extend the turn contract** — optional `uiState.selectedAssetId` on the request; `ui: { action, suggestedAssetId? }` + `readyToSubmit` on the response.
   `apps/ai-api/src/intake/dto/intake-turn.dto.ts`
2. ✅ **Extend the live context block + tighten the prompt** — selection line ("NEVER ask which device"), EXACTLY-ONE-question rule, never-re-ask rule, `[event]` semantics, `ui`/`readyToSubmit` JSON keys; defensive parsing kept.
   `apps/ai-api/src/intake/intake-agent.service.ts` `buildIntakeSystemPrompt()` / `parseExtraction()` / `resolveUiDirective()`
3. ✅ **Replace the readiness gate** — model `readyToSubmit` primary; anti-trap fallback = ≥ 2 user turns AND ≥ 25 words (also covers JSON parse failure). The 10-word turn-one CTA is gone; `issueCaptured` remains for informational compat.
4. ✅ **Selection is a conversation event** — chip tap dispatches `selectDevice`, appends a hidden `[event]` note, and fires an acknowledgment turn with `uiState.selectedAssetId`; chips render on `showDevicePicker`/`suggestDevice` directives (sticky until picked, reopened by "Change"); suggested device gets a one-tap confirm chip.
   `LandingChatPanel.tsx`, `IntakeShell.tsx`, `intake/IntakeConversation.tsx`, `lib/intake-flow.ts`, `lib/intake-client.ts`
5. ✅ **Description visible + editable in the review card** — editable textarea in the landing panel confirm card and in `IntakeSummaryCard` (via `onDescriptionChange`); `[event]` notes excluded from transcript fallbacks.
6. ✅ **Done-screen email guard** — `state.email || context.contactEmail`, sentence hidden when neither exists.
7. ✅ **Context cached per identity** — 5-minute TTL, 200-entry cap in `IntakeAgentService`; one Salesforce round-trip per conversation instead of per message.
8. ✅ **Tests green** — ai-api: 643 tests / 73 suites pass (new: directive resolution, suggestion index → assetId, catalog validation of `selectedAssetId`, readiness fallback, cache). react-chat vitest: intake-flow (11) + intake-client (10) pass. Playwright intake mocks updated with `ui`/`readyToSubmit` (suite needs `@playwright/test` installed to run). Pre-existing failures on this branch (untouched): d3-dependent chart components + two non-intake spec type errors.
   Deploy note: intake API changes require deploying **ai-api and react-chat-window together** (`railway-quick-deploy`).

## 7. Live retest — 2026-07-06 (OTP bypass on, production)

Replayed the Section 1 scenario against production (deploys `42478167` ai-api / `5018d8ae` react-chat-window, branch head `746d0be`). OTP bypass enabled for the run. Result: **Case #00001201 created end-to-end**, several Section 2 fixes verified, but four defects remain — turn response bodies captured for each.

### Verified fixed ✅

- Bootstrap skips email/OTP; greeting personalized with device **count** (5), no device-name dump.
- Chip tap fires an acknowledgment turn — bot responds "You've selected the AeroVolt Stratos Air 13…" and never re-asks the device (RC‑1/Failure 3).
- Multi-location rule asks default ship-to vs. different site before submit.
- Review description is visible and editable (RC‑5 — but see R‑4 below on its content).
- Done screen: "You'll receive updates at jason.l@ablypro.com." in bootstrap mode (RC‑6).
- Case lands with correct Account/Contact/Asset, Origin=Chat, `AI_Orchestration_Status__c=stopped_by_user`.

### Still broken 🔴

| #   | Defect                                                                                                                                                                                                                                                                                                 | Evidence (turn response)                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R‑1 | **Double question, re-asks answered item** (Failure 1). Turn 1 reply: "When did this issue start, **and** have you tried any troubleshooting steps?" — model games the one-`?` rule by and-joining; user had just said they tried an external monitor. Prompt-only rule, no server check.              | turn 1 `reply`                                                                                                                                                  |
| R‑2 | **Directive/text contradiction → dead end.** Turn 2 reply says "tap the matching chip below" but returns `ui.action:"none"` — no chips render; user typed "i dont see any chip here". `sanitizeDevicePickerReply()` guards only the inverse case (picker shown, reply denies listing).                 | `{"reply":"…tap the matching chip below…","ui":{"action":"none"}}`                                                                                              |
| R‑3 | **`extracted` collapses to `{}` mid-conversation** (turns 2, 3, chip-ack) despite the REQUIRED-every-turn prompt rule. No server-side carry-forward of last-good subject/description/priority.                                                                                                         | turns 2–4 `extracted:{}`                                                                                                                                        |
| R‑4 | **Case description = raw transcript dump.** `resolveCaseDescription()` now ignores `extracted.description` entirely (deliberate workaround for R‑3) — CRM Description contains typos + meta-chatter: "i dont see any chip here, what devices do i have?" / "default address is fine".                  | Case 00001201 Description                                                                                                                                       |
| R‑5 | **Fallback readiness fires mid-clarification** (Failure 4 variant). `readyToSubmit:true` at turn 3 via the ≥2-turns/≥25-words fallback while the model is still asking for the device; after the chip tap the server forces `showReview` while the reply is asking the ship-to question — CTA vs. bot. | turn 3 `{"ui":{"action":"showDevicePicker"},"readyToSubmit":true}`; chip-ack turn `{"reply":"…should the on-site service occur…","ui":{"action":"showReview"}}` |

Minor: internal test asset "Node2 Validation Asset 2026-06-08" shows as a customer chip on the bootstrap account (data hygiene); `/landing` favicon 404s.

**Fix direction:** R‑2/R‑3/R‑5 are server-side consistency gaps — reconcile the reply text with the resolved directive (mention chips ⇒ ensure picker directive, or rewrite the reply), carry forward last-non-empty extraction, and don't let the word-count fallback override an explicit model `readyToSubmit:false` mid-question (keep it only for parse failure / genuine trap). R‑4 then becomes safe to revert to extracted-description-first with transcript fallback. R‑1 needs a server-side one-question check (or a reply rewrite pass), not just a prompt rule.

## 8. Conversational create redesign — 2026-07-06 (SHIPPED)

Product decision after the §7 retest: **no review/submit screen at all.** The bot summarizes in chat, the customer confirms in chat, the case is created from the conversation, the bot announces it in chat, and the conversation continues ("anything else?"). Verified live: **Case #00001202** created this way, with a clean AI-written Description in Salesforce.

### Contract changes

- New `ui.action: "createCase"` on the turn response — the model cues it only after the customer confirms its in-chat summary. `showReview` is deprecated (accepted, mapped to `none`).
- Server guards (`resolveUiDirective`): `createCase` without a locked-in device downgrades to the picker (typed-name match upgrades to `suggestDevice`); **a reply that references chips always renders them** (fixes R‑2 — chip-text with `action:"none"` was the §7 dead end); `readyToSubmit` no longer forces any widget (fixes R‑5 — it is informational only).
- Prompt: summary + "Shall I go ahead and create the case?" → on explicit confirmation only, `createCase` with a short "Creating your case now…"; after a `[event] Case created` note, help with next needs and base a NEW case only on messages after the latest event; `description` must be the model's OWN consolidated summary (symptom, device, when it started, what was tried) — never transcript verbatim (fixes R‑4 at the source).
- Client: the reducer accumulates last-non-empty extraction (absorbs R‑3 gaps); `resolveCaseDescription` is **extraction-first** with transcript fallback only when extraction never succeeded; `createCase` directive auto-POSTs `/intake/case` (double-guarded: reducer + server); the announcement (case #, issue, device, priority, follow-up email, "anything else?") is composed deterministically client-side and appended as a bot bubble plus a hidden `[event]` note for the model; per-case state resets after create (single-device auto-select re-applied) so a follow-up issue starts a fresh case in the same chat.
- Removed: `confirm`/`done` phases, `Review & submit` CTA, `IntakeSummaryCard`, `IntakeDone`, `descriptionOverride`/`editDescription`, `canReview`. Both surfaces (`/landing` panel and `/intake` page) share the new flow.

### Verified live (production, 2026-07-06)

- Bot summary in chat → "yes … create the case" → "Creating your case now…" → ✅ announcement with case number and "Is there anything else I can help you with?" — input stays active, polite close works.
- Salesforce Case 00001202 Description: _"The AeroVolt Stratos Air 13 - Exec Travel Unit has a black screen issue that started today. The customer has restarted the laptop three times, but the issue persists. An external monitor works fine, indicating the laptop's screen is the problem."_ — the AI's understanding, not the transcript.
- Chip cue and chips now always appear together (R‑2 regression test added server-side).

### Follow-up shipped 2026-07-06 (later the same day): service address + contact confirmation

UAT feedback: the bot never told the customer which address/contact would be used, only asked about location on multi-location accounts, and never offered different contact details.

- **Summary now always states what will be used** — the on-file ship-to address and contact email are injected into the summary rule for every account (not just multi-location) — and the single confirm question covers them: _"I will use the on-file service address in Austin, TX, US, and send updates to &lt;email&gt;. Is that all correct — shall I go ahead and create the case?"_
- **Overrides captured in chat** — new extracted fields `serviceAddress` / `contactEmail` / `contactPhone` (validated server-side; empty unless the customer explicitly gave different details). A correction restates the summary and re-asks confirmation.
- **Overrides land on the Case** — `SuppliedEmail` (override wins over verified/contact email), new `SuppliedPhone`, and a `Service address (customer provided): …` line appended to the Description (free text doesn't decompose into the structured `Service_Ship_To_*__c` fields, which keep the account defaults). Announcement shows the effective email + "Service at:" line.
- **Deterministic sniff fallback** — live testing caught the model restating a changed email/phone in prose while returning `extracted:{}` (R‑3 striking again); the server now regex-captures an email (≠ on-file) and phone (+‑prefixed or phone-context wording; serials/dates rejected) from the latest typed message whenever the model omits the JSON fields. Model extraction wins when present.
- Verified live: Case **00001205** — SuppliedEmail `jason.alt@…`, SuppliedPhone `+1 512 555 0100`, Dallas address line in Description; default-path Case confirms on-file address/email in the summary before create.

### Staged confirmation (UAT feedback: single mega-summary was confusing) — SHIPPED 2026-07-06

Registration is now **three beats, never one message** (prompt rules 9/9a/9b/10):

1. **Issue summary** — 1-2 sentences (device, symptom, started, tried) ending "Shall I go ahead and register this case?" — no address/contact in it.
2. **Service details** — its own message: the on-file service address and update email (or the customer's overrides), ending "Should I use these details, or would you like a different address or contact?"
3. **Create** — only after both confirmations → `createCase` → announcement.

Live testing caught a second text/directive mismatch: reply "Creating your case now…" with `ui.action:"none"` — the customer waits on a create that never fires. Added `CREATE_REFERENCE_PATTERN` reconciliation (create-announcement prose + no question mark + device locked ⇒ `createCase`; no device ⇒ picker), mirroring the chip reconciliation. Verified live: Case **00001206** created through the staged flow.

**Final-description re-extraction** — Cases 00001206/00001207 landed with the stale turn-1 description ("no troubleshooting steps mentioned yet") because later turns returned `extracted:{}` and the client's accumulate kept the old non-empty value. Prompt nudges didn't fix it. Deterministic fix: on the turn whose resolved action is `createCase` with an empty parsed description, the server makes a second, focused extraction call over the full transcript (`extractFinalCaseFields`) — single-purpose extraction is reliable where the conversational turn is not; failures degrade to the previous fallback chain. Verified live: Case **00001208** Description contains the device, symptom, "since today", and both troubleshooting steps (three restarts + reseated display cable).

### Still open

- R‑1 (double questions joined with "and") — prompt-level only; a server-side reply rewrite/question-splitter remains the fix if it keeps recurring.
- Bootstrap account still exposes internal test asset "Node2 Validation Asset 2026-06-08" as a customer chip; `/landing` favicon 404.
- `serviceAddress` has no deterministic fallback (model-only extraction; free-text addresses are too ambiguous to sniff) — the description line has carried it in every live run so far.
- The service-details message sometimes says "your email on file" instead of printing the literal address — prompt asks for the literal value; model paraphrases occasionally.

Tests: ai-api 664/73 suites green (createCase directive honored/downgraded, chip-reference reconciliation, deprecated showReview mapping, prompt contract incl. address/contact summary, override parse/validation, sniff fallback, case mapping). react-chat vitest 39 intake tests green (createCase reducer gating, post-create reset + single-device reselect, extraction-first description, override accumulate/payload/announcement). Playwright intake mock spec rewritten for the conversational flow (needs `@playwright/test` to run).

## Related docs

- Intake architecture plan: `docs/sleepy-sparking-newt.md`
- Skill: `.agents/skills/ablypro-landing-intake-chat/SKILL.md`
- OTP bypass for UAT: `.agents/skills/intake-skip-email-verification/`

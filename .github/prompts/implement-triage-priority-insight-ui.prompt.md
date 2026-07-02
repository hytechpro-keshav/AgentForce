---
name: "Implement Triage Priority Insight UI"
description: "Plan + implement AI-driven priority rationale, color badges, and D3 donut chart on the stepped console — deploy to Railway and prove with unit tests + Playwright E2E."
agent: "Stepped Console Implementer"
argument-hint: "Phase: plan-only | implement | deploy-test | full (default full). Optional workflow id or Case number."
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Case Triage Slice Implementer"
  - "Release Checker"
---

# Triage Priority Insight — plan, implement, deploy, test

You are adding **operator-trust UI** on the stepped orchestration console so Triage explains **why** a priority was chosen — without UI `if/else` rules.

**Core rule:** `priorityRationale` and `priorityFactors[]` (percent weights) come from the **same triage LLM call** that sets `priority`, `summary`, and `nextStep`. The React UI only renders AI output + theme-colored badges + a D3 donut.

## User-provided context

```text
${input}
```

Parse `${input}` for:

| Token            | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `plan-only`      | Write plan doc only; no code                                          |
| `implement`      | Code + local tests; no deploy                                         |
| `deploy-test`    | Deploy + Playwright only (assumes code shipped)                       |
| `full` (default) | Plan slice if missing → implement → local tests → deploy → Playwright |

Optional proof anchors:

- **Clean path:** Aptivance tech, Case `00001108` (display transfer)
- **Demo path:** `same-day-battery-fix` or `display-transfer` via `/demo/case-create`
- **Production URLs:** `https://react-chat-window-production.up.railway.app`, `https://ai-api-production-03f5.up.railway.app`

---

## Required reading (in order)

| #   | File                                                                    | Why                                                          |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `docs/orchestrator/triage-demo-signal-gaps-plan.md`                     | Prior signal-gap fixes (tenantId, asset repeat, buildTriage) |
| 2   | `apps/ai-api/src/agents/support-triage.service.ts`                      | Triage LLM prompt + JSON parse seam                          |
| 3   | `apps/ai-api/src/agents/dto/triage-case.dto.ts`                         | Request/response DTOs                                        |
| 4   | `apps/ai-api/src/orchestrator/dto/orchestration-status-event.ts`        | `SanitizedTriageResult` snapshot contract                    |
| 5   | `apps/ai-api/src/orchestrator/customer-context-to-triage-signals.ts`    | What signals the model sees (no raw Case JSON)               |
| 6   | `apps/react-chat-window/lib/stepped-view-model.ts`                      | `buildTriage`, `NODE_DEFS`                                   |
| 7   | `apps/react-chat-window/components/SteppedOrchestrationView.tsx`        | Layout: header → progress → spine                            |
| 8   | `apps/react-chat-window/components/SteppedOrchestrationView.module.css` | Theme tokens (`--amber-*`, `--ink`, `--mono`)                |
| 9   | `apps/react-chat-window/e2e/triage-demo-signal-gaps.spec.ts`            | Existing deployed E2E pattern                                |

Skills: `langgraph-stepped-console`, `langgraph-case-triage-slice`

---

## Product intent

Operators should see on the **main stepped screen** (not only buried in execution trace):

1. **Colored priority badge** — `low` / `normal` / `high` / `critical`
2. **Companion badges** — business risk level, repeat yes/no
3. **AI rationale** — plain English: _why this priority_ (e.g. strategic + 1 open → medium risk, but no repeat → stays normal)
4. **D3 donut chart** — AI-assigned **priority factor mix** (percentages sum to 100) for this Case only

**Never** synthesize rationale text in the frontend from `if (risk === 'medium')` rules.

---

## Phase 1 — Plan doc

Create or update `docs/orchestrator/triage-priority-insight-ui-plan.md` with:

### 1.1 Layout (target)

Full-width **Triage Insight** strip between progress bar and node spine (visible when `triage` exists):

```
┌─────────────────────────────────────────────────────────────┐
│ [NORMAL] [MEDIUM RISK] [NO REPEAT]          ← badges        │
│ Why this priority (AI)                                      │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ priorityRationale text from model                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│ Summary line (existing triage.summary)                      │
│                                    ╭───╮  Priority mix     │
│                                    │ D3 │  ● Case 30%      │
│                                    ╰───╯  ● Risk 35% …     │
└─────────────────────────────────────────────────────────────┘
```

Also show priority badge on **01 Triage** row header next to `DONE`.

Inside accordion: repeat `priorityRationale` (same field, no duplicate logic).

### 1.2 Badge colors (use CSS module vars)

| Badge       | Background | Text/border                    |
| ----------- | ---------- | ------------------------------ |
| critical    | `#fef2f2`  | `#dc2626`                      |
| high        | `#fdf3e7`  | `#d97706` (reuse `--amber-tx`) |
| normal      | `#f4f4f1`  | `#111` (reuse `--black`)       |
| low         | `#fbfbfa`  | `#a2a29d` (reuse `--mute`)     |
| medium risk | `#fdf3e7`  | `#b45309`                      |
| high risk   | `#fef3c7`  | `#92400e`                      |

### 1.3 Backend contract extension

Extend triage LLM JSON (single `ModelRouter.chat()` call):

```json
{
  "priority": "normal",
  "summary": "<=160 chars",
  "nextStep": "<=160 chars",
  "priorityRationale": "<=240 chars, plain English why this priority",
  "priorityFactors": [
    { "id": "customer_risk", "label": "Customer risk", "weight": 35 },
    { "id": "case_urgency", "label": "Case urgency", "weight": 30 },
    { "id": "reported_priority", "label": "Reported priority", "weight": 15 },
    { "id": "sla_tier", "label": "SLA / tier", "weight": 10 },
    { "id": "repeat_pattern", "label": "Repeat pattern", "weight": 5 },
    { "id": "warranty", "label": "Warranty", "weight": 5 }
  ]
}
```

**Validation (server):**

- `priorityFactors` optional; if present, weights must be integers 1–100 summing to **100** (±1 tolerance ok)
- Invalid/missing factors → omit chart; still show `priorityRationale` if valid
- Route all new strings through `redactSensitiveText`
- **Do not** add a second LLM call for rationale

**DTO / snapshot fields to add:**

- `TriageCaseResponseDto` + `SanitizedTriageResult` + `OrchestrationTriage` (react `orchestration.ts` sanitizer)
- Types: `TriagePriorityFactor { id: string; label: string; weight: number }`

**Prompt additions** (`buildTriageSystemPrompt`):

- Instruct model to explain priority tradeoffs using **only** fenced `customerSignals` + case text
- Require `priorityFactors` to reflect relative influence (not factual claims)
- Forbid inventing customer facts not in signals

### 1.4 File change list

| File                                  | Change                                                 | Size |
| ------------------------------------- | ------------------------------------------------------ | ---- |
| `support-triage.service.ts`           | Prompt + parse `priorityRationale` + `priorityFactors` | M    |
| `triage-case.dto.ts`                  | DTOs + class-validator                                 | S    |
| `orchestration-status-event.ts`       | Extend `SanitizedTriageResult`                         | S    |
| `orchestration.ts` (react)            | Sanitize new fields                                    | S    |
| `stepped-view-model.ts`               | Pass rationale/factors into view model                 | S    |
| `TriageInsightCard.tsx` (new)         | Badges + rationale + chart host                        | M    |
| `TriagePriorityDonut.tsx` (new)       | D3 donut using theme colors                            | M    |
| `SteppedOrchestrationView.tsx`        | Insert insight strip                                   | M    |
| `SteppedOrchestrationView.module.css` | Badge + insight strip styles                           | S    |

**Dependency:** add `d3` + `@types/d3` to `apps/react-chat-window` only if not present.

### 1.5 Test matrix

| ID  | Layer                                        | Scenario               | Assert                                                                                |
| --- | -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| T1  | `support-triage.service.spec`                | Signals present        | Response includes `priorityRationale`; factors sum to 100; payload has no `"records"` |
| T2  | `support-triage.service.spec`                | Malformed factors      | Chart omitted; priority still parsed                                                  |
| T3  | `stepped-view-model.test`                    | Fixture with rationale | Insight fields on triage node                                                         |
| T4  | `SteppedOrchestrationView.test.tsx`          | Render insight strip   | Badges + rationale visible                                                            |
| T5  | `TriagePriorityDonut.test.tsx`               | Mock factors           | SVG segments count matches factors                                                    |
| T6  | Playwright `triage-priority-insight.spec.ts` | Demo create → triage   | Insight visible; no "Missing tenant"; rationale non-empty                             |
| T7  | Playwright                                   | After triage           | Donut legend labels match API `priorityFactors`                                       |
| T8  | Manual                                       | Aptivance display case | normal + medium risk rationale mentions strategic/open, not repeat                    |

---

## Phase 2 — Implement

### Backend (ai-api)

1. Extend `buildTriageSystemPrompt` with rationale + factors instructions
2. Extend `parseTriageJson` to extract and validate new fields
3. Map through orchestrator → snapshot store (same path as existing triage fields)
4. Unit tests in `support-triage.service.spec.ts`

### Frontend (react-chat-window)

1. Extend types/sanitizer in `lib/orchestration.ts`
2. Extend `SteppedViewModel` / `buildTriage` with `priorityRationale`, `priorityFactors`, badge tones
3. Create `TriagePriorityDonut.tsx` — client component, `useEffect` + D3, destroy on unmount, aria-label for a11y
4. Create `TriageInsightCard.tsx` — badges, rationale block, summary, donut
5. Mount in `SteppedOrchestrationView` when `vm.nodes[0]` triage data available and revealed ≥ 1
6. Priority badge on Triage `NodeRow` header

**Non-goals:**

- No UI-generated rationale strings
- No raw Case JSON in chart tooltips
- No engineering console (`OrchestrationView.tsx`) in v1 unless trivial — stepped console first

---

## Phase 3 — Local tests (must pass before deploy)

```bash
# Backend
npm run ai-api:typecheck
npm run ai-api:test -- --testPathPattern="support-triage.service.spec|case-triage-orchestrator.service.spec"

# Frontend unit
cd apps/react-chat-window
npm run typecheck  # or root: npm run react-chat:typecheck
npx vitest run lib/__tests__/stepped-view-model.test.ts
npx vitest run components/__tests__/SteppedOrchestrationView.test.tsx
# Add when created:
npx vitest run components/__tests__/TriagePriorityDonut.test.tsx

# Prettier (if touched many files)
npm run prettier:verify
```

---

## Phase 4 — Deploy

```bash
chmod +x scripts/deploy/railway-quick-deploy.sh
SERVICE=all MESSAGE="Triage priority insight: AI rationale, badges, D3 donut" ./scripts/deploy/railway-quick-deploy.sh
```

Report deployment IDs + smoke HTTP results. Do not print secrets.

---

## Phase 5 — Playwright (production)

Create `apps/react-chat-window/e2e/triage-priority-insight.spec.ts` (or extend `triage-demo-signal-gaps.spec.ts`):

```bash
cd apps/react-chat-window
npm run test:e2e:install   # once
REACT_CHAT_URL=https://react-chat-window-production.up.railway.app \
  npx playwright test e2e/triage-priority-insight.spec.ts --reporter=list
```

**Flow (single serial test, reuse session cookie from demo create):**

1. `/demo/case-create` → `display-transfer` or `same-day-battery-fix` → Create case & step through
2. Wait for triage `awaiting_step` + `node === knowledge`
3. Screenshot `test-results/triage-priority-insight/01-insight-card.png`
4. Assert `[data-testid="triage-insight-rationale"]` non-empty
5. Assert `[data-testid="priority-badge-normal"]` or matching priority visible
6. Assert donut legend contains ≥3 factor labels from API snapshot
7. `GET /api/orchestrator/{workflowId}` — `triage.priorityRationale` defined; `priorityFactors` sum ≈ 100

**Screenshots:** save under `test-results/triage-priority-insight/*.png` at each step.

---

## Acceptance criteria

- [ ] `priorityRationale` is AI-generated in triage LLM response (not UI rules)
- [ ] Colored priority + risk + repeat badges match theme
- [ ] Triage Insight strip visible on main stepped screen after triage completes
- [ ] D3 donut shows AI `priorityFactors` weights; hidden when factors invalid
- [ ] 01 Triage accordion still shows summary, customer fields, trace
- [ ] LLM still receives only safe signals — no raw Case JSON (existing tests stay green)
- [ ] Local unit tests pass
- [ ] Railway deploy smoke 200
- [ ] Playwright E2E passes on production

---

## Final response format

Return:

1. Plan doc path (if written)
2. Contract summary (`priorityRationale`, `priorityFactors`)
3. Files changed
4. Local test commands + results
5. Deploy IDs + URLs
6. Playwright result + screenshot paths
7. Example rationale from live Case (one sentence, no PII)

Do not commit unless user asks.

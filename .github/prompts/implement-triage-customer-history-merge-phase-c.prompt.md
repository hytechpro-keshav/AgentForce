---
name: "Implement Triage + Customer History Merge — Phase C"
description: "UI collapse only: one Triage accordion (case + customer summary), remove Customer Context stage from visible spine, repoint stepped gate to knowledge, update fixtures/tests. No backend graph changes."
agent: "Stepped Console Implementer"
argument-hint: "Optional: focus engineering view only, stepped console only, or both"
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Code Review Orchestrator"
---

# Execution mode — implement Phase C only, do not replan

You are in **executing mode**. Implement **Phase C (UI collapse)** of the Triage + Customer History merge. **Phases A and B are shipped** on the backend. **Do not** change graph topology, eligibility, triage prompt, or DTOs unless a UI bug proves a minimal snapshot field is missing. **Do not** start Phase D (docs/briefs) unless `${input}` explicitly asks.

## Product goal (one paragraph)

Operators see **one stage called Triage** — not separate "Node 1 Triage" and "Node 2 Customer Context." The Triage card shows **priority**, a **complete plain-English summary** (case + customer from `triage.summary`), and **expandable structured customer findings** from `customerContext.package`. Visible stage count drops **6 → 5** (Triage + Nodes 3–6). **Do not renumber** Knowledge/Parts/Scheduling/Guardrail labels (still Node 3–6). Keep `customer_history` in `ORCHESTRATION_NODE_IDS` for event/trace exhaustiveness — it simply is not rendered as its own spine row.

## Prerequisites — Phases A + B (already done)

| Layer         | State                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Graph         | `readContext → runTriage → knowledge → …`; customer read + synthesis + context-informed LLM inside `runTriage` |
| Stepped pause | First pause after merged Triage: `snapshot.node === 'knowledge'` (backend)                                     |
| Triage LLM    | `customerSignals` from `customerContext.package`; complete summary in `triage.summary`                         |
| Backend tests | 567/567 green                                                                                                  |
| React UI      | **Still shows 2 stages** — this phase fixes that                                                               |

## Required skill-loading order

1. `langgraph-stepped-console` — stepped spine, bootstrap gate, advance UX
2. `langgraph-case-triage-slice` — snapshot fields (`triage`, `customerContext`)

## Agent persona

Adopt `.github/agents/stepped-console-implementer.agent.md`.

## Relevant repo instructions

- [frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)

## Canonical documents

| Document                 | Path                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Merge plan (primary)** | `docs/orchestrator/triage-customer-history-merge-plan.md` — §5 UI, §6 frontend file list, §9 risks (`:237` gate) |
| Stepped console plan     | `docs/orchestrator/stepped-console-phase-plan.md`                                                                |
| Phase A (done)           | `.github/prompts/implement-triage-customer-history-merge-phase-a.prompt.md`                                      |
| Phase B (done)           | `.github/prompts/implement-triage-customer-history-merge-phase-b.prompt.md`                                      |

## User-provided context

```text
${input}
```

Default when no arguments:

- Scope: **both** engineering `OrchestrationView` + stepped `SteppedOrchestrationView`
- Backend: **no edits** unless snapshot typing requires a one-line comment
- Docs: **out of scope** (Phase D)

---

## Phase C scope — IN

### A. Stepped console spine (`lib/stepped-view-model.ts`)

- [ ] Remove `customer_history` entry from **`NODE_DEFS`** visible spine (keep `NODE_SHORT.customer_history` + `builders`/`payloadPresent` keys for enum exhaustiveness)
- [ ] Update Triage `sub` copy — e.g. `priority · case · customer context`
- [ ] Fold **`buildCustomerContext`** detail sections into **`buildTriage`** (priority, summary, suggested next step, **plus** tier/SLA/warranty/repeat/risk from `customerContext.package` when present)
- [ ] `computeRevealedProgress` — index-based; should auto-correct when spine length drops; verify tests
- [ ] Events tagged `customer_history` still appear inside Triage trace/detail (rollup), not as separate stage

### B. Stepped UI gate — **critical** (`SteppedOrchestrationView.tsx`)

- [ ] Repoint load-bearing gate **`:237`**:
  - `snapshot.node === 'customer_history'` → **`snapshot.node === 'knowledge'`**
- [ ] Header copy `'6 nodes'` → **`'5 nodes'`** (`:476`)
- [ ] First post-Triage Run button should read **"Run Knowledge Base"** (data-driven from spine — verify, don't hardcode wrong label)
- [ ] Triage bootstrap animation still completes when backend pauses for Knowledge

### C. Engineering view (`OrchestrationView.tsx`)

- [ ] Merge **Node 1 + Node 2** presentation into one **Triage** stage:
  - Update `NODE_META.triage.description` — reads case **and** customer, context-informed priority
  - Remove `customer_history` from **`STAGE_NODES`** (keep key in `NODE_META` for event display if needed)
- [ ] Fold **`CustomerContextSummary`** / Node 2 output block into **`TriageSummary`** / Node 1 panel
- [ ] Single Triage card in orchestration panel — priority badge + `triage.summary` + expandable customer findings
- [ ] Fix **`displayNode`** fallback (`~:360-381`) — no longer promote `customer_history` as active stage
- [ ] Progress strip `/6` → **`/5`** where stage count is shown (`~:1858`)
- [ ] Intro copy (`~:1848`) — one Triage stage, not "Node 1 triage, Node 2 customer"

### D. Page subtitle (`app/orchestration/page.tsx`)

- [ ] Reword `:31` — merged Triage; Nodes 3–6 unchanged

### E. `lib/orchestration.ts`

- [ ] **KEEP** `customer_history` in `ORCHESTRATION_NODE_IDS` and sanitizer — spine presentation only changes

### F. Fixtures & tests (must update)

| File                                                     | Changes                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `lib/__tests__/stepped-fixture.ts`                       | Post-triage pause `node: 'knowledge'`; drop separate customer_history stage expectations |
| `lib/__tests__/stepped-view-model.test.ts`               | Spine order drops `customer_history`; Triage detail includes customer fields             |
| `components/__tests__/SteppedOrchestrationView.test.tsx` | Gate on `'knowledge'`; no "Run Customer Context"; `/5` nodes                             |
| `components/__tests__/OrchestrationView.test.tsx`        | One Triage stage; customer findings inside Triage card                                   |
| `lib/__tests__/orchestration.test.ts`                    | Update if stage count / node routing assertions break                                    |

**Scenarios to assert:**

1. Triage accordion shows priority + summary + customer tier/risk when `customerContext.package` present
2. Stepped spine has **5** visible nodes (Triage, Knowledge, Parts, Scheduling, Guardrail)
3. After auto-run Triage, `awaiting_step` + `node === 'knowledge'` completes bootstrap (no spinner hang)
4. `customer_history` events still render inside Triage trace when present in snapshot events
5. Nodes 3–6 labels still say "Node 3 · Knowledge Base" etc.

---

## Phase C scope — OUT

| Out of scope                           | Phase |
| -------------------------------------- | ----- |
| `apps/ai-api/**` graph, prompt, DTO    | —     |
| Docs / agent briefs / smoke script     | D     |
| Deleting `customer_history` from enums | Never |
| Renumbering Nodes 3–8 operator labels  | Never |

---

## Implementation checklist

### Stepped console

- [ ] `NODE_DEFS` — 5 entries (no `customer_history` row)
- [ ] `SteppedOrchestrationView.tsx:237` → `'knowledge'`
- [ ] `5 nodes` header
- [ ] Fixtures + stepped tests green

### Engineering view

- [ ] `STAGE_NODES` — 5 entries
- [ ] Merged Triage summary component
- [ ] `/5` progress denominator
- [ ] `OrchestrationView.test.tsx` green

### Validation

```bash
npm run react-chat:typecheck
cd apps/react-chat-window && npx vitest run \
  lib/__tests__/stepped-view-model.test.ts \
  lib/__tests__/orchestration.test.ts \
  components/__tests__/SteppedOrchestrationView.test.tsx \
  components/__tests__/OrchestrationView.test.tsx
```

Optional manual smoke (if env available):

- `/demo/case-create` → stepped console → Triage auto-runs → advance shows Knowledge first

---

## Acceptance criteria (Phase C)

- [ ] One operator-facing **Triage** stage in both consoles
- [ ] Complete summary visible: `triage.summary` + structured customer detail in same card
- [ ] No separate "Customer Context" / "Node 2" stage in spine or progress strip
- [ ] Stepped gate uses `'knowledge'` — no spinner hang after Triage
- [ ] Visible count **5** (not 6); Nodes 3–6 numbers unchanged
- [ ] `ORCHESTRATION_NODE_IDS` still includes `customer_history`
- [ ] Focused frontend tests pass
- [ ] No `apps/ai-api/**` changes

---

## Risk register

| Risk                                                       | Mitigation                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `:237` gate not repointed → infinite Triage spinner        | Change + component test                                               |
| Removing enum keys breaks `Record<OrchestrationNodeId>`    | Keep keys in maps; only drop from spine arrays                        |
| Customer events orphaned                                   | Roll `customer_history` events into Triage detail/trace               |
| `fromSnapshot > 1` bootstrap path wrong after spine shrink | Re-read stepped bootstrap `useEffect` logic; test fresh workflow load |

---

## Final response format

Return:

1. Skills/instructions used
2. UI before/after (stage list)
3. Files changed (React only)
4. Screenshot-level description of merged Triage card
5. Commands run + results
6. Phase C acceptance checklist
7. Gaps for Phase D (docs, smoke labels, merged agent brief)
8. Manual demo steps if not run live

Do not commit unless the user explicitly asks.

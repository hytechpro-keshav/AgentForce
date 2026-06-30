---
name: "Implement Stepped Console State Fix"
description: "Fix stepped console trace settlement, COMPLETED spine coherence, sidebar Receiving state, ACTIVITY log filtering, and backend pause copy. Playwright proof on production."
agent: "Stepped Console Implementer"
argument-hint: "Phase: A|B|C|D|E|frontend|backend|full (default full). Optional: deploy-test"
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Code Review Orchestrator"
  - "Release Checker"
---

# Execution mode — implement stepped console state fix (do not replan)

You are in **executing mode**. Implement the fixes in
`docs/orchestrator/stepped-console-state-fix-plan.md`. **Do not** change LangGraph
topology, orchestrator DTOs, Salesforce metadata, or `OrchestrationView.tsx`
(engineering console).

## Product goal (one paragraph)

Operators stepping through `/orchestration/stepped` should see a **coherent**
console: spine rows marked **COMPLETED** (green ✓) must not show `running` on
SEQ trace lines; the orchestrator sidebar should show **Receiving ←** during
completion animations (never vague **Working…**); the ACTIVITY log should show
only relevant lines per phase (no stale `Running AI triage` after Triage
finished); bootstrap and pause copy must read as “press Run for {next}”, not
“Stage complete” before anything ran.

## Already shipped in workspace (do not regress)

- Spine status badge: **COMPLETED** (green pill + ✓), not `DONE`
- Green rail line (`lineComplete`) and green knot for completed nodes
- E2E specs assert `COMPLETED` on finished spine rows
- `e2e/stepped-console-state.spec.ts` exists but **fails** until Phases A–D land

## User-provided context

```text
${input}
```

Parse `${input}`:

| Token            | Scope                                                                       |
| ---------------- | --------------------------------------------------------------------------- |
| `A`              | Phase A only — settle trace SEQ badges                                      |
| `B`              | Phase B only — `nodeState` animation order                                  |
| `C`              | Phase C only — sidebar `Receiving` during `completingIndex`                 |
| `D`              | Phase D only — `buildVisibleActivity` filtering + optional `#1…#n` renumber |
| `E`              | Phase E only — backend pause `safeSummary` copy                             |
| `frontend`       | Phases A + B + C + D (react-chat-window only)                               |
| `backend`        | Phase E only (ai-api)                                                       |
| `deploy-test`    | Deploy react-chat-window (+ ai-api if E changed) + Playwright only          |
| `full` (default) | A → B → C → D → E → local tests → deploy → Playwright                       |

Default when empty: **`full`**.

---

## Required skill-loading order

1. `langgraph-stepped-console` — stepped spine, reveal gate, advance UX, activity log
2. `langgraph-fundamentals` — awareness only; **no graph edits**

## Agent persona

Adopt `.github/agents/stepped-console-implementer.agent.md`.

Escalate: `Nest AI Architect` (view-model boundaries), `Release Checker` (deploy + Playwright gate).

## Relevant repo instructions

- [AGENTS.md](../../AGENTS.md)
- [frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)

## Canonical document

| Document                     | Path                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| **State fix plan (primary)** | `docs/orchestrator/stepped-console-state-fix-plan.md`      |
| Stepped console history      | `docs/orchestrator/stepped-console-phase-plan.md`          |
| Playwright repro             | `apps/react-chat-window/e2e/stepped-console-state.spec.ts` |

## Code anchors

| Area                              | Path                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Live trace + SEQ badges           | `apps/react-chat-window/components/SteppedLiveTrace.tsx`                                              |
| Reveal gate, `nodeState`, sidebar | `apps/react-chat-window/components/SteppedOrchestrationView.tsx`                                      |
| Activity log builder              | `apps/react-chat-window/lib/stepped-view-model.ts` — `buildVisibleActivity`                           |
| COMPLETED spine CSS               | `apps/react-chat-window/components/SteppedOrchestrationView.module.css`                               |
| Bootstrap pause event             | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts` — `bootstrapSteppedAwaitingTriage` |
| Post-stage pause event            | same file — `appendStepPauseEvent` (~`:838`)                                                          |
| Fixtures                          | `apps/react-chat-window/lib/__tests__/stepped-fixture.ts`                                             |

---

## Phase A — Settle trace SEQ badges (P0)

**IN:**

- [ ] `SteppedLiveTrace`: add `settled?: boolean`; display `completed` when `settled || !active` (map `assigned` → `completed` when settled)
- [ ] `NodeRow`: `settled={state === "done" && !completingActive && !showLiveTrace}`
- [ ] `SteppedLiveTrace.test.tsx` — settled/inactive shows `completed`, not `running`
- [ ] `stepped-console-state.spec.ts` — zero `running` badges in trace when spine shows **COMPLETED**

**OUT:** View-model `traceSection` rewrite (prefer component `settled` seam)

---

## Phase B — Align node badge with animation (P1)

**IN:**

- [ ] Reorder `nodeState`: check `runningIndex` / `completingIndex` **before** `index < revealed`
- [ ] `SteppedOrchestrationView.test.tsx` — header **RUNNING** while `completingIndex` set

**OUT:** Renaming `done` render state to `completed` (spine already says COMPLETED)

---

## Phase C — Sidebar during completion (P2)

**IN:**

- [ ] Pass `completingIndex` into `resolveOrchState`
- [ ] `if (runningIndex !== null \|\| completingIndex !== null) return "receiving"`
- [ ] `orchActiveName`: `runningIndex ?? completingIndex ?? awaitingIndex`
- [ ] Component test: no **Working…** during completion animation

**OUT:** Engineering console sidebar

---

## Phase D — Activity log filtering & copy (P2)

**IN:**

- [ ] Helpers in `stepped-view-model.ts`: `isInFlightTraceEntry`, `isPauseEntry`, optional `normalizeActivityText` for legacy backend strings
- [ ] `awaiting_step`: drop in-flight `→` traces from finished stages; keep synthetic `← {Stage} · complete` + frontier CTA
- [ ] `running`: show **active node only** (`snapshot.node`)
- [ ] Terminal (`done` / `rejected` / `escalated`): per-stage summary, no mid-flight rows
- [ ] Optional P3: `displaySeq` 1…n in render (`entry.displaySeq ?? entry.seq`)
- [ ] Extend `stepped-view-model.test.ts` `buildVisibleActivity` cases (paused at parts, running knowledge, terminal)
- [ ] Update `stepped-fixture.ts` if pause text expectations change

**OUT:** Raw backend `event.sequence` in API responses

---

## Phase E — Backend pause copy (P2)

**IN:**

- [ ] `bootstrapSteppedAwaitingTriage`: `Workflow ready — press Run for Triage.`
- [ ] `appendStepPauseEvent`: `{finishedLabel} complete — press Run for {nextLabel}.` — thread **finished** node label into helper
- [ ] `case-triage-orchestrator.service.spec.ts` — new `safeSummary` strings
- [ ] Sync `stepped-fixture.ts` + frontend tests matching pause text

**OUT:** Graph interrupt topology, new DTO fields

**Compatibility:** Phase D `normalizeActivityText()` must tolerate old snapshots until ai-api deploys.

---

## Scope — OUT

| Out of scope                            | Reason                          |
| --------------------------------------- | ------------------------------- |
| `OrchestrationView.tsx`                 | Engineering console unchanged   |
| Graph nodes / `interruptAfter`          | Plan explicitly frontend + copy |
| Salesforce metadata                     | Never                           |
| Confidence chart / triage insight strip | Unrelated                       |
| Docs beyond plan checklist              | Unless `${input}` asks          |

---

## Implementation checklist (merge)

- [ ] Phase A — trace `completed` when spine settled
- [ ] Phase B — `nodeState` animation-first
- [ ] Phase C — sidebar **Receiving ←** during completion
- [ ] Phase D — activity filtering + optional renumber
- [ ] Phase E — backend pause copy
- [ ] All focused unit tests green
- [ ] Playwright `stepped-console-state.spec.ts` green on production
- [ ] `stepped-trace-phase-a` + `triage-workflow-confidence` still green

---

## Validation (run before handoff)

```bash
# Frontend unit
cd apps/react-chat-window
npx vitest run \
  components/__tests__/SteppedLiveTrace.test.tsx \
  components/__tests__/SteppedOrchestrationView.test.tsx \
  lib/__tests__/stepped-view-model.test.ts

# Backend (if Phase E)
cd ../..
npm run ai-api:test -- --testPathPattern="case-triage-orchestrator.service.spec"

npm run react-chat:typecheck
npm run ai-api:typecheck

# Deployed proof (after deploy)
cd apps/react-chat-window
REACT_CHAT_URL=https://react-chat-window-production.up.railway.app \
  npx playwright test \
    e2e/stepped-console-state.spec.ts \
    e2e/stepped-trace-phase-a.spec.ts \
    e2e/triage-workflow-confidence.spec.ts
```

Deploy:

```bash
# Frontend Phases A–D
SERVICE=react-chat-window ./scripts/deploy/railway-quick-deploy.sh

# Backend Phase E (when ready)
SERVICE=ai-api ./scripts/deploy/railway-quick-deploy.sh
```

---

## Acceptance criteria (release gate)

- [ ] **COMPLETED** spine rows: zero `running` SEQ badges in accordion trace
- [ ] Node header **RUNNING** during completion animation (not COMPLETED early)
- [ ] Sidebar never **Working…** during normal stepped flow
- [ ] ACTIVITY: no stale in-flight lines from finished stages when paused
- [ ] Bootstrap ACTIVITY does not say “Stage complete” before first Run
- [ ] Post-stage pause names the **finished** stage, not the next one
- [ ] Playwright `stepped-console-state.spec.ts` passes on production
- [ ] Existing triage E2E specs still pass

---

## Manual smoke (after deploy)

1. `/demo/case-create` → display-transfer → **Create case & step through**
2. Before Run Triage: ACTIVITY reads “Workflow ready…” (not “Stage complete”)
3. Run Triage → COMPLETED green spine → expand accordion → SEQ rows show `completed`
4. Run Knowledge → while running, ACTIVITY shows KB traces only (not stale Triage running lines)
5. After KB COMPLETED: ACTIVITY shows Triage complete + Ready to dispatch Parts
6. Step through Parts → Scheduling → Guardrail; final ACTIVITY is summary-only

---

## Final response format

Return:

1. Skills/instructions used
2. Phases implemented (A–E)
3. Files changed
4. Before/after operator copy examples (bootstrap, paused, running, complete)
5. Commands run + test results
6. Deploy URLs + Playwright outcome
7. Acceptance checklist status
8. Anything left for a follow-up PR

Do not commit unless the user explicitly asks.

# Stepped Console — State, Trace & Activity Fix Plan

Fix operator-facing inconsistencies in the stepped orchestration console
(`/orchestration/stepped`): DONE nodes whose execution trace still shows
`RUNNING`, misleading ACTIVITY copy, stale in-flight log lines, and generic
**Working…** sidebar states during completion animations.

**Proof:** Playwright `e2e/stepped-console-state.spec.ts` reproduces the bug on
production. Triage-only E2E (`stepped-trace-phase-a`, `triage-workflow-confidence`)
still passes — the break appears after advancing past Triage.

**Scope:** React stepped console + minimal backend event copy. No graph topology,
DTO, or Salesforce changes.

---

## Symptoms (operator report)

| Symptom                          | Example                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DONE header + RUNNING trace rows | Knowledge **DONE** but SEQ 1–4 all `running`                                                                       |
| Misleading bootstrap ACTIVITY    | Before first Run: `Stage complete — awaiting Run for Triage`                                                       |
| Misleading pause ACTIVITY        | After Triage: `Knowledge Base · Stage complete — awaiting Run for Knowledge Base` (reads like KB already finished) |
| Stale in-flight log lines        | After KB complete, log still shows `→ Triage · Running AI triage`                                                  |
| Sequence gaps                    | `#1` → `#3` → `#9` (backend global `event.sequence`)                                                               |
| Generic sidebar                  | **Working…** during completion animation instead of **Receiving ←**                                                |
| Final activity clutter           | **Run complete** but log still lists mid-flight traces                                                             |

Sidebar pause CTAs are mostly correct:

- **Awaiting Next ▸** press Run to dispatch {next node}
- **Dispatching →** / **Receiving ←** during active runs

---

## Root causes

### R1 — Trace badge uses raw backend event status (P0)

`lib/stepped-view-model.ts` `traceSection()` maps each progress event’s
`status` onto `SteppedTraceStep.status`. Backend emits `running` on in-flight
progress events; those values are **never updated to `done`** when the node
finishes.

`SteppedLiveTrace` renders `step.status` even when `active={false}` after the
node header is **DONE**.

**Files:** `SteppedLiveTrace.tsx`, `SteppedOrchestrationView.tsx` (`NodeRow`)

### R2 — `nodeState` checks `revealed` before animation indices (P1)

```ts
if (index < revealed) return "done";
if (index === runningIndex || index === completingIndex) return "running";
```

A node can show **DONE** in the header while `completingIndex` is still set on
that index during the completion animation.

**File:** `SteppedOrchestrationView.tsx`

### R3 — Sidebar `resolveOrchState` ignores `completingIndex` (P2)

When `completingIndex !== null` and `runningIndex === null`, `pill` is
`running` but `resolveOrchState` falls through to **Working…** instead of
**Receiving ←**.

**File:** `SteppedOrchestrationView.tsx`

### R4 — `buildVisibleActivity` leaks in-flight traces (P2)

When `snapshot.status === "running"`, activity includes **all events** for every
node up to the active index — including old `running` trace lines from stages
already DONE on the spine.

When `awaiting_step`, `priorIds` filters by node id but **not** by event kind;
in-flight `→` trace lines from finished stages remain visible.

**File:** `lib/stepped-view-model.ts` (`buildVisibleActivity`,
`filterActivityForRevealed`)

### R5 — Backend pause event copy is ambiguous (P2)

| Event                                        | Current copy                                    | Problem                                                                  |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| Bootstrap (`bootstrapSteppedAwaitingTriage`) | `Stage complete — awaiting Run for Triage.`     | Nothing completed yet                                                    |
| Post-stage pause (`appendStepPauseEvent`)    | `Stage complete — awaiting Run for {nextNode}.` | Sounds like `{nextNode}` finished; means “press Run to start {nextNode}” |

**File:** `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts`

### R6 — Display sequence numbers are backend globals (P3)

Activity shows raw `event.sequence` (`#1`, `#3`, `#9`). Operators interpret
these as step order. Cosmetic only.

---

## Target operator experience

### Sidebar (Orchestrator panel)

| Phase                                    | Label               | Subtext                      |
| ---------------------------------------- | ------------------- | ---------------------------- |
| Bootstrap (paused before Triage)         | **Awaiting Next ▸** | press Run to start Triage    |
| Dispatching                              | **Dispatching →**   | handing case to {name}       |
| Node executing (backend or UI animation) | **Receiving ←**     | output from {name}           |
| Paused between stages                    | **Awaiting Next ▸** | press Run to dispatch {next} |
| Guardrail approval                       | **Paused**          | awaiting external approval   |
| Terminal                                 | **Run complete**    | all nodes settled            |

Never show **Working…** during normal stepped flow.

### ACTIVITY log

| Phase              | Show                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Bootstrap          | `Workflow ready — press Run for Triage` + `Ready to dispatch → Triage` (or merge into one line) |
| Paused at frontier | One **complete** line per finished stage + frontier pause + `Ready to dispatch → {next}`        |
| Node running       | **Current node only** — live `→` trace lines                                                    |
| Workflow complete  | One line per stage: `{Stage} · complete` or terminal outcome (`escalated`, etc.)                |

Do **not** show:

- `Stage complete — awaiting Run for Triage` before first run
- In-flight `Running AI triage` after Triage is DONE on the spine
- Raw backend sequence gaps (optional: renumber `#1…#n` in UI)

### Execution trace (accordion)

| Phase                                      | SEQ badge                                                      |
| ------------------------------------------ | -------------------------------------------------------------- |
| Live typing (`active`)                     | Backend status (`assigned`, `running`, …)                      |
| Settled (`active=false` or node COMPLETED) | **`completed`** for all visible steps (not `done` / `running`) |

### Spine completed visual (operator-facing)

| Element                       | Treatment                                         |
| ----------------------------- | ------------------------------------------------- |
| Status badge                  | **COMPLETED** (not DONE) — green pill with ✓ icon |
| Rail knot                     | Green circle, white checkmark                     |
| Rail line (completed segment) | Green (`--complete` #16a34a), not black           |
| Terminal “Case handled”       | Same COMPLETED treatment when workflow finishes   |

---

## Implementation phases

### Phase A — Settle trace SEQ badges (P0)

**Goal:** DONE nodes never show `running` on SEQ rows.

**Changes:**

1. `SteppedLiveTrace.tsx`
   - Add `settled?: boolean` prop.
   - Display status: `settled || !active ? "completed" : step.status` (normalize
     `assigned` → `completed` when settled if desired).

2. `SteppedOrchestrationView.tsx` (`NodeRow`)
   - Pass `settled={state === "done" && !completingActive && !showLiveTrace}`.

3. Optional alternative (view-model): in `traceSection()`, when building for a
   node whose payload is present in snapshot, map all items to `done`. Prefer
   component-level `settled` — keeps live animation honest during `active`.

**Tests:**

- `SteppedLiveTrace.test.tsx` — inactive/settled trace shows `done`, not `running`
- `e2e/stepped-console-state.spec.ts` — assert zero `running` badges on DONE nodes
  (Triage, Knowledge, Parts)

**Acceptance:**

- [ ] Any spine row with **DONE** header has no `running` SEQ badges
- [ ] Live trace during Run still shows `running` / `assigned` while typing

---

### Phase B — Align node badge with animation (P1)

**Goal:** Header badge matches animation phase.

**Change** `nodeState` in `SteppedOrchestrationView.tsx`:

```ts
const nodeState = (index: number): NodeRenderState => {
  if (index === runningIndex || index === completingIndex) return "running";
  if (index < revealed) return "done";
  if (index === revealed) return "frontier";
  return "queued";
};
```

**Tests:**

- `SteppedOrchestrationView.test.tsx` — during `completingIndex`, node header
  shows **RUNNING** until response typing completes

**Acceptance:**

- [ ] No **DONE** header while completion animation is still active on that node

---

### Phase C — Sidebar state during completion (P2)

**Goal:** Replace **Working…** with **Receiving ←** during completion animation.

**Changes** `SteppedOrchestrationView.tsx`:

- Pass `completingIndex` into `resolveOrchState`.
- `if (runningIndex !== null || completingIndex !== null) return "receiving"`.
- `orchActiveName`: use `runningIndex ?? completingIndex ?? awaitingIndex`.

**Tests:**

- Unit or component test: `completingIndex` set → sidebar **Receiving ←**

**Acceptance:**

- [ ] No **Working…** during normal stepped advance/completion

---

### Phase D — Activity log filtering & copy (P2)

**Goal:** ACTIVITY reads chronologically; no stale in-flight lines.

**Frontend** (`lib/stepped-view-model.ts`):

1. Add helpers:
   - `isInFlightTraceEntry(entry)` — `kind === "out"` and text does not match
     pause/complete patterns
   - `isPauseEntry(entry)` — `Stage complete — awaiting Run` or new copy
   - `collapseStageActivity(entries, nodeId)` — one `← {Stage} · complete` per
     finished stage

2. **`awaiting_step` branch** (existing):
   - Keep `priorIds` filter
   - Drop in-flight `→` traces from prior stages (only synthetic `complete` + pause + dispatch)
   - Transform frontier pause copy in UI if backend not yet updated (see Phase E)

3. **`running` branch**:
   - Show events for **active node only** (`snapshot.node`), not all nodes
     `slice(0, activeIndex + 1)`

4. **Terminal branch** (`done`, `rejected`, `escalated`):
   - One summary line per revealed stage + terminal guardrail outcome
   - No in-flight traces

5. **Display renumbering (optional P3):**
   - Map `visibleActivity` to `displaySeq: 1..n` before render; keep `seq` for
     React keys only

**Render** (`SteppedOrchestrationView.tsx`):

- Use `entry.displaySeq ?? entry.seq` for `#` prefix

**Tests:**

- Extend `stepped-view-model.test.ts` `buildVisibleActivity` cases:
  - Paused at parts: no `Running AI triage`
  - Running knowledge: only knowledge `→` lines (+ optional dispatch line)
  - Terminal: collapsed summary

**Acceptance:**

- [ ] Paused state: only completion + frontier CTA lines for finished stages
- [ ] Running state: current node trace only
- [ ] Complete state: per-stage summary, no mid-flight rows

---

### Phase E — Backend event copy (P2)

**Goal:** Fix misleading pause strings at the source.

**File:** `case-triage-orchestrator.service.ts`

| Location                               | Current                                          | Proposed                                                |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `bootstrapSteppedAwaitingTriage`       | `Stage complete — awaiting Run for Triage.`      | `Workflow ready — press Run for Triage.`                |
| `appendStepPauseEvent` (after stage N) | `Stage complete — awaiting Run for {nextLabel}.` | `{finishedLabel} complete — press Run for {nextLabel}.` |

Requires passing **finished** node label into `appendStepPauseEvent` (the graph
node that just completed), not only `awaitingNode`.

**Tests:**

- `case-triage-orchestrator.service.spec.ts` — assert new `safeSummary` strings
- Update `stepped-fixture.ts` and frontend tests that match pause text

**Acceptance:**

- [ ] Bootstrap event does not say “Stage complete”
- [ ] Post-triage pause names Triage as complete, not Knowledge as complete

**Compatibility:** Frontend Phase D may still rewrite legacy strings until
ai-api is deployed; add a small `normalizeActivityText()` for old snapshots.

---

## File touch list

| File                                                                            | Phases      |
| ------------------------------------------------------------------------------- | ----------- |
| `apps/react-chat-window/components/SteppedLiveTrace.tsx`                        | A           |
| `apps/react-chat-window/components/SteppedOrchestrationView.tsx`                | A, B, C     |
| `apps/react-chat-window/lib/stepped-view-model.ts`                              | D           |
| `apps/react-chat-window/lib/__tests__/stepped-view-model.test.ts`               | D           |
| `apps/react-chat-window/components/__tests__/SteppedLiveTrace.test.tsx`         | A           |
| `apps/react-chat-window/components/__tests__/SteppedOrchestrationView.test.tsx` | B, C        |
| `apps/react-chat-window/e2e/stepped-console-state.spec.ts`                      | A–D (proof) |
| `apps/react-chat-window/lib/__tests__/stepped-fixture.ts`                       | D, E        |
| `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts`              | E           |
| `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.spec.ts`         | E           |

**Out of scope:** `OrchestrationView.tsx` (engineering console), graph nodes,
Salesforce metadata, docs/agent briefs beyond this plan.

---

## Validation commands

```bash
# Frontend unit
cd apps/react-chat-window
npx vitest run \
  components/__tests__/SteppedLiveTrace.test.tsx \
  components/__tests__/SteppedOrchestrationView.test.tsx \
  lib/__tests__/stepped-view-model.test.ts

# Backend unit (after Phase E)
npm run ai-api:test -- --testPathPattern="case-triage-orchestrator.service.spec"

# Typecheck
npm run react-chat:typecheck
npm run ai-api:typecheck

# Deployed proof
REACT_CHAT_URL=https://react-chat-window-production.up.railway.app \
  npx playwright test \
    e2e/stepped-console-state.spec.ts \
    e2e/stepped-trace-phase-a.spec.ts \
    e2e/triage-workflow-confidence.spec.ts
```

Deploy order: **react-chat-window** (Phases A–D) can ship first with
`normalizeActivityText()` for legacy backend strings; **ai-api** (Phase E) can
follow independently.

---

## Suggested copy matrix (final)

### Backend `safeSummary` events

| When                           | Text                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| Stepped workflow created       | `Workflow ready — press Run for Triage.`                     |
| Triage finished, paused for KB | `Triage complete — press Run for Knowledge Base.`            |
| KB finished, paused for Parts  | `Knowledge Base complete — press Run for Parts & Logistics.` |
| …                              | `{Finished} complete — press Run for {Next}.`                |

### Frontend synthetic ACTIVITY lines (unchanged intent, clearer labels)

| Synthetic    | Text                                      |
| ------------ | ----------------------------------------- |
| Stage rollup | `← {Stage} · complete`                    |
| Frontier CTA | `→ Ready to dispatch → {Next stage name}` |

### Sidebar

| State         | Label           | Subtext                      |
| ------------- | --------------- | ---------------------------- |
| `ready`       | Awaiting Next ▸ | press Run to dispatch {next} |
| `dispatching` | Dispatching →   | handing case to {name}       |
| `receiving`   | Receiving ←     | output from {name}           |
| `complete`    | Run complete    | all nodes settled            |

---

## Risk register

| Risk                                              | Mitigation                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Settling trace hides real errors mid-animation    | Only settle when `!active && !completingActive` or explicit `settled`    |
| Backend copy change breaks E2E/fixtures           | `normalizeActivityText()` + update fixtures in same PR                   |
| Activity too sparse while running                 | Show current node live trace only; spine accordion still has full detail |
| Phase E needs finished-node label in pause helper | Thread `completedNode` from graph interrupt callback                     |

---

## Acceptance checklist (release gate)

- [ ] **P0** COMPLETED nodes: zero `running` SEQ badges in accordion trace; spine shows green ✓ + **COMPLETED** badge
- [ ] **P1** Node header **RUNNING** during completion animation
- [ ] **P2** Sidebar never **Working…** during normal stepped flow
- [ ] **P2** ACTIVITY: no stale in-flight lines from finished stages when paused
- [ ] **P2** Bootstrap ACTIVITY does not say “Stage complete” before first Run
- [ ] **P2** Post-stage pause names the **finished** stage, not the next one
- [ ] **P3** (optional) Activity displayed as `#1…#n` without backend gaps
- [ ] Playwright `stepped-console-state.spec.ts` green on production
- [ ] Existing triage E2E specs still green

---

## Related documents

- `docs/orchestrator/stepped-console-phase-plan.md` — original phased console delivery
- `docs/orchestrator/triage-customer-history-merge-plan.md` — merged Triage (no Node 02 in spine)
- `.agents/skills/langgraph-stepped-console/SKILL.md` — operator flow reference
- `.github/prompts/implement-triage-customer-history-merge-phase-c.prompt.md` — UI collapse (done)
- `.github/prompts/implement-stepped-console-state-fix.prompt.md` — trace/activity/sidebar state fix (this plan)

---

## Execution order

1. **Phase A** — trace badge settlement (highest visual impact)
2. **Phase B** — nodeState ordering
3. **Phase C** — sidebar receiving state
4. **Phase D** — activity filtering + optional renumbering
5. **Phase E** — backend copy (can parallelize after D’s `normalizeActivityText`)

Estimated effort: **1 PR (A+B+C)**, **1 PR (D)**, **1 PR (E)** — or single PR if preferred for one deploy.

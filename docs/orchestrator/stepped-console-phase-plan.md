# Stepped Orchestration Console — Phase Plan

Convert the approved "spine" mockup (`docs/orchestrator/Orchestration Console.html`)
into a real screen in `apps/react-chat-window`, with manual **Run next stage**
controls. The existing read-only console at `/orchestration`
(`components/OrchestrationView.tsx`) is **left untouched** — this is a new,
parallel surface.

## Decisions (signed off)

- **New screen**, separate route `/orchestration/stepped`. Existing console unchanged.
- **Preserve the mockup look** — scoped CSS Module + Space Grotesk / JetBrains Mono
  via `next/font` (no global/layout change).
- **Sequencing: replay-first, then real stepping.** Phase 1 ships the screen over a
  real run with zero backend risk; Phase 2 adds true per-node stepping.

## Backend reality (why two phases)

The orchestrator (`apps/ai-api/src/orchestrator/case-triage.graph.ts`,
`case-triage-orchestrator.service.ts`) runs the whole LangGraph in one
`graph.invoke()` and only pauses at **Node 6 (guardrail)** via `interrupt()`.
Resume is guardrail-only (`Command({ resume })`). There is **no per-node
stepping** and no endpoint for it. So Phase 1 reveals already-computed stages;
Phase 2 adds the stepping capability.

---

## Phase 1 — Replay screen (DONE)

Drives the spine from a **real** `OrchestrationSnapshot`, fetched through the
existing read-only proxy (`/api/orchestrator/case/[caseId]` or
`/api/orchestrator/[workflowId]`). Triage auto-reveals once the case is assigned;
each later stage has a **Run** button that reveals its real, already-computed
result. A stage's Run button only enables once the backend has actually produced
that stage (`available` in the snapshot) — so the screen never shows a stage that
has not run. **No backend or proxy changes.**

Files:

- `apps/react-chat-window/lib/stepped-view-model.ts` — pure
  `buildSteppedViewModel(snapshot)` mapping each node's real fields → spine
  output line + accordion (summary, field grid, lists, execution trace). Reuses
  `sanitizeSnapshot` guarantees; invents no data.
- `apps/react-chat-window/components/SteppedOrchestrationView.tsx` — client
  component: polls (2.5s, stops at terminal), reveal state machine, accordions,
  Run buttons, orchestrator panel + activity log from real `events`.
- `apps/react-chat-window/components/SteppedOrchestrationView.module.css` — scoped
  port of the mockup aesthetic.
- `apps/react-chat-window/app/orchestration/stepped/page.tsx` — route + scoped fonts.
- Tests: `lib/__tests__/stepped-view-model.test.ts`,
  `components/__tests__/SteppedOrchestrationView.test.tsx`,
  fixture `lib/__tests__/stepped-fixture.ts`. `react-chat:test` + `:typecheck` green.

View: `/orchestration/stepped?caseId=500…` (or `?workflowId=wf-…`).

Live proof (operator env): open the stepped route for a Case that has a real run,
confirm Triage auto-reveals and each Run reveals the true stage data, guardrail
shows the waiting note when approval is pending.

---

## Phase 2 — Real per-node stepping (DONE)

Generalize the guardrail's proven interrupt/checkpoint pattern into a **stepped
run mode** so each Run truly executes that node on demand.

### Contract / shared

- Add `runMode: "auto" | "stepped"` to graph state + the snapshot DTO and
  `lib/orchestration.ts` (+ `sanitizeSnapshot`).
- Add a non-terminal status `awaiting_step` and an `awaitingNode?: OrchestrationNodeId`
  so the UI knows the run is paused for the next click. Update `STATUS_META`,
  `isTerminalStatus` (keep it non-terminal).
- New auth scope `agentforce:orchestrator-step` (distinct from read/approval/control).

### Backend (`apps/ai-api/src/orchestrator`)

- Compile a stepped graph variant with LangGraph **`interruptAfter: [triage,
customer_history, knowledge, parts_logistics, scheduling]`** (guardrail keeps
  its existing approval interrupt). After each node checkpoints, the invoke returns.
- Service: `triggerStepped(caseId)` → create `assigned` snapshot, run Triage,
  pause at `awaiting_step`; `advance(workflowId)` → `graph.invoke(new Command({
resume }), { thread_id })` runs exactly the next node, pauses again. Guardrail
  "advance" = the existing approve/reject `resume`.
- Controller: `POST /cases/:caseId/stepped` and `POST /:workflowId/advance`
  (scope `agentforce:orchestrator-step`). Reuse `appendEvent` so the trace/timeline
  still populate per step.
- **Durability:** the checkpointer is `MemorySaver` (in-memory) — fine for a
  single instance/demo, but multi-instance/restart-safe stepping needs a
  **Postgres checkpointer** (mirror the optional Postgres path already used by the
  status store). Required before production multi-instance rollout.

### Frontend

- New proxy routes for `stepped` + `advance` using the operator-session cookie
  (mirror `…/stop`), new scope. Swap the component's local `startReveal` for a
  real `POST /advance`; gate the Run button on `awaiting_step` + `awaitingNode`.
- Guardrail stays approval-by-out-of-band (no approve/reject button here, matching
  current console policy) — or add it behind `agentforce:orchestrator-approval`.

### Tests

- Graph spec: pauses after each node in stepped mode; `advance` runs exactly one.
- Controller spec: scopes, idempotency, terminal handling.
- UI: Run → `/advance` call, button gating on `awaiting_step`.

### Risks

- Touches the production orchestrator graph + adds a mutation endpoint → land
  behind config/scope, with the auto-run path unchanged.
- In-memory checkpointer loses paused stepped runs on restart — ship Postgres
  checkpointer before relying on it in production.

---

## Phase 2b — Launchers & start flow (DONE)

Make the stepped console discoverable and kick-off friendly without curl:

- `OrchestrationConsoleNav` cross-links `/orchestration` ↔ `/orchestration/stepped`
  (preserves `caseId` / `workflowId` query params).
- Demo Case Create returns `steppedOrchestrationUrl` and offers **Create case &
  step through →** alongside the existing watch-workflow button.
- `SteppedStartPanel` on the stepped route when `?caseId=` has no workflow yet:
  operator login + **Start stepped run** POSTs to `/api/orchestrator/case/[id]/stepped`,
  then replaces the URL with `?workflowId=wf-…` and polls.

Live proof: create a demo Case → stepped console → sign in → start stepped run →
advance each stage and confirm real snapshot data appears.

---

## Phase 3 — Production durability (PLANNED)

- Postgres checkpointer for stepped runs (multi-instance / restart-safe).
- Optional: advance-step operator login inline (currently shares session cookie
  with start panel / Stop AI login).

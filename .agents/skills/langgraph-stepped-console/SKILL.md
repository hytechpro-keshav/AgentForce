---
name: langgraph-stepped-console
description: >-
  Stepped orchestration console in react-chat-window: manual per-node advance,
  demo case create bootstrap, operator session, triage intro animation, and
  guardrail approval UX. Use when editing SteppedOrchestrationView, stepped
  proxies, demo create auto-start, or stepped-console docs.
argument-hint: "Route, proxy, view model, demo flow, or stepped backend scope"
user-invocable: true
---

# Stepped Orchestration Console

Operator-facing **manual stepping** surface at `/orchestration/stepped`. Separate from the read-only engineering console at `/orchestration`.

**Phase plan (canonical):** [`docs/orchestrator/stepped-console-phase-plan.md`](../../../docs/orchestrator/stepped-console-phase-plan.md)

## Two consoles — do not conflate

| Surface                 | Route                                        | Purpose                                                                                |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Stepped console**     | `/orchestration/stepped?workflowId=wf-…`     | Demo/operator walkthrough — Triage auto-runs, then **Run** advances one node at a time |
| **Engineering console** | `/orchestration?caseId=…` or `?workflowId=…` | Read-only observability, Stop AI, full timeline                                        |

The stepped page **does not** link to the engineering console. Demo Case create redirects to stepped only.

## Demo operator flow (production)

1. Open **`/demo/case-create`** → pick scenario → **Create case & step through**
2. **ai-api** creates the Case and calls `triggerStepped` → returns `steppedWorkflowId`
3. **Next.js** `POST /api/demo/cases` mints operator session via `POST /demo/orchestration-session` (uses existing `AI_API_DEMO_CASE_CREATE_TOKEN`) and sets `orchestrator_session` httpOnly cookie
4. Browser redirects to **`/orchestration/stepped?workflowId=wf-…`** (not `?caseId=`)
5. UI shows **01 Triage RUNNING** while backend runs triage, then animates to **DONE**
6. Operator clicks **Run Customer Context**, **Run Knowledge Base**, … through Node 6
7. Guardrail **waiting_approval** shows **amber WAITING** (out-of-band approval — no approve button here)

**Do not** open `?caseId=` alone expecting a stepped run — Salesforce auto-trigger full runs are **ignored** on the stepped screen. Use demo create or **Start stepped run** on the start panel.

## Backend contract (ai-api)

| Endpoint                                               | Scope                          | Behavior                                                 |
| ------------------------------------------------------ | ------------------------------ | -------------------------------------------------------- |
| `POST /orchestrator/case-triage/cases/:caseId/stepped` | `agentforce:orchestrator-step` | Create workflow, run Triage, pause at `awaiting_step`    |
| `POST /orchestrator/case-triage/:workflowId/advance`   | `agentforce:orchestrator-step` | Run exactly one graph node, pause again or terminal      |
| `POST /demo/cases`                                     | `agentforce:demo-case-create`  | Create Case + internal `triggerStepped`                  |
| `POST /demo/orchestration-session`                     | `agentforce:demo-case-create`  | Mint operator JWT (read + control + step) for BFF cookie |

Graph: `interruptAfter: [triage, customer_history, knowledge, parts_logistics, scheduling]` on stepped compile. Guardrail keeps dynamic approval interrupt.

**Durability:** stepped checkpoints use in-memory `MemorySaver` — paused runs do not survive ai-api restart (Phase 3: Postgres checkpointer).

## Frontend files

| Path                                                  | Role                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `app/orchestration/stepped/page.tsx`                  | Route; `?workflowId` or `?caseId`                                       |
| `components/SteppedOrchestrationView.tsx`             | Poll, reveal state machine, Run → `/advance`                            |
| `components/SteppedStartPanel.tsx`                    | Start panel when no stepped run (`?caseId` only)                        |
| `lib/stepped-view-model.ts`                           | `buildSteppedViewModel`, `isSteppedSnapshot`, `computeRevealedProgress` |
| `app/api/orchestrator/case/[caseId]/stepped/route.ts` | BFF stepped trigger                                                     |
| `app/api/orchestrator/[workflowId]/advance/route.ts`  | BFF advance                                                             |
| `lib/orchestrator-operator-session.ts`                | Demo token session mint + cookie attach                                 |

## UI rules

- **Queued stages** show **"Waiting for agent output"** (not "Waiting for backend")
- **`isSteppedSnapshot`**: `status === awaiting_step` OR events contain `awaiting_step` — filters auto-runs when polling by `caseId`
- **`pollWorkflowId` bound**: accept `running`/`assigned` during triage bootstrap (do not show "not a stepped run")
- **Triage intro**: animate RUNNING → DONE before showing next Run button; complete reveal when backend pauses at `customer_history` even if `runningIndex` is still 0
- **Guardrail approval**: amber dot, **WAITING** badge, amber trace for `waiting_approval`
- **New nodes**: update `NODE_DEFS` + builders in `stepped-view-model.ts`, tests in `stepped-fixture.ts`, and checklist in `new-node-phase-completion-checklist.md` § Stepped console

## Env (react-chat-window)

| Variable                            | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `DEMO_CASE_CREATE_ENABLED`          | Enable `/demo/case-create`                                           |
| `AI_API_DEMO_CASE_CREATE_TOKEN`     | Demo create + orchestration-session mint                             |
| `ORCHESTRATOR_OPERATOR_ACCESS_CODE` | Optional fallback for manual sign-in on start panel (same as ai-api) |

## Tests before handoff

```bash
npm run react-chat:typecheck
cd apps/react-chat-window && npx vitest run lib/__tests__/stepped-view-model.test.ts components/__tests__/SteppedOrchestrationView.test.ts
npm run ai-api:test -- --testPathPattern="demo-case-create|case-triage.graph.spec"
```

## Related skills

- `langgraph-case-triage-slice` — orchestrator graph and trigger seams
- `langgraph-human-in-the-loop` — `interruptAfter` / guardrail approval
- `salesforce-case-create` — CLI Case create and Node 4 scenarios
- `railway-quick-deploy` — deploy `react-chat-window` + `ai-api` after stepped changes

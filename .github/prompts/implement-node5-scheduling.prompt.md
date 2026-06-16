---
name: "Implement Node 5 Scheduling"
description: "Implement Phase 5a Node 5 Scheduling: Field Service gateway, parts-ETA-gated planner, scheduling channel, graph node, verdict rollup, React card, and live Salesforce scheduling proof."
agent: "Node 5 Scheduling Implementer"
argument-hint: "Phase scope (5a default), org alias (default AgentForce), demo Case id, and whether to include UI observability"
tools: [read, search, edit, execute, todo, agent]
---

# Execution mode — implement, do not replan

You are in **executing mode**. Implement Phase **5a** of Node 5 — Scheduling per the phase plan. Do not produce architecture-only documentation unless code cannot proceed due to a blocker.

Use the installed workspace skills for this task.

## Required skill-loading order

1. `framework-selection`
2. `langgraph-fundamentals`
3. `langgraph-case-triage-slice` — mirror Node 3/4 graph + channel pattern
4. `langgraph-node4-parts-logistics` — upstream `partsLogistics` channel + ETA fields
5. `langgraph-node5-scheduling` — **primary skill for this task**
6. `salesforce-node5-scheduling-prep` — pre-flight validation only (5-Pre already shipped)
7. `langchain-dependencies` — only if package changes are needed
8. `new-org-tenant-onboarding` — only if OAuth run-as FLS is blocked

## Agent persona

Adopt `.github/agents/node5-scheduling-implementer.agent.md`.

Escalate when cross-cutting:

- `Nest AI Architect` — gateway/module boundaries, config flags
- `Security Reviewer` — no technician PII in events/verdict
- `Telemetry Reviewer` — safe status events for Node 5
- `Release Checker` — pre-ship validation gates

## Relevant repo instructions (honor during implementation)

- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md) — **includes mandatory re-orchestration review**
- [frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)
- [telemetry instructions](../instructions/telemetry.instructions.md)
- [testing and eval instructions](../instructions/testing-evals.instructions.md)

## Canonical documents (read before coding)

| Document                  | Path                                                                                       | Sections                                             |
| ------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Phase plan (primary)**  | `docs/orchestrator/node-5-scheduling-phase-plan.md`                                        | **§0.4** (5-Pre shipped), §3.5–§3.7, §7, §8–§11, §14 |
| 5-Pre lessons             | `docs/context/node5-field-service-prep-lessons.md`                                         | Secondary territory, Skill metadata                  |
| Re-orchestration          | `docs/orchestrator/re-orchestration-backlog.md`                                            | 5a point-in-time only                                |
| Node completion checklist | `docs/orchestrator/new-node-phase-completion-checklist.md`                                 | Verdict + re-orchestration                           |
| Orchestrator flow         | `docs/orchestrator/case-triage-orchestrator-flow.md`                                       | Node 5 placement                                     |
| Parts channel (upstream)  | `apps/ai-api/src/orchestrator/dto/parts-logistics.ts`                                      | `fulfillmentReadiness`, ETA                          |
| Graph (extend)            | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                                        | mirror `parts` node                                  |
| Inventory gateway pattern | `apps/ai-api/src/salesforce/salesforce-inventory.gateway.ts`                               | degrade-safe reads                                   |
| Parts planner pattern     | `apps/ai-api/src/orchestrator/parts-logistics-planner.service.ts`                          | deterministic planner                                |
| Verdict synthesizer       | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`                         | four surfaces                                        |
| Perm set                  | `force-app/main/default/permissionsets/Agentforce_Scheduling_Node5.permissionset-meta.xml` | FLS reference                                        |

## Pre-flight gate (run first)

```bash
./scripts/sf/node5-pre-validation.sh AgentForce
```

Confirm from phase plan §0.4:

1. **5-Pre is shipped** on `AgentForce` (2026-06-16); do not redeploy seed from scratch
2. Validation script passes (Skill 5+, NA territory, laptop WorkTypes, Run As perm)
3. `Agentforce_Scheduling_Node5` on **OAuth Run As** `chaudhary.keshav4u@gmail.com`
4. Restart Railway `ai-api` if perm was just assigned (token cache)

**Stop and report** if validation fails. Do not claim live proof with mocks.

## User-provided context

```text
${input}
```

Defaults:

- Phase: **5a** (read/plan only, no SF writes)
- Org: **AgentForce**
- UI: include read-only Node 5 card in `apps/react-chat-window`
- Proof: live Field Service reads on Austin laptop Case from §14.4

---

## Implementation scope — Phase 5a only

### A. New components

| Component          | Path                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| DTO                | `apps/ai-api/src/orchestrator/dto/scheduling.ts` — match phase plan §7 |
| Scheduling gateway | `apps/ai-api/src/salesforce/salesforce-scheduling.gateway.ts`          |
| Planner            | `apps/ai-api/src/orchestrator/scheduling-planner.service.ts`           |
| Graph node         | `scheduling` in `case-triage.graph.ts`                                 |
| Lifecycle id       | `SCHEDULING_NODE_ID` in `case-triage-lifecycle.ts`                     |
| Config flag        | `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED` in `app-config.service.ts`    |

Register gateway + planner in `salesforce.module.ts` and `orchestrator.module.ts`.

### B. Planner behavior (deterministic — no LLM, no AppointmentCandidates API)

Implement per §8.4:

1. Derive required skills from `assetProductCode` / WorkType config map
2. Derive target territory from Case ship-to (Austin → **North America**)
3. Filter candidates: active technicians with **Primary OR Secondary** membership in target territory (§8.3 — do not filter `TerritoryType = 'P'` only)
4. **Parts-ETA floor:** `earliestStart = max(partsEtaFloor, technicianAvailability, now)` (§3.5)
5. Map parts state → `schedulingReadiness` (`schedulable` | `provisional` | `deferred` | `unschedulable`)
6. Rank by skill + territory fit + availability; cap candidates (top 3)
7. Sanitize `resourceReference` — never full technician name in channel/events
8. Degrade-safe: SF failure → `degraded: true`, graph continues

### C. Graph wiring

```
… → parts → scheduling → gate → …
```

- Node 5 is **non-interrupting** — never `interrupt()`
- Writes **only** `scheduling` channel
- Do **not** add scheduling to `requiresApproval` in 5a
- Emit safe running/done status events with `SCHEDULING_NODE_ID` (mirror Node 4)

Extend: `orchestration-status-event.ts`, status store/repository, `orchestrator-verdict.synthesizer.ts`, `case-triage-orchestrator.service.ts` (`buildVerdict` input).

### D. Final Verdict rollup (do not skip — Node 4 gap lesson)

Update **all four** surfaces when scheduling is eligible (§10):

- `headline`, `summary`, `recommendedSteps`, `highlights`, `basis` includes `"scheduling"`
- Fixtures in `orchestrator-verdict.synthesizer.spec.ts` per readiness state
- Update `orchestrator-verdict.ts` comment to list Nodes 1–5

### E. UI (read-only observability)

Extend `apps/react-chat-window`:

- `lib/orchestration.ts` — sanitize `scheduling` channel; strip full names defensively
- `components/OrchestrationView.tsx` — Node 5 card: readiness, technician ref, window, parts-gated reason
- `app/orchestration/page.tsx` — subtitle lists Scheduling
- Tests: `OrchestrationView.test.tsx`, `orchestration.test.ts`

### F. Smoke

Extend `scripts/smoke/all-3-nodes-deployed.sh` (or successor) to assert Node 5 when scheduling flag enabled.

### G. Tests

| Layer        | Focus                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| Planner unit | ready/partial/blocked/deferred/provisional; skill rank; Secondary territory; degraded |
| Gateway unit | SOQL shape, no name leaks, error → degraded                                           |
| Graph unit   | `parts → scheduling → gate`; sole writer; non-interrupting                            |
| Verdict      | four surfaces per readiness                                                           |
| UI           | stage card + sanitization                                                             |

```bash
npm run ai-api:test
npm run react-chat:typecheck
```

---

## Re-orchestration (mandatory awareness — do not implement 5d unless asked)

- **5a is point-in-time** — `deferred`/`provisional` reflect the run snapshot only (§3.7).
- Do not imply live scheduling after workflow `done` without reconcile (5d backlog).
- Document this in the execution summary.

## Explicit out-of-scope

- Phase 5c `ServiceAppointment` writes
- Phase 5d reconcile API / SF event triggers
- Stop AI orchestration button (RC-1)
- `AppointmentCandidates` / managed-package scheduler API (5b)
- EU territory seed (deferred)
- Node 6 guardrail changes beyond reading `scheduling` in verdict input
- Nodes 6–8

## Acceptance criteria (§14.2)

| #   | Requirement                                                  |
| --- | ------------------------------------------------------------ |
| B1  | After `parts`, before `gate`; non-interrupting               |
| B2  | Writes only `scheduling`                                     |
| B3  | Ranks by skill + territory + availability                    |
| B4  | Parts `ready` → `schedulable`, window ≥ parts ETA floor      |
| B5  | Parts `partial` → `provisional`, `partsEtaConstrained: true` |
| B6  | Parts `blocked` → `deferred`, no committed window            |
| B7  | No technician → `unschedulable`                              |
| B8  | SF failure → `degraded`, continues                           |
| B9  | No full technician name in events/verdict                    |
| B10 | Verdict headline + summary + ≥1 step for scheduling          |
| B11 | Flag off → clean skip                                        |

Exercise demo matrix §14.4 where org data supports it.

## Final response must include

1. Skills, instructions, documents used
2. 5-Pre validation output
3. Contracts implemented (`SchedulingChannel`, key planner fields)
4. End-to-end path: parts → scheduling → verdict → UI
5. Live Field Service proof (Case id, technician ranked) or exact blocker
6. Re-orchestration note (5a point-in-time acknowledged)
7. Validation commands + results
8. Residual risks / next step (5b or 5c)

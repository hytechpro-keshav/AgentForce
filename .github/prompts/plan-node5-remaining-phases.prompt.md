---
name: "Node 5 Remaining Phases (Railway E2E, 5b, 5c, 5d)"
description: "After 5a ships: Railway production proof, optional 5b planner refinements, 5c gated ServiceAppointment writes post Node 6, and 5d re-orchestration reconcile."
agent: "Node 5 Scheduling Remaining Phases"
argument-hint: "Phase focus (railway-e2e | 5b | 5c | 5d | all), org AgentForce, demo Case id 500g500000YpQMnAAN"
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Agentforce Reviewer"
  - "Security Reviewer"
  - "Release Checker"
---

# Execution mode — phase-selected; do not skip gates

5a (`scheduling` channel + graph node `schedule`) is **shipped in repo**. This prompt covers everything **after** 5a.

Use `${input}` to select phase(s). Default order when unspecified: **Railway E2E → stop if fail → 5b only if asked → 5c blocked until Node 6 → 5d design+implement when asked**.

## Required skill-loading order

1. `langgraph-node5-scheduling` — 5a baseline
2. `langgraph-node4-parts-logistics` — parts ETA floor + 4c write pattern for 5c
3. `langgraph-human-in-the-loop` — Node 6 guardrail context for 5c
4. `salesforce-node5-scheduling-prep` — 5-Pre / Run As FLS
5. `railway-quick-deploy` — Railway deploy + smoke
6. `new-org-tenant-onboarding` — only if Run As / OAuth blocked

## Agent persona

Adopt `.github/agents/node5-scheduling-remaining-phases.agent.md`.

## Canonical documents

| Document              | Path                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| Phase plan            | `docs/orchestrator/node-5-scheduling-phase-plan.md` — §0.5, §3.7, §14.3–§14.4     |
| Re-orchestration      | `docs/orchestrator/re-orchestration-backlog.md`                                   |
| 5-Pre / 5a lessons    | `docs/context/node5-field-service-prep-lessons.md`                                |
| Node 4 writes pattern | `docs/orchestrator/node-4-parts-4b-4c-plan.md`                                    |
| Node 6 backlog        | `docs/orchestrator/service-workflow-remediation-backlog.md` (composite guardrail) |
| Deploy script         | `scripts/deploy/railway-node5-scheduling-e2e.sh`                                  |

## User-provided context

```text
${input}
```

Defaults:

- Org: **AgentForce**
- Demo Case: **500g500000YpQMnAAN** (00001050 display repair, Austin)
- Phase: **railway-e2e** first, then stop for user direction on 5b/5c/5d

---

## Phase A — Railway E2E (do this first)

**Goal:** Prove Nodes 1–5 on production Railway with live Salesforce Field Service reads.

### Prerequisites

- `railway login` (CLI must show authenticated user)
- Local commit **9946094+** includes 5a code (graph `schedule`, scheduling channel)
- `./scripts/sf/node5-pre-validation.sh AgentForce` passes
- Run As `chaudhary.keshav4u@gmail.com` has `Agentforce_Scheduling_Node5`
- Parts flag already on Railway: `AI_API_ORCHESTRATOR_PARTS_ENABLED=true`

### Steps

```bash
chmod +x scripts/deploy/railway-node5-scheduling-e2e.sh
SF_CASE_ID=500g500000YpQMnAAN ./scripts/deploy/railway-node5-scheduling-e2e.sh
```

Or manually:

```bash
railway variable set --service ai-api --environment production \
  AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true

SERVICE=ai-api MESSAGE="Node 5 scheduling 5a" ./scripts/deploy/railway-quick-deploy.sh
SERVICE=react-chat-window MESSAGE="Node 5 UI card" ./scripts/deploy/railway-quick-deploy.sh

ASSERT_SCHEDULING=1 SF_CASE_ID=500g500000YpQMnAAN ./scripts/smoke/all-3-nodes-deployed.sh
```

### Exit criteria

| Check                            | Expected                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| `scheduling.eligible`            | `true` (flag on, Case has asset + ship-to)                   |
| `scheduling.schedulingReadiness` | `schedulable` or `provisional` for display Case              |
| `scheduling.degraded`            | `false`                                                      |
| `recommendedResourceReference`   | e.g. `SR-A2` (Display skill ranks higher)                    |
| `partsEtaConstrained`            | `true` when parts partial / transfer                         |
| Verdict                          | headline + summary mention scheduling                        |
| UI                               | `/orchestration?caseId=500g500000YpQMnAAN` shows Node 5 card |

Update `docs/orchestrator/node-5-scheduling-phase-plan.md` §0.5 with Railway workflow id + timestamp when green.

**Stop here** unless `${input}` explicitly requests 5b/5c/5d in the same session.

---

## Phase B — 5b Planner refinements (optional)

**Goal:** Improve scheduling accuracy without Salesforce writes.

| Item          | Current 5a simplification    | 5b target                                                                  |
| ------------- | ---------------------------- | -------------------------------------------------------------------------- |
| Timezone      | Operating hours as UTC       | Territory-local TZ from `ServiceTerritory` / Case ship-to                  |
| Collision     | `ResourceAbsence` only       | Query existing `ServiceAppointment` in proposed window                     |
| Scheduler API | Deterministic TimeSlot scan  | Evaluate `AppointmentCandidates` / managed-package API behind feature flag |
| Duration      | WorkType `EstimatedDuration` | KB duration hints cross-check                                              |

**Files likely touched:** `scheduling-planner.service.ts`, `scheduling-availability.ts`, `salesforce-scheduling.gateway.ts`, specs, phase plan §0.

**Out of scope:** `ServiceAppointment` writes (5c).

---

## Phase C — 5c Gated ServiceAppointment writes

**HARD GATE: Node 6 composite guardrail must ship first** (or user explicitly accepts interim shared-gate risk in writing).

Mirror Node 4 Phase 4c:

| Component      | Pattern                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| Write gateway  | `salesforce-scheduling-write.gateway.ts` or extend scheduling gateway with write seam  |
| Graph          | After Node 6 approval only — **not** the current triage+parts gate                     |
| Idempotency    | `Orchestrator_Workflow_Id__c` + Case + resource reference                              |
| Fresh read     | Re-run parts inventory + scheduling planner immediately before create                  |
| Channel update | `appointmentStatus: booked`, `appointmentReference`                                    |
| Salesforce     | `ServiceAppointment` + `AssignedResource`; link to Case via WorkOrder/`ParentRecordId` |

Acceptance: phase plan §14.3 C1–C4.

**Do not start 5c** if Node 6 is still the prototype triage-only `gate` unless `${input}` overrides.

---

## Phase D — 5d Re-orchestration

**Goal:** Refresh `parts → scheduling` when fulfillment status changes — without full Case re-trigger.

Implement per `docs/orchestrator/re-orchestration-backlog.md`:

| ID   | Deliverable                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| RC-1 | Stop AI button + `POST …/cases/:caseId/stop` + Case `AI_Orchestration_Status__c`                             |
| RC-2 | Flow guard on `Case_Triage_Orchestrator_Handoff`                                                             |
| RC-3 | `POST /orchestrator/case-triage/cases/:caseId/reconcile` — partial re-run from `parts` or `parts → schedule` |
| RC-4 | SF Flow on `ProductTransfer` status / parts fulfillment field → reconcile trigger                            |
| RC-5 | (overlap with 5c) fresh parts read at write time                                                             |

**5a honesty preserved:** reconcile produces a **new workflow version** or explicit `reconciledAt` on snapshot; UI shows latest.

---

## Important rules

- Read `docs/orchestrator/re-orchestration-backlog.md` before any 5c/5d code.
- LangGraph graph node = **`schedule`**; channel = **`scheduling`** (never rename node to `scheduling`).
- No technician full names in events/verdict.
- `ASSERT_SCHEDULING=1` must pass on Railway before marking Railway E2E done.

## Final response must include

1. Phase(s) executed and gate decisions (especially 5c vs Node 6)
2. Railway deployment id + smoke output (if Phase A)
3. Workflow id + scheduling channel snapshot for demo Case
4. Files changed (if 5b/5c/5d)
5. Updated phase plan §0 status
6. Exact next recommended phase

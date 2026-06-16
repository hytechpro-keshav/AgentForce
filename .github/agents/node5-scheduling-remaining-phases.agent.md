---
name: "Node 5 Scheduling Remaining Phases"
description: "Use after 5a ships: Railway E2E proof, Phase 5b planner refinements, Phase 5c gated ServiceAppointment writes (post Node 6), and Phase 5d re-orchestration reconcile."
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Agentforce Reviewer"
  - "Security Reviewer"
  - "Release Checker"
user-invocable: true
---

You advance Node 5 **after Phase 5a** — scheduling channel shipped, flag-gated, point-in-time only.

## Phases

| Phase           | Scope                                                                                | Gate                           |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| **Railway E2E** | Deploy + `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true` + `ASSERT_SCHEDULING=1` smoke | 5a code on Railway             |
| **5b**          | Territory-local TZ, appointment collision, optional `AppointmentCandidates`          | 5a E2E green                   |
| **5c**          | Gated `ServiceAppointment` create after Node 6 approval                              | Node 6 guardrail ships         |
| **5d**          | Event-driven `parts → scheduling` reconcile + Stop AI guard                          | Re-orchestration backlog RC-1+ |

## Constraints

- **5c never ships before Node 6** composite guardrail (or explicit user override with documented risk).
- **5d** must respect `AI_Orchestration_Status__c = stopped_by_user` (backlog RC-1).
- **5c write path:** mandatory fresh `parts` read before `ServiceAppointment` create (§3.7).
- Reuse Node 4 Phase 4c write-back patterns for idempotency and degrade-safe gateway.

## Primary references

- `docs/orchestrator/node-5-scheduling-phase-plan.md` §0.5, §3.7, §14.3
- `docs/orchestrator/re-orchestration-backlog.md`
- `docs/context/node5-field-service-prep-lessons.md`
- Node 4: `node-4-parts-4b-4c-plan.md`, `salesforce-fulfillment.gateway.ts`

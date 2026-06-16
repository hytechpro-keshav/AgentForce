# Plan Node 5 Scheduling

Deep planning and implementation-readiness review for Node 5 — Scheduling. Full harness: `.github/prompts/plan-node5-scheduling.prompt.md`.

Adopt agent persona: `.github/agents/node5-scheduling-planner.agent.md`.

## Execution mode

**Plan and research only — do not implement code.** Produce `docs/orchestrator/node-5-scheduling-phase-plan.md`.

## Required skill-loading order

1. `.agents/skills/framework-selection/SKILL.md`
2. `.agents/skills/langgraph-fundamentals/SKILL.md`
3. `.agents/skills/langgraph-case-triage-slice/SKILL.md`
4. `.agents/skills/langgraph-node4-parts-logistics/SKILL.md` ← upstream parts channel
5. `.agents/skills/langgraph-human-in-the-loop/SKILL.md`
6. `.agents/skills/langgraph-persistence/SKILL.md`
7. `.agents/skills/salesforce-node4-parts-prep/SKILL.md` ← Field Service baseline
8. `.agents/skills/langgraph-node5-scheduling/SKILL.md` ← Node 5 stub (plan-first)

## Primary references

| Document                    | Path                                                           |
| --------------------------- | -------------------------------------------------------------- |
| Orchestrator flow           | `docs/orchestrator/case-triage-orchestrator-flow.md`           |
| Node 4 phase plan (pattern) | `docs/orchestrator/node-4-parts-logistics-phase-plan.md`       |
| Phase completion checklist  | `docs/orchestrator/new-node-phase-completion-checklist.md`     |
| Service ops mapping         | `docs/agents/service-operations-operating-system.md`           |
| Scheduling Agent (SF)       | `force-app/main/default/genAiPlannerBundles/Scheduling_Agent/` |

## Salesforce audit (run against org)

Default org: **AgentForce**

```bash
sf org display --target-org AgentForce
sf sobject describe --sobject ServiceResource --target-org AgentForce
sf sobject describe --sobject ServiceAppointment --target-org AgentForce
sf data query --query "SELECT COUNT() FROM ServiceResource" --target-org AgentForce
sf data query --query "SELECT COUNT() FROM ServiceTerritory" --target-org AgentForce
```

## Key constraints

- Node 5 = **Scheduling** — best technician · skill · location (after Parts & Logistics)
- Consumes `partsLogistics` fulfillment readiness and ETA before proposing windows
- **Non-interrupting** — Node 6 owns human approval
- Mirror Node 4 patterns: typed channel, planner, gateway, verdict rollup, UI card
- Do not block on missing SF data — document 5-Pre prerequisites instead

## Deliverable

`docs/orchestrator/node-5-scheduling-phase-plan.md` with architecture analysis, SF readiness, gap analysis, prerequisites, implementation plan, risks, test plan, and execution order.

$ARGUMENTS

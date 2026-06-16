---
name: langgraph-node5-scheduling
description: >-
  Plan and implement Node 5 Scheduling in the case-triage orchestrator: Field Service
  technician ranking, service window proposal, scheduling channel, graph node, UI
  observability, and live Salesforce proof. Start with the planning prompt before
  any implementation — phase plan must exist first.
argument-hint: "Org alias (AgentForce), phase (plan vs 5a implement), demo Case id"
user-invocable: true
---

# LangGraph Node 5 — Scheduling

Node 5 proposes **best technician · skill · location** and a **service window** after Parts & Logistics. It is **non-interrupting**; Node 6 owns human approval.

## Planning vs implementation

| Phase                         | Use                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------- |
| **Before any code**           | `.github/prompts/plan-node5-scheduling.prompt.md` or `/plan-node5-scheduling` |
| **After phase plan approved** | This skill + `docs/orchestrator/node-5-scheduling-phase-plan.md`              |

If `docs/orchestrator/node-5-scheduling-phase-plan.md` does not exist or §0 says planning is incomplete, **stop and run the planning prompt first**.

## Use this skill for

- "plan Node 5 scheduling"
- "implement scheduling channel"
- "technician assignment orchestrator"
- "Field Service scheduling node"
- "service appointment planning in LangGraph"

## Do NOT use this skill for

- Node 6 guardrail / approval (use `langgraph-human-in-the-loop`)
- Node 4 parts fulfillment (use `langgraph-node4-parts-logistics`)
- Customer-facing Scheduling Agent behavior only (see `docs/agents/customer-self-service.md`)

## Required references (read in order)

1. [Node 5 phase plan](../../../docs/orchestrator/node-5-scheduling-phase-plan.md) — **§0 first** when it exists
2. [Orchestrator flow](../../../docs/orchestrator/case-triage-orchestrator-flow.md) — Node 5 placement
3. [Node 4 phase plan](../../../docs/orchestrator/node-4-parts-logistics-phase-plan.md) — upstream parts channel pattern
4. [New node checklist](../../../docs/orchestrator/new-node-phase-completion-checklist.md)
5. [Parts logistics contract](../../../apps/ai-api/src/orchestrator/dto/parts-logistics.ts) — scheduling gates on fulfillment readiness
6. [Case triage graph](../../../apps/ai-api/src/orchestrator/case-triage.graph.ts)
7. [Service ops mapping](../../../docs/agents/service-operations-operating-system.md) — technician assignment agent

## Planning harness

- Prompt: `.github/prompts/plan-node5-scheduling.prompt.md`
- Agent: `.github/agents/node5-scheduling-planner.agent.md`
- Claude command: `.claude/commands/plan-node5-scheduling.md`

## Implementation harness (after phase plan + 5-Pre)

- Prompt: `.github/prompts/implement-node5-scheduling.prompt.md`
- Agent: `.github/agents/node5-scheduling-implementer.agent.md`
- Claude command: `.claude/commands/implement-node5-scheduling.md`

## Related skills

- `framework-selection`, `langgraph-fundamentals`, `langgraph-case-triage-slice`
- `langgraph-node4-parts-logistics` — upstream channel
- `salesforce-node4-parts-prep` — Field Service org baseline + Run As FLS pattern
- `salesforce-node5-scheduling-prep` — 5-Pre Salesforce seed + perm set
- `new-org-tenant-onboarding` — OAuth run-as FLS / PSL

## Re-orchestration (mandatory)

Read `docs/orchestrator/re-orchestration-backlog.md` before any node implementation. Node 5: §3.7 in phase plan (5a point-in-time, 5c write-time fresh read, 5d event reconcile).

## Related instructions

- `.github/instructions/langgraph-orchestrator.instructions.md`
- `.github/instructions/nest-ai-api.instructions.md`
- `.github/instructions/salesforce-agentforce.instructions.md`
- `.github/instructions/security-observability.instructions.md`

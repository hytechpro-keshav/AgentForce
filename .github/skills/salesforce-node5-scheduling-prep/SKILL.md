---
name: salesforce-node5-scheduling-prep
description: >-
  Deploy and validate Salesforce Phase 5-Pre scheduling metadata: Skill graph,
  NA ServiceTerritory aligned to Node 4 ship-to, laptop WorkTypes, Agentforce_Scheduling_Node5
  permission set assigned to OAuth Run As user. Run before Node 5a orchestrator implementation.
argument-hint: "Org alias (default AgentForce), Run As username, skip seed if already done"
user-invocable: true
---

# Salesforce Node 5 Scheduling Prep (Phase 5-Pre)

Prepare Field Service scheduling data for orchestrator **Node 5 — Scheduling** before any AI API 5a code.

## Use this skill for

- "Node 5 Pre Salesforce prep"
- "seed scheduling skills and NA territory"
- "deploy Agentforce_Scheduling_Node5"
- "configure AI API Run As for scheduling reads"
- any 5-Pre task before `/implement-node5-scheduling`

## OAuth Run As — Node 4 pattern (verify first)

Node 4 **solved** Run As FLS. Node 5 repeats the pattern for **scheduling objects only**.

1. Confirm Connected App Run As = standard user (e.g. `chaudhary.keshav4u@gmail.com`).
2. Confirm `Agentforce_Parts_Logistics_Node4` already on Run As (Node 4 baseline).
3. Deploy + assign **`Agentforce_Scheduling_Node5`** to the **same Run As user**.
4. Restart `ai-api` after perm change (token cache).

See [`docs/context/node4-auth-session-lessons.md`](../../../docs/context/node4-auth-session-lessons.md).

## Default org

- Alias: `AgentForce` (planning audit used `Agent` — same org, use CLI alias)
- `sf org display --target-org AgentForce`

## Required references

1. [`docs/orchestrator/node-5-scheduling-phase-plan.md`](../../../docs/orchestrator/node-5-scheduling-phase-plan.md) — §6, §12, §2.4
2. [`docs/orchestrator/node-4-parts-logistics-phase-plan.md`](../../../docs/orchestrator/node-4-parts-logistics-phase-plan.md) — ship-to regions
3. [`data/warehouse-transit-rules.json`](../../../data/warehouse-transit-rules.json)

## 5-Pre checklist

| #   | Task                                       | Exit                                 |
| --- | ------------------------------------------ | ------------------------------------ |
| 1   | Seed `Skill` + `ServiceResourceSkill`      | COUNT > 0                            |
| 2   | Create NA `ServiceTerritory` + members     | Name includes North America / Austin |
| 3   | Add laptop `WorkType` + `SkillRequirement` | `WorkType` LIKE '%Laptop%'           |
| 4   | Deploy `Agentforce_Scheduling_Node5`       | Metadata in repo                     |
| 5   | Assign perm set to Run As user             | SOQL assignment row                  |
| 6   | Run validation script                      | `node5-pre-validation.sh` green      |

## Prompt / command

- `.github/prompts/node5-pre-salesforce-prep.prompt.md`
- `.claude/commands/node5-pre-salesforce-prep.md`

## Scripts (create if missing)

```bash
./scripts/sf/node5-pre-deploy.sh AgentForce chaudhary.keshav4u@gmail.com
./scripts/sf/node5-pre-validation.sh AgentForce
```

## Do NOT use for

- Node 5a orchestrator graph code
- Customer `Scheduling_Agent` bundle changes
- Node 4 inventory prep (use `salesforce-node4-parts-prep`)

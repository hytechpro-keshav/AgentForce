# Node 5 Pre Salesforce Prep

Phase 5-Pre — seed Salesforce Field Service data for Node 5 Scheduling. Full harness: `.github/prompts/node5-pre-salesforce-prep.prompt.md`.

## Execution mode

**Salesforce prep only** — no orchestrator 5a code unless explicitly requested.

## Required skill

`.agents/skills/salesforce-node5-scheduling-prep/SKILL.md` ← primary

Also read: `.agents/skills/salesforce-node4-parts-prep/SKILL.md` (Run As FLS pattern)

## Defaults

- Org: **AgentForce**
- OAuth Run As: **chaudhary.keshav4u@gmail.com**

## Verify Node 4 Run As perms first (pattern already solved)

```bash
sf data query --target-org AgentForce --query \
  "SELECT Assignee.Username, PermissionSet.Name FROM PermissionSetAssignment \
   WHERE PermissionSet.Name = 'Agentforce_Parts_Logistics_Node4' \
   AND Assignee.Username = 'chaudhary.keshav4u@gmail.com'"
```

## 5-Pre tasks

1. **Skills** — seed `Skill` + `ServiceResourceSkill` for laptop taxonomy (§12.2)
2. **NA territory** — `ServiceTerritory` aligned to Austin / Node 4 ship-to
3. **Laptop WorkTypes** — duration + `SkillRequirement`
4. **Perm set** — deploy `Agentforce_Scheduling_Node5` + assign to **Run As user** (not CLI only)
5. **Validate** — `scripts/sf/node5-pre-validation.sh AgentForce`

## Phase plan

`docs/orchestrator/node-5-scheduling-phase-plan.md` §6, §12, §2.4

$ARGUMENTS

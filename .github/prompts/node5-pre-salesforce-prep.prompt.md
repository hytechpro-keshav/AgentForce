---
name: "Node 5 Pre Salesforce Prep"
description: "Phase 5-Pre Salesforce preparation for Node 5 Scheduling: seed Skill graph, NA territory aligned to Node 4 ship-to, laptop WorkTypes, Agentforce_Scheduling_Node5 perm set assigned to OAuth Run As user, validation script."
agent: "Node 5 Scheduling Planner"
argument-hint: "Org alias (default AgentForce), OAuth Run As username (default chaudhary.keshav4u@gmail.com), skip seed if already done"
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Agentforce Reviewer"
  - "New Org Tenant Onboarding Operator"
  - "Release Checker"
---

# Execution mode — Salesforce 5-Pre prep only

Prepare the connected Salesforce org for Node 5 Scheduling **before** any orchestrator 5a code. Do not implement the `scheduling` graph node in this pass unless `${input}` explicitly asks.

Use the installed workspace skills for this task.

## Required skill-loading order

1. `salesforce-node5-scheduling-prep` — **primary skill for this task**
2. `salesforce-node4-parts-prep` — Node 4 FLS / Run As pattern (already shipped)
3. `new-org-tenant-onboarding` — Connected App Run As + perm set assignment
4. `langgraph-node5-scheduling` — phase plan context

## Agent persona

Adopt `.github/agents/node5-scheduling-planner.agent.md` for scope boundaries. Escalate to `Agentforce Reviewer` for metadata deploy risks.

## Relevant repo instructions

- [AGENTS.md](../../AGENTS.md)
- [Salesforce Agentforce instructions](../instructions/salesforce-agentforce.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)
- [new org tenant onboarding instructions](../instructions/new-org-tenant-onboarding.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)

## Canonical documents

| Document            | Path                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| Node 5 phase plan   | `docs/orchestrator/node-5-scheduling-phase-plan.md` — §6, §12, §2.4 Run As             |
| Node 4 auth lessons | `docs/context/node4-auth-session-lessons.md` — **OAuth Run As + FLS pattern (solved)** |
| Node 4 phase plan   | `docs/orchestrator/node-4-parts-logistics-phase-plan.md` — ship-to regions             |
| Re-orchestration    | `docs/orchestrator/re-orchestration-backlog.md`                                        |
| Warehouse / ship-to | `data/warehouse-transit-rules.json`                                                    |

## User-provided context

```text
${input}
```

Defaults:

- Org alias: **`AgentForce`** (not `Agent` — re-alias if needed: `sf alias set Agent AgentForce`)
- OAuth Run As user: **`chaudhary.keshav4u@gmail.com`** (same as Node 4 production proof)
- Scope: full 5-Pre (skills + NA territory + laptop WorkTypes + perm set + validation)

---

## Critical: AI API Run As permissions (Node 4 pattern — verify first)

The planning audit said "AI API run-as user permissions ❌ Missing." **Node 4 solved this pattern** — Node 5 needs the **same steps for scheduling objects only**.

### Verify Node 4 baseline (must pass before 5-Pre)

```bash
sf org display --target-org AgentForce
sf data query --target-org AgentForce --query \
  "SELECT Assignee.Username, PermissionSet.Name FROM PermissionSetAssignment \
   WHERE PermissionSet.Name IN ('Agentforce_Parts_Logistics_Node4','Agentforce_Parts_Fulfillment_Writes') \
   AND Assignee.Username = 'chaudhary.keshav4u@gmail.com'"
```

Expected: both perm sets on the **Connected App Run As** user. If missing, assign Node 4 perm sets first (see `node4-auth-session-lessons.md`) before Node 5 work.

**Do not** assign scheduling perm sets only to the CLI admin — Railway `ai-api` uses client-credentials as the Run As user.

---

## 5-Pre tasks (execute in order)

### A. Create Skill taxonomy + technician assignments

Per phase plan §12.2:

| Skill (`MasterLabel`) | Assign to (`ServiceResourceSkill`) |
| --------------------- | ---------------------------------- |
| Laptop Hardware       | A1 (level 9), A2 (level 7)         |
| Battery/Power         | A1 (8), A2 (5)                     |
| Display               | A2 (8)                             |
| Motherboard           | A1 (9)                             |
| Thermal/Cooling       | A1 (6), A2 (7)                     |

- Query existing `ServiceResource` (A1/A2 technicians) before insert — idempotent upsert by name or external code.
- Exit: `Skill` count > 0; `ServiceResourceSkill` count ≥ 2.

### B. Create NA territory (align to Node 4 Austin ship-to)

Per phase plan §6.2 / §2.5:

- Create `ServiceTerritory` **North America** (or **Austin NA**) covering laptop service for Cases with ship-to Austin TX / NA region.
- Link `OperatingHours` + `TimeSlot` rows (reuse or clone existing calendar).
- Add `ServiceTerritoryMember` for A1 and A2 (Primary).
- Map territory to Node 4 fulfillment region NA (WH-AUS-001 / Austin).
- Optional v1: EU territory for FRA ship-to Cases — document if deferred.

### C. Add laptop WorkTypes + SkillRequirement

Per phase plan §12.3:

| WorkType                   | Duration | SkillRequirement |
| -------------------------- | -------- | ---------------- |
| Laptop Onsite Repair       | 2 Hours  | Laptop Hardware  |
| Laptop Battery Replacement | 1 Hour   | Battery/Power    |

Do not delete appliance demo WorkTypes — add laptop domain alongside.

### D. Configure AI user permissions (Node 5 perm set)

1. Create/deploy `force-app/main/default/permissionsets/Agentforce_Scheduling_Node5.permissionset-meta.xml`:
   - Read: `ServiceResource`, `ServiceTerritory`, `ServiceTerritoryMember`, `OperatingHours`, `TimeSlot`, `WorkType`, `Skill`, `ServiceResourceSkill`, `ServiceAppointment`, `AssignedResource`, `ResourceAbsence` (if used)
   - Create (for future 5c): `ServiceAppointment`, `AssignedResource`
2. Deploy perm set metadata.
3. Assign to **both**:
   - CLI admin user (for validation scripts)
   - **OAuth Run As user** (`chaudhary.keshav4u@gmail.com` or `${input}` override)

```bash
sf org assign permset --target-org AgentForce \
  --name Agentforce_Scheduling_Node5 \
  --on-behalf-of chaudhary.keshav4u@gmail.com
```

4. If Railway `ai-api` is live: **restart ai-api** after perm assignment (OAuth token cache ~25 min).

### E. Validation script

Create or run `scripts/sf/node5-pre-validation.sh AgentForce` per phase plan §6.6:

```bash
sf data query --target-org AgentForce --query "SELECT COUNT() FROM Skill"
sf data query --target-org AgentForce --query "SELECT COUNT() FROM ServiceResourceSkill"
sf data query --target-org AgentForce --query "SELECT Name FROM ServiceTerritory"
sf data query --target-org AgentForce --query "SELECT Name, EstimatedDuration FROM WorkType WHERE Name LIKE '%Laptop%'"
```

Assert Run As can read scheduling objects (no `INVALID_FIELD`).

### F. Scripts to create (if missing)

| Script                               | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `scripts/sf/node5-pre-seed.sh`       | Idempotent skill + territory + WorkType seed |
| `scripts/sf/node5-pre-deploy.sh`     | Deploy perm set + assign + seed + validate   |
| `scripts/sf/node5-pre-validation.sh` | Exit criteria gate                           |
| `manifest/node5-pre-package.xml`     | Perm set (+ optional `Technician_Code__c`)   |

Mirror `scripts/sf/node4-pre-deploy.sh` structure.

---

## Out of scope (this pass)

- Node 5a orchestrator code (`scheduling` channel, graph node, UI)
- `ServiceAppointment` writes (5c)
- Re-orchestration API (5d) — document only in phase plan
- Replacing the customer-facing `Scheduling_Agent` bundle

---

## Final response must include

1. Org alias + instance URL confirmed
2. Node 4 Run As perm verification output
3. Skill / territory / WorkType counts after seed
4. `Agentforce_Scheduling_Node5` assignment proof for Run As user
5. Validation script output (pass/fail)
6. Files created (perm set, scripts, manifest)
7. Residual gaps + ready for `/implement-node5-scheduling` (when prompt exists)

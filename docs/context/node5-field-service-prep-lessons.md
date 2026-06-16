# Node 5 Field Service Prep Lessons (2026-06-16)

Session context: Phase **5-Pre** completed on org **`AgentForce`** (CLI alias; same org as planning audit `Agent`). Validation: `./scripts/sf/node5-pre-validation.sh AgentForce` **PASSED**. OAuth Run As: `chaudhary.keshav4u@gmail.com` holds `Agentforce_Scheduling_Node5` plus Node 4 perm sets.

## Symptoms / gotchas discovered

| Gotcha                                              | Wrong assumption                                                | Actual behavior                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skill records are metadata, not Apex-insertable** | Seed `Skill` via anonymous Apex `insert new Skill(...)`         | `Skill` deploys as **`force-app/main/default/skills/*.skill-meta.xml`**; Apex seed script **queries** Skill Ids after metadata deploy               |
| **Territory overlap validation**                    | Add NA territory as **Primary** (`TerritoryType = P`) for A1/A2 | FSL allows **one Primary** territory per resource per date range; A1/A2 already Primary in **`Abypro`** → NA membership must be **Secondary (`S`)** |
| **Planner must not filter Primary-only**            | `TerritoryType = 'P'` in gateway SOQL filter                    | Rank NA candidates using **Secondary** memberships — see phase plan §8.3                                                                            |
| **Org alias drift**                                 | Hardcode `Agent` in scripts                                     | CLI alias is **`AgentForce`**; `sf alias set AgentForce <username>` if needed                                                                       |
| **Run As FLS “missing”**                            | OAuth user has no permissions at all                            | Node **4** pattern solved; Node **5** needed new perm set on **same** Run As user                                                                   |

## Deploy sequence that worked

1. Deploy Skill metadata (`manifest/node5-pre-package.xml` or skills folder).
2. Deploy `Agentforce_Scheduling_Node5` perm set.
3. Run `scripts/sf/node5-pre-seed.sh` (Apex resolves Skill Ids + seeds relationships).
4. Assign perm set to CLI admin **and** Run As user.
5. `./scripts/sf/node5-pre-validation.sh AgentForce`
6. **Restart Railway `ai-api`** if live (OAuth token cache ~25 min).

## 5-Pre seed snapshot (AgentForce)

| Object                   | Count / note                                                              |
| ------------------------ | ------------------------------------------------------------------------- |
| `Skill`                  | 5 (Laptop Hardware, Battery/Power, Display, Motherboard, Thermal/Cooling) |
| `ServiceResourceSkill`   | 8                                                                         |
| `ServiceTerritory`       | **North America** (Austin TX), OperatingHours `0Hhg500000047yzCAA`        |
| `ServiceTerritoryMember` | 4 total (A1+A2 in NA as **Secondary**)                                    |
| `WorkType`               | 2 laptop types + existing appliance demo types                            |
| `SkillRequirement`       | 2                                                                         |

**Deferred:** EU territory for FRA ship-to (optional v1 per phase plan §6.2).

## 5a implementation implications

1. **`SalesforceSchedulingGateway`** — include `TerritoryType` in subquery; do **not** drop Secondary members when ship-to region maps to North America.
2. **Region → territory map** — Austin / NA Cases → `North America` territory name (config or planner constant).
3. **Re-orchestration** — 5a remains point-in-time; see `docs/orchestrator/re-orchestration-backlog.md` §3.7.
4. **Live proof** — use Node 4 laptop Cases (e.g. Austin battery/display scenarios in §14.4).

## Related artifacts

- `scripts/sf/node5-pre-{deploy,seed,validation}.sh`
- `scripts/sf/apex/node5-pre-seed.apex`
- `force-app/main/default/permissionsets/Agentforce_Scheduling_Node5.permissionset-meta.xml`
- `force-app/main/default/skills/*.skill-meta.xml`
- [`node-5-scheduling-phase-plan.md`](../orchestrator/node-5-scheduling-phase-plan.md)
- [`node4-auth-session-lessons.md`](./node4-auth-session-lessons.md) — Run As + FLS pattern

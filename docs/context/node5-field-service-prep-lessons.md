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

## 5a implemented (2026-06-16) — gotchas discovered

| Gotcha                                              | Wrong assumption                                                   | Actual behavior                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LangGraph node name == channel name collides**    | Name the graph node `"scheduling"` (same as the channel key)       | LangGraph forbids a node sharing a name with a state channel. Follow the existing convention: graph node `schedule` writes channel `scheduling` (node `parts` → `partsLogistics`). The status-event id `SCHEDULING_NODE_ID = "scheduling"` is separate and fine. |
| **`basis` includes present-but-skipped channels**   | Assert a skipped scheduling channel is absent from verdict `basis` | Mirrors parts: `if (scheduling) basis.push("scheduling")` even when `eligible:false`. Assert the absence of scheduling _clauses_ in headline/summary/highlights instead.                                                                                         |
| **Parts ETA floor uses dispatch hours, not an ISO** | Read `partsLogistics.estimatedArrivalAt`                           | The shipped parts channel has `estimatedDispatchHoursMax` (hours from now), not an ISO arrival. `partsEtaFloor = now + max(estimatedDispatchHoursMax)`.                                                                                                          |

**Shipped (5a):** `dto/scheduling.ts`, `salesforce-scheduling.gateway.ts`, `scheduling-{rules,availability}.ts`, `scheduling-planner.service.ts`, `schedule` graph node, verdict four-surface rollup, React Node 5 card + sanitizer, `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED` flag, `scheduling` jsonb persistence column, smoke `ASSERT_SCHEDULING`. ai-api 367 tests green; react-chat 49 green; both typecheck clean.

**Live proof (Case `500g500000YpQMnAAN` / 00001050, display repair, Austin):** live FS read returns A1/A2 as NA Secondary with real skills; deterministic planner ranks **SR-A2** #1 (holds `Display` 8; A1 does not) and, with a 41h display transfer, defers the window to a business slot past the parts-ETA floor with `partsEtaConstrained: true` (matches demo matrix §14.4). **Not yet deployed to Railway** — enable `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true` + restart `ai-api`, then run smoke with `ASSERT_SCHEDULING=1` for an end-to-end orchestrator proof.

## Related artifacts

- `scripts/sf/node5-pre-{deploy,seed,validation}.sh`
- `scripts/sf/apex/node5-pre-seed.apex`
- `force-app/main/default/permissionsets/Agentforce_Scheduling_Node5.permissionset-meta.xml`
- `force-app/main/default/skills/*.skill-meta.xml`
- [`node-5-scheduling-phase-plan.md`](../orchestrator/node-5-scheduling-phase-plan.md)
- [`node4-auth-session-lessons.md`](./node4-auth-session-lessons.md) — Run As + FLS pattern

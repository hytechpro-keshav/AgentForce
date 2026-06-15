# Node 4 Parts & Logistics — Release Proof (post-merge)

Date: 2026-06-15  
Org: `AgentForce`  
Branch: merged to `main` (IMP-NODE-4)

## Scope

Node 4 **Parts & Logistics** in the case-triage orchestrator:

- **4a** — Fulfillment-location-first planner, live inventory read, multi-segment ETA
- **4b** — KB warehouse cross-check (audit-only)
- **4c** — Gated Salesforce writes after approval (`ProductTransfer`, `ProductRequest`)
- **UI** — Orchestration console Node 4 panel + Final Verdict rollup
- **Ops** — Deploy scripts, smoke resume, case scenario runbook

Graph path:

```text
… → knowledge (N3) → parts (N4) → gate → writeBack (triage + 4c fulfillment)
```

## Production services

| Service           | URL                                                   | Health (2026-06-15) |
| ----------------- | ----------------------------------------------------- | ------------------- |
| ai-api            | `https://ai-api-production-03f5.up.railway.app`       | 200 `/health/live`  |
| react-chat-window | `https://react-chat-window-production.up.railway.app` | 200 `/`             |

Railway flags (production):

- `AI_API_ORCHESTRATOR_PARTS_ENABLED=true`
- `AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED=true`

## Scenario verification (live org)

All four regression Cases verified against production read model
(`GET /api/orchestrator/case/{caseId}`):

| Scenario            | Case Id              | Case #   | Readiness | Write outcome | Key plan signal                                            |
| ------------------- | -------------------- | -------- | --------- | ------------- | ---------------------------------------------------------- |
| **A — Local stock** | `500g500000aBxZVAA0` | 00001053 | `ready`   | none          | `SP-BATT-15X` available @ `WH-AUS-001`, `planned`          |
| **B — Transfer**    | `500g500000YpQMnAAN` | —        | `partial` | 1 created     | `SP-DISP-15X-FHD` → `transfer_pending` / `ProductTransfer` |
| **B′ — Mixed**      | `500g500000aBxPpAAK` | 00001052 | `partial` | 1 created     | Battery local + `SP-CHG-65W` transfer                      |
| **C — Backorder**   | `500g500000aBTErAAO` | 00001051 | `blocked` | 1 created     | `SP-TEST-OOS` → `backorder_requested` / `ProductRequest`   |

Console: `https://react-chat-window-production.up.railway.app/orchestration?caseId=<Case Id>`

### Scenario A re-run (post-merge smoke)

```bash
SF_CASE_ID=500g500000aBxZVAA0 ./scripts/smoke/all-3-nodes-deployed.sh
```

Result: **PASSED** — workflow `wf-8d40275a-c14b-4658-8af7-15698fded190`, status `done`, Nodes 1–3 healthy; production snapshot confirms Node 4 `ready` + KB `ALIGNED`.

## Salesforce ops (one-time per org)

```bash
./scripts/sf/node4-pre-validation.sh AgentForce
./scripts/sf/node4-4c-deploy.sh AgentForce <oauth-run-as-username>
```

Seed helpers:

```bash
./scripts/sf/node4-seed-scenario-a-local.sh AgentForce   # Scenario A
./scripts/sf/node4-seed-oos-sku.sh AgentForce              # Scenario C
```

## Create test Cases

See skill [`.agents/skills/salesforce-case-create/SKILL.md`](../../.agents/skills/salesforce-case-create/SKILL.md) and phase plan §14 in [`docs/orchestrator/node-4-parts-logistics-phase-plan.md`](../orchestrator/node-4-parts-logistics-phase-plan.md).

**Rules:**

- Set `Service_Ship_To_City__c` / `State__c` / `Country__c` (Austin, TX, US → `WH-AUS-001`).
- Only list spare parts in the description that you want planned (`SP-*` extraction).
- Link asset `SN-PRO15X-2026-0041A` for compatibility checks.

## Known gap (follow-up)

**Scenario A local stock** stops at `reservationStatus: planned` — no Salesforce DML yet. Phase plan calls for optional `ProductRequired` → `reserved`; 4c currently writes only transfer and backorder exceptions.

## References

- Phase plan: [`docs/orchestrator/node-4-parts-logistics-phase-plan.md`](../orchestrator/node-4-parts-logistics-phase-plan.md)
- 4b/4c plan: [`docs/orchestrator/node-4-parts-4b-4c-plan.md`](../orchestrator/node-4-parts-4b-4c-plan.md)
- Auth lessons: [`docs/context/node4-auth-session-lessons.md`](../context/node4-auth-session-lessons.md)
- Checklist: [`docs/orchestrator/new-node-phase-completion-checklist.md`](../orchestrator/new-node-phase-completion-checklist.md)

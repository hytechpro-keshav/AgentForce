# Node 4 orchestrator — Case creation scenarios

Use this runbook with the [`salesforce-case-create`](../../.agents/skills/salesforce-case-create/SKILL.md) skill to create Salesforce Cases that exercise each Node 4 parts & logistics path. Cases auto-trigger the orchestrator on insert when the async Case trigger is active.

**Default org:** `AgentForce`  
**Orchestration console:** `https://react-chat-window-production.up.railway.app/orchestration?caseId=<Case Id>`

---

## Prerequisites

1. Phase 4-Pre deployed and validated: `./scripts/sf/node4-pre-validation.sh AgentForce`
2. Node 4 read perm set assigned to the AI API OAuth run-as user (see [`node4-auth-session-lessons.md`](../context/node4-auth-session-lessons.md))
3. For Phase 4c write proof: `./scripts/sf/node4-4c-deploy.sh` + Railway `AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED=true`

---

## Stable org context (AgentForce — query before create)

Always resolve live Ids with SOQL; names below are the current seeded records on org `AgentForce`.

| Record                  | Lookup                        | Typical Id (AgentForce) |
| ----------------------- | ----------------------------- | ----------------------- |
| Account                 | `Aptivance tech`              | `001g500000BsP8BAAV`    |
| Contact                 | Jason Luu on that account     | `003g500000GB8YvAAL`    |
| Asset                   | Serial `SN-PRO15X-2026-0041A` | `02ig5000000bMj7AAE`    |
| Product (laptop)        | `AV-LP-15X-PRO`               | via Asset               |
| Fulfillment WH (Austin) | `WH-AUS-001`                  | `131g50000004ENlAAM`    |
| Fulfillment WH (EU)     | `WH-FRA-004`                  | `131g50000004ESbAAM`    |

Quick resolve:

```bash
sf data query --target-org AgentForce --query \
  "SELECT Id, AccountId, Account.Name, SerialNumber, Product2.ProductCode FROM Asset WHERE SerialNumber = 'SN-PRO15X-2026-0041A' LIMIT 1" --json
sf data query --target-org AgentForce --query \
  "SELECT Id, FirstName, LastName, Email FROM Contact WHERE AccountId = '001g500000BsP8BAAV' ORDER BY CreatedDate DESC LIMIT 3" --json
```

---

## Required Case fields for Node 4

| Field                        | Purpose                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `AssetId`                    | Compatibility check (`Product2.Compatible_Product_Code__c` vs asset product)      |
| `Service_Ship_To_City__c`    | Fulfillment warehouse selection                                                   |
| `Service_Ship_To_State__c`   | Fulfillment warehouse selection                                                   |
| `Service_Ship_To_Country__c` | Fulfillment warehouse selection                                                   |
| `Description`                | Part candidate extraction (`SP-*` codes) — **only list parts you intend to plan** |

**Ship-to → fulfillment WH (North America demo):**

| Ship-to        | Fulfillment WH                                      |
| -------------- | --------------------------------------------------- |
| Austin, TX, US | `WH-AUS-001`                                        |
| (default NA)   | `WH-JCY-003` → `WH-AUS-001` → `WH-SJO-002` priority |

**Ship-to → fulfillment WH (EU demo):**

| Ship-to      | Fulfillment WH |
| ------------ | -------------- |
| Germany / EU | `WH-FRA-004`   |

---

## Scenario matrix

| Scenario                         | Seed script                                                                         | Part(s) in description             | Ship-to           | Expected Node 4                                                                          | 4c write           |
| -------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| **A — Local stock**              | [`node4-seed-scenario-a-local.sh`](../../scripts/sf/node4-seed-scenario-a-local.sh) | **`SP-BATT-15X` only**             | Austin, TX, US    | `ready`, `available`, `exceptionType: none`, KB `ALIGNED`, `reservationStatus: planned`  | None               |
| **B — Inter-warehouse transfer** | (stock already at remote WH)                                                        | `SP-DISP-15X-FHD` only             | Austin, TX, US    | `inter_warehouse_transfer`, `WH-SJO-002 → WH-AUS-001`, `transfer_pending` after approval | `ProductTransfer`  |
| **B′ — Mixed / partial**         | Scenario A seed + default org stock                                                 | `SP-BATT-15X` **and** `SP-CHG-65W` | Austin, TX, US    | `partial` — battery local, charger transfer from `WH-JCY-003`                            | Transfer line only |
| **C — Backorder (OOS)**          | [`node4-seed-oos-sku.sh`](../../scripts/sf/node4-seed-oos-sku.sh)                   | **`SP-TEST-OOS` only**             | Any (Austin fine) | `backorder`, `blocked`, `backorder_requested` after approval                             | `ProductRequest`   |

### Live proof Cases (AgentForce, 2026-06-15)

| Scenario           | Case Id              | Case #   | Console                                                                                             |
| ------------------ | -------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| A — local stock    | `500g500000aBxZVAA0` | 00001053 | [open](https://react-chat-window-production.up.railway.app/orchestration?caseId=500g500000aBxZVAA0) |
| B′ — mixed partial | `500g500000aBxPpAAK` | 00001052 | [open](https://react-chat-window-production.up.railway.app/orchestration?caseId=500g500000aBxPpAAK) |
| B — transfer       | `500g500000YpQMnAAN` | —        | [open](https://react-chat-window-production.up.railway.app/orchestration?caseId=500g500000YpQMnAAN) |
| C — backorder      | `500g500000aBTErAAO` | 00001051 | [open](https://react-chat-window-production.up.railway.app/orchestration?caseId=500g500000aBTErAAO) |

Re-run smoke with writes:

```bash
ASSERT_PARTS_WRITES=1 SF_CASE_ID=500g500000YpQMnAAN ./scripts/smoke/all-3-nodes-deployed.sh   # transfer
ASSERT_PARTS_WRITES=1 SF_CASE_ID=500g500000aBTErAAO ./scripts/smoke/all-3-nodes-deployed.sh   # backorder
SF_CASE_ID=500g500000aBxZVAA0 ./scripts/smoke/all-3-nodes-deployed.sh                          # Scenario A (no write)
```

---

## Scenario A — Local stock at fulfillment WH

**Goal:** Part in stock at the same warehouse the planner selects from ship-to. No transfer, no Salesforce fulfillment write (plan-only until `ProductRequired` / `reserved` is implemented).

1. Seed inventory:

```bash
./scripts/sf/node4-seed-scenario-a-local.sh AgentForce
```

2. Create Case (**do not mention other spare parts** in the description):

```bash
sf data create record --target-org AgentForce --sobject Case --values \
  "Subject='ProBook 15X battery replacement - local stock at Austin WH' \
  Description='AeroVolt ProBook 15X asset SN-PRO15X-2026-0041A battery will not hold charge. BIOS diagnostics confirm battery failure. Technician approved replacement with spare part SP-BATT-15X only. Product AV-LP-15X-PRO.' \
  Status='New' Origin='Web' Priority='High' \
  AccountId='001g500000BsP8BAAV' ContactId='003g500000GB8YvAAL' AssetId='02ig5000000bMj7AAE' \
  SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com' \
  Service_Ship_To_City__c='Austin' Service_Ship_To_State__c='TX' Service_Ship_To_Country__c='US'" \
  --json
```

**Expected UI:** `fulfillmentReadiness: ready`, KB cross-check `ALIGNED`, no **Fulfillment writes** card, verdict **parts available**.

**Pitfall:** Mentioning `SP-CHG-65W` in the description adds a second plan — charger stock is at `WH-JCY-003`, not `WH-AUS-001`, so readiness becomes `partial`.

---

## Scenario B — Inter-warehouse transfer

**Goal:** Stock exists only at a remote warehouse; planner plans transfer into the fulfillment WH and 4c creates `ProductTransfer` after approval.

Default org inventory: `SP-DISP-15X-FHD` qty 75 at `WH-SJO-002`, none at `WH-AUS-001`.

```bash
sf data create record --target-org AgentForce --sobject Case --values \
  "Subject='ProBook 15X display flickering - transfer required' \
  Description='Customer reports display flickering on AeroVolt ProBook 15X asset SN-PRO15X-2026-0041A. External monitor is fine. BIOS display test shows panel fault. Replace spare part SP-DISP-15X-FHD. Product AV-LP-15X-PRO.' \
  Status='New' Origin='Web' Priority='High' \
  AccountId='001g500000BsP8BAAV' ContactId='003g500000GB8YvAAL' AssetId='02ig5000000bMj7AAE' \
  SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com' \
  Service_Ship_To_City__c='Austin' Service_Ship_To_State__c='TX' Service_Ship_To_Country__c='US'" \
  --json
```

**Expected:** `inter_warehouse_transfer`, transfer `WH-SJO-002 → WH-AUS-001`, after approval `reservationStatus: transfer_pending`, **Fulfillment writes: 1 created**.

---

## Scenario B′ — Mixed partial (local + transfer)

**Goal:** One part local, one part needs transfer — demonstrates `fulfillmentReadiness: partial`.

Requires Scenario A seed **and** a description that names both parts:

```bash
# After node4-seed-scenario-a-local.sh
sf data create record --target-org AgentForce --sobject Case --values \
  "Subject='Battery and charger issue - mixed fulfillment' \
  Description='ProBook 15X SN-PRO15X-2026-0041A battery not charging. Replace SP-BATT-15X and verify SP-CHG-65W adapter. Product AV-LP-15X-PRO.' \
  Status='New' Origin='Web' Priority='High' \
  AccountId='001g500000BsP8BAAV' ContactId='003g500000GB8YvAAL' AssetId='02ig5000000bMj7AAE' \
  SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com' \
  Service_Ship_To_City__c='Austin' Service_Ship_To_State__c='TX' Service_Ship_To_Country__c='US'" \
  --json
```

---

## Scenario C — Backorder (network OOS)

**Goal:** Part code with zero inventory network-wide → backorder plan and `ProductRequest` after approval.

1. Seed OOS SKU (no ProductItem rows):

```bash
./scripts/sf/node4-seed-oos-sku.sh AgentForce
```

2. Create Case:

```bash
sf data create record --target-org AgentForce --sobject Case --values \
  "Subject='Critical part unavailable - backorder test' \
  Description='Field service needs test spare part SP-TEST-OOS for asset SN-PRO15X-2026-0041A. No stock at any warehouse. Product AV-LP-15X-PRO.' \
  Status='New' Origin='Web' Priority='High' \
  AccountId='001g500000BsP8BAAV' ContactId='003g500000GB8YvAAL' AssetId='02ig5000000bMj7AAE' \
  SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com' \
  Service_Ship_To_City__c='Austin' Service_Ship_To_State__c='TX' Service_Ship_To_Country__c='US'" \
  --json
```

**Expected:** `exceptionType: backorder`, `fulfillmentReadiness: blocked`, after approval `backorder_requested` + **Fulfillment writes**.

---

## Post-create verification

```bash
CASE_ID='<18-char Case Id>'
sf data query --target-org AgentForce --query \
  "SELECT Id, CaseNumber, AI_Triage_Workflow_Id__c, AI_Triage_Status__c, AI_Triage_UI_URL__c FROM Case WHERE Id = '${CASE_ID}'" --json
```

Poll the read model (no secrets):

```bash
curl -sS "https://react-chat-window-production.up.railway.app/api/orchestrator/case/${CASE_ID}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); pl=d.get('partsLogistics',{}); print('status',d.get('status')); print('readiness',pl.get('fulfillmentReadiness')); print('writeOutcome',pl.get('writeOutcome')); [print('plan',p.get('partNumber'),p.get('availability'),p.get('exceptionType'),p.get('reservationStatus')) for p in pl.get('partPlans',[])]"
```

---

## Related docs

- Phase plan demo matrix: [`docs/orchestrator/node-4-parts-logistics-phase-plan.md` §14](../orchestrator/node-4-parts-logistics-phase-plan.md)
- Phase 4b/4c acceptance: [`docs/orchestrator/node-4-parts-4b-4c-plan.md`](../orchestrator/node-4-parts-4b-4c-plan.md)
- Skill entry point: [`.agents/skills/salesforce-case-create/SKILL.md`](../../.agents/skills/salesforce-case-create/SKILL.md)

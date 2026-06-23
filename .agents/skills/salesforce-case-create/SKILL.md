---
name: salesforce-case-create
description: >-
  Create a realistic Salesforce Case in the connected AgentForce org for testing,
  demos, or orchestration validation. Use when the user asks to add, create,
  seed, or open a Case in Salesforce, especially for support issues tied to a
  product, asset, spare part, or account from the repo seed data.
user-invocable: true
---

# Salesforce Case Create

Create a realistic Salesforce `Case` in the connected org using seeded account,
contact, asset, product, and spare-part data. Cases auto-trigger the orchestrator
when the async Case trigger is active.

**Node 4 scenario runbook (copy-paste recipes):**
[`docs/testing/node4-orchestrator-case-scenarios.md`](../../docs/testing/node4-orchestrator-case-scenarios.md)

## Use this skill for

- "create a Salesforce case"
- "add a case in SF"
- "open a support case for testing"
- "create a case for Node 4 / parts logistics / Scenario A / transfer / backorder"
- "create a realistic case for orchestrator / Agentforce / Node 1–4 validation"
- any request to seed a Case tied to `data/products-and-location-data.json`

## Default org and data

- Default Salesforce org alias: **`AgentForce`**
- Seed data file: `data/products-and-location-data.json`
- **Account (AgentForce org):** `Aptivance tech` — query Id; do not assume `Sample Account for Entitlements` exists
- **Contact:** Jason Luu (`jason.l@ablypro.com`) on that account
- **Asset for laptop / Node 4 tests:**
  - serial: `SN-PRO15X-2026-0041A`
  - product: `AV-LP-15X-PRO`
- **Orchestration console:** `https://react-chat-window-production.up.railway.app/orchestration?caseId=<Case Id>`
- **Demo Case create UI:** `https://react-chat-window-production.up.railway.app/demo/case-create` (requires `DEMO_CASE_CREATE_ENABLED=true` on Railway)

## Node 4 — scenario quick reference

| Scenario               | Seed first                                    | Part(s) in description only  | Ship-to        | Expected outcome                              |
| ---------------------- | --------------------------------------------- | ---------------------------- | -------------- | --------------------------------------------- |
| **A — Local stock**    | `./scripts/sf/node4-seed-scenario-a-local.sh` | `SP-BATT-15X` **only**       | Austin, TX, US | `ready`, no transfer, no 4c write             |
| **B — Transfer**       | (default org stock)                           | `SP-DISP-15X-FHD` only       | Austin, TX, US | `inter_warehouse_transfer`, `ProductTransfer` |
| **B′ — Mixed partial** | Scenario A seed                               | `SP-BATT-15X` + `SP-CHG-65W` | Austin, TX, US | `partial` (local + transfer)                  |
| **C — Backorder**      | `./scripts/sf/node4-seed-oos-sku.sh`          | `SP-TEST-OOS` only           | Austin, TX, US | `backorder`, `ProductRequest`                 |

**Critical rule:** The orchestrator extracts every `SP-*` code from the Case **description**. Listing a backup part (e.g. `SP-CHG-65W`) creates a second plan and can change readiness from `ready` to `partial`.

Full commands, live proof Case Ids, and verification curls:
[`docs/testing/node4-orchestrator-case-scenarios.md`](../../docs/testing/node4-orchestrator-case-scenarios.md)

## Workflow

1. Confirm the connected org:

```bash
sf org list --all --json
```

2. Resolve live record Ids (never hardcode without querying):

```bash
sf data query --target-org AgentForce --query \
  "SELECT Id, AccountId, Account.Name, SerialNumber, Product2.ProductCode FROM Asset WHERE SerialNumber = 'SN-PRO15X-2026-0041A' LIMIT 1" --json
sf data query --target-org AgentForce --query \
  "SELECT Id, FirstName, LastName, Email FROM Contact WHERE AccountId = '<ACCOUNT_ID>' ORDER BY CreatedDate DESC LIMIT 3" --json
```

3. For Node 4, run the scenario seed script when needed (see matrix above).

4. Create the Case with `sf data create record`. Standard fields:

- `Subject`, `Description`, `Status='New'`, `Origin='Web'`
- `Priority='High'` for orchestrator validation unless the user asks otherwise
- `AccountId`, `ContactId`, `AssetId`, `SuppliedName`, `SuppliedEmail`
- **Node 4 ship-to (required for fulfillment WH selection):**
  - `Service_Ship_To_City__c`
  - `Service_Ship_To_State__c`
  - `Service_Ship_To_Country__c`

### Example — Scenario A (local stock)

```bash
./scripts/sf/node4-seed-scenario-a-local.sh AgentForce

sf data create record --target-org AgentForce --sobject Case --values \
  "Subject='ProBook 15X battery replacement - local stock at Austin WH' \
  Description='AeroVolt ProBook 15X asset SN-PRO15X-2026-0041A battery will not hold charge. BIOS diagnostics confirm battery failure. Technician approved replacement with spare part SP-BATT-15X only. Product AV-LP-15X-PRO.' \
  Status='New' Origin='Web' Priority='High' \
  AccountId='<ACCOUNT_ID>' ContactId='<CONTACT_ID>' AssetId='<ASSET_ID>' \
  SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com' \
  Service_Ship_To_City__c='Austin' Service_Ship_To_State__c='TX' Service_Ship_To_Country__c='US'" \
  --json
```

### Example — Scenario B (display transfer)

```bash
sf data create record --target-org AgentForce --sobject Case --values \
  "Subject='ProBook 15X display flickering - transfer required' \
  Description='Display flickering on AeroVolt ProBook 15X SN-PRO15X-2026-0041A. Replace spare part SP-DISP-15X-FHD. Product AV-LP-15X-PRO.' \
  Status='New' Origin='Web' Priority='High' \
  AccountId='<ACCOUNT_ID>' ContactId='<CONTACT_ID>' AssetId='<ASSET_ID>' \
  SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com' \
  Service_Ship_To_City__c='Austin' Service_Ship_To_State__c='TX' Service_Ship_To_Country__c='US'" \
  --json
```

### Example — Scenario C (backorder)

```bash
./scripts/sf/node4-seed-oos-sku.sh AgentForce

sf data create record --target-org AgentForce --sobject Case --values \
  "Subject='Critical part unavailable - backorder test' \
  Description='Need test spare part SP-TEST-OOS for asset SN-PRO15X-2026-0041A. No stock at any warehouse. Product AV-LP-15X-PRO.' \
  Status='New' Origin='Web' Priority='High' \
  AccountId='<ACCOUNT_ID>' ContactId='<CONTACT_ID>' AssetId='<ASSET_ID>' \
  SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com' \
  Service_Ship_To_City__c='Austin' Service_Ship_To_State__c='TX' Service_Ship_To_Country__c='US'" \
  --json
```

5. After create, verify and return Case Id, Case Number, subject, and workflow fields:

```bash
sf data query --target-org AgentForce --query \
  "SELECT Id, CaseNumber, AI_Triage_Workflow_Id__c, AI_Triage_Status__c, AI_Triage_UI_URL__c FROM Case WHERE Id = '<CASE_ID>' LIMIT 1" --json
```

6. For Node 4, optionally poll the orchestration snapshot:

```bash
curl -sS "https://react-chat-window-production.up.railway.app/api/orchestrator/case/<CASE_ID>"
```

## Case-writing rules

- Always use a realistic issue description aligned with `apps/ai-api/data/knowledge/kb-laptop-corpus.json`.
- Include the product code and **only** the spare part(s) you want Node 4 to plan.
- Prefer the seeded ProBook asset so Node 2 customer history and compatibility checks succeed.
- Set **Service*Ship_To*\*** for Node 4 fulfillment warehouse selection.
- Do not invent unsupported Case fields. If a field fails in the org, remove it and retry.

## Other default scenarios (Node 1–3 / KB)

### Battery not charging (KB-rich)

- Product: `AV-LP-15X-PRO`, Asset: `SN-PRO15X-2026-0041A`
- For **Scenario A only:** part `SP-BATT-15X` alone + Austin ship-to + seed script
- For **mixed partial:** also mention `SP-CHG-65W`

### Overheating / thermal cutoff

- Parts: `SP-FAN-15X`, `SP-HEAT-15X`
- EU ship-to (e.g. Germany) → fulfillment `WH-FRA-004`

### Keyboard failure

- Part: `SP-KBD-15X` on wrong asset model → `incompatible_part` demo

## Safety rules

- Never print access tokens, secrets, or credential material.
- Never assume a Salesforce record exists; query it first.
- Do not use fake fixture Ids when the user wants a live Case in Salesforce.
- If Salesforce rejects a field, remove or adjust that field instead of forcing the insert.

## Report back

Return:

- org alias used
- Case Id and Case Number
- subject and ship-to used
- part(s) intentionally named in the description
- seed script(s) run, if any
- scenario label (A / B / B′ / C)
- orchestration workflow Id and console URL
- expected vs observed `fulfillmentReadiness` when Node 4 applies

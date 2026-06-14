---
name: salesforce-node4-parts-prep
description: >-
  Deploy and validate Salesforce Phase 4-Pre inventory metadata, permission sets,
  data backfill, and duplicate Product2 remediation before implementing Node 4
  Parts & Logistics in the AI orchestrator. Use when preparing Field Service
  inventory, warehouse transit rules, Case ship-to fields, Product2 compatibility
  metadata, or running node4-pre-deploy for the AgentForce org.
argument-hint: "Salesforce org alias (default AgentForce) and whether to skip backfill"
user-invocable: true
---

# Salesforce Node 4 Parts Prep (Phase 4-Pre)

Prepare the Salesforce org as a complete data source for orchestrator **Node 4 — Parts & Logistics** before any AI API Node 4 code ships.

## Use this skill for

- "deploy Node 4 Salesforce metadata"
- "prepare inventory for parts logistics agent"
- "backfill Product2 compatibility fields"
- "Phase 4-Pre validation"
- "fix duplicate AV-LP-15X-PRO Product2"
- any request to flush Salesforce inventory/location/Case fields before Node 4 implementation

## Required references

Read before running:

- [Node 4 phase plan](../../../docs/orchestrator/node-4-parts-logistics-phase-plan.md)
- Seed data: [`data/products-and-location-data.json`](../../../data/products-and-location-data.json)
- Transit rules: [`data/warehouse-transit-rules.json`](../../../data/warehouse-transit-rules.json)
- Deploy manifest: [`manifest/node4-pre-package.xml`](../../../manifest/node4-pre-package.xml)

## Default org

- Alias: `AgentForce`
- Confirm with `sf org display --target-org AgentForce` (report alias, username, org id, instance URL only — never tokens).

## One-command deploy (preferred)

```bash
./scripts/sf/node4-pre-deploy.sh AgentForce
```

This runs in order:

1. Deploy metadata (`manifest/node4-pre-package.xml` + ProductRequestLineItem fields + permission set)
2. Assign `Agentforce_Parts_Logistics_Node4` permission set to the CLI user
3. Backfill Product2 compatibility, Location ETA fields, duplicate laptop Product2 remediation, Case ship-to
4. Run validation script

## Manual steps (when one-command is not enough)

### 1. Confirm org + Field Service

```bash
sf data query --target-org AgentForce --query "SELECT COUNT() FROM ProductRequest"
```

If this fails, enable **Field Service** in Setup → Field Service Settings, then retry.

### 2. Deploy metadata only

```bash
sf project deploy start --target-org AgentForce \
  --manifest manifest/node4-pre-package.xml \
  --source-dir force-app/main/default/objects/ProductRequestLineItem/fields \
  --source-dir force-app/main/default/permissionsets/Agentforce_Parts_Logistics_Node4.permissionset-meta.xml \
  --wait 10
```

### 3. Permission set (critical — FLS)

Custom fields deploy but **SOQL returns INVALID_FIELD** until FLS is granted.

```bash
sf org assign permset --target-org AgentForce --name Agentforce_Parts_Logistics_Node4
```

Also assign this permission set to the **AI API OAuth run-as user** (Integration User setup → Permission Set Assignments). Without this, NestJS inventory reads will fail at runtime.

Verify:

```bash
sf data query --target-org AgentForce \
  --query "SELECT ProductCode, Compatible_Product_Code__c FROM Product2 WHERE ProductCode = 'SP-BATT-15X' LIMIT 1"
```

### 4. Backfill data

```bash
./scripts/sf/node4-pre-backfill.sh AgentForce
```

Idempotent. Key actions:

- Sets `Compatible_Product_Code__c`, `Part_Category__c`, `Is_Universal_Part__c` on all `SP-*` Product2 rows
- Sets `Region__c`, `Outbound_Lead_Time_Hours__c`, `Supports_Expedite__c` on all inventory Locations
- Repoints Assets from legacy `01tg5000005aBq5AAE` to canonical `01tg5000005c2U9AAI`; deactivates legacy row
- Copies Account Shipping → Case `Service_Ship_To_*__c` for asset-linked Cases missing ship-to

**Always key inventory logic on `ProductCode` and `Location.ExternalReference`, never Product2 Id.**

### 5. Validate exit criteria

```bash
./scripts/sf/node4-pre-validation.sh AgentForce
```

Must show:

- `ProductRequest count:` query succeeds (0 rows OK)
- `SP-* products: 12, missing compatibility: 0`
- `Inventory locations: 4, incomplete ETA config: 0`
- `AV-LP-15X-PRO active rows: 1`
- Sample Cases show `shipTo=` populated

## Metadata deployed by this skill

| Object                 | Fields / artifacts                                                             |
| ---------------------- | ------------------------------------------------------------------------------ |
| Product2               | `Compatible_Product_Code__c`, `Part_Category__c`, `Is_Universal_Part__c`       |
| Location               | `Region__c`, `Outbound_Lead_Time_Hours__c`, `Supports_Expedite__c`             |
| Case                   | `Service_Ship_To_*`, `Parts_Fulfillment_Status__c`, `AI_Parts_Plan_Summary__c` |
| ProductRequestLineItem | `Backorder_Reason__c`, `Orchestrator_Workflow_Id__c`                           |
| Custom Metadata        | `Warehouse_Transit_Rule__mdt` + 5 transit rows                                 |
| Permission set         | `Agentforce_Parts_Logistics_Node4`                                             |

## Safety rules

- Never print access tokens, OAuth secrets, or secure credential values.
- Never assume Salesforce record ids in scripts are stable across orgs — the backfill script embeds **AgentForce org ids**; re-query ids when running in a different org.
- Do not skip permission set assignment — metadata deploy alone is insufficient.
- Do not start Node 4a AI API work until validation script passes.
- Assign the permission set to the AI API integration user, not only the CLI admin.

## Report back

Return:

- org alias used
- deploy job id / status
- validation script output summary
- whether ProductRequest is queryable
- whether permission set assigned to CLI user and (if known) AI API run-as user
- blockers remaining (e.g. Field Service not enabled)

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

Create a realistic Salesforce `Case` in the connected org using the repo's seeded
account, contact, asset, product, and spare-part data.

## Use this skill for

- "create a Salesforce case"
- "add a case in SF"
- "open a support case for testing"
- "create a realistic case for orchestrator / Agentforce / Node 1-3 validation"
- any request to seed a Case tied to `data/products-and-location-data.json`

## Default org and data

- Default Salesforce org alias: `AgentForce`
- Seed data file: `data/products-and-location-data.json`
- Common seeded account: `Sample Account for Entitlements`
- Common seeded contact: `Jason Luu`
- Common seeded asset for laptop tests:
  - asset serial: `SN-PRO15X-2026-0041A`
  - product: `AV-LP-15X-PRO`
- Common spare parts for ProBook 15X:
  - `SP-BATT-15X`
  - `SP-CHG-65W`
  - `SP-FAN-15X`
  - `SP-HEAT-15X`

## Workflow

1. Confirm the connected org safely with:

```bash
sf org list --all --json
```

1. Read `data/products-and-location-data.json` when the user wants a case based on
   repo seed data.

1. Query Salesforce for the real supporting records before creating the Case:

```bash
sf data query --target-org AgentForce --query "SELECT Id, Name FROM Account WHERE Name = 'Sample Account for Entitlements' LIMIT 1" --json
sf data query --target-org AgentForce --query "SELECT Id, FirstName, LastName, Email, AccountId FROM Contact WHERE AccountId = '<ACCOUNT_ID>' ORDER BY CreatedDate DESC LIMIT 1" --json
sf data query --target-org AgentForce --query "SELECT Id, Name, SerialNumber, AccountId, Product2Id, Product2.ProductCode FROM Asset WHERE AccountId = '<ACCOUNT_ID>' ORDER BY CreatedDate DESC LIMIT 20" --json
```

1. Create the Case with `sf data create record`. Prefer these fields:

- `Subject`
- `Description`
- `Status='New'`
- `Origin='Web'` unless the user asks for another channel
- `Priority='High'` for orchestrator validation unless the user asks otherwise
- `AccountId`
- `ContactId`
- `AssetId`
- `SuppliedName`
- `SuppliedEmail`

Example:

```bash
sf data create record --target-org AgentForce --sobject Case --values "Subject='AeroVolt ProBook 15X battery not charging - validation' Description='Customer reports AeroVolt ProBook 15X asset serial SN-PRO15X-2026-0041A is plugged in with the 65W USB-C power adapter but the charging LED stays off and the battery percentage does not increase. BIOS battery diagnostics report degraded battery health. Relevant product AV-LP-15X-PRO. Relevant spare part SP-BATT-15X. Backup check part SP-CHG-65W.' Status='New' Origin='Web' Priority='High' AccountId='<ACCOUNT_ID>' ContactId='<CONTACT_ID>' AssetId='<ASSET_ID>' SuppliedName='Jason Luu' SuppliedEmail='jason.l@ablypro.com'" --json
```

1. After create, verify the Case and return:

- `Case Id`
- `Case Number`
- `Subject`
- key linked context used for the case

1. If the case is meant for orchestration validation, check whether the workflow
   tracking fields were populated:

```bash
sf data query --target-org AgentForce --query "SELECT Id, CaseNumber, AI_Triage_Workflow_Id__c, AI_Triage_Status__c, AI_Triage_UI_URL__c FROM Case WHERE Id = '<CASE_ID>' LIMIT 1" --json
```

## Case-writing rules

- Always use a realistic issue description.
- Include both the product and the relevant spare part in the description text.
- Prefer using an existing seeded `Asset` so Node 2 customer history has real context.
- For laptop KB / Node 3 tests, prefer battery, charging, thermal, display, or keyboard issues that exist in `apps/ai-api/data/knowledge/kb-laptop-corpus.json`.
- Do not invent unsupported Case fields. If a field fails in the org, remove it and retry with standard supported fields.

## Good default scenarios

### Battery not charging

- Product: `AV-LP-15X-PRO`
- Asset: `SN-PRO15X-2026-0041A`
- Spare part: `SP-BATT-15X`
- Backup part: `SP-CHG-65W`

### Overheating / thermal cutoff

- Product: `AV-LP-15X-PRO`
- Spare parts:
  - `SP-FAN-15X`
  - `SP-HEAT-15X`

### Keyboard failure

- Product: `AV-LP-15X-PRO`
- Spare part: `SP-KBD-15X`

## Safety rules

- Never print access tokens, secrets, or credential material.
- Never assume a Salesforce record exists; query it first.
- Do not use fake fixture ids when the user wants a live Case in Salesforce.
- If Salesforce rejects a field, remove or adjust that field instead of forcing the insert.

## Report back

Return:

- org alias used
- Case Id
- Case Number
- subject
- asset/product/spare-part context used
- whether orchestration tracking fields were populated

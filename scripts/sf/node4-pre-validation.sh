#!/usr/bin/env bash
# Phase 4-Pre validation — run after deploying Node 4 Salesforce metadata and data backfill.
# Usage: ./scripts/sf/node4-pre-validation.sh [org-alias]
set -euo pipefail

ORG="${1:-AgentForce}"

echo "== Phase 4-Pre validation (org: ${ORG}) =="

echo "-- Field Service logistics objects --"
sf data query --target-org "$ORG" --query "SELECT COUNT() FROM ProductRequest" --json \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print('ProductRequest count:', r['totalSize'])"

echo "-- Product2 compatibility fields --"
sf data query --target-org "$ORG" --query \
  "SELECT ProductCode, Compatible_Product_Code__c, Part_Category__c, Is_Universal_Part__c FROM Product2 WHERE ProductCode LIKE 'SP-%' ORDER BY ProductCode" \
  --json | python3 -c "
import json,sys
rows=json.load(sys.stdin)['result']['records']
missing=[r['ProductCode'] for r in rows if not r.get('Compatible_Product_Code__c')]
print(f'SP-* products: {len(rows)}, missing compatibility: {len(missing)}')
if missing: print('  Missing:', ', '.join(missing))
"

echo "-- Location ETA inputs --"
sf data query --target-org "$ORG" --query \
  "SELECT ExternalReference, Region__c, Outbound_Lead_Time_Hours__c, Supports_Expedite__c FROM Location WHERE IsInventoryLocation = true ORDER BY ExternalReference" \
  --json | python3 -c "
import json,sys
rows=json.load(sys.stdin)['result']['records']
bad=[r['ExternalReference'] for r in rows if not r.get('Region__c') or r.get('Outbound_Lead_Time_Hours__c') is None]
print(f'Inventory locations: {len(rows)}, incomplete ETA config: {len(bad)}')
"

echo "-- Duplicate laptop Product2 check --"
sf data query --target-org "$ORG" --query \
  "SELECT ProductCode, COUNT(Id) cnt FROM Product2 WHERE ProductCode = 'AV-LP-15X-PRO' AND IsActive = true GROUP BY ProductCode" \
  --json | python3 -c "
import json,sys
rows=json.load(sys.stdin)['result']['records']
for r in rows:
    cnt=r.get('cnt') or r.get('expr0')
    print(f\"AV-LP-15X-PRO active rows: {cnt} (expect 1)\")
"

echo "-- Case asset + ship-to sample --"
sf data query --target-org "$ORG" --query \
  "SELECT CaseNumber, Asset.Product2.ProductCode, Service_Ship_To_City__c, Service_Ship_To_State__c, Parts_Fulfillment_Status__c FROM Case WHERE AssetId != null ORDER BY CreatedDate DESC LIMIT 3" \
  --json | python3 -c "
import json,sys
rows=json.load(sys.stdin)['result']['records']
print(f'Cases with assets (sample): {len(rows)}')
for r in rows:
    asset=r.get('Asset') or {}
    p2=asset.get('Product2') or {}
    print(f\"  {r.get('CaseNumber')}: product={p2.get('ProductCode')} shipTo={r.get('Service_Ship_To_City__c') or '(blank)'}\")
"

echo "== Done =="

#!/usr/bin/env bash
# Seed SP-TEST-OOS for Node 4 backorder (Scenario C) live proof.
# Creates a universal test Product2 with NO ProductItem rows (network shortage).
# Usage: ./scripts/sf/node4-seed-oos-sku.sh [org-alias]
set -euo pipefail

ORG="${1:-AgentForce}"

echo "== Seed SP-TEST-OOS (org: ${ORG}) =="

existing=$(sf data query --target-org "$ORG" --query \
  "SELECT Id, ProductCode FROM Product2 WHERE ProductCode = 'SP-TEST-OOS' LIMIT 1" --json \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['result']['records']; print(r[0]['Id'] if r else '')")

if [[ -n "${existing}" ]]; then
  echo "  Product2 SP-TEST-OOS already exists: ${existing}"
  product_id="${existing}"
else
  product_id=$(sf data create record --target-org "$ORG" --sobject Product2 \
    --values "Name='Test OOS Spare Part' ProductCode='SP-TEST-OOS' IsActive=true Compatible_Product_Code__c='ALL' Part_Category__c='Power' Is_Universal_Part__c=true" \
    --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result',{}).get('id',''))")
  echo "  Created Product2 SP-TEST-OOS: ${product_id}"
fi

item_count=$(sf data query --target-org "$ORG" --query \
  "SELECT COUNT() FROM ProductItem WHERE Product2.ProductCode = 'SP-TEST-OOS'" --json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['totalSize'])")

echo "  ProductItem rows for SP-TEST-OOS: ${item_count} (expect 0 for backorder Scenario C)"
echo "== Done. Use a Case whose description includes SP-TEST-OOS as the only part candidate. =="

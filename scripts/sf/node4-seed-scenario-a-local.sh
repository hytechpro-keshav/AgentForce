#!/usr/bin/env bash
# Seed SP-BATT-15X at WH-AUS-001 for Node 4 Scenario A (local stock at fulfillment WH).
# Austin ship-to Cases resolve to WH-AUS-001; without this row the planner only
# finds battery stock at WH-SJO-002 and plans an inter-warehouse transfer instead.
#
# Usage: ./scripts/sf/node4-seed-scenario-a-local.sh [org-alias]
set -euo pipefail

ORG="${1:-AgentForce}"
PART_CODE="SP-BATT-15X"
WH_REF="WH-AUS-001"
QTY="${QTY:-25}"

echo "== Seed Scenario A local stock (org: ${ORG}) =="
echo "   Part: ${PART_CODE} @ ${WH_REF} qty=${QTY}"

product_id=$(sf data query --target-org "$ORG" --query \
  "SELECT Id FROM Product2 WHERE ProductCode = '${PART_CODE}' LIMIT 1" --json \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['result']['records']; print(r[0]['Id'] if r else '')")

location_id=$(sf data query --target-org "$ORG" --query \
  "SELECT Id FROM Location WHERE ExternalReference = '${WH_REF}' LIMIT 1" --json \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['result']['records']; print(r[0]['Id'] if r else '')")

if [[ -z "${product_id}" || -z "${location_id}" ]]; then
  echo "ERROR: Product2 ${PART_CODE} or Location ${WH_REF} not found. Run node4-pre-deploy first." >&2
  exit 1
fi

existing=$(sf data query --target-org "$ORG" --query \
  "SELECT Id, QuantityOnHand FROM ProductItem WHERE Product2Id = '${product_id}' AND LocationId = '${location_id}' LIMIT 1" --json \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['result']['records']; print(r[0]['Id'] if r else '')")

if [[ -n "${existing}" ]]; then
  sf data update record --target-org "$ORG" --sobject ProductItem --record-id "$existing" \
    --values "QuantityOnHand=${QTY}" --json >/dev/null
  echo "  Updated ProductItem ${existing} -> qty ${QTY}"
else
  item_id=$(sf data create record --target-org "$ORG" --sobject ProductItem \
    --values "Product2Id='${product_id}' LocationId='${location_id}' QuantityOnHand=${QTY} QuantityUnitOfMeasure='Each'" \
    --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result',{}).get('id',''))")
  echo "  Created ProductItem ${item_id} (${PART_CODE} @ ${WH_REF}, qty ${QTY})"
fi

sf data query --target-org "$ORG" --query \
  "SELECT Product2.ProductCode, Location.ExternalReference, QuantityOnHand FROM ProductItem WHERE Product2.ProductCode = '${PART_CODE}' AND Location.ExternalReference = '${WH_REF}' LIMIT 1" --json \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['result']['records'], indent=2))"

echo "== Done. Create a Case with Austin ship-to and ONLY ${PART_CODE} in the description. =="
echo "   See docs/testing/node4-orchestrator-case-scenarios.md (Scenario A)."

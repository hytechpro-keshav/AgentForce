#!/usr/bin/env bash
# Phase 4-Pre data backfill — Product2 compatibility, Location ETA fields,
# Case service ship-to, duplicate AV-LP-15X-PRO remediation.
# Usage: ./scripts/sf/node4-pre-backfill.sh [org-alias]
set -euo pipefail

ORG="${1:-AgentForce}"
CANONICAL_LAPTOP_ID="01tg5000005c2U9AAI"
LEGACY_LAPTOP_ID="01tg5000005aBq5AAE"

echo "== Phase 4-Pre backfill (org: ${ORG}) =="

backfill_product() {
  local id="$1"
  local compat="$2"
  local category="$3"
  local universal="$4"
  sf data update record --target-org "$ORG" --sobject Product2 --record-id "$id" \
    --values "Compatible_Product_Code__c='${compat}' Part_Category__c='${category}' Is_Universal_Part__c=${universal}" \
    --json >/dev/null
  echo "  updated Product2 ${id} (${compat})"
}

echo "-- Product2 compatibility backfill --"
while IFS='|' read -r id compat category universal; do
  [[ -z "$id" || "$id" =~ ^# ]] && continue
  backfill_product "$id" "$compat" "$category" "$universal"
done <<'EOF'
01tg5000005cXOHAA2|AV-LP-15X-PRO|Battery|false
01tg5000005cXMfAAM|AV-LP-15X-PRO|Display|false
01tg5000005cXPtAAM|AV-LP-15X-PRO|Keyboard|false
01tg5000005cXWLAA2|AV-LP-15X-PRO|Cooling|false
01tg5000005cXXxAAM|AV-LP-15X-PRO|Cooling|false
01tg5000005cXePAAU|AV-LP-15X-PRO|Mechanical|false
01tg5000005cXZZAA2|AV-LP-15X-PRO|Motherboard|false
01tg5000005cXcnAAE|AV-LP-15X-PRO|Input|false
01tg5000005cXbBAAU|ALL|Power|true
01tg5000005cXRVAA2|ALL|Memory|true
01tg5000005cXT7AAM|ALL|Storage|true
01tg5000005cXUjAAM|ALL|Network|true
EOF

echo "-- Location ETA backfill --"
while IFS='|' read -r id region hours expedite; do
  [[ -z "$id" || "$id" =~ ^# ]] && continue
  sf data update record --target-org "$ORG" --sobject Location --record-id "$id" \
    --values "Region__c='${region}' Outbound_Lead_Time_Hours__c=${hours} Supports_Expedite__c=${expedite}" \
    --json >/dev/null
  echo "  updated Location ${id} (${region}, ${hours}h)"
done <<'EOF'
131g50000004ENlAAM|North America|4|true
131g50000004EPNAA2|North America|2|true
131g50000004EQzAAM|North America|3|true
131g50000004ESbAAM|Europe|6|true
EOF

echo "-- Duplicate AV-LP-15X-PRO remediation --"
ASSET_IDS=$(sf data query --target-org "$ORG" --query \
  "SELECT Id FROM Asset WHERE Product2Id = '${LEGACY_LAPTOP_ID}'" --json \
  | python3 -c "import json,sys; print(','.join(r['Id'] for r in json.load(sys.stdin)['result']['records']))")

if [[ -n "${ASSET_IDS}" ]]; then
  IFS=',' read -ra ASSETS <<< "${ASSET_IDS}"
  for aid in "${ASSETS[@]}"; do
    sf data update record --target-org "$ORG" --sobject Asset --record-id "$aid" \
      --values "Product2Id='${CANONICAL_LAPTOP_ID}'" --json >/dev/null
    echo "  repointed Asset ${aid} to canonical Product2"
  done
fi

sf data update record --target-org "$ORG" --sobject Product2 --record-id "$LEGACY_LAPTOP_ID" \
  --values "IsActive=false" --json >/dev/null
echo "  deactivated legacy Product2 ${LEGACY_LAPTOP_ID}"

sf data update record --target-org "$ORG" --sobject Product2 --record-id "$CANONICAL_LAPTOP_ID" \
  --values "Part_Category__c='Laptop' Compatible_Product_Code__c='AV-LP-15X-PRO' Is_Universal_Part__c=false" \
  --json >/dev/null
echo "  tagged canonical laptop Product2"

echo "-- Case service ship-to from Account Shipping --"
TMP_CASES="$(mktemp)"
sf data query --target-org "$ORG" --query \
  "SELECT Id, Account.ShippingCity, Account.ShippingState, Account.ShippingCountry FROM Case WHERE AssetId != null AND Service_Ship_To_City__c = null LIMIT 50" \
  --json > "$TMP_CASES"
python3 - "$ORG" "$TMP_CASES" <<'PY'
import json, subprocess, sys
org, path = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as fh:
    payload = json.load(fh)
for row in payload.get("result", {}).get("records", []):
    acct = row.get("Account") or {}
    city = acct.get("ShippingCity")
    state = acct.get("ShippingState")
    country = acct.get("ShippingCountry") or "US"
    if not city:
        continue
    vals = (
        f"Service_Ship_To_City__c='{city}' "
        f"Service_Ship_To_State__c='{state or ''}' "
        f"Service_Ship_To_Country__c='{country}'"
    )
    subprocess.run(
        [
            "sf", "data", "update", "record",
            "--target-org", org,
            "--sobject", "Case",
            "--record-id", row["Id"],
            "--values", vals,
            "--json",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print(f"  updated Case {row['Id']} ship-to {city}, {state}, {country}")
PY
rm -f "$TMP_CASES"

echo "-- Done. Run ./scripts/sf/node4-pre-validation.sh ${ORG} --"

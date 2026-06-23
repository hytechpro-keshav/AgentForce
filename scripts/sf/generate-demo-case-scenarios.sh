#!/usr/bin/env bash
# Refresh the inventory snapshot embedded in demo-case-scenarios.json from live Salesforce.
# Scenario form templates and expected outcomes are curated; only inventorySnapshot +
# generatedAt are overwritten unless REGENERATE_ALL=1.
#
# Usage: ./scripts/sf/generate-demo-case-scenarios.sh [org-alias]
set -euo pipefail

ORG="${1:-AgentForce}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CATALOG="${REPO_ROOT}/apps/react-chat-window/data/demo-case-scenarios.json"

if [[ ! -f "${CATALOG}" ]]; then
  echo "ERROR: catalog not found at ${CATALOG}" >&2
  exit 1
fi

echo "== Refresh demo case scenario inventory snapshot (org: ${ORG}) =="

SNAPSHOT_JSON="$(
  ORG="${ORG}" python3 <<'PY'
import json, os, subprocess

org = os.environ["ORG"]

def soql(q):
    out = subprocess.check_output(
        ["sf", "data", "query", "--target-org", org, "--query", q, "--json"],
        text=True,
    )
    data = json.loads(out)
    if data.get("status") != 0:
        raise SystemExit(data)
    return data["result"]

locations = soql(
    "SELECT Id, Name, ExternalReference, LocationType FROM Location "
    "WHERE ExternalReference LIKE 'WH-%' ORDER BY ExternalReference"
)["records"]

items = soql(
    "SELECT Product2.ProductCode, Product2.Name, Location.ExternalReference, "
    "QuantityOnHand FROM ProductItem WHERE Product2.ProductCode LIKE 'SP-%' "
    "ORDER BY Product2.ProductCode, Location.ExternalReference"
)["records"]

oos = soql(
    "SELECT Id FROM Product2 WHERE ProductCode = 'SP-TEST-OOS' LIMIT 1"
)["records"]
oos_count = 0
if oos:
    oos_count = soql(
        "SELECT COUNT() FROM ProductItem WHERE Product2.ProductCode = 'SP-TEST-OOS'"
    )["totalSize"]

skills = soql(
    "SELECT ServiceResource.Name, Skill.MasterLabel, SkillLevel "
    "FROM ServiceResourceSkill WHERE ServiceResource.IsActive = true "
    "ORDER BY ServiceResource.Name, Skill.MasterLabel"
)["records"]

territories = soql(
    "SELECT Name FROM ServiceTerritory WHERE IsActive = true ORDER BY Name"
)["records"]

by_resource = {}
for row in skills:
    name = row["ServiceResource"]["Name"]
    by_resource.setdefault(name, []).append(
        {"label": row["Skill"]["MasterLabel"], "level": row["SkillLevel"]}
    )

product_items = [
    {
        "productCode": r["Product2"]["ProductCode"],
        "productName": r["Product2"]["Name"],
        "warehouseReference": r["Location"]["ExternalReference"],
        "quantityOnHand": r["QuantityOnHand"],
    }
    for r in items
]
if oos:
    product_items.append(
        {
            "productCode": "SP-TEST-OOS",
            "productName": "Test OOS Spare Part",
            "warehouseReference": None,
            "quantityOnHand": 0 if oos_count == 0 else oos_count,
        }
    )

snapshot = {
    "warehouses": [
        {
            "externalReference": r["ExternalReference"],
            "name": r["Name"],
            "locationType": r["LocationType"],
            "region": "Europe"
            if r["ExternalReference"] == "WH-FRA-004"
            else "North America",
        }
        for r in locations
    ],
    "productItems": product_items,
    "serviceResources": [
        {"name": n, "skills": s} for n, s in sorted(by_resource.items())
    ],
    "serviceTerritories": [t["Name"] for t in territories],
}

print(json.dumps(snapshot))
PY
)"

CATALOG_PATH="${CATALOG}" SNAPSHOT_JSON="${SNAPSHOT_JSON}" python3 <<'PY'
import json, os
from datetime import datetime, timezone

path = os.environ["CATALOG_PATH"]
snapshot = json.loads(os.environ["SNAPSHOT_JSON"])

with open(path, encoding="utf-8") as f:
    catalog = json.load(f)

catalog["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
catalog["inventorySnapshot"] = snapshot

with open(path, "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2)
    f.write("\n")

print(f"Updated {path}")
print(f"  warehouses: {len(snapshot['warehouses'])}")
print(f"  productItems: {len(snapshot['productItems'])}")
print(f"  serviceResources: {len(snapshot['serviceResources'])}")
PY

AI_API_CATALOG="${REPO_ROOT}/apps/ai-api/data/demo-case-scenarios.json"
cp "${CATALOG}" "${AI_API_CATALOG}"
echo "Synced catalog copy to ${AI_API_CATALOG}"

echo "== Done. Review scenario inventoryBasis blocks if stock layout changed materially. =="

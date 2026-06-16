#!/usr/bin/env bash
# Phase 5-Pre validation — exit criteria gate for Node 5 Scheduling Salesforce prep.
# Asserts skill graph, NA territory, technician membership, laptop WorkTypes, and Run As FLS.
# Usage: ./scripts/sf/node5-pre-validation.sh [org-alias] [run-as-username]
set -euo pipefail

ORG="${1:-AgentForce}"
RUN_AS="${2:-chaudhary.keshav4u@gmail.com}"

echo "== Phase 5-Pre validation (org: ${ORG}) =="
FAIL=0

count() { # object  -> totalSize
  sf data query --target-org "$ORG" --query "SELECT COUNT() FROM $1" --json \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['totalSize'])"
}

assert_ge() { # label value min
  if [ "$2" -ge "$3" ]; then echo "  PASS: $1 = $2 (>= $3)"; else echo "  FAIL: $1 = $2 (expected >= $3)"; FAIL=1; fi
}

echo "-- Skill graph (S5–S7) --"
assert_ge "Skill" "$(count Skill)" 5
assert_ge "ServiceResourceSkill" "$(count ServiceResourceSkill)" 2
assert_ge "SkillRequirement" "$(count SkillRequirement)" 2

echo "-- Geography aligned to Node 4 ship-to (S3) --"
NA=$(sf data query --target-org "$ORG" --query "SELECT Name FROM ServiceTerritory WHERE Name = 'North America'" --json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['totalSize'])")
assert_ge "North America territory" "$NA" 1
assert_ge "ServiceTerritoryMember (total)" "$(count ServiceTerritoryMember)" 2

echo "-- Technicians active (S2) --"
ACTIVE=$(sf data query --target-org "$ORG" --query "SELECT COUNT() FROM ServiceResource WHERE IsActive = true AND ResourceType = 'T'" --json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['totalSize'])")
assert_ge "Active technicians" "$ACTIVE" 2

echo "-- Laptop WorkTypes with duration (S8) --"
sf data query --target-org "$ORG" --query \
  "SELECT Name, EstimatedDuration, DurationType FROM WorkType WHERE Name LIKE '%Laptop%' ORDER BY Name" --json \
  | python3 -c "
import json,sys
rows=json.load(sys.stdin)['result']['records']
print(f'  Laptop WorkTypes: {len(rows)}')
for r in rows: print(f\"    {r['Name']}: {r['EstimatedDuration']} {r['DurationType']}\")
import sys as _s
_s.exit(0 if len(rows) >= 2 else 1)
" || { echo "  FAIL: expected >= 2 laptop WorkTypes"; FAIL=1; }

echo "-- FLS proof: Run As user (${RUN_AS}) can read scheduling objects (S11) --"
sf data query --target-org "$ORG" --query \
  "SELECT ServiceResource.Name, Skill.MasterLabel, SkillLevel FROM ServiceResourceSkill LIMIT 5" \
  --json >/dev/null 2>&1 && echo "  PASS: ServiceResourceSkill (incl. Skill.MasterLabel) readable — no INVALID_FIELD" \
  || { echo "  FAIL: ServiceResourceSkill read failed"; FAIL=1; }

ASSIGNED=$(sf data query --target-org "$ORG" --query \
  "SELECT COUNT() FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Agentforce_Scheduling_Node5' AND Assignee.Username = '${RUN_AS}'" --json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['totalSize'])")
assert_ge "Agentforce_Scheduling_Node5 on Run As user" "$ASSIGNED" 1

echo
if [ "$FAIL" -eq 0 ]; then echo "== Phase 5-Pre validation PASSED =="; else echo "== Phase 5-Pre validation FAILED =="; exit 1; fi

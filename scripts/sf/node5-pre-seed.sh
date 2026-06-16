#!/usr/bin/env bash
# Phase 5-Pre seed — idempotent Field Service scheduling data (skills graph, territory, work types).
# Skills themselves are metadata (force-app/main/default/skills/) and must be DEPLOYED before this runs.
# Usage: ./scripts/sf/node5-pre-seed.sh [org-alias]
set -euo pipefail

ORG="${1:-AgentForce}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Node 5 Phase 5-Pre seed (org: ${ORG}) =="
echo "-- Running idempotent Apex seed (ServiceResourceSkill, NA territory + members, laptop WorkTypes, SkillRequirement) --"
sf apex run --target-org "$ORG" --file "${ROOT}/scripts/sf/apex/node5-pre-seed.apex"
echo "== Seed complete =="

#!/usr/bin/env bash
# Phase 5-Pre full deploy: Skill metadata + perm set, perm-set assignment (CLI + OAuth Run As),
# idempotent data seed, and validation. Mirrors scripts/sf/node4-pre-deploy.sh.
# Usage: ./scripts/sf/node5-pre-deploy.sh [org-alias] [run-as-username]
set -euo pipefail

ORG="${1:-AgentForce}"
RUN_AS="${2:-chaudhary.keshav4u@gmail.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Node 5 Phase 5-Pre deploy (org: ${ORG}, run-as: ${RUN_AS}) =="

echo "-- 1/5 Deploy metadata (Skills + permission set) --"
sf project deploy start --target-org "$ORG" \
  --source-dir "${ROOT}/force-app/main/default/skills" \
  --source-dir "${ROOT}/force-app/main/default/permissionsets/Agentforce_Scheduling_Node5.permissionset-meta.xml" \
  --wait 10

echo "-- 2/5 Assign permission set to CLI admin user --"
sf org assign permset --target-org "$ORG" --name Agentforce_Scheduling_Node5 || true

echo "-- 3/5 Assign permission set to OAuth Run As user (${RUN_AS}) --"
sf org assign permset --target-org "$ORG" --name Agentforce_Scheduling_Node5 --on-behalf-of "$RUN_AS" || true

echo "-- 4/5 Seed scheduling data --"
"${ROOT}/scripts/sf/node5-pre-seed.sh" "$ORG"

echo "-- 5/5 Validate --"
"${ROOT}/scripts/sf/node5-pre-validation.sh" "$ORG" "$RUN_AS"

echo "== Phase 5-Pre complete. If Railway ai-api is live, RESTART it (OAuth token cache ~25 min) before live scheduling reads. =="

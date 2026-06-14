#!/usr/bin/env bash
# Phase 4-Pre full deploy: metadata, permission set, backfill, validation.
# Usage: ./scripts/sf/node4-pre-deploy.sh [org-alias]
set -euo pipefail

ORG="${1:-AgentForce}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Node 4 Phase 4-Pre deploy (org: ${ORG}) =="

echo "-- 1/4 Deploy metadata --"
sf project deploy start --target-org "$ORG" \
  --manifest "${ROOT}/manifest/node4-pre-package.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/ProductRequestLineItem/fields" \
  --source-dir "${ROOT}/force-app/main/default/permissionsets/Agentforce_Parts_Logistics_Node4.permissionset-meta.xml" \
  --wait 10

echo "-- 2/4 Assign permission set to current user --"
sf org assign permset --target-org "$ORG" --name Agentforce_Parts_Logistics_Node4

echo "-- 3/4 Backfill org data --"
"${ROOT}/scripts/sf/node4-pre-backfill.sh" "$ORG"

echo "-- 4/4 Validate --"
"${ROOT}/scripts/sf/node4-pre-validation.sh" "$ORG"

echo "== Phase 4-Pre complete. Assign Agentforce_Parts_Logistics_Node4 to the AI API OAuth run-as user before live orchestrator reads. =="

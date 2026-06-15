#!/usr/bin/env bash
# Phase 4c live deploy: Apex fulfillment executor, workflow-id fields, Flow,
# fulfillment-writes permission set (Field Service license-gated), and
# run-as user assignment.
#
# Usage:
#   ./scripts/sf/node4-4c-deploy.sh [org-alias] [run-as-username]
#
# Defaults:
#   org-alias        AgentForce
#   run-as-username  chaudhary.keshav4u@gmail.com
#
# After deploy:
#   1. Set AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED=true on Railway ai-api
#   2. Redeploy or restart ai-api (OAuth token cache)
#   3. ASSERT_PARTS_WRITES=1 SF_CASE_ID=<case> ./scripts/smoke/all-3-nodes-deployed.sh
set -euo pipefail

ORG="${1:-AgentForce}"
RUN_AS_USER="${2:-chaudhary.keshav4u@gmail.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Node 4 Phase 4c deploy (org: ${ORG}, run-as: ${RUN_AS_USER}) =="

echo "-- 1/5 Deploy 4c metadata (Apex, fields, Flow, fulfillment perm set) --"
sf project deploy start --target-org "$ORG" \
  --source-dir "${ROOT}/force-app/main/default/classes/AgentforcePartsFulfillmentService.cls" \
  --source-dir "${ROOT}/force-app/main/default/classes/AgentforcePartsFulfillmentService.cls-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/classes/AgentforcePartsFulfillmentServiceTest.cls" \
  --source-dir "${ROOT}/force-app/main/default/classes/AgentforcePartsFulfillmentServiceTest.cls-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/classes/AgentforcePartsFulfillmentRest.cls" \
  --source-dir "${ROOT}/force-app/main/default/classes/AgentforcePartsFulfillmentRest.cls-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/ProductRequest/fields" \
  --source-dir "${ROOT}/force-app/main/default/objects/ProductTransfer/fields" \
  --source-dir "${ROOT}/force-app/main/default/flows/Case_Parts_Backorder_Notification.flow-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/permissionsets/Agentforce_Parts_Fulfillment_Writes.permissionset-meta.xml" \
  --test-level RunSpecifiedTests \
  --tests AgentforcePartsFulfillmentServiceTest \
  --wait 30

echo "-- 2/5 Assign Field Service Standard PSL to run-as user --"
sf org assign permsetlicense --target-org "$ORG" \
  --name FieldServiceStandardPsl \
  --on-behalf-of "$RUN_AS_USER" || {
  echo "WARN: Field Service PSL assignment failed (may already be assigned)." >&2
}

echo "-- 3/5 Assign Agentforce_Parts_Logistics_Node4 (read/plan) --"
sf org assign permset --target-org "$ORG" \
  --name Agentforce_Parts_Logistics_Node4 \
  --on-behalf-of "$RUN_AS_USER" || true

echo "-- 4/5 Assign Agentforce_Parts_Fulfillment_Writes (gated DML) --"
sf org assign permset --target-org "$ORG" \
  --name Agentforce_Parts_Fulfillment_Writes \
  --on-behalf-of "$RUN_AS_USER"

echo "-- 5/5 Verify assignments --"
sf data query --target-org "$ORG" --query \
  "SELECT Assignee.Username, PermissionSet.Name FROM PermissionSetAssignment WHERE Assignee.Username = '${RUN_AS_USER}' AND PermissionSet.Name LIKE 'Agentforce_Parts%'" \
  --result-format human

sf data query --target-org "$ORG" --query \
  "SELECT Assignee.Username, PermissionSetLicense.MasterLabel FROM PermissionSetLicenseAssign WHERE Assignee.Username = '${RUN_AS_USER}'" \
  --result-format human

echo ""
echo "== Phase 4c deploy complete. =="
echo "Next: set AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED=true on Railway ai-api, restart ai-api, then:"
echo "  ASSERT_PARTS_WRITES=1 SF_CASE_ID=<case-id> ./scripts/smoke/all-3-nodes-deployed.sh"

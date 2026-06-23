#!/usr/bin/env bash
# Node 6 Phase 6c-Pre — Stop AI + hardening Salesforce deploy (STUB — author metadata first).
#   1. AI_Orchestration_Status__c picklist (active|stopped_by_user|suppressed) + perm-set FLS
#   2. Apex callback: stop guard + approver/decision-at stamp (ProcessInstanceStep)
#   3. Handoff Flow stop guard (<filterFormula>) + approver queue members
#   4. Approval History on the demo Case layout (RETRIEVE the org layout first — none in source)
# Scaffolded by /plan-node6-hardening-stop-ai. Mirrors scripts/sf/node6-sf-approval-pre-deploy.sh.
# Usage: ./scripts/sf/node6-6c-stop-ai-pre-deploy.sh [org-alias] [run-as-username]
set -euo pipefail

ORG="${1:-AgentForce}"
RUN_AS="${2:-chaudhary.keshav4u@gmail.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Node 6 Phase 6c-Pre Stop AI deploy (org: ${ORG}, run-as: ${RUN_AS}) =="
echo "   PRE-REQ: author force-app/main/default/objects/Case/fields/AI_Orchestration_Status__c.field-meta.xml"
echo "            (restricted picklist incl. stopped_by_user) BEFORE running — it does not exist yet."

echo "-- 1/5 Validate Apex with targeted tests (full org validate may fail on unrelated tests) --"
sf project deploy start --target-org "$ORG" \
  --metadata ApexClass:AgentforceGuardrailApprovalCallback \
  --metadata ApexClass:AgentforceGuardrailApprovalCallbackTest \
  --test-level RunSpecifiedTests \
  --tests AgentforceGuardrailApprovalCallbackTest \
  --dry-run --wait 10 || true

echo "-- 2/5 Deploy Case AI_Orchestration_Status__c field + permission set FLS --"
sf project deploy start --target-org "$ORG" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Orchestration_Status__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/permissionsets/Agentforce_Guardrail_Node6.permissionset-meta.xml" \
  --wait 10

echo "-- 3/5 Assign perm set to CLI admin + OAuth Run As user (${RUN_AS}) --"
sf org assign permset --target-org "$ORG" --name Agentforce_Guardrail_Node6 || true
sf org assign permset --target-org "$ORG" --name Agentforce_Guardrail_Node6 --on-behalf-of "$RUN_AS" || true

echo "-- 4/5 Deploy Apex callback (stop guard + approver/decision-at stamp) + queue --"
echo "   NOTE: ProcessInstanceStep uses SystemModstamp (not CompletedDate) for decision-at."
sf project deploy start --target-org "$ORG" \
  --metadata ApexClass:AgentforceGuardrailApprovalCallback \
  --metadata ApexClass:AgentforceGuardrailApprovalCallbackTest \
  --test-level RunSpecifiedTests \
  --tests AgentforceGuardrailApprovalCallbackTest \
  --wait 10
sf project deploy start --target-org "$ORG" \
  --source-dir "${ROOT}/force-app/main/default/queues/Agentforce_Guardrail_Approvers.queue-meta.xml" \
  --wait 10

echo "-- 5/5 Deploy Handoff Flow stop guard --"
echo "   WARNING: an active Flow can block redeploys — deactivate first if a redeploy fails."
sf project deploy start --target-org "$ORG" \
  --source-dir "${ROOT}/force-app/main/default/flows/Case_Triage_Orchestrator_Handoff.flow-meta.xml" \
  --wait 10

echo "== Node 6 Phase 6c-Pre deploy complete. =="
echo "== MANUAL/RETRIEVE step: add the Approval History related list to the demo Case layout =="
echo "==   (no Case layout exists in source — retrieve it first: sf project retrieve start --metadata Layout). =="
echo "== Then enable timeout + control on Railway ai-api: ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED, =="
echo "==   ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS, and the orchestrator-control scope for Stop AI. =="

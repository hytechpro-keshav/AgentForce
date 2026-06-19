#!/usr/bin/env bash
# Node 6 Phase 6b+ Salesforce Approval Process deploy:
# Case guardrail/verdict/resume-token fields + perm set, perm-set assignment (CLI + OAuth Run As),
# guardrail Apex, then workflow field updates + Approval Process + callback Flow.
# Mirrors scripts/sf/node5-pre-deploy.sh.
# Usage: ./scripts/sf/node6-sf-approval-pre-deploy.sh [org-alias] [run-as-username]
set -euo pipefail

ORG="${1:-AgentForce}"
RUN_AS="${2:-chaudhary.keshav4u@gmail.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Node 6 Phase 6b+ Salesforce Approval deploy (org: ${ORG}, run-as: ${RUN_AS}) =="

echo "-- 1/5 Deploy Case guardrail fields + permission set --"
sf project deploy start --target-org "$ORG" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Guardrail_Status__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Guardrail_Decision_At__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Guardrail_Approver__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Guardrail_Resume_Token__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Orchestrator_Verdict_Headline__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Orchestrator_Verdict_Summary__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Orchestrator_Verdict_Steps__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Orchestrator_Verdict_Highlights__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/objects/Case/fields/AI_Orchestration_Console_URL__c.field-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/permissionsets/Agentforce_Guardrail_Node6.permissionset-meta.xml" \
  --wait 10

echo "-- 2/5 Assign permission set to CLI admin user --"
sf org assign permset --target-org "$ORG" --name Agentforce_Guardrail_Node6 || true

echo "-- 3/5 Assign permission set to OAuth Run As user (${RUN_AS}) --"
sf org assign permset --target-org "$ORG" --name Agentforce_Guardrail_Node6 --on-behalf-of "$RUN_AS" || true

echo "-- 4/5 Deploy guardrail Apex (authored separately — must already exist in source) --"
echo "   NOTE: AgentforceGuardrailApprovalService, AgentforceGuardrailApprovalRest, and"
echo "   AgentforceGuardrailApprovalCallback are authored separately. They must exist before this step."
sf project deploy start --target-org "$ORG" \
  --metadata ApexClass:AgentforceGuardrailApprovalService \
  --metadata ApexClass:AgentforceGuardrailApprovalRest \
  --metadata ApexClass:AgentforceGuardrailApprovalCallback \
  --wait 10

echo "-- 5/5 Deploy workflow field updates + Approval Process + callback Flow --"
echo "   WARNING: the Approval Process approver assignment is adhoc (submitter chooses)."
echo "   The org may need to set a real approver/queue (e.g. Agentforce_Guardrail_Approvers)."
echo "   WARNING: an active Approval Process and/or an active Flow can block redeploys —"
echo "   deactivate them first if a subsequent deploy fails."
sf project deploy start --target-org "$ORG" \
  --source-dir "${ROOT}/force-app/main/default/workflows/Case.workflow-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/approvalProcesses/Case.Agentforce_Guardrail_Approval.approvalProcess-meta.xml" \
  --source-dir "${ROOT}/force-app/main/default/flows/Agentforce_Guardrail_Approval_Callback.flow-meta.xml" \
  --wait 10

echo "== Node 6 Phase 6b+ Salesforce Approval deploy complete. =="
echo "== RESTART the Railway ai-api after enabling ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED =="
echo "== and ORCHESTRATOR_APPROVAL_TOKEN_SECRET so the resume-callback path is live. =="

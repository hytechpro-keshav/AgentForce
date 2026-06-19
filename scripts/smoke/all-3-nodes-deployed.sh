#!/usr/bin/env bash
# ==============================================================================
# all-3-nodes-deployed.sh — End-to-end test for the orchestrator nodes on
# Railway (Node 1 Triage, Node 2 Customer History, Node 3 Knowledge Base,
# Node 4 Parts & Logistics, Node 5 Scheduling, Node 6 Compliance & Guardrail)
#
# Tests the full LangGraph case-triage workflow with the laptop KB corpus:
#   START → readContext → runTriage (N1) → customerHistory (N2) → knowledge (N3)
#         → partsLogistics (N4) → scheduling (N5) → evaluateGuardrail (N6)
#         → writeBack / rejected / escalated
#
# Prerequisites:
#   • Railway deployment is healthy
#   • Laptop KB corpus is ingested (or set INGEST_CORPUS=1 to ingest)
#   • AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED=true on Railway
#   • AI_API_ORCHESTRATOR_PARTS_ENABLED=true on Railway
#   • RAG_ENABLED=true on Railway
#   • For ASSERT_SCHEDULING=1: AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true on
#     Railway + OAuth Run As user has Agentforce_Scheduling_Node5 (see
#     scripts/sf/node5-pre-validation.sh) + NA Field Service seed (5-Pre)
#   • A real Salesforce Case ID with an installed asset (laptop issue description)
#   • OAuth Connected App Run As user has Agentforce_Parts_Logistics_Node4
#   • For ASSERT_PARTS_WRITES=1: run-as also needs Agentforce_Parts_Fulfillment_Writes
#     + Field Service Standard PSL (see scripts/sf/node4-4c-deploy.sh)
#
# Required env vars:
#   RAILWAY_SERVICE       — Railway service name (default: ai-api)
#   RAILWAY_ENVIRONMENT   — Railway environment (default: production)
#   SF_CASE_ID            — Salesforce Case record ID to triage
#
# Optional:
#   AI_API_BASE_URL       — defaults to Railway deployed URL
#   INGEST_CORPUS         — set to 1 to re-ingest the laptop KB before testing
#   POLL_TIMEOUT_SECS     — workflow poll timeout (default: 120)
#   ASSERT_PARTS_ELIGIBLE — set to 0 to skip Node 4 eligibility assertion (default: 1)
#   ASSERT_SCHEDULING     — set to 1 to assert Node 5 scheduling (default: 0;
#                           requires the scheduling flag enabled on Railway)
#   ASSERT_SCHEDULING_5B  — set to 1 with ASSERT_SCHEDULING=1 to assert 5b fields
#                           (territory-local TZ, durationSource, slotSource, PDT window)
#   ASSERT_SCHEDULING_WRITES — set to 1 to assert Node 5 Phase 5c booked the
#                           ServiceAppointment (appointmentStatus=booked +
#                           reference). Needs an APPROVED Case (requireHumanApproval
#                           → approved, NOT escalate), AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED=true,
#                           and ServiceAppointment create on the run-as user (default: 0)
#   ASSERT_GUARDRAIL      — set to 1 to assert the demo Case trips Node 6 to
#                           requireHumanApproval (default: 0; needs the parts +
#                           scheduling flags on so the composite risk clears the band)
#   ASSERT_GUARDRAIL_EMAIL — set to 1 to assert Phase 6b approval EMAIL routing:
#                           guardrail.approvalRouting.method=email + sentAt set.
#                           Requires ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED=true
#                           (+ ORCHESTRATOR_APPROVAL_TOKEN_SECRET, _LINK_BASE_URL,
#                           _EMAIL_FROM, _EMAIL_TO) on Railway AND an SF_CASE_ID that
#                           lands requireHumanApproval — NOT 00001050 (escalates),
#                           NOT 00001054 (autoApprove). The approve-link click is
#                           manual proof; this only asserts the email was routed.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MINT_JWT="${REPO_ROOT}/scripts/smoke/phase4-mint-jwt.mjs"
PARSE_SNAPSHOT="${REPO_ROOT}/scripts/smoke/parse-orchestrator-snapshot.mjs"

AI_API_BASE_URL="${AI_API_BASE_URL:-https://ai-api-production-03f5.up.railway.app}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-ai-api}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
CORPUS_PATH="${CORPUS_PATH:-${REPO_ROOT}/apps/ai-api/data/knowledge/kb-laptop-corpus.json}"
INGEST_CORPUS="${INGEST_CORPUS:-0}"
POLL_TIMEOUT_SECS="${POLL_TIMEOUT_SECS:-120}"
JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
ASSERT_PARTS_ELIGIBLE="${ASSERT_PARTS_ELIGIBLE:-1}"
# Phase 4c gated-write assertion. Off by default — only meaningful once
# the workflow is approved AND AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED=true
# with the expanded perm set assigned to the run-as user.
ASSERT_PARTS_WRITES="${ASSERT_PARTS_WRITES:-0}"
# Node 5 scheduling assertion. Off by default — only meaningful once
# AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true with the Agentforce_Scheduling_Node5
# perm set assigned to the run-as user and the 5-Pre Field Service seed in place.
ASSERT_SCHEDULING="${ASSERT_SCHEDULING:-0}"
# Node 5 Phase 5c gated-write assertion. Off by default — only meaningful once
# the workflow is APPROVED (requireHumanApproval → approved, not escalate) AND
# AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED=true with ServiceAppointment
# create on the run-as user. The plan must be schedulable at write time (RC-5).
ASSERT_SCHEDULING_WRITES="${ASSERT_SCHEDULING_WRITES:-0}"
# Node 6 guardrail demo-case assertion. Off by default — proves the live demo
# Case (00001050) trips Node 6 composite policy on all upstream channels.
# Production may land in requireHumanApproval (minimal fixture, score ~70) OR
# escalate (full customerContext + KB + sla_breach_risk scheduling, score ~100).
# The always-on invariant below proves evaluateGuardrail replaced the gate on
# every run regardless of this flag.
ASSERT_GUARDRAIL="${ASSERT_GUARDRAIL:-0}"
# Node 6 Phase 6b — approval email routing assertion. Off by default. Asserts
# the approver notification was routed by email (method=email + sentAt). Needs
# the email flags on Railway and an SF_CASE_ID that lands requireHumanApproval
# (escalate has no interrupt/routing; autoApprove never pauses). See the header.
ASSERT_GUARDRAIL_EMAIL="${ASSERT_GUARDRAIL_EMAIL:-0}"
# Node 6 Phase 6b+ — Salesforce Approval Process routing assertion. Off by
# default. Asserts the approver notification was routed to a native SF Approval
# (method=salesforce_approval + sentAt + externalRef = ProcessInstance id).
# Needs ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED=true + ORCHESTRATOR_APPROVAL_TOKEN_SECRET
# on Railway and an SF_CASE_ID that lands requireHumanApproval (NOT 00001050
# escalate / 00001054 autoApprove). The approver acting in Salesforce is manual
# proof; this asserts the submit routed.
ASSERT_GUARDRAIL_SF="${ASSERT_GUARDRAIL_SF:-0}"

: "${SF_CASE_ID:?Set SF_CASE_ID to a Salesforce Case record ID for the triage test.}"

command -v curl    >/dev/null 2>&1 || { echo "Missing: curl" >&2; exit 1; }
command -v node    >/dev/null 2>&1 || { echo "Missing: node" >&2; exit 1; }
command -v jq      >/dev/null 2>&1 || { echo "Missing: jq" >&2; exit 1; }
command -v railway >/dev/null 2>&1 || { echo "Missing: railway CLI" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Health check
# ---------------------------------------------------------------------------
echo ""
echo "=== [0] Health check: ${AI_API_BASE_URL} ==="
health_code=$(curl -sS -o /tmp/all3-health.out -w '%{http_code}' "${AI_API_BASE_URL}/health/live")
[[ "${health_code}" == "200" ]] || { echo "Health FAILED (${health_code})" >&2; exit 1; }
echo "Healthy."

# ---------------------------------------------------------------------------
# 1. Mint JWT tokens
# ---------------------------------------------------------------------------
echo ""
echo "=== [1] Minting JWTs via Railway ==="

MAINT_TOKEN=$(cd "${REPO_ROOT}" && railway run \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  node "${MINT_JWT}" \
    --purpose maintenance \
    --tenant tenant-demo \
    --namespace customer-self-service \
    --ttl-seconds "${JWT_TTL_SECONDS}")
echo "Maintenance JWT minted (${#MAINT_TOKEN} chars)."

AGENTFORCE_TOKEN=$(cd "${REPO_ROOT}" && railway run \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  node "${MINT_JWT}" \
    --scope "agentforce:orchestrator-triage agentforce:orchestrator-read agentforce:orchestrator-approval agentforce:support-triage agentforce:knowledge-rag" \
    --tenant tenant-demo \
    --namespace customer-self-service \
    --ttl-seconds "${JWT_TTL_SECONDS}")
echo "Agentforce JWT minted (${#AGENTFORCE_TOKEN} chars)."

# ---------------------------------------------------------------------------
# 2. Optionally re-ingest the laptop KB corpus
# ---------------------------------------------------------------------------
if [[ "${INGEST_CORPUS}" == "1" ]]; then
  echo ""
  echo "=== [2] Ingesting laptop KB corpus ==="
  AI_API_BASE_URL="${AI_API_BASE_URL}" \
    AI_API_BEARER_TOKEN="${MAINT_TOKEN}" \
    AI_API_RAG_CORPUS="${CORPUS_PATH}" \
    AI_API_RAG_SMOKE_QUESTION="AeroVolt ProBook 15X battery not charging, adapter plugged in but no LED" \
    AI_API_RAG_SMOKE_REQUEST_ID="all3-node3-ingest-smoke" \
    bash "${REPO_ROOT}/scripts/smoke/phase4-rag-ingest-sample.sh"
  echo "Ingest complete."
else
  echo ""
  echo "=== [2] Corpus ingest skipped (INGEST_CORPUS=${INGEST_CORPUS}) ==="
fi

# ---------------------------------------------------------------------------
# 3. Verify Node 3 RAG can find laptop knowledge
# ---------------------------------------------------------------------------
echo ""
echo "=== [3] Verify Node 3 RAG (pre-orchestrator sanity) ==="

echo "  Querying: laptop battery not charging..."
rag_response=$(curl -sS -X POST "${AI_API_BASE_URL}/agent/knowledge/answer" \
  -H "authorization: Bearer ${MAINT_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"question":"AeroVolt ProBook 15X battery not charging, adapter plugged in but no LED","requestId":"all3-node3-sanity"}')

rag_status=$(echo "${rag_response}" | jq -r '.answerStatus // .status // "unknown"')
echo "  RAG status: ${rag_status}"
[[ "${rag_status}" == "ANSWERED" ]] || {
  echo "  RAG sanity check FAILED — expected ANSWERED, got ${rag_status}" >&2
  echo "${rag_response}" | jq '.' >&2
  exit 1
}
source_count=$(echo "${rag_response}" | jq '.sources | length')
echo "  Sources retrieved: ${source_count}"
echo "${rag_response}" | jq -r '.sources[] | "    • \(.sourceId): \(.title)"' 2>/dev/null | head -5

# ---------------------------------------------------------------------------
# 4. Trigger orchestrator case-triage (all 4 nodes)
# ---------------------------------------------------------------------------
echo ""
echo "=== [4] Triggering orchestrator for Case ${SF_CASE_ID} ==="

trigger_response=$(curl -sS -X POST "${AI_API_BASE_URL}/orchestrator/case-triage/triggers" \
  -H "authorization: Bearer ${AGENTFORCE_TOKEN}" \
  -H "content-type: application/json" \
  -d "{\"caseId\":\"${SF_CASE_ID}\"}")

echo "${trigger_response}" | jq '.'
workflow_id=$(echo "${trigger_response}" | jq -r '.workflowId // empty')
[[ -n "${workflow_id}" ]] || { echo "Trigger failed — no workflowId returned." >&2; exit 1; }
echo "WorkflowId: ${workflow_id}"

# ---------------------------------------------------------------------------
# 5. Poll until terminal status
# ---------------------------------------------------------------------------
echo ""
echo "=== [5] Polling workflow ${workflow_id} (timeout: ${POLL_TIMEOUT_SECS}s) ==="

deadline=$(( $(date +%s) + POLL_TIMEOUT_SECS ))
terminal_statuses=("done" "failed" "rejected" "escalated")
final_status=""
snapshot=""
resume_attempted=0

while true; do
  now=$(date +%s)
  if (( now >= deadline )); then
    echo "Timed out after ${POLL_TIMEOUT_SECS}s waiting for terminal status." >&2
    exit 1
  fi

  snapshot=$(curl -sS \
    -H "authorization: Bearer ${AGENTFORCE_TOKEN}" \
    "${AI_API_BASE_URL}/orchestrator/case-triage/${workflow_id}")
  status=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field status)

  printf "  [%ds remaining] status=%s\n" "$(( deadline - now ))" "${status}"

  if [[ "${status}" == "waiting_approval" && "${resume_attempted}" == "0" ]]; then
    echo "  Workflow paused for approval — auto-resuming with approved..."
    resume_response=$(curl -sS -X POST \
      "${AI_API_BASE_URL}/orchestrator/case-triage/${workflow_id}/resume" \
      -H "authorization: Bearer ${AGENTFORCE_TOKEN}" \
      -H "content-type: application/json" \
      -d "{\"decision\":\"approved\",\"idempotencyKey\":\"smoke-${workflow_id}\"}")
    resume_status=$(echo "${resume_response}" | node "${PARSE_SNAPSHOT}" --field status 2>/dev/null || echo "unknown")
    echo "  Resume status: ${resume_status}"
    resume_attempted=1
    sleep 3
    continue
  fi

  for t in "${terminal_statuses[@]}"; do
    if [[ "${status}" == "${t}" ]]; then
      final_status="${t}"
      break 2
    fi
  done

  sleep 5
done

# ---------------------------------------------------------------------------
# 6. Final workflow snapshot (safe parse — orchestrator text may contain
#    control characters that break jq)
# ---------------------------------------------------------------------------
echo ""
echo "=== [6] Final workflow snapshot ==="
echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --summary

# ---------------------------------------------------------------------------
# 7. Assertions
# ---------------------------------------------------------------------------
echo ""
echo "=== [7] Assertions ==="

knowledge_status=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field knowledgeGuidance.status)
knowledge_eligible=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field knowledgeGuidance.eligible)
knowledge_degraded=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field knowledgeGuidance.degraded)
triage_priority=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field triage.recommendedPriority)
parts_eligible=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.eligible)
parts_status=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.status)
parts_degraded=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.degraded)
parts_readiness=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.fulfillmentReadiness)
parts_plan_count=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.partPlans.length)
parts_eligibility_reason=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.eligibilityReason)
parts_kb_crosscheck=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.kbCrossCheck.status)
parts_write_applied=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field partsLogistics.writeOutcome.applied)
scheduling_eligible=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.eligible)
scheduling_status=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.status)
scheduling_readiness=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.schedulingReadiness)
scheduling_degraded=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.degraded)
scheduling_technician=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.recommendedResourceReference)
scheduling_window=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.proposedWindow.displayWindow)
scheduling_timezone=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.proposedWindow.timeZone)
scheduling_slot_source=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.proposedWindow.slotSource)
scheduling_duration_source=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.proposedWindow.durationSource)
scheduling_parts_eta=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.proposedWindow.partsEtaConstrained)
scheduling_candidates_api=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.candidatesApiUsed)
scheduling_appt_status=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.appointmentStatus)
scheduling_appt_ref=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field scheduling.appointmentReference)
guardrail_outcome=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field guardrail.outcome)
guardrail_risk_score=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field guardrail.riskScore)
guardrail_risk_level=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field guardrail.riskLevel)
guardrail_routing_method=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field guardrail.approvalRouting.method)
guardrail_routing_sent_at=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field guardrail.approvalRouting.sentAt)
guardrail_routing_external_ref=$(echo "${snapshot}" | node "${PARSE_SNAPSHOT}" --field guardrail.approvalRouting.externalRef)

errors=0

echo "  Workflow status:         ${final_status}"
echo "  Triage priority:         ${triage_priority}"
echo "  Knowledge eligible:      ${knowledge_eligible}"
echo "  Knowledge status:        ${knowledge_status}"
echo "  Knowledge degraded:      ${knowledge_degraded}"
echo "  Parts eligible:          ${parts_eligible}"
echo "  Parts status:            ${parts_status}"
echo "  Parts degraded:          ${parts_degraded}"
echo "  Parts readiness:         ${parts_readiness}"
echo "  Parts plan count:        ${parts_plan_count}"
echo "  Parts KB cross-check:    ${parts_kb_crosscheck}"
if [[ "${parts_eligible}" != "true" ]]; then
  echo "  Parts eligibility reason: ${parts_eligibility_reason}"
fi

[[ "${final_status}" == "done" || "${final_status}" == "escalated" || "${final_status}" == "rejected" ]] || {
  echo "  FAIL: Expected terminal status done|escalated|rejected, got ${final_status}" >&2
  (( errors++ ))
}
[[ "${triage_priority}" != "absent" && "${triage_priority}" != "null" ]] || {
  echo "  FAIL: Triage priority absent (Node 1 failed?)" >&2
  (( errors++ ))
}
[[ "${knowledge_eligible}" == "true" ]] || {
  echo "  FAIL: Knowledge not eligible (check KNOWLEDGE_ENABLED + RAG_ENABLED)" >&2
  (( errors++ ))
}
[[ "${knowledge_degraded}" == "false" ]] || {
  echo "  WARN: Knowledge degraded — RAG or vector DB may be unavailable"
}
[[ "${knowledge_status}" == "ANSWERED" || "${knowledge_status}" == "NO_SOURCE" ]] || {
  echo "  FAIL: Unexpected knowledge status: ${knowledge_status}" >&2
  (( errors++ ))
}

# Node 6 always runs (no feature flag) — every settled workflow must carry a
# valid composite guardrail decision, proving evaluateGuardrail replaced the
# prototype gate on this deployment.
echo "  Guardrail outcome:       ${guardrail_outcome}"
echo "  Guardrail risk:          ${guardrail_risk_score} (${guardrail_risk_level})"
[[ "${guardrail_outcome}" == "autoApprove" || "${guardrail_outcome}" == "requireHumanApproval" || "${guardrail_outcome}" == "reject" || "${guardrail_outcome}" == "escalate" ]] || {
  echo "  FAIL: Node 6 produced no valid guardrail outcome (got ${guardrail_outcome}); evaluateGuardrail may not be deployed" >&2
  (( errors++ ))
}
[[ "${guardrail_risk_score}" =~ ^[0-9]+$ ]] || {
  echo "  FAIL: Node 6 guardrail risk score missing/non-numeric: ${guardrail_risk_score}" >&2
  (( errors++ ))
}

if [[ "${ASSERT_PARTS_ELIGIBLE}" == "1" ]]; then
  [[ "${parts_eligible}" == "true" ]] || {
    echo "  FAIL: Parts logistics not eligible (check PARTS_ENABLED, OAuth Run As user, perm set, Case asset)" >&2
    (( errors++ ))
  }
  [[ "${parts_status}" == "PLANNED" || "${parts_status}" == "PARTIAL" || "${parts_status}" == "UNAVAILABLE" ]] || {
    echo "  FAIL: Unexpected parts status: ${parts_status}" >&2
    (( errors++ ))
  }
  [[ "${parts_plan_count}" =~ ^[1-9][0-9]*$ ]] || {
    echo "  FAIL: Expected at least one part plan when eligible=true, got ${parts_plan_count}" >&2
    (( errors++ ))
  }
  [[ "${parts_degraded}" == "false" ]] || {
    echo "  WARN: Parts logistics degraded — inventory reads or transit rules may be unavailable"
  }
  # Phase 4b — KB warehouse cross-check (audit-only). Absent only when degraded.
  if [[ "${parts_degraded}" == "false" ]]; then
    [[ "${parts_kb_crosscheck}" == "ALIGNED" || "${parts_kb_crosscheck}" == "DIVERGENT" || "${parts_kb_crosscheck}" == "UNDOCUMENTED" ]] || {
      echo "  FAIL: Unexpected parts KB cross-check status: ${parts_kb_crosscheck}" >&2
      (( errors++ ))
    }
  fi
else
  echo "  Node 4 assertions skipped (ASSERT_PARTS_ELIGIBLE=${ASSERT_PARTS_ELIGIBLE})"
fi

# Phase 4c — gated fulfillment writes (only when explicitly asserted).
if [[ "${ASSERT_PARTS_WRITES}" == "1" ]]; then
  echo "  Parts writes applied:    ${parts_write_applied}"
  [[ "${parts_write_applied}" == "true" ]] || {
    echo "  FAIL: Expected parts fulfillment writes applied (check PARTS_WRITES_ENABLED, approval, perm set, Apex REST)" >&2
    (( errors++ ))
  }
fi

# Phase 5a — Node 5 scheduling (only when explicitly asserted).
if [[ "${ASSERT_SCHEDULING}" == "1" ]]; then
  echo "  Scheduling eligible:     ${scheduling_eligible}"
  echo "  Scheduling status:       ${scheduling_status}"
  echo "  Scheduling readiness:    ${scheduling_readiness}"
  echo "  Scheduling degraded:     ${scheduling_degraded}"
  echo "  Recommended technician:  ${scheduling_technician}"
  echo "  Proposed window:         ${scheduling_window}"
  [[ "${scheduling_eligible}" == "true" ]] || {
    echo "  FAIL: Scheduling not eligible (check SCHEDULING_ENABLED, Run As perm set, 5-Pre seed)" >&2
    (( errors++ ))
  }
  [[ "${scheduling_status}" == "PLANNED" || "${scheduling_status}" == "PROVISIONAL" || "${scheduling_status}" == "DEFERRED" || "${scheduling_status}" == "UNSCHEDULABLE" ]] || {
    echo "  FAIL: Unexpected scheduling status: ${scheduling_status}" >&2
    (( errors++ ))
  }
  [[ "${scheduling_degraded}" == "false" ]] || {
    echo "  WARN: Scheduling degraded — Field Service reads may be unavailable"
  }
  # A non-degraded, schedulable/provisional plan must name a technician.
  if [[ "${scheduling_degraded}" == "false" && ( "${scheduling_status}" == "PLANNED" || "${scheduling_status}" == "PROVISIONAL" ) ]]; then
    [[ "${scheduling_technician}" != "absent" && "${scheduling_technician}" != "null" && -n "${scheduling_technician}" ]] || {
      echo "  FAIL: Expected a recommended technician reference for status ${scheduling_status}" >&2
      (( errors++ ))
    }
  fi

  # Phase 5b — territory-local TZ, duration cross-check, deterministic slot source.
  if [[ "${ASSERT_SCHEDULING_5B:-0}" == "1" ]]; then
    echo "  Scheduling timeZone:       ${scheduling_timezone}"
    echo "  Scheduling slotSource:     ${scheduling_slot_source}"
    echo "  Scheduling durationSource: ${scheduling_duration_source}"
    echo "  Scheduling partsEtaConstr: ${scheduling_parts_eta}"
    echo "  Scheduling candidatesApi:  ${scheduling_candidates_api}"
    [[ "${scheduling_timezone}" == "America/Los_Angeles" ]] || {
      echo "  FAIL: Expected timeZone=America/Los_Angeles (live NA OperatingHours), got ${scheduling_timezone}" >&2
      (( errors++ ))
    }
    [[ "${scheduling_window}" == *"PDT"* || "${scheduling_window}" == *"PST"* ]] || {
      echo "  FAIL: Expected Pacific local label in displayWindow (PDT/PST), got: ${scheduling_window}" >&2
      (( errors++ ))
    }
    [[ "${scheduling_slot_source}" == "deterministic" ]] || {
      echo "  FAIL: Expected slotSource=deterministic, got ${scheduling_slot_source}" >&2
      (( errors++ ))
    }
    [[ "${scheduling_duration_source}" == "worktype" || "${scheduling_duration_source}" == "kb" || "${scheduling_duration_source}" == "default" ]] || {
      echo "  FAIL: Unexpected durationSource: ${scheduling_duration_source}" >&2
      (( errors++ ))
    }
    [[ "${scheduling_candidates_api}" == "false" || "${scheduling_candidates_api}" == "null" ]] || {
      echo "  FAIL: Expected candidatesApiUsed=false (5c seam off), got ${scheduling_candidates_api}" >&2
      (( errors++ ))
    }
    # Display-repair demo Case with PARTIAL parts should be parts-ETA constrained.
    if [[ "${parts_status}" == "PARTIAL" && "${scheduling_status}" == "PROVISIONAL" ]]; then
      [[ "${scheduling_parts_eta}" == "true" ]] || {
        echo "  FAIL: Expected partsEtaConstrained=true for PARTIAL+PROVISIONAL, got ${scheduling_parts_eta}" >&2
        (( errors++ ))
      }
      [[ "${scheduling_technician}" == "SR-A2" ]] || {
        echo "  FAIL: Expected SR-A2 (Display skill) for demo Case, got ${scheduling_technician}" >&2
        (( errors++ ))
      }
    fi
  fi
fi

# Phase 5c — Node 5 gated ServiceAppointment write (only when explicitly asserted).
# Requires an APPROVED Case (requireHumanApproval → approved, NOT escalate) with
# AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED=true and ServiceAppointment create
# on the run-as user. RC-5: the plan must still be schedulable at write time.
if [[ "${ASSERT_SCHEDULING_WRITES}" == "1" ]]; then
  echo "  Scheduling appt status:  ${scheduling_appt_status}"
  echo "  Scheduling appt ref:     ${scheduling_appt_ref}"
  [[ "${guardrail_outcome}" != "escalate" ]] || {
    echo "  FAIL: Case escalated — 5c writes only run on the approved path (use an approvable Case, not one that escalates)" >&2
    (( errors++ ))
  }
  [[ "${scheduling_appt_status}" == "booked" ]] || {
    echo "  FAIL: Expected scheduling.appointmentStatus=booked, got ${scheduling_appt_status} (check WRITES_ENABLED, ServiceAppointment create on run-as, schedulable at write time)" >&2
    (( errors++ ))
  }
  [[ "${scheduling_appt_ref}" != "absent" && "${scheduling_appt_ref}" != "null" && -n "${scheduling_appt_ref}" ]] || {
    echo "  FAIL: Expected a booked appointmentReference (e.g. SA-0007), got ${scheduling_appt_ref}" >&2
    (( errors++ ))
  }
fi

# Phase 6a — Node 6 guardrail demo-case decision (only when explicitly asserted).
# Live Case 00001050 with all five channels often escalates (score 100) because
# customerContext + KB approval flags add to the minimal matrix (~70). Both
# outcomes prove Node 6 is live; only requireHumanApproval exercises HITL resume.
if [[ "${ASSERT_GUARDRAIL}" == "1" ]]; then
  guardrail_triggered_rules=$(echo "${snapshot}" | node -e "
const s = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log((s.guardrail?.policyRulesTriggered ?? []).map((r) => r.ruleId).join(','));
")
  echo "  Guardrail triggered rules: ${guardrail_triggered_rules}"
  if [[ "${guardrail_outcome}" == "requireHumanApproval" ]]; then
    [[ "${resume_attempted}" == "1" ]] || {
      echo "  FAIL: Expected Node 6 to interrupt (waiting_approval) before resume for requireHumanApproval" >&2
      (( errors++ ))
    }
    [[ "${final_status}" == "done" ]] || {
      echo "  FAIL: Expected workflow status=done after resume, got ${final_status}" >&2
      (( errors++ ))
    }
  elif [[ "${guardrail_outcome}" == "escalate" ]]; then
    [[ "${final_status}" == "escalated" ]] || {
      echo "  FAIL: Expected workflow status=escalated for guardrail escalate, got ${final_status}" >&2
      (( errors++ ))
    }
  else
    echo "  FAIL: Expected demo Case guardrail outcome requireHumanApproval or escalate, got ${guardrail_outcome}" >&2
    (( errors++ ))
  fi
  [[ "${guardrail_risk_score}" =~ ^[0-9]+$ && "${guardrail_risk_score}" -ge 70 ]] || {
    echo "  FAIL: Expected demo Case composite risk score >= 70, got ${guardrail_risk_score}" >&2
    (( errors++ ))
  }
  [[ "${guardrail_triggered_rules}" == *"PARTS_PARTIAL"* ]] || {
    echo "  FAIL: Expected PARTS_PARTIAL in triggered rules for demo Case" >&2
    (( errors++ ))
  }
  if [[ "${guardrail_triggered_rules}" != *"PARTS_APPROVAL_REQUIRED"* && "${guardrail_triggered_rules}" != *"SCHEDULING_APPROVAL_REQUIRED"* ]]; then
    echo "  FAIL: Expected PARTS_APPROVAL_REQUIRED or SCHEDULING_APPROVAL_REQUIRED in triggered rules" >&2
    (( errors++ ))
  fi
fi

# Phase 6b — Node 6 approval EMAIL routing (only when explicitly asserted).
# The auto-resume above (step 5) drives the workflow to done via the Bearer
# resume endpoint; the email is sent BEFORE that pause, so the final snapshot
# carries the routing the approver email used. The approve-link click itself is
# manual proof (see header). Use a Case that lands requireHumanApproval.
if [[ "${ASSERT_GUARDRAIL_EMAIL}" == "1" ]]; then
  echo "  Guardrail routing method:  ${guardrail_routing_method}"
  echo "  Guardrail routing sentAt:  ${guardrail_routing_sent_at}"
  [[ "${guardrail_outcome}" == "requireHumanApproval" ]] || {
    echo "  FAIL: Email routing only applies to requireHumanApproval (got ${guardrail_outcome}); pick an approvable Case (not 00001050 escalate / 00001054 autoApprove)" >&2
    (( errors++ ))
  }
  [[ "${resume_attempted}" == "1" ]] || {
    echo "  FAIL: Expected the workflow to pause at waiting_approval (so the email was routed) before resume" >&2
    (( errors++ ))
  }
  [[ "${guardrail_routing_method}" == "email" ]] || {
    echo "  FAIL: Expected guardrail.approvalRouting.method=email (check ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED + token secret + link base + from/to), got ${guardrail_routing_method}" >&2
    (( errors++ ))
  }
  [[ "${guardrail_routing_sent_at}" != "absent" && "${guardrail_routing_sent_at}" != "null" && -n "${guardrail_routing_sent_at}" ]] || {
    echo "  FAIL: Expected guardrail.approvalRouting.sentAt to be set when email routing is on" >&2
    (( errors++ ))
  }
fi

# Node 6 Phase 6b+ — Salesforce Approval Process routing. The submit is
# asserted here; the approver acting in the native SF Approval UI is manual
# proof (see header). Use a Case that lands requireHumanApproval.
if [[ "${ASSERT_GUARDRAIL_SF}" == "1" ]]; then
  echo "  Guardrail routing method:  ${guardrail_routing_method}"
  echo "  Guardrail routing sentAt:  ${guardrail_routing_sent_at}"
  echo "  Guardrail externalRef:     ${guardrail_routing_external_ref}"
  [[ "${guardrail_outcome}" == "requireHumanApproval" ]] || {
    echo "  FAIL: SF approval routing only applies to requireHumanApproval (got ${guardrail_outcome}); pick an approvable Case (not 00001050 escalate / 00001054 autoApprove)" >&2
    (( errors++ ))
  }
  [[ "${resume_attempted}" == "1" ]] || {
    echo "  FAIL: Expected the workflow to pause at waiting_approval (so the SF Approval was submitted) before resume" >&2
    (( errors++ ))
  }
  [[ "${guardrail_routing_method}" == "salesforce_approval" ]] || {
    echo "  FAIL: Expected guardrail.approvalRouting.method=salesforce_approval (check ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED + token secret + SF connection), got ${guardrail_routing_method}" >&2
    (( errors++ ))
  }
  [[ "${guardrail_routing_sent_at}" != "absent" && "${guardrail_routing_sent_at}" != "null" && -n "${guardrail_routing_sent_at}" ]] || {
    echo "  FAIL: Expected guardrail.approvalRouting.sentAt to be set when SF approval routing is on" >&2
    (( errors++ ))
  }
  # externalRef is the ProcessInstance id; absent/empty means the submit
  # degraded (the graph still paused). Warn rather than fail so a degraded
  # submit (e.g. Approval Process not yet active in the org) is visible
  # without masking the routing assertion above.
  if [[ "${guardrail_routing_external_ref}" == "absent" || "${guardrail_routing_external_ref}" == "null" || -z "${guardrail_routing_external_ref}" ]]; then
    echo "  WARN: guardrail.approvalRouting.externalRef is unset — SF submit degraded (Approval Process may not be active/assigned). The workflow still paused; resume via the SF callback or a manual resume." >&2
  fi
fi

if (( errors > 0 )); then
  echo ""
  echo "All-nodes test FAILED with ${errors} error(s)." >&2
  exit 1
fi

echo ""
echo "=== Orchestrator nodes PASSED ==="
echo "  Node 1 (Triage):            priority=${triage_priority}"
echo "  Node 2 (Customer History):  eligible=${knowledge_eligible}"
echo "  Node 3 (Knowledge Base):    status=${knowledge_status}"
echo "  Node 4 (Parts & Logistics): status=${parts_status}, readiness=${parts_readiness}, plans=${parts_plan_count}"
if [[ "${ASSERT_SCHEDULING}" == "1" ]]; then
  echo "  Node 5 (Scheduling):        status=${scheduling_status}, readiness=${scheduling_readiness}, technician=${scheduling_technician}, window=${scheduling_window}"
fi
if [[ "${ASSERT_SCHEDULING_WRITES}" == "1" ]]; then
  echo "  Node 5 (5c write):          appointmentStatus=${scheduling_appt_status}, reference=${scheduling_appt_ref}"
fi
echo "  Node 6 (Guardrail):         outcome=${guardrail_outcome}, risk=${guardrail_risk_score} (${guardrail_risk_level})"
if [[ "${ASSERT_GUARDRAIL_EMAIL}" == "1" ]]; then
  echo "  Node 6 (6b approval email): method=${guardrail_routing_method}, sentAt=${guardrail_routing_sent_at}"
fi
if [[ "${ASSERT_GUARDRAIL_SF}" == "1" ]]; then
  echo "  Node 6 (6b+ SF approval):   method=${guardrail_routing_method}, externalRef=${guardrail_routing_external_ref}"
fi

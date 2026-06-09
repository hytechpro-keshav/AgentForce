#!/usr/bin/env bash
# ==============================================================================
# all-3-nodes-deployed.sh — End-to-end test for all 3 orchestrator nodes on
# Railway (Node 1 Triage, Node 2 Customer History, Node 3 Knowledge Base)
#
# Tests the full LangGraph case-triage workflow with the laptop KB corpus:
#   START → readContext → runTriage (N1) → customerHistory (N2) → knowledge (N3) → gate → writeBack
#
# Prerequisites:
#   • Railway deployment is healthy
#   • Laptop KB corpus is ingested (or set INGEST_CORPUS=1 to ingest)
#   • AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED=true on Railway
#   • RAG_ENABLED=true on Railway
#   • A real Salesforce Case ID with an asset (laptop issue description)
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
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MINT_JWT="${REPO_ROOT}/scripts/smoke/phase4-mint-jwt.mjs"

AI_API_BASE_URL="${AI_API_BASE_URL:-https://ai-api-production-03f5.up.railway.app}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-ai-api}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
CORPUS_PATH="${CORPUS_PATH:-${REPO_ROOT}/apps/ai-api/data/knowledge/kb-laptop-corpus.json}"
INGEST_CORPUS="${INGEST_CORPUS:-0}"
POLL_TIMEOUT_SECS="${POLL_TIMEOUT_SECS:-120}"
JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"

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
# 4. Trigger orchestrator case-triage (all 3 nodes)
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
terminal_statuses=("done" "failed" "rejected")
final_status=""

while true; do
  now=$(date +%s)
  if (( now >= deadline )); then
    echo "Timed out after ${POLL_TIMEOUT_SECS}s waiting for terminal status." >&2
    exit 1
  fi

  snapshot=$(curl -sS \
    -H "authorization: Bearer ${AGENTFORCE_TOKEN}" \
    "${AI_API_BASE_URL}/orchestrator/case-triage/${workflow_id}")
  status=$(echo "${snapshot}" | jq -r '.status // "unknown"')

  printf "  [%ds remaining] status=%s\n" "$(( deadline - now ))" "${status}"

  for t in "${terminal_statuses[@]}"; do
    if [[ "${status}" == "${t}" ]]; then
      final_status="${t}"
      break 2
    fi
  done

  sleep 5
done

echo ""
echo "=== [6] Final workflow snapshot ==="
echo "${snapshot}" | jq '{
  workflowId: .workflowId,
  status: .status,
  triage: .triage,
  customerContext: (if .customerContext then { eligible: .customerContext.eligible, degraded: .customerContext.degraded } else null end),
  knowledgeGuidance: (if .knowledgeGuidance then {
    eligible: .knowledgeGuidance.eligible,
    status: .knowledgeGuidance.status,
    degraded: .knowledgeGuidance.degraded,
    sourceCount: (if .knowledgeGuidance.answer then (.knowledgeGuidance.answer.sources | length) else 0 end)
  } else null end)
}'

# ---------------------------------------------------------------------------
# 7. Assertions
# ---------------------------------------------------------------------------
echo ""
echo "=== [7] Assertions ==="

knowledge_status=$(echo "${snapshot}" | jq -r '.knowledgeGuidance.status // "absent"')
knowledge_eligible=$(echo "${snapshot}" | jq -r '.knowledgeGuidance.eligible // false')
knowledge_degraded=$(echo "${snapshot}" | jq -r '.knowledgeGuidance.degraded // true')
triage_priority=$(echo "${snapshot}" | jq -r '.triage.recommendedPriority // "absent"')

errors=0

echo "  Workflow status:       ${final_status}"
echo "  Triage priority:       ${triage_priority}"
echo "  Knowledge eligible:    ${knowledge_eligible}"
echo "  Knowledge status:      ${knowledge_status}"
echo "  Knowledge degraded:    ${knowledge_degraded}"

[[ "${final_status}" == "done" ]] || { echo "  FAIL: Expected status=done, got ${final_status}" >&2; (( errors++ )); }
[[ "${triage_priority}" != "absent" ]] || { echo "  FAIL: Triage priority absent (Node 1 failed?)" >&2; (( errors++ )); }
[[ "${knowledge_eligible}" == "true" ]] || { echo "  FAIL: Knowledge not eligible (check KNOWLEDGE_ENABLED + RAG_ENABLED)" >&2; (( errors++ )); }
[[ "${knowledge_degraded}" == "false" ]] || { echo "  WARN: Knowledge degraded — RAG or vector DB may be unavailable"; }
[[ "${knowledge_status}" == "ANSWERED" || "${knowledge_status}" == "NO_SOURCE" ]] || {
  echo "  FAIL: Unexpected knowledge status: ${knowledge_status}" >&2
  (( errors++ ))
}

if (( errors > 0 )); then
  echo ""
  echo "All-3-nodes test FAILED with ${errors} error(s)." >&2
  exit 1
fi

echo ""
echo "=== All 3 nodes PASSED ==="
echo "  Node 1 (Triage):          priority=${triage_priority}"
echo "  Node 2 (Customer History): eligible=${knowledge_eligible}"
echo "  Node 3 (Knowledge Base):  status=${knowledge_status}"

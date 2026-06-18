#!/usr/bin/env bash
# Node 6 Guardrail — Railway deploy + E2E smoke (pre-5c gate)
#
# Prerequisites:
#   railway login + active Railway plan (trial upload blocked if expired)
#   Local commit includes 6a (evaluateGuardrail, f307e99+)
#   AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true on ai-api
#   5-Pre validated: ./scripts/sf/node5-pre-validation.sh AgentForce
#
# Usage:
#   ./scripts/deploy/railway-node6-guardrail-e2e.sh
#   SF_CASE_ID=500g500000YpQMnAAN ./scripts/deploy/railway-node6-guardrail-e2e.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SF_CASE_ID="${SF_CASE_ID:-500g500000YpQMnAAN}"

echo "== Node 6 Railway E2E (pre-5c) =="
echo "Case: ${SF_CASE_ID}"

railway whoami >/dev/null 2>&1 || {
  echo "FAIL: railway CLI unauthorized. Run: railway login" >&2
  exit 1
}

echo ""
echo "=== [1] Deploy ai-api (6a evaluateGuardrail) ==="
POLL_MAX_ATTEMPTS=90 POLL_INTERVAL_SEC=15 \
  SERVICE=ai-api MESSAGE="Node 6a evaluateGuardrail composite policy" \
  "${REPO_ROOT}/scripts/deploy/railway-quick-deploy.sh"

echo ""
echo "=== [2] Deploy react-chat-window (Node 6 guardrail card) ==="
POLL_MAX_ATTEMPTS=90 POLL_INTERVAL_SEC=15 \
  SERVICE=react-chat-window MESSAGE="Node 6 guardrail observability card" \
  "${REPO_ROOT}/scripts/deploy/railway-quick-deploy.sh"

echo ""
echo "=== [3] Verify new deployment (not stale 5b-only build) ==="
LATEST_ID=$(railway deployment list --service ai-api --environment production --json 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
LATEST_STATUS=$(railway deployment list --service ai-api --environment production --json 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['status'])")
echo "  ai-api latest: ${LATEST_ID} (${LATEST_STATUS})"
[[ "${LATEST_STATUS}" == "SUCCESS" ]] || {
  echo "FAIL: ai-api deploy not SUCCESS — check Railway dashboard (trial/plan may block upload)" >&2
  exit 1
}

echo ""
echo "=== [4] Orchestrator smoke (Nodes 1–6) ==="
ASSERT_SCHEDULING=1 ASSERT_SCHEDULING_5B=1 ASSERT_GUARDRAIL=1 SF_CASE_ID="${SF_CASE_ID}" \
  "${REPO_ROOT}/scripts/smoke/all-3-nodes-deployed.sh"

echo ""
echo "== Node 6 Railway E2E PASSED =="
echo "UI: https://react-chat-window-production.up.railway.app/orchestration?caseId=${SF_CASE_ID}"
echo "5c gate: proceed with /implement-node5-5c when smoke is green."

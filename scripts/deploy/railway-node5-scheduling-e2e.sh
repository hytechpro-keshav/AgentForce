#!/usr/bin/env bash
# Node 5 Scheduling — Railway deploy + E2E smoke
#
# Prerequisites:
#   railway login   (refresh if Unauthorized)
#   Local tree includes 5a scheduling code (commit 9946094+)
#   Org AgentForce: 5-Pre validated, Run As has Agentforce_Scheduling_Node5
#
# Usage:
#   ./scripts/deploy/railway-node5-scheduling-e2e.sh
#   SF_CASE_ID=500g500000YpQMnAAN ./scripts/deploy/railway-node5-scheduling-e2e.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SF_CASE_ID="${SF_CASE_ID:-500g500000YpQMnAAN}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-ai-api}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"

echo "== Node 5 Railway E2E =="
echo "Case: ${SF_CASE_ID}"

railway whoami >/dev/null 2>&1 || {
  echo "FAIL: railway CLI unauthorized. Run: railway login" >&2
  exit 1
}

echo ""
echo "=== [1] Enable scheduling flag on ${RAILWAY_SERVICE} ==="
railway variable set \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true

echo ""
echo "=== [2] Deploy ai-api (includes 5a code + flag redeploy) ==="
SERVICE=ai-api MESSAGE="Node 5 scheduling 5a + SCHEDULING_ENABLED" \
  "${REPO_ROOT}/scripts/deploy/railway-quick-deploy.sh"

echo ""
echo "=== [3] Deploy react-chat-window (Node 5 UI card) ==="
SERVICE=react-chat-window MESSAGE="Node 5 scheduling observability card" \
  "${REPO_ROOT}/scripts/deploy/railway-quick-deploy.sh"

echo ""
echo "=== [4] 5-Pre validation (local SF CLI) ==="
"${REPO_ROOT}/scripts/sf/node5-pre-validation.sh" AgentForce

echo ""
echo "=== [5] Orchestrator smoke (Nodes 1–5, ASSERT_SCHEDULING=1) ==="
ASSERT_SCHEDULING=1 ASSERT_SCHEDULING_5B=1 SF_CASE_ID="${SF_CASE_ID}" \
  "${REPO_ROOT}/scripts/smoke/all-3-nodes-deployed.sh"

echo ""
echo "== Node 5 Railway E2E PASSED =="
echo "UI: https://react-chat-window-production.up.railway.app/orchestration?caseId=${SF_CASE_ID}"

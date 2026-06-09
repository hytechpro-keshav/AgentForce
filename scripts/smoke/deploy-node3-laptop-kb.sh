#!/usr/bin/env bash
# ==============================================================================
# deploy-node3-laptop-kb.sh — Deploy Node 3 laptop KB changes to Railway and test
#
# Follows Railway skill + phase4 RAG runbook patterns:
#   1. Preflight Railway auth + health
#   2. Set orchestrator knowledge env vars on ai-api
#   3. Deploy current workspace to Railway (railway up)
#   4. Wait for /health/live
#   5. Ingest kb-laptop-corpus.json
#   6. Run Node 3 RAG sanity queries
#   7. Optionally run all-3-nodes orchestrator test when SF_CASE_ID is set
#
# Prerequisites:
#   railway login   (refresh expired token if deploy fails with Unauthorized)
#
# Optional env:
#   RAILWAY_SERVICE=ai-api
#   RAILWAY_ENVIRONMENT=production
#   AI_API_BASE_URL=https://ai-api-production-03f5.up.railway.app
#   SF_CASE_ID=<Salesforce Case Id>   — if set, runs all-3-nodes-deployed.sh
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MINT_JWT="${REPO_ROOT}/scripts/smoke/phase4-mint-jwt.mjs"

RAILWAY_SERVICE="${RAILWAY_SERVICE:-ai-api}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
AI_API_BASE_URL="${AI_API_BASE_URL:-https://ai-api-production-03f5.up.railway.app}"
CORPUS_PATH="${CORPUS_PATH:-${REPO_ROOT}/apps/ai-api/data/knowledge/kb-laptop-corpus.json}"
JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"
RAILWAY_CALLER="${RAILWAY_CALLER:-skill:use-railway@1.2.0}"
RAILWAY_AGENT_SESSION="${RAILWAY_AGENT_SESSION:-deploy-node3-$(date +%s)}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

require_command railway
require_command curl
require_command node
require_command jq

railway_cmd() {
  RAILWAY_CALLER="${RAILWAY_CALLER}" RAILWAY_AGENT_SESSION="${RAILWAY_AGENT_SESSION}" railway "$@"
}

echo ""
echo "=== [1] Railway preflight ==="
if ! railway_cmd whoami --json >/dev/null 2>&1; then
  echo "Railway auth expired. Run: railway login" >&2
  exit 1
fi
echo "Railway authenticated."

echo ""
echo "=== [2] Set Node 3 + RAG env vars on ${RAILWAY_SERVICE}/${RAILWAY_ENVIRONMENT} ==="
railway_cmd variable set \
  AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED=true \
  AI_API_ORCHESTRATOR_KNOWLEDGE_NAMESPACE=customer-self-service \
  AI_API_ORCHESTRATOR_KNOWLEDGE_RETRIEVAL_TOP_K=5 \
  AI_API_ORCHESTRATOR_KNOWLEDGE_SCORE_THRESHOLD=0.60 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
echo "Knowledge env vars staged (deploy skipped)."

if [[ "${SKIP_DEPLOY:-0}" != "1" ]]; then
  echo ""
  echo "=== [3] Deploy to Railway ==="
  (cd "${REPO_ROOT}" && railway_cmd up \
    --service "${RAILWAY_SERVICE}" \
    --environment "${RAILWAY_ENVIRONMENT}" \
    --detach \
    -m "Node 3 laptop KB RAG wiring + corpus alignment")
  echo "Deploy submitted."
else
  echo ""
  echo "=== [3] Deploy skipped (SKIP_DEPLOY=1) ==="
fi

echo ""
echo "=== [4] Wait for health ==="
deadline=$(( $(date +%s) + 300 ))
while true; do
  code=$(curl -sS -o /tmp/node3-deploy-health.json -w '%{http_code}' "${AI_API_BASE_URL}/health/live" || true)
  if [[ "${code}" == "200" ]]; then
    echo "Health OK."
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "Timed out waiting for health (last HTTP ${code})." >&2
    exit 1
  fi
  sleep 10
done

echo ""
echo "=== [5] Mint maintenance JWT via Railway runtime ==="
MAINT_TOKEN=$(cd "${REPO_ROOT}" && railway_cmd run \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  node "${MINT_JWT}" \
    --purpose maintenance \
    --tenant tenant-demo \
    --namespace customer-self-service \
    --ttl-seconds "${JWT_TTL_SECONDS}")
echo "Maintenance JWT minted."

echo ""
echo "=== [6] Ingest laptop KB corpus ==="
AI_API_BASE_URL="${AI_API_BASE_URL}" \
  AI_API_BEARER_TOKEN="${MAINT_TOKEN}" \
  AI_API_RAG_CORPUS="${CORPUS_PATH}" \
  CORPUS_PATH="${CORPUS_PATH}" \
  MAINT_TOKEN="${MAINT_TOKEN}" \
  node - <<'INGEST'
const fs = require("fs");
const https = require("https");
const http = require("http");

const corpusPath = process.env.CORPUS_PATH;
const baseUrl = process.env.AI_API_BASE_URL;
const token = process.env.MAINT_TOKEN;
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const BATCH = 50;

function post(url, body) {
  const parsed = new URL(url);
  const lib = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = lib.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
        "content-length": Buffer.byteLength(data)
      }
    }, (res) => {
      let buf = "";
      res.on("data", (d) => (buf += d));
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  let total = 0;
  for (let i = 0; i < corpus.documents.length; i += BATCH) {
    const batch = corpus.documents.slice(i, i + BATCH);
    const res = await post(baseUrl + "/rag/ingest", {
      namespace: corpus.namespace,
      requestId: corpus.requestId + "-batch-" + Math.floor(i / BATCH),
      documents: batch
    });
    if (res.status !== 200 && res.status !== 201) {
      console.error("Ingest failed:", res.status, res.body);
      process.exit(1);
    }
    total += batch.length;
    console.log("  batch", Math.floor(i / BATCH) + 1, "→", batch.length, "docs (total:", total + ")");
  }
})();
INGEST

echo ""
echo "=== [7] Node 3 RAG sanity (battery not charging) ==="
rag_response=$(curl -sS -X POST "${AI_API_BASE_URL}/agent/knowledge/answer" \
  -H "authorization: Bearer ${MAINT_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"question":"AeroVolt ProBook 15X battery not charging, adapter plugged in but no LED","requestId":"deploy-node3-sanity"}')
echo "${rag_response}" | jq '{answerStatus, sourceCount, sources: [.sources[]? | {sourceId, title}] | .[0:3]}'
rag_status=$(echo "${rag_response}" | jq -r '.answerStatus // "unknown"')
[[ "${rag_status}" == "ANSWERED" ]] || {
  echo "Node 3 RAG sanity FAILED (status=${rag_status})" >&2
  exit 1
}
echo "Node 3 RAG sanity PASSED."

if [[ -n "${SF_CASE_ID:-}" ]]; then
  echo ""
  echo "=== [8] All 3 nodes orchestrator test (SF_CASE_ID=${SF_CASE_ID}) ==="
  SF_CASE_ID="${SF_CASE_ID}" INGEST_CORPUS=0 \
    bash scripts/smoke/all-3-nodes-deployed.sh
else
  echo ""
  echo "=== [8] Orchestrator all-3-nodes test skipped (set SF_CASE_ID to run) ==="
fi

echo ""
echo "=== Deploy + Node 3 test complete ==="

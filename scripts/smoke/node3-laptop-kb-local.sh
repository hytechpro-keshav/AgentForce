#!/usr/bin/env bash
# ==============================================================================
# node3-laptop-kb-local.sh — Local Node 3 (Knowledge Base Agent) test
#
# Tests the new laptop KB corpus (AeroVolt / Quantum products) against the
# Node 3 RAG pipeline locally with real API output.
#
# Prerequisites (start locally before running):
#   npm run ai-api:dev   (with the env vars below set)
#
# Required env vars:
#   AI_API_JWT_SECRET         — same secret as AI_API_JWT_SECRET in your .env
#
# Optional:
#   AI_API_BASE_URL           — defaults to http://localhost:3000
#   SKIP_INGEST               — set to 1 to skip the ingest step
# ==============================================================================
set -euo pipefail

AI_API_BASE_URL="${AI_API_BASE_URL:-http://localhost:3000}"
CORPUS_PATH="${CORPUS_PATH:-apps/ai-api/data/knowledge/kb-laptop-corpus.json}"
SKIP_INGEST="${SKIP_INGEST:-0}"

: "${AI_API_JWT_SECRET:?Set AI_API_JWT_SECRET to the local JWT secret.}"

command -v curl >/dev/null 2>&1 || { echo "Missing: curl" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Missing: node" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "Missing: jq" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Health check
# ---------------------------------------------------------------------------
echo ""
echo "=== [0] Health check at ${AI_API_BASE_URL} ==="
health_code=$(curl -sS -o /tmp/node3-health.out -w '%{http_code}' "${AI_API_BASE_URL}/health/live")
if [[ "${health_code}" != "200" ]]; then
  echo "Health check FAILED (HTTP ${health_code}). Is the server running?" >&2
  echo "Start with: npm run ai-api:dev" >&2
  echo "Env vars needed: RAG_ENABLED=true VECTOR_DB_PROVIDER=memory AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED=true" >&2
  exit 1
fi
echo "Server healthy."

# ---------------------------------------------------------------------------
# 1. Mint JWT with maintenance scopes
# ---------------------------------------------------------------------------
echo ""
echo "=== [1] Minting local JWT (tenant-demo) ==="
MAINT_TOKEN=$(AI_API_JWT_SECRET="${AI_API_JWT_SECRET}" \
  node scripts/smoke/phase4-mint-jwt.mjs \
    --purpose maintenance \
    --tenant tenant-demo \
    --namespace customer-self-service)
echo "JWT minted (${#MAINT_TOKEN} chars)."

# ---------------------------------------------------------------------------
# 2. Ingest laptop KB corpus
# ---------------------------------------------------------------------------
if [[ "${SKIP_INGEST}" != "1" ]]; then
  echo ""
  echo "=== [2] Ingesting laptop KB corpus (${CORPUS_PATH}) ==="
  # Split corpus into 50-document batches (API max is 50 docs per request)
  node - <<'INGEST_SCRIPT'
const fs = require("fs");
const https = require("https");
const http = require("http");

const corpusPath = process.env.CORPUS_PATH || "apps/ai-api/data/knowledge/kb-laptop-corpus.json";
const baseUrl = process.env.AI_API_BASE_URL || "http://localhost:3000";
const token = process.env.MAINT_TOKEN;
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const docs = corpus.documents;
const BATCH = 50;

async function post(url, body) {
  const parsed = new URL(url);
  const lib = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = lib.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + token,
        "content-length": Buffer.byteLength(data)
      }
    }, res => {
      let buf = "";
      res.on("data", d => buf += d);
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  let total = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const payload = {
      namespace: corpus.namespace,
      requestId: corpus.requestId + "-batch-" + Math.floor(i / BATCH),
      documents: batch
    };
    const res = await post(baseUrl + "/rag/ingest", payload);
    if (res.status !== 200 && res.status !== 201) {
      console.error("Ingest FAILED batch", Math.floor(i/BATCH), "HTTP", res.status, res.body);
      process.exit(1);
    }
    total += batch.length;
    console.log("  Batch", Math.floor(i/BATCH)+1, "→", batch.length, "docs ingested (total:", total + ")");
  }
  console.log("Ingest complete. Total articles:", total);
})().catch(err => { console.error(err); process.exit(1); });
INGEST_SCRIPT
else
  echo ""
  echo "=== [2] Ingest skipped (SKIP_INGEST=1) ==="
fi

# ---------------------------------------------------------------------------
# 3. Node 3 RAG queries — laptop issues
# ---------------------------------------------------------------------------
echo ""
echo "=== [3] Node 3 RAG queries (laptop KB) ==="

run_query() {
  local label="$1"
  local question="$2"
  echo ""
  echo "--- Query: ${label} ---"
  echo "Q: ${question}"
  response=$(curl -sS -X POST "${AI_API_BASE_URL}/agent/knowledge/answer" \
    -H "authorization: Bearer ${MAINT_TOKEN}" \
    -H "content-type: application/json" \
    -d "{\"question\":$(printf '%s' "${question}" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8').trim()))"),\"requestId\":\"node3-test-$(date +%s)\"}")

  status=$(echo "${response}" | jq -r '.status // "unknown"')
  echo "Status: ${status}"

  if [[ "${status}" == "ANSWERED" ]]; then
    echo "Answer:"
    echo "${response}" | jq -r '.answer'
    echo ""
    echo "Sources (${status}):"
    echo "${response}" | jq -r '.sources[] | "  - \(.sourceId) → \(.title)"' 2>/dev/null || true
    echo "Latency: $(echo "${response}" | jq -r '.latencyMs // "?"')ms"
  elif [[ "${status}" == "NO_SOURCE" ]]; then
    echo "No matching articles found (expected for out-of-scope queries)."
  else
    echo "RAW response:"
    echo "${response}" | jq '.' 2>/dev/null || echo "${response}"
  fi
}

run_query \
  "Battery not charging — ProBook 15X" \
  "My AeroVolt ProBook 15X battery is not charging even though it is plugged in. The charging LED is off."

run_query \
  "Laptop won't power on — no LEDs" \
  "The AeroVolt ProBook 15X does not power on. No LED lights up when I press the power button."

run_query \
  "Display flickering — ProBook 15X" \
  "My ProBook 15X display is flickering and showing horizontal lines. Screen goes black randomly."

run_query \
  "Overheating and thermal throttling" \
  "Laptop gets very hot and the fan is running at full speed constantly. Performance drops significantly."

run_query \
  "Keyboard keys not working — Stratos Air 13" \
  "Several keys on my AeroVolt Stratos Air 13 keyboard are not responding. The keyboard backlight also stopped working."

run_query \
  "Out-of-scope sanity check — legal advice" \
  "Can you advise me on filing a legal complaint against the manufacturer?"

echo ""
echo "=== Node 3 local test complete ==="

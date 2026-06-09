#!/usr/bin/env bash
set -euo pipefail

: "${AI_API_BASE_URL:?Set AI_API_BASE_URL to the ai-api base URL.}"
: "${AI_API_BEARER_TOKEN:?Set AI_API_BEARER_TOKEN to a JWT with rag:ingest rag:search agentforce:knowledge-rag scopes and a trusted tenant claim.}"

CORPUS_PATH="${AI_API_RAG_CORPUS:-apps/ai-api/data/knowledge/phase4-sample-corpus.json}"
SMOKE_QUESTION="${AI_API_RAG_SMOKE_QUESTION:-What approved troubleshooting can I give for intermittent residential service?}"
SMOKE_REQUEST_ID="${AI_API_RAG_SMOKE_REQUEST_ID:-phase4-rag-smoke-answer}"

doc_count=$(node -e "const c=require('${CORPUS_PATH}'); console.log((c.documents||[]).length)")
if (( doc_count <= 50 )); then
  curl -sS -X POST "${AI_API_BASE_URL%/}/rag/ingest" \
    -H "authorization: Bearer ${AI_API_BEARER_TOKEN}" \
    -H "content-type: application/json" \
    --data-binary "@${CORPUS_PATH}"
  printf '\n'
else
  # API allows max 50 documents per ingest request — batch large corpora.
  AI_API_BASE_URL="${AI_API_BASE_URL}" \
    AI_API_BEARER_TOKEN="${AI_API_BEARER_TOKEN}" \
    CORPUS_PATH="${CORPUS_PATH}" \
    node - <<'INGEST'
const fs = require("fs");
const https = require("https");
const http = require("http");

const corpusPath = process.env.CORPUS_PATH;
const baseUrl = process.env.AI_API_BASE_URL.replace(/\/+$/, "");
const token = process.env.AI_API_BEARER_TOKEN;
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
      requestId: (corpus.requestId || "rag-ingest") + "-batch-" + Math.floor(i / BATCH),
      documents: batch
    });
    if (res.status !== 200 && res.status !== 201) {
      console.error("Ingest failed:", res.status, res.body);
      process.exit(1);
    }
    total += batch.length;
    console.log(JSON.stringify({ batch: Math.floor(i / BATCH) + 1, docs: batch.length, total }));
  }
})();
INGEST
  printf '\n'
fi

curl -sS -X POST "${AI_API_BASE_URL%/}/agent/knowledge/answer" \
  -H "authorization: Bearer ${AI_API_BEARER_TOKEN}" \
  -H "content-type: application/json" \
  -d "$(node -e "console.log(JSON.stringify({question: process.argv[1], requestId: process.argv[2]}))" "${SMOKE_QUESTION}" "${SMOKE_REQUEST_ID}")"

printf '\n'

#!/usr/bin/env bash
set -euo pipefail

: "${AI_API_BASE_URL:?Set AI_API_BASE_URL to the ai-api base URL.}"
: "${AI_API_BEARER_TOKEN:?Set AI_API_BEARER_TOKEN to a JWT with rag:ingest rag:search agentforce:knowledge-rag scopes and a trusted tenant claim.}"

CORPUS_PATH="${AI_API_RAG_CORPUS:-apps/ai-api/data/knowledge/phase4-sample-corpus.json}"

curl -sS -X POST "${AI_API_BASE_URL%/}/rag/ingest" \
  -H "authorization: Bearer ${AI_API_BEARER_TOKEN}" \
  -H "content-type: application/json" \
  --data-binary "@${CORPUS_PATH}"

printf '\n'

curl -sS -X POST "${AI_API_BASE_URL%/}/agent/knowledge/answer" \
  -H "authorization: Bearer ${AI_API_BEARER_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"question":"What approved troubleshooting can I give for intermittent residential service?","requestId":"phase4-rag-smoke-answer"}'

printf '\n'
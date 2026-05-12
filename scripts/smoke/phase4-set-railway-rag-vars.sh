#!/usr/bin/env bash
set -euo pipefail

RAILWAY_SERVICE="${RAILWAY_SERVICE:-ai-api}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
RAG_NAMESPACE="${RAG_DEFAULT_NAMESPACE:-customer-self-service}"
EMBEDDING_MODEL="${OPENAI_EMBEDDING_MODEL:-text-embedding-3-small}"
VECTOR_PROVIDER="${VECTOR_DB_PROVIDER:-qdrant}"
EMBEDDING_PROVIDER="${DEFAULT_EMBEDDING_PROVIDER:-openai}"
QDRANT_COLLECTION="${QDRANT_COLLECTION:-agentforce-knowledge-rag}"
QDRANT_VECTOR_SIZE="${QDRANT_VECTOR_SIZE:-1536}"
QDRANT_DISTANCE="${QDRANT_DISTANCE:-Cosine}"
APPLY="${PHASE4_APPLY:-false}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

require_command railway

if [[ "${APPLY}" != "true" ]]; then
  cat <<EOF
Dry run only. Set PHASE4_APPLY=true to update Railway.

This script will set RAG defaults for Qdrant, optionally set QDRANT_API_KEY from
stdin or a hidden prompt, and only then set RAG_ENABLED=true to trigger the
production redeploy.

Required before apply:
- QDRANT_URL=<Qdrant endpoint, such as Railway private URL>
- QDRANT_COLLECTION=<collection name, default ${QDRANT_COLLECTION}>
- QDRANT_VECTOR_SIZE=<embedding dimensions, default ${QDRANT_VECTOR_SIZE}>
- QDRANT_DISTANCE=<Cosine|Dot|Euclid, default ${QDRANT_DISTANCE}>
EOF
  exit 0
fi

: "${QDRANT_URL:?Set QDRANT_URL to the Qdrant endpoint.}"

if [[ -z "${QDRANT_API_KEY:-}" && "${QDRANT_REQUIRE_API_KEY:-false}" == "true" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "QDRANT_API_KEY: " QDRANT_API_KEY
    printf '\n'
  else
    printf 'Set QDRANT_API_KEY or run interactively for a hidden prompt.\n' >&2
    exit 1
  fi
fi

railway variable set "DEFAULT_EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set "OPENAI_EMBEDDING_MODEL=${EMBEDDING_MODEL}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set "VECTOR_DB_PROVIDER=${VECTOR_PROVIDER}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set "QDRANT_URL=${QDRANT_URL}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set "QDRANT_COLLECTION=${QDRANT_COLLECTION}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set "QDRANT_VECTOR_SIZE=${QDRANT_VECTOR_SIZE}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set "QDRANT_DISTANCE=${QDRANT_DISTANCE}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set "RAG_DEFAULT_NAMESPACE=${RAG_NAMESPACE}" \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set RAG_CHUNK_SIZE=900 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set RAG_CHUNK_OVERLAP=120 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set RAG_TOP_K=4 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set RAG_SCORE_THRESHOLD=0.68 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set EMBEDDING_CACHE_MAX_ITEMS=2048 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set RAG_RATE_LIMIT_WINDOW_MS=60000 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set RAG_RATE_LIMIT_MAX_REQUESTS=60 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null
railway variable set RAG_INGEST_RATE_LIMIT_MAX_REQUESTS=10 \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" \
  --skip-deploys >/dev/null

if [[ -n "${QDRANT_API_KEY:-}" ]]; then
  printf '%s' "${QDRANT_API_KEY}" | railway variable set QDRANT_API_KEY \
    --stdin \
    --service "${RAILWAY_SERVICE}" \
    --environment "${RAILWAY_ENVIRONMENT}" \
    --skip-deploys >/dev/null
  unset QDRANT_API_KEY
fi

railway variable set RAG_ENABLED=true \
  --service "${RAILWAY_SERVICE}" \
  --environment "${RAILWAY_ENVIRONMENT}" >/dev/null

printf 'Phase 4 Qdrant RAG variables set. Railway should start a deployment because RAG_ENABLED was set last.\n'
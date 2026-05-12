#!/usr/bin/env bash
set -euo pipefail

AI_API_BASE_URL="${AI_API_BASE_URL:-https://ai-api-production-03f5.up.railway.app}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-ai-api}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
JWT_TTL_SECONDS="${JWT_TTL_SECONDS:-3600}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

require_command curl
require_command node
require_command railway

health_code="$({ curl -sS -o /tmp/phase4-rag-live-health.out -w '%{http_code}' "${AI_API_BASE_URL%/}/health/live"; } 2>/dev/null)"
if [[ "${health_code}" != "200" ]]; then
  printf 'Expected /health/live HTTP 200, got %s.\n' "${health_code}" >&2
  exit 1
fi

required_names=(
  RAG_ENABLED
  DEFAULT_EMBEDDING_PROVIDER
  OPENAI_EMBEDDING_MODEL
  VECTOR_DB_PROVIDER
  QDRANT_URL
  QDRANT_COLLECTION
  RAG_DEFAULT_NAMESPACE
)

runtime_names="$({ railway run --service "${RAILWAY_SERVICE}" --environment "${RAILWAY_ENVIRONMENT}" sh -c 'env | cut -d= -f1'; } 2>/dev/null)"
missing=()
for name in "${required_names[@]}"; do
  if ! grep -qx "${name}" <<<"${runtime_names}"; then
    missing+=("${name}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Railway runtime is missing required RAG variable names: %s\n' "${missing[*]}" >&2
  printf 'Run scripts/smoke/phase4-set-railway-rag-vars.sh after Qdrant URL/collection setup, then wait for the Railway deployment to become healthy.\n' >&2
  exit 1
fi

runtime_values="$({ railway run --service "${RAILWAY_SERVICE}" --environment "${RAILWAY_ENVIRONMENT}" sh -c 'printf "RAG_ENABLED=%s\nVECTOR_DB_PROVIDER=%s\nDEFAULT_EMBEDDING_PROVIDER=%s\nOPENAI_EMBEDDING_MODEL=%s\n" "${RAG_ENABLED:-}" "${VECTOR_DB_PROVIDER:-}" "${DEFAULT_EMBEDDING_PROVIDER:-}" "${OPENAI_EMBEDDING_MODEL:-}"'; } 2>/dev/null)"
rag_enabled="$(awk -F= '$1 == "RAG_ENABLED" {print $2}' <<<"${runtime_values}")"
vector_provider="$(awk -F= '$1 == "VECTOR_DB_PROVIDER" {print $2}' <<<"${runtime_values}")"
embedding_provider="$(awk -F= '$1 == "DEFAULT_EMBEDDING_PROVIDER" {print $2}' <<<"${runtime_values}")"
embedding_model="$(awk -F= '$1 == "OPENAI_EMBEDDING_MODEL" {print $2}' <<<"${runtime_values}")"

if [[ "${rag_enabled}" != "true" ]]; then
  printf 'Railway RAG_ENABLED is %s, not true. Enable RAG only after OpenAI embedding-model access is confirmed.\n' "${rag_enabled:-<empty>}" >&2
  exit 1
fi

if [[ "${vector_provider}" != "qdrant" ]]; then
  printf 'Expected VECTOR_DB_PROVIDER=qdrant, got %s.\n' "${vector_provider:-<empty>}" >&2
  exit 1
fi

if [[ "${embedding_provider}" != "openai" || -z "${embedding_model}" ]]; then
  printf 'Expected DEFAULT_EMBEDDING_PROVIDER=openai and a non-empty OPENAI_EMBEDDING_MODEL.\n' >&2
  exit 1
fi

maintenance_token="$({ railway run --service "${RAILWAY_SERVICE}" --environment "${RAILWAY_ENVIRONMENT}" node scripts/smoke/phase4-mint-jwt.mjs --purpose maintenance --ttl-seconds "${JWT_TTL_SECONDS}"; } 2>/dev/null)"
if [[ -z "${maintenance_token}" ]]; then
  printf 'Failed to mint maintenance JWT.\n' >&2
  exit 1
fi

AI_API_BASE_URL="${AI_API_BASE_URL}" \
  AI_API_BEARER_TOKEN="${maintenance_token}" \
  scripts/smoke/phase4-rag-ingest-sample.sh

unset maintenance_token
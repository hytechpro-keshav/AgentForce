#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${AI_API_BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"

if [[ -z "${AGENTFORCE_HEALTH_API_KEY:-}" ]]; then
  echo "AGENTFORCE_HEALTH_API_KEY is required to smoke the protected Phase 1 bridge." >&2
  exit 1
fi

LIVE_RESPONSE="$(curl -fsS "${BASE_URL}/health/live")"
RESPONSE="${LIVE_RESPONSE}" node <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "{}");
if (response.status !== "ok" || Object.keys(response).length !== 1) {
  throw new Error("/health/live must return only minimal liveness status.");
}
NODE

UNAUTH_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/health")"
if [[ "${UNAUTH_STATUS}" != "401" ]]; then
  echo "Expected unauthenticated /health to return 401, got ${UNAUTH_STATUS}." >&2
  exit 1
fi

HEALTH_RESPONSE="$(curl -fsS \
  -H "X-Agentforce-Health-Key: ${AGENTFORCE_HEALTH_API_KEY}" \
  "${BASE_URL}/health")"
RESPONSE="${HEALTH_RESPONSE}" node <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "{}");
if (response.status !== "ok") {
  throw new Error("Protected /health did not return ok status.");
}
if (response.salesforceBridge?.phase !== "phase-1-external-bridge") {
  throw new Error("Protected /health is missing the Phase 1 bridge marker.");
}
if (response.salesforceBridge?.namedCredential !== "Agentforce_AI_API") {
  throw new Error("Protected /health is missing the expected Named Credential marker.");
}
if (response.salesforceBridge?.endpoint !== "/health") {
  throw new Error("Protected /health returned the wrong Salesforce bridge endpoint.");
}
if (response.deferredCapabilities?.providerRouting !== "phase-2") {
  throw new Error("Provider routing must remain deferred after Phase 1.");
}
if (response.deferredCapabilities?.rag !== "phase-4") {
  throw new Error("RAG must remain deferred after Phase 1.");
}
if (response.deferredCapabilities?.openWebUi !== "phase-5") {
  throw new Error("Open WebUI must remain deferred after Phase 1.");
}
if (response.deferredCapabilities?.reactChat !== "phase-6") {
  throw new Error("React chat must remain deferred after Phase 1.");
}
NODE

echo "Phase 1 ai-api health smoke passed for ${BASE_URL}."
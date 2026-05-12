#!/usr/bin/env bash
set -euo pipefail

: "${AI_API_BASE_URL:?Set AI_API_BASE_URL to the ai-api base URL.}"
: "${AI_API_BEARER_TOKEN:?Set AI_API_BEARER_TOKEN to the scoped Open WebUI gateway JWT.}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

require_command curl
require_command node

if [[ "${AI_API_BEARER_TOKEN}" == sk-* ]]; then
  printf 'AI_API_BEARER_TOKEN looks like a direct OpenAI key. Use the scoped NestJS Open WebUI gateway JWT instead.\n' >&2
  exit 1
fi

base_url="${AI_API_BASE_URL%/}"

unauth_code="$(curl -sS -o /dev/null -w '%{http_code}' "${base_url}/v1/models")"
if [[ "${unauth_code}" != "401" ]]; then
  printf 'Expected unauthenticated /v1/models to return HTTP 401, got %s.\n' "${unauth_code}" >&2
  exit 1
fi

models_json="$(curl -fsS "${base_url}/v1/models" \
  -H "authorization: Bearer ${AI_API_BEARER_TOKEN}")"

model_id="$(MODELS_JSON="${models_json}" node <<'NODE'
const payload = JSON.parse(process.env.MODELS_JSON ?? "{}");
const models = Array.isArray(payload.data) ? payload.data : [];
const expected = process.env.PHASE5_OPENWEBUI_MODEL ?? "knowledge-rag";
if (models.length !== 1 || models[0]?.id !== expected) {
  throw new Error(
    `/v1/models must return exactly one Open WebUI model (${expected}); got ${models.map((model) => model.id).join(", ") || "none"}`
  );
}
process.stdout.write(models[0].id);
NODE
)"

chat_body="$(PHASE5_MODEL="${model_id}" node <<'NODE'
const body = {
  model: process.env.PHASE5_MODEL,
  user: "phase5-openwebui-smoke",
  stream: false,
  temperature: 0.2,
  max_completion_tokens: 128,
  messages: [
    {
      role: "user",
      content: "Reply with a short internal console smoke-test acknowledgement."
    }
  ]
};
process.stdout.write(JSON.stringify(body));
NODE
)"

chat_json="$(curl -fsS -X POST "${base_url}/v1/chat/completions" \
  -H "authorization: Bearer ${AI_API_BEARER_TOKEN}" \
  -H 'content-type: application/json' \
  -d "${chat_body}")"

CHAT_JSON="${chat_json}" node <<'NODE'
const payload = JSON.parse(process.env.CHAT_JSON ?? "{}");
const content = payload.choices?.[0]?.message?.content;
if (payload.object !== "chat.completion" || typeof content !== "string" || content.length === 0) {
  throw new Error("/v1/chat/completions did not return an OpenAI-shaped completion");
}
NODE

printf 'Phase 5 Open WebUI gateway chat smoke passed for model %s.\n' "${model_id}"

if [[ "${PHASE5_RAG_SMOKE:-false}" == "true" ]]; then
  rag_model="${PHASE5_RAG_MODEL:-knowledge-rag}"
  rag_body="$(PHASE5_RAG_MODEL="${rag_model}" node <<'NODE'
const body = {
  model: process.env.PHASE5_RAG_MODEL,
  user: "phase5-openwebui-rag-smoke",
  stream: false,
  temperature: 0,
  messages: [
    {
      role: "user",
      content: "What approved troubleshooting can I give for intermittent residential service?"
    }
  ]
};
process.stdout.write(JSON.stringify(body));
NODE
)"

  rag_json="$(curl -fsS -X POST "${base_url}/v1/chat/completions" \
    -H "authorization: Bearer ${AI_API_BEARER_TOKEN}" \
    -H 'content-type: application/json' \
    -d "${rag_body}")"

  RAG_JSON="${rag_json}" node <<'NODE'
const payload = JSON.parse(process.env.RAG_JSON ?? "{}");
const content = payload.choices?.[0]?.message?.content ?? "";
if (!content.includes("Sources:") || !content.includes("kb-troubleshoot-intermittent-service-v1")) {
  throw new Error("knowledge-rag response did not include the expected Phase 4 source evidence");
}
NODE

  printf 'Phase 5 Open WebUI gateway RAG smoke passed for model %s.\n' "${rag_model}"
fi

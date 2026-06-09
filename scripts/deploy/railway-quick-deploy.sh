#!/usr/bin/env bash
# Deploy current workspace changes to Railway production.
# Auto-detects target service(s) from git changes, or pass SERVICE= explicitly.
#
# Usage:
#   ./scripts/deploy/railway-quick-deploy.sh
#   SERVICE=react-chat-window ./scripts/deploy/railway-quick-deploy.sh
#   SERVICE=ai-api MESSAGE="Node 3 RAG wiring" ./scripts/deploy/railway-quick-deploy.sh
#   SERVICE=all ./scripts/deploy/railway-quick-deploy.sh
#
# Prerequisites: railway login (refresh if Unauthorized)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
RAILWAY_CALLER="${RAILWAY_CALLER:-skill:railway-quick-deploy@1.0.0}"
RAILWAY_AGENT_SESSION="${RAILWAY_AGENT_SESSION:-quick-deploy-$(date +%s)}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-10}"
POLL_MAX_ATTEMPTS="${POLL_MAX_ATTEMPTS:-30}"

AI_API_URL="${AI_API_BASE_URL:-https://ai-api-production-03f5.up.railway.app}"
CHAT_URL="${REACT_CHAT_URL:-https://react-chat-window-production.up.railway.app}"

service_health_url() {
  case "$1" in
    ai-api) printf '%s/health/live' "${AI_API_URL}" ;;
    react-chat-window) printf '%s/' "${CHAT_URL}" ;;
    *) printf '' ;;
  esac
}

railway_cmd() {
  RAILWAY_CALLER="${RAILWAY_CALLER}" RAILWAY_AGENT_SESSION="${RAILWAY_AGENT_SESSION}" railway "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

collect_changed_paths() {
  {
    git -C "${REPO_ROOT}" diff --name-only HEAD 2>/dev/null || true
    git -C "${REPO_ROOT}" diff --name-only --cached HEAD 2>/dev/null || true
    git -C "${REPO_ROOT}" ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u
}

detect_services() {
  local paths="$1"
  local -a services=()

  if [[ "${paths}" == *"apps/react-chat-window/"* ]]; then
    services+=("react-chat-window")
  fi
  if [[ "${paths}" == *"apps/openwebui/"* ]]; then
    services+=("openwebui")
  fi
  if [[ "${paths}" == *"apps/ai-api/"* ]] \
    || [[ "${paths}" == *"packages/"* ]] \
    || [[ "${paths}" == *"railway.json"* ]] \
    || [[ "${paths}" == *"package.json"* ]] \
    || [[ "${paths}" == *"package-lock.json"* ]]; then
    services+=("ai-api")
  fi

  if ((${#services[@]} == 0)); then
    return 1
  fi

  printf '%s\n' "${services[@]}" | sort -u
}

default_message() {
  local service="$1"
  local summary
  summary="$(git -C "${REPO_ROOT}" diff --stat HEAD -- "apps/${service}/" "apps/ai-api/" 2>/dev/null | tail -1 || true)"
  if [[ -n "${summary}" ]]; then
    printf 'Deploy %s: %s' "${service}" "${summary}"
  else
    printf 'Deploy %s from workspace' "${service}"
  fi
}

latest_deployment_status() {
  local service="$1"
  railway_cmd deployment list \
    --service "${service}" \
    --environment "${RAILWAY_ENVIRONMENT}" \
    --json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['status'])"
}

wait_for_deployment() {
  local service="$1"
  local status="UNKNOWN"

  # Poll the newest deployment only. Matching a stale id from build-log URLs
  # can return REMOVED and loop until timeout even after SUCCESS.
  sleep 3

  for ((attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++)); do
    status="$(latest_deployment_status "${service}")"
    printf '[%s] attempt %s/%s: %s\n' "${service}" "${attempt}" "${POLL_MAX_ATTEMPTS}" "${status}"
    case "${status}" in
      SUCCESS) return 0 ;;
      FAILED | CRASHED) return 1 ;;
    esac
    sleep "${POLL_INTERVAL_SEC}"
  done

  printf 'Timed out waiting for %s (last status: %s)\n' "${service}" "${status}" >&2
  return 1
}

smoke_service() {
  local service="$1"
  local url
  url="$(service_health_url "${service}")"

  if [[ -z "${url}" ]]; then
    printf '[%s] no smoke URL configured; skipping HTTP check\n' "${service}"
    return 0
  fi

  local code
  code="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "${url}" || true)"
  printf '[%s] smoke %s -> HTTP %s\n' "${service}" "${url}" "${code}"
  [[ "${code}" == "200" ]]
}

deploy_service() {
  local service="$1"
  local message="${2:-Deploy ${service} from workspace}"

  printf '\n=== Deploy %s (%s) ===\n' "${service}" "${RAILWAY_ENVIRONMENT}"
  local up_output
  up_output="$(cd "${REPO_ROOT}" && railway_cmd up \
    --service "${service}" \
    --environment "${RAILWAY_ENVIRONMENT}" \
    --detach \
    -m "${message}" 2>&1)"

  printf '%s\n' "${up_output}"

  wait_for_deployment "${service}"
  smoke_service "${service}"
}

main() {
  require_command railway
  require_command curl
  require_command python3

  if ! railway_cmd whoami >/dev/null 2>&1; then
    printf 'Railway auth expired. Run: railway login\n' >&2
    exit 1
  fi

  local -a services=()
  if [[ -n "${SERVICE:-}" ]]; then
    if [[ "${SERVICE}" == "all" ]]; then
      services=(ai-api react-chat-window)
    else
      services=("${SERVICE}")
    fi
  else
    local paths
    paths="$(collect_changed_paths | tr '\n' ' ')"
    services=()
    while IFS= read -r svc; do
      [[ -n "${svc}" ]] && services+=("${svc}")
    done < <(detect_services "${paths}" || true)
    if ((${#services[@]} == 0)); then
      printf 'No deployable changes detected.\n' >&2
      printf 'Changed paths:\n%s\n' "$(collect_changed_paths | sed 's/^/  /')" >&2
      printf 'Set SERVICE=ai-api|react-chat-window|openwebui|all to deploy explicitly.\n' >&2
      exit 1
    fi
  fi

  local message="${MESSAGE:-}"
  local failed=0

  for service in "${services[@]}"; do
    local deploy_message="${message:-$(default_message "${service}")}"
    if ! deploy_service "${service}" "${deploy_message}"; then
      failed=1
    fi
  done

  if ((failed != 0)); then
    exit 1
  fi

  printf '\nAll requested deploys succeeded.\n'
}

main "$@"

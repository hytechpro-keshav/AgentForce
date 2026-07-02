#!/usr/bin/env bash
# Live UAT: stepped console posts agent Case comments only per stage; triage uses LLM summary.
set -euo pipefail

REACT_CHAT_URL="${REACT_CHAT_URL:-https://react-chat-window-production.up.railway.app}"
AI_API_URL="${AI_API_URL:-https://ai-api-production-03f5.up.railway.app}"
SF_ORG="${SF_ORG:-AgentForce}"
SCENARIO_ID="${SCENARIO_ID:-eu-thermal-repair}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

log() { printf '\n==> %s\n' "$*"; }

query_agent_comments() {
  local case_id="$1"
  sf data query --target-org "$SF_ORG" --json --query \
    "SELECT Id, CommentBody, CreatedDate FROM CaseComment WHERE ParentId = '${case_id}' AND IsPublished = false ORDER BY CreatedDate ASC" \
    | python3 -c "
import json,sys
data=json.load(sys.stdin)
rows=data.get('result',{}).get('records',[])
agent=[r for r in rows if 'Agent ' in (r.get('CommentBody') or '')]
print(f'agent_comments={len(agent)} total_comments={len(rows)}')
for r in agent:
    body=(r.get('CommentBody') or '').replace('\n',' ')[:160]
    print(f\"  - {body}\")
"
}

log "1) Create demo Case (scenario=${SCENARIO_ID}) via react-chat BFF"
CREATE_RESP="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "${REACT_CHAT_URL}/api/demo/cases" \
  -H 'content-type: application/json' \
  -d "{\"scenarioId\":\"${SCENARIO_ID}\"}")"
echo "$CREATE_RESP" | python3 -m json.tool | head -20

CASE_ID="$(echo "$CREATE_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['caseId'])")"
CASE_NUMBER="$(echo "$CREATE_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('caseNumber',''))")"
log "CaseId=${CASE_ID} CaseNumber=${CASE_NUMBER}"

log "2) Start stepped workflow (before Run Triage)"
STEPPED_RESP="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "${REACT_CHAT_URL}/api/orchestrator/case/${CASE_ID}/stepped" \
  -H 'content-type: application/json' \
  -d "{\"caseId\":\"${CASE_ID}\",\"caseNumber\":\"${CASE_NUMBER}\"}")"
echo "$STEPPED_RESP" | python3 -m json.tool
WORKFLOW_ID="$(echo "$STEPPED_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['workflowId'])")"
log "WorkflowId=${WORKFLOW_ID}"

sleep 2
log "3) Salesforce Case comments BEFORE Run Triage (expect 0 agent comments)"
query_agent_comments "$CASE_ID"

ORCH_STATUS="$(sf data query --target-org "$SF_ORG" --json --query \
  "SELECT AI_Orchestration_Status__c FROM Case WHERE Id = '${CASE_ID}'" \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['result']['records'][0]; print(r.get('AI_Orchestration_Status__c',''))")"
log "AI_Orchestration_Status__c=${ORCH_STATUS} (expect suppressed)"

log "4) Advance Triage (Run Triage)"
ADVANCE_RESP="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "${REACT_CHAT_URL}/api/orchestrator/${WORKFLOW_ID}/advance" \
  -H 'content-type: application/json' \
  -d '{}')"
echo "$ADVANCE_RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d.get('triage') or {}
print('status:', d.get('status'))
print('node:', d.get('node'))
print('triage.summary:', (t.get('summary') or '')[:200])
print('triage.suggestedNextStep:', (t.get('suggestedNextStep') or '')[:120])
"

sleep 3
log "5) Salesforce Case comments AFTER Run Triage (expect 1 Agent 1 comment with LLM summary)"
query_agent_comments "$CASE_ID"

log "6) Snapshot triage fields from AI API"
curl -sS "${AI_API_URL}/orchestrator/case-triage/${WORKFLOW_ID}" \
  -H "authorization: Bearer $(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "${REACT_CHAT_URL}/api/orchestrator/session" -H 'content-type: application/json' -d '{}' 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("accessToken",""))' 2>/dev/null || echo '')" \
  2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  t=d.get('triage') or {}
  print('api triage.summary:', (t.get('summary') or '')[:200])
except Exception as e:
  print('(skipped direct ai-api read — use stepped advance output above)', e)
" || true

log "Done. Open stepped console: ${REACT_CHAT_URL}/orchestration/stepped?workflowId=${WORKFLOW_ID}"

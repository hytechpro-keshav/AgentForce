# Demo Case Create — Live Proof

> Record Case Ids from manual smoke runs after enabling `DEMO_CASE_CREATE_ENABLED`
> on react-chat-window and ai-api with a paired `AI_API_DEMO_CASE_CREATE_TOKEN`.

## Prerequisites

1. `DEMO_CASE_CREATE_ENABLED=true` on **react-chat-window** and **ai-api**.
2. `AI_API_DEMO_CASE_CREATE_TOKEN` on react-chat-window (raw opaque token).
3. SHA-256 of that token in ai-api `AI_API_AGENTFORCE_BEARERS_JSON` with scope
   `agentforce:demo-case-create`.
4. Salesforce outbound OAuth configured on ai-api (AgentForce org).

## Expected demo flow (stepped console)

1. Open `/demo/case-create` → **Create case & step through**
2. Redirect lands on `/orchestration/stepped?workflowId=wf-…` (not `?caseId=`)
3. **01 Triage** shows RUNNING briefly, then DONE
4. **Run Customer Context** → advance each stage manually through Node 6
5. Guardrail approval scenarios show **amber WAITING** on Node 6

Skill: `.agents/skills/langgraph-stepped-console/SKILL.md`

## Smoke commands

```bash
export REACT_CHAT_URL="https://react-chat-window-production.up.railway.app"

curl -sS -X POST "${REACT_CHAT_URL}/api/demo/cases" \
  -H "content-type: application/json" \
  -d '{"scenarioId":"same-day-battery-fix"}' | jq .

# Response should include steppedWorkflowId and steppedOrchestrationUrl with workflowId=

curl -sS "${REACT_CHAT_URL}/api/orchestrator/<WORKFLOW_ID>" | jq '.status,.node'
```

## Proof log

| Date       | Scenario                     | Case Id            | Workflow Id | Case Number | Stepped status   | Notes                                    |
| ---------- | ---------------------------- | ------------------ | ----------- | ----------- | ---------------- | ---------------------------------------- |
| 2026-06-23 | same-day-battery-fix         | 500g500000cAu34AAC | —           | 00001069    | auto-run only    | Pre-stepped-console; engineering console |
| _pending_  | same-day-battery-fix         |                    | wf-…        |             | awaiting_step    | Post Phase 2c demo bootstrap             |
| _pending_  | manager-approval-mixed-parts |                    | wf-…        |             | waiting_approval | Node 6 amber WAITING on stepped console  |

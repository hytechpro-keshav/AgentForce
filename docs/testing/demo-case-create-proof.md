# Demo Case Create — Live Proof

> Record Case Ids from manual smoke runs after enabling `DEMO_CASE_CREATE_ENABLED`
> on react-chat-window and ai-api with a paired `AI_API_DEMO_CASE_CREATE_TOKEN`.

## Prerequisites

1. `DEMO_CASE_CREATE_ENABLED=true` on **react-chat-window** and **ai-api**.
2. `AI_API_DEMO_CASE_CREATE_TOKEN` on react-chat-window (raw opaque token).
3. SHA-256 of that token in ai-api `AI_API_AGENTFORCE_BEARERS_JSON` with scope
   `agentforce:demo-case-create`.
4. Salesforce outbound OAuth configured on ai-api (AgentForce org).

## Smoke commands

```bash
export REACT_CHAT_URL="https://react-chat-window-production.up.railway.app"

curl -sS -X POST "${REACT_CHAT_URL}/api/demo/cases" \
  -H "content-type: application/json" \
  -d '{"scenarioId":"same-day-battery-fix"}' | jq .

curl -sS "${REACT_CHAT_URL}/api/orchestrator/case/<CASE_ID>" | jq '.status'
```

## Proof log

| Date       | Scenario                     | Case Id            | Case Number | Orchestration status      | Notes                                        |
| ---------- | ---------------------------- | ------------------ | ----------- | ------------------------- | -------------------------------------------- |
| 2026-06-23 | same-day-battery-fix         | 500g500000cAu34AAC | 00001069    | pending (async trigger)   | Post-deploy smoke; catalog path fix redeploy |
| _pending_  | manager-approval-mixed-parts |                    |             | waiting_approval expected |                                              |

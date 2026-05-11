# Phase 1 Health Bridge Smoke

Use this template to capture validation evidence for the Phase 1 bridge only.

## Scope

- Railway liveness: `GET /health/live`.
- Protected bridge health: `GET /health` with `X-Agentforce-Health-Key`.
- Apex bridge action: `AgentforceAiApiHealthCheck`.
- Agentforce action metadata: `Check_AI_API_Health`.
- Published proof agent: `Customer_Self_Service_Agent`.

This smoke does not validate OpenAI, ModelRouter, LangChain, Pinecone, Open WebUI, or React chat.

## Evidence

- Date:
- Environment or Railway deployment:
- Salesforce org alias:
- Named Credential base URL confirmed:
- Backend command summary:
- Apex test summary:
- Agentforce eval or Testing Center summary:
- Result:

## Commands

```bash
npm run ai-api:typecheck
npm run ai-api:test
npm run ai-api:test:e2e
npm run ai-api:build
AI_API_BASE_URL=http://localhost:3000 AGENTFORCE_HEALTH_API_KEY=smoke-key npm run ai-api:smoke:health
sf apex run test --class-names AgentforceAiApiHealthCheckTest --wait 30 --result-format human
```

Org-dependent Agentforce evals should run after metadata deployment, credential setup, and active-agent reactivation when applicable.

The Phase 1 published-agent smoke target is `Customer_Self_Service_Agent`, not the Service/University reference agent.

## Manual Prompts

Use these prompts when you want to validate the published agent manually:

- `Check the AI API health bridge.`
- `Invoke Check AI API Health and tell me the bridgeStatus, healthStatus, and httpStatusCode for the AI API health bridge.`

## Future Retirement

The published `AI_API_Health_Bridge` topic is a Phase 1 runtime-proof surface, not the long-term end-state customer-facing production behavior. Once later phases are complete, remove that topic from the published planner bundle and keep any remaining health checks only in internal ops workflows, smoke coverage, or replacement monitoring surfaces.

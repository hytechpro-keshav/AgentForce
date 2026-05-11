# Phase 1 Health Bridge Smoke

Use this template to capture validation evidence for the Phase 1 bridge only.

## Scope

- Railway liveness: `GET /health/live`.
- Protected bridge health: `GET /health` with `X-Agentforce-Health-Key`.
- Apex bridge action: `AgentforceAiApiHealthCheck`.
- Agentforce action metadata: `Check_AI_API_Health`.

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

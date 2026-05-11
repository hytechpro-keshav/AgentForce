# AgentForce AI API

Phase 1 contains only the NestJS health bridge used to prove Salesforce Agentforce -> Apex -> Named Credential -> Railway NestJS connectivity.

## Local Commands

```bash
npm run ai-api:dev
npm run ai-api:test
npm run ai-api:test:e2e
npm run ai-api:build
AI_API_BASE_URL=http://localhost:3000 AGENTFORCE_HEALTH_API_KEY=smoke-key npm run ai-api:smoke:health
```

## Health Contract

`GET /health/live` returns minimal unauthenticated liveness for Railway health checks.

`GET /health` returns structured service context, the Salesforce bridge path, and explicit deferred phase markers for provider routing, RAG, Open WebUI, and React chat. It requires `X-Agentforce-Health-Key`; production-like deployments fail startup when `AGENTFORCE_HEALTH_API_KEY` is missing.

Set `AGENTFORCE_HEALTH_API_KEY` in Railway and inject the matching header from Salesforce Named Credential / External Credential configuration, not Apex source code.

For Railway, keep the service attached to the monorepo root. The root `railway.json` uses `npm ci`, `npm run ai-api:build`, and `npm run ai-api:start` so deployment uses the root `package-lock.json` and workspace scripts. The Railway health check path is `/health/live`.

Detailed Railway setup is in [../../docs/deployment/railway-ai-api-phase1.md](../../docs/deployment/railway-ai-api-phase1.md).

Phase 1 does not implement model provider routing, OpenAI calls, LangChain, Pinecone, Open WebUI integration, or the React chat window.

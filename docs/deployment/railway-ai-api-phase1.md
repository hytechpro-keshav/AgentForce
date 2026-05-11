# Railway AI API Phase 1

This runbook covers only the Phase 1 health bridge: Salesforce Agentforce -> Apex -> Named Credential / External Credential -> Railway NestJS -> structured health response.

## Railway Service

- Service root: repository root.
- Railway config file: `apps/ai-api/railway.json`.
- Build command: `npm ci && npm run ai-api:build`.
- Start command: `npm run ai-api:start`.
- Liveness path: `GET /health/live`.
- Protected Salesforce bridge path: `GET /health`.

## Environment Variables

Required for production-like Railway deployments:

```text
NODE_ENV=production
AGENTFORCE_HEALTH_API_KEY=<stored in Railway only>
```

Do not add OpenAI, Pinecone, Open WebUI, or React chat secrets for Phase 1.

## Salesforce Credential Setup

Configure the Salesforce credential values manually or through a secure deployment system. Do not commit URLs with secrets or the health key.

1. Create or update the Named Credential developer name `Agentforce_AI_API`.
2. Set the Named Credential base URL to the Railway ai-api service URL.
3. Create or update the External Credential and principal used by the runtime user.
4. Inject `X-Agentforce-Health-Key` with the same value stored in Railway as `AGENTFORCE_HEALTH_API_KEY`.
5. Assign the required credential permission access to the Agentforce runtime user or permission set.

## Smoke Validation

Local or Railway backend smoke:

```bash
AI_API_BASE_URL=https://<railway-service-host> \
AGENTFORCE_HEALTH_API_KEY=<same test value from secure storage> \
npm run ai-api:smoke:health
```

Salesforce validation:

```bash
sf apex run test --class-names AgentforceAiApiHealthCheckTest --wait 30 --result-format human
```

After metadata is deployed and the agent is active, run the Support Operations Phase 1 eval in `agent-eval/support-operations-phase1-health.yaml` or equivalent Testing Center cases.

## Rollback

Rollback the Railway service to the previous deployment if `/health/live` fails or `/health` cannot return a protected Phase 1 response. Revert Salesforce metadata only through the normal deploy path and reactivate any active Agentforce planner bundle after action changes.

# Railway AI API Phase 1

This runbook covers only the Phase 1 health bridge: Salesforce Agentforce -> Apex -> Named Credential / External Credential -> Railway NestJS -> structured health response.

## Railway Service

- Service root: repository root.
- Railway config file: `railway.json` at the repository root.
- Runtime: Node `>=20.17 <23` from the root `package.json` engines field.
- Install command: Railway Nixpacks default `npm ci`.
- Build command: `npm run ai-api:build`.
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

The non-secret Salesforce credential metadata is stored in source:

- `force-app/main/default/namedCredentials/Agentforce_AI_API.namedCredential-meta.xml`
- `force-app/main/default/externalCredentials/Agentforce_AI_API.externalCredential-meta.xml`
- `force-app/main/default/permissionsets/Agentforce_AI_API_Health_Bridge.permissionset-meta.xml`

Deploy these components after the Railway URL is known. If the Railway app URL changes, update the `Url` parameter in the Named Credential metadata before deploying.

```bash
sf project deploy start \
	--target-org AgentForce \
	--source-dir force-app/main/default/namedCredentials/Agentforce_AI_API.namedCredential-meta.xml \
	--source-dir force-app/main/default/externalCredentials/Agentforce_AI_API.externalCredential-meta.xml \
	--source-dir force-app/main/default/permissionsets/Agentforce_AI_API_Health_Bridge.permissionset-meta.xml \
	--test-level NoTestRun \
	--wait 30
```

The health key remains secret and must not be committed. Store the same value in Railway as `AGENTFORCE_HEALTH_API_KEY` and in Salesforce as the encrypted named-principal credential value `AGENTFORCE_HEALTH_API_KEY` for External Credential `Agentforce_AI_API` / principal `Agentforce_AI_API_Principal`.

The custom auth header formula is:

```text
X-Agentforce-Health-Key: {!$Credential.Agentforce_AI_API.AGENTFORCE_HEALTH_API_KEY}
```

Assign permission set `Agentforce_AI_API_Health_Bridge` to the Agentforce runtime user and to any admin or test user that will run the Apex bridge manually.

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

After metadata is deployed and the agent is active, run the `Agentforce_Service_Agent` Phase 1 eval in `agent-eval/support-operations-phase1-health.yaml` or equivalent Testing Center cases.

## Rollback

Rollback the Railway service to the previous deployment if `/health/live` fails or `/health` cannot return a protected Phase 1 response. Revert Salesforce metadata only through the normal deploy path and reactivate any active Agentforce planner bundle after action changes.

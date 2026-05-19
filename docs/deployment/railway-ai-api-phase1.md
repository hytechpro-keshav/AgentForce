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

For a Phase 1-only deployment, do not add OpenAI, Pinecone, Open WebUI, or React chat secrets.

## Phase 2 Railway Variables

The current Railway service can run the Phase 2 backend foundation once the same deployed app has these additional variables. Store every secret in Railway; do not commit `.env` files or raw token values.

Required for Phase 2 production-like traffic:

```text
NODE_ENV=production
AGENTFORCE_HEALTH_API_KEY=<same secret used by the Salesforce External Credential>
LLM_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=<Railway secret>
OPENAI_DEFAULT_MODEL=gpt-4o-mini
AI_API_JWT_SECRET=<Railway secret>
AI_API_JWT_ISSUER=salesforce-agentforce
AI_API_JWT_AUDIENCE=agentforce-ai-api
```

Use a model that the configured OpenAI project can access. On 2026-05-11, the deployed project returned `model_not_found` for `gpt-4.1-mini`, so production was set to `gpt-4o-mini` and the Phase 2 Agentforce proof passed with that model.

Optional provider fallback or future self-hosted/custom model path:

```text
LLM_FALLBACK_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=https://<custom-openai-compatible-host>/v1
OPENAI_COMPAT_API_KEY=<Railway secret if required by that host>
OPENAI_COMPAT_DEFAULT_MODEL=<custom-model-id>
```

Do not set `AI_API_AUTH_DISABLED=true` in Railway production. That flag is only for local development or explicit test environments.

Phase 2 telemetry now emits token totals and estimated USD cost-reference fields for known priced models such as `gpt-4o-mini`. These values are safe structured observability fields in Railway logs, not billing-system truth.

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

After metadata is deployed and the agent is active, run the `Customer_Self_Service_Agent` Phase 1 eval in `agent-eval/customer-self-service-phase1-health.yaml` or equivalent Testing Center cases.

Recommended manual prompts for the published agent:

- `Check the AI API health bridge.`
- `Invoke Check AI API Health and tell me the bridgeStatus, healthStatus, and httpStatusCode for the AI API health bridge.`

This published planner topic exists to prove the narrow Phase 1 bridge in a real runtime. When later production phases are live, remove `AI_API_Health_Bridge` and its planner-local action from the customer-facing planner bundle, but keep the underlying health bridge implementation or move it to an ops-only surface until replacement monitoring exists.

Phase 2 and Phase 3 backend routes can be smoke-tested directly with a JWT after the Railway variables above are present. The first through-Agentforce Phase 2 path is `/agent/support/triage-case`, called by `Triage Support Case` through `Agentforce_AI_API_Phase2`; runtime proof is captured in `docs/testing/phase2-agentforce-support-triage-proof.md`. The first Phase 3 path is `/agent/support/analyze-case`, called by `Analyze Support Case` through the same Named Credential; runtime proof is captured in `docs/testing/phase3-agentforce-case-analysis-proof.md`.

## Phase 2 Support Triage Credential Setup

The first through-Agentforce Phase 2 path uses a separate credential from the Phase 1 health bridge.

Non-secret metadata in source:

- `force-app/main/default/namedCredentials/Agentforce_AI_API_Phase2.namedCredential-meta.xml`
- `force-app/main/default/externalCredentials/Agentforce_AI_API_Phase2.externalCredential-meta.xml`
- `force-app/main/default/genAiFunctions/Triage_Support_Case/`
- `force-app/main/default/classes/AgentforceAiApiSupportTriage.cls`

The External Credential header formula is:

```text
Authorization: Bearer {!$Credential.Agentforce_AI_API_Phase2.AI_API_PHASE2_BEARER_JWT}
```

Store the encrypted value `AI_API_PHASE2_BEARER_JWT` for External Credential `Agentforce_AI_API_Phase2` / principal `Agentforce_AI_API_Phase2_Principal` through Salesforce REST resource `/services/data/v66.0/named-credentials/credential`. Do not use `/services/data/v66.0/connect/named-credentials/credential`; that path returns 404 in this org.

The original Phase 2 JWT claims were:

```text
sub=salesforce-agentforce
scope=agentforce:support-triage
iss=salesforce-agentforce
aud=agentforce-ai-api
alg=HS256
```

Phase 3 reuses the same External Credential and stores a combined-scope JWT:

```text
sub=salesforce-agentforce
scope=agentforce:support-triage agentforce:case-analysis
iss=salesforce-agentforce
aud=agentforce-ai-api
alg=HS256
```

Mint the token from Railway `AI_API_JWT_SECRET` and pipe it directly into Salesforce secure credential storage. Do not print the token, commit it, or put it in Apex source. Use `POST /services/data/v66.0/named-credentials/credential` for the first credential value, and `PUT /services/data/v66.0/named-credentials/credential` when overwriting an existing principal value. After storing the credential, validate with a direct Apex smoke and then through `Customer_Self_Service_Agent` preview.

For live Agentforce runtime connectivity, prefer an opaque service bearer token
over a static short-lived JWT. The existing header formula can stay the same,
but the encrypted Salesforce value contains a high-entropy opaque token rather
than a JWT. Configure Railway with only the token hash and trusted principal
claims:

```text
AI_API_AGENTFORCE_BEARER_TOKEN_SHA256=<sha256-of-salesforce-runtime-token>
AI_API_AGENTFORCE_BEARER_SUBJECT=salesforce-agentforce
AI_API_AGENTFORCE_BEARER_TENANT=tenant-demo
AI_API_AGENTFORCE_BEARER_RAG_NAMESPACE=customer-self-service
AI_API_AGENTFORCE_BEARER_SCOPES=agentforce:support-triage agentforce:case-analysis agentforce:knowledge-rag agentforce:services-project-health
AI_API_AGENTFORCE_BEARER_ROLES=support-agent
```

Short-lived JWTs remain appropriate for maintenance and direct smoke tests.
They are not a durable live runtime credential when stored as a static Custom
External Credential value because Salesforce does not refresh custom bearer
header values automatically.

Phase 2 proof artifacts are recorded in `docs/testing/phase2-agentforce-support-triage-proof.md`.

Phase 3 proof artifacts are recorded in `docs/testing/phase3-agentforce-case-analysis-proof.md`.

## Rollback

Rollback the Railway service to the previous deployment if `/health/live` fails or `/health` cannot return a protected Phase 1 response. Revert Salesforce metadata only through the normal deploy path and reactivate any active Agentforce planner bundle after action changes.

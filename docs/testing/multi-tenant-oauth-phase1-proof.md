# Multi-Tenant OAuth Phase 1 Proof

Date: 2026-05-19
Branch: `feature/multi-tenant-oauth-onboarding`
Plan: [Multi-Tenant Salesforce OAuth Onboarding Plan](../deployment/multi-tenant-oauth-onboarding-plan.md)

## Scope

Phase 1 adds a config-backed OAuth 2.0 client-credentials token issuer for Salesforce org onboarding while preserving existing static JWT and opaque service-bearer auth paths.

Implemented pieces:

- `POST /oauth/token` public token endpoint.
- Config-backed OAuth clients through `AI_API_OAUTH_CLIENTS_JSON`.
- Short-lived access tokens signed with `AI_API_JWT_SECRET`.
- Trusted token claims for tenant, Salesforce org id, scopes, roles, and RAG namespace.
- Existing `JwtAuthGuard` continues enforcing route scopes on issued access tokens.
- Backward compatibility with existing Agentforce static bearer/JWT route auth.

## Local Test Evidence

### Unit Tests

Command:

```bash
npm --workspace @agentforce/ai-api run test -- oauth-token.service app-config.service
```

Result:

- Passed.
- 2 test suites passed.
- 42 tests passed.

Coverage focus:

- Valid client credentials receive a scoped token.
- Invalid client secret returns `401`.
- Suspended clients fail closed.
- Requested scopes must be a subset of allowed scopes.
- Missing signing secret returns `503`.
- OAuth client config requires SHA-256 secret digests.
- OAuth token TTL must be 300 to 3600 seconds.

### E2E Tests

Command:

```bash
npm --workspace @agentforce/ai-api run test:e2e -- chat.e2e-spec.ts
```

Result:

- Passed.
- 40 tests passed.

Coverage focus:

- `POST /oauth/token` issues a scoped token for a configured Salesforce client.
- Invalid OAuth client credentials return `401`.
- OAuth-issued token with `agentforce:services-project-health` can call `POST /agent/services/project-health`.
- OAuth-issued token without project-health scope receives `403`.
- Existing chat, OpenAI-compatible, support triage, case analysis, RAG, and project-health e2e checks still pass.

### Typecheck And Build

Commands:

```bash
npm run ai-api:typecheck
npm run ai-api:build
```

Result:

- Typecheck passed.
- Build passed.

## Deployment Smoke Evidence

Status: passed for direct deployed API smoke.

Railway service:

- Project: `agentforce-ai-api`
- Environment: `production`
- Service: `ai-api`
- Code deployment id: `7aa92805-7876-4d1f-9fed-86e6fc7f3501`
- OAuth smoke-client variable deployment id: `8eb88570-a176-4bfb-8da9-8272e54fcbcf`

Health check:

- Endpoint: `GET https://ai-api-production-03f5.up.railway.app/health/live`
- Result: HTTP `200`, body `{"status":"ok"}`.

OAuth client setup:

- Temporary smoke client id: `phase1-oauth-smoke`.
- Tenant: `certinia-phase8`.
- Stored Railway value: SHA-256 digest only through `AI_API_OAUTH_CLIENTS_JSON`.
- Raw smoke secret: generated into a local `/tmp` file for the smoke run only.
- Token TTL: `900` seconds through `AI_API_OAUTH_ACCESS_TOKEN_TTL_SECONDS`.

Positive direct API smoke:

- Token request: `POST /oauth/token` with `grant_type=client_credentials` and
  scope `agentforce:services-project-health`.
- Token result: HTTP `201`, `token_type=Bearer`, `expires_in=900`,
  `access_token` present.
- Protected route: `POST /agent/services/project-health` with a sanitized
  aggregate payload.
- Protected route result: HTTP `201`.
- Safe response fields: `healthStatus=red`, `riskLevel=critical`,
  `scheduleStatus=red`, `budgetStatus=red`, `staffingStatus=red`,
  `provider=openai`, `model=gpt-4o-mini`, `latencyMs=4756`.

Negative direct API smoke:

- Token request: `POST /oauth/token` with scope `agentforce:support-triage`.
- Token result: HTTP `201`.
- Protected route attempted: `POST /agent/services/project-health`.
- Protected route result: HTTP `403` with safe message
  `Bearer token is missing a required scope.`

Smoke credential cleanup:

- Temporary smoke client was revoked after proof by replacing
  `AI_API_OAUTH_CLIENTS_JSON` with an empty array.
- Cleanup deployment id: `8d8805a2-71a9-4c80-8735-72275e2016b2`.
- Final Railway status: `SUCCESS`, `stopped=false`.
- Final health check: HTTP `200` from `/health/live`.

Required proof:

- Complete.

## Salesforce Connectivity Evidence

Status: pending.

Phase 1 proved the deployed OAuth issuer and resource-server scope enforcement
directly against Railway. Salesforce OAuth External Credential packaging is not
yet implemented in this branch; it is planned in Phase 3. Until that metadata is
added, Salesforce orgs continue to use the existing static bearer/JWT Named
Credential path as the rollout fallback.

Required proof:

- Target Salesforce org alias.
- External Credential / Named Credential strategy used for OAuth token request.
- Apex smoke action or anonymous Apex call through Named Credential.
- HTTP status and safe response summary.
- Confirmation that no raw OAuth client secret, access token, Authorization header, prompt, or PII was logged.

## Phase 1 Exit Gate

Current status: local tests and direct deployed API smoke passed; Salesforce
OAuth Named Credential connectivity is pending Phase 3 metadata/setup work.

Phase 1 server-side OAuth foundation is ready for Phase 2 tenant-registry work.
Do not promote OAuth as the default customer onboarding path until Phase 3
Salesforce External Credential connectivity passes.

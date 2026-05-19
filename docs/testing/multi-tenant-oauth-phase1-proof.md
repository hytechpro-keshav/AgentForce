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

Status: pending.

Required proof:

- Railway deployment id.
- `GET /health/live` returns `200` after deployment.
- A deployed OAuth client can request `POST /oauth/token` without printing raw secrets.
- The returned access token can call a protected deployed route with the expected scope.
- A token missing route scope receives `403`.

## Salesforce Connectivity Evidence

Status: pending.

Required proof:

- Target Salesforce org alias.
- External Credential / Named Credential strategy used for OAuth token request.
- Apex smoke action or anonymous Apex call through Named Credential.
- HTTP status and safe response summary.
- Confirmation that no raw OAuth client secret, access token, Authorization header, prompt, or PII was logged.

## Phase 1 Exit Gate

Current status: local tests passed; deployment and Salesforce connectivity are pending.

Phase 1 is complete only after deployed direct smoke and Salesforce Named Credential connectivity smoke pass.

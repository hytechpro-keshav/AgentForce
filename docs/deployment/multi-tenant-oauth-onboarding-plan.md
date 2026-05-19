# Multi-Tenant Salesforce OAuth Onboarding Plan

Date: 2026-05-19
Branch: `feature/multi-tenant-oauth-onboarding`

## Purpose

Move Agentforce-to-NestJS authentication from static per-org bearer/JWT setup to a plug-and-play multi-tenant OAuth integration model. Each Salesforce org is represented as a tenant, authenticates to the AI API with short-lived OAuth access tokens, and receives only the scopes, model routing, RAG namespace, and rate limits assigned to that tenant.

This plan keeps the current runtime boundary:

```text
Agentforce -> Apex -> Named Credential / External Credential -> NestJS AI API -> ModelRouter / RAG / telemetry
```

The backend remains the external AI orchestration layer. Salesforce remains the system of record and should continue gathering Salesforce-side facts through Apex unless a later approved phase adds backend-to-Salesforce data access.

## Target Experience

A customer admin should be able to connect a Salesforce org with minimal manual work:

1. Install or deploy the integration package/metadata.
2. Create or select the tenant in the provider portal.
3. Register the Salesforce org as an OAuth client.
4. Store OAuth client credentials in Salesforce External Credential secure storage.
5. Run a smoke test from Salesforce through the Named Credential.
6. Enable the approved Agentforce actions for that tenant.

No customer org should require Railway environment-variable edits or manually minted long-lived JWTs.

For the repeatable operator workflow, use
`docs/deployment/new-org-tenant-onboarding.md` and the workspace
`Tenant Onboarding Operator` custom agent.

## Current Baseline

The existing AI API supports two proof-era auth paths:

- HS256 JWTs signed with `AI_API_JWT_SECRET`.
- Hash-validated opaque Agentforce service bearers configured through `AI_API_AGENTFORCE_BEARER_TOKEN_SHA256` or `AI_API_AGENTFORCE_BEARERS_JSON`.

Those paths are useful for controlled proofs, but they do not scale operationally because onboarding and rotation are tied to deploy-time configuration.

## Design Principles

- Tenant identity is trusted only from verified access tokens, never from request bodies.
- Each Salesforce org receives a distinct tenant id and OAuth client identity.
- Access tokens are short lived and scoped.
- Secrets are stored only as hashes or encrypted values.
- Token issuance, tenant status, scopes, rate limits, and model policy are data-driven.
- Existing Agentforce Apex actions should keep using Named Credentials.
- Existing static bearer/JWT behavior remains temporarily available for backward compatibility during rollout.
- Every phase needs local tests, direct API smoke tests, and Salesforce connectivity validation before moving forward.

## Tenant Model

Minimum tenant record:

```text
tenantId
salesforceOrgId
salesforceInstanceUrl
status: active | suspended | revoked
allowedScopes
ragNamespace
modelRoutingProfile
rateLimitProfile
createdAt
updatedAt
```

Minimum OAuth client record:

```text
clientId
tenantId
clientSecretHash or publicKeyThumbprint
allowedScopes
status: active | rotating | revoked
lastUsedAt
createdAt
updatedAt
```

Phase 1 may use config-backed records for speed. Phase 2 must introduce durable storage before production onboarding.

## Phase 1 - OAuth Token Issuer Foundation

Goal: Add a NestJS OAuth-compatible token endpoint and resource-server verification path while preserving the existing static auth routes.

Implementation tasks:

1. Add an `oauth` module in `apps/ai-api/src/auth` or a sibling auth-owned folder.
2. Add DTO validation for `grant_type=client_credentials`, `client_id`, `client_secret`, and `scope`.
3. Add a config-backed tenant/client registry for local and first deployment use.
4. Store only client secret hashes in configuration.
5. Issue short-lived JWT access tokens with claims for `sub`, `tenant`, `sf_org_id`, `scope`, `roles`, `rag_namespace`, `iss`, `aud`, `iat`, and `exp`.
6. Update `JwtAuthGuard` only as needed so OAuth-issued access tokens are accepted by existing scoped routes.
7. Add safe telemetry/audit records for token success/failure without logging secrets.
8. Document environment variables and local smoke commands.

Phase 1 test plan:

- Unit: valid client credentials receive a token with expected claims.
- Unit: invalid client secret returns `401`.
- Unit: unknown, suspended, or revoked clients fail closed.
- Unit: requested scopes must be a subset of allowed client/tenant scopes.
- Unit: no raw client secret is logged or returned.
- E2E: `POST /oauth/token` returns a short-lived bearer token.
- E2E: token can call `POST /agent/services/project-health` with `agentforce:services-project-health`.
- E2E: token without required scope receives `403`.
- Direct deployment smoke: deploy AI API, request token from deployed `/oauth/token`, use it against deployed project-health endpoint with sanitized sample payload.
- Salesforce connectivity smoke: configure a test External Credential with the OAuth client, call an Apex smoke action through the Named Credential, and confirm HTTP 2xx or the expected provider response.

Exit gate:

- Focused backend tests pass.
- Build passes.
- Direct deployed token smoke passes.
- Salesforce Named Credential smoke passes in at least one org.
- Existing static bearer/JWT route remains compatible for current orgs.

Rollback:

- Disable OAuth clients by status or unset OAuth client config.
- Revert Salesforce Named Credential to the prior static bearer External Credential if needed.
- Existing static bearer/JWT route remains the fallback during Phase 1.

## Phase 2 - Durable Tenant Registry And Rotation

Goal: Move tenant/client state out of environment variables into durable storage and add rotation controls.

Status on 2026-05-19: backend Phase 2 is implemented and deployed with Railway Postgres. Direct deployed API smoke passed for two Postgres-backed tenants, including scope rejection, tenant suspension, already-minted token blocking, tenant isolation, and audit readback. See `docs/testing/multi-tenant-oauth-phase2-proof.md`. Salesforce OAuth External Credential setup for two orgs remains in Phase 3.

Implementation tasks:

1. Add database-backed tenant and OAuth client persistence.
2. Add repository/service abstractions so tests can use in-memory storage.
3. Add secret hashing with a strong KDF or HMAC strategy approved for service credentials.
4. Add client rotation state: active credential plus pending replacement.
5. Add tenant status enforcement in auth guard and token issuer.
6. Add admin CLI or protected admin endpoint for registering tenants and clients.
7. Add tenant-aware rate-limit defaults and model-routing profile lookup.
8. Add audit events for client creation, rotation, revocation, token issuance, and denied token requests.

Phase 2 test plan:

- Unit: tenant and client repositories enforce status and uniqueness.
- Unit: secret verification is constant-time where practical.
- Unit: rotated clients allow the active secret and reject revoked secrets.
- E2E: create tenant/client, request token, call protected route.
- E2E: suspended tenant cannot mint or use tokens.
- E2E: revoked client cannot mint tokens.
- Data migration test: existing env-backed proof config can be represented in durable registry records.
- Deployment smoke: onboard two Salesforce orgs without Railway env edits.
- Salesforce connectivity smoke: both orgs authenticate independently and receive distinct tenant claims.

Exit gate:

- Two real Salesforce orgs can call the same AI API service with separate tenant identities.
- Revoking one org does not affect the other.
- RAG and telemetry tenant fields stay isolated.

Rollback:

- Keep Phase 1 config-backed registry available behind a flag until durable storage is proven.
- Re-enable static service bearer for any critical org while investigating durable registry issues.

## Phase 3 - Salesforce Plug-And-Play Package And Setup Wizard

Goal: Make onboarding repeatable for customer orgs with minimal manual Salesforce setup.

Status on 2026-05-19: backend setup support is implemented and deployed with a protected `tenant:admin` setup endpoint, Salesforce onboarding guide, secure credential mapping, response-shape tests, e2e route coverage, and direct Railway setup/report smoke. See `docs/deployment/salesforce-oauth-onboarding-phase3.md` and `docs/testing/multi-tenant-oauth-phase3-proof.md`. Final Salesforce sandbox OAuth External Credential smoke still requires secure per-org credential entry outside source control.

Implementation tasks:

1. Create or document a deployable Salesforce metadata package for OAuth External Credential, Named Credential, permission set, Apex actions, and Agentforce function bindings.
2. Add a setup guide that maps OAuth client fields to External Credential secure values.
3. Add a validation Apex action or admin-only smoke flow that checks token issuance and a protected endpoint.
4. Add portal/setup API support for generating per-org setup instructions.
5. Add customer-safe error mapping for auth failures: unknown client, invalid secret, missing scope, suspended tenant.
6. Add onboarding checklist and rollback instructions for customer admins.

Phase 3 test plan:

- Salesforce deploy validation for the package/metadata.
- Apex tests for auth smoke action and existing Agentforce actions.
- Manual setup test in one sandbox org from clean metadata.
- Repeat setup test in a second org to confirm no shared secret/tenant leakage.
- Agentforce preview test for at least one protected action per enabled product.
- Negative test: remove required scope and confirm clear failure.

Exit gate:

- New org can be onboarded from documentation/package without editing backend env vars.
- Smoke action proves Salesforce -> OAuth token -> protected AI API route.
- Agentforce action works in the onboarded org.

Rollback:

- Disable the OAuth client in tenant registry.
- Remove or deactivate the Salesforce permission set/action package.
- Revert Named Credential to a prior known-good credential only for that org.

## Phase 4 - SaaS Controls, Observability, And Production Readiness

Goal: Add the controls needed to operate many customer orgs safely.

Status on 2026-05-19: API/CLI SaaS controls are implemented and deployed for tenant reports, readiness/alerts, durable OAuth token quotas, rotation due dates, policy metadata, quota rejection auditing, and direct Railway quota smoke. See `docs/deployment/multi-tenant-saas-controls-phase4.md` and `docs/testing/multi-tenant-oauth-phase4-proof.md`. Cost-limit enforcement is stored as policy and ready for telemetry rollup enforcement after model usage/cost aggregation is connected.

Implementation tasks:

1. Add tenant dashboards or CLI reports for status, token usage, routes, provider/model usage, latency, errors, and cost references.
2. Add per-tenant quotas and spend limits that survive process restarts.
3. Add tenant-aware model routing policy and RAG namespace policy.
4. Add automated key rotation reminders and stale-client detection.
5. Add alerting for auth failures, token spikes, tenant suspension, provider failures, and abnormal cost.
6. Add security review artifacts for token handling, secret storage, audit logs, and tenant isolation.
7. Add release gates and UAT checklist for onboarding production customer orgs.

Phase 4 test plan:

- Unit: quota enforcement by tenant and route.
- Unit: model routing is selected from tenant policy.
- Unit: tenant suspension blocks token minting and resource access.
- Integration: usage/cost telemetry is emitted with tenant id and no raw prompts/secrets.
- Integration: auth failure metrics distinguish invalid client, invalid secret, missing scope, and suspended tenant.
- Load smoke: multiple tenants request tokens and call protected routes within configured limits.
- Production rehearsal: onboard, rotate, suspend, reactivate, and revoke a test tenant.

Exit gate:

- Security review complete.
- Release checklist complete.
- Tenant onboarding and revocation are documented and tested.
- Observability can answer: who called, which tenant, which route, which model, how many tokens, how much cost reference, and what outcome, without exposing secrets or raw sensitive prompts.

Rollback:

- Tenant-level kill switch.
- Route-level feature flags.
- Restore previous model-routing profile.
- Disable new onboarding while preserving existing active tenants.

## Deployment And Connectivity Discipline

Each implementation phase must follow this sequence:

1. Implement focused code changes on the feature branch.
2. Run focused unit/e2e tests for touched modules.
3. Run `npm run ai-api:build`.
4. Deploy to the target Railway AI API environment only after local tests pass.
5. Run direct deployed smoke tests with no secrets printed to logs.
6. Run Salesforce Named Credential/Apex smoke from the target org.
7. Record proof in the relevant docs before beginning the next phase.

## Open Decisions

- Durable store for tenant registry: PostgreSQL, Railway Postgres, or another managed database.
- OAuth client authentication method: client secret first, private key JWT next, or both.
- Whether tenant admin APIs are internal-only CLI endpoints or backed by a portal UI.
- Whether Salesforce package is unlocked package, managed package, or metadata deployment bundle for the first customer pilots.
- Production issuer/audience values and custom domain for the AI API.

## Phase 1 Working Assumptions

- Keep existing `JwtAuthGuard` and route scopes.
- Add OAuth token issuance with HS256 initially using existing signing config, then prepare RS256/private-key support as a later hardening path.
- Use config-backed tenant/client records only for Phase 1.
- Do not remove `AI_API_AGENTFORCE_BEARERS_JSON` yet.
- Do not add backend-to-Salesforce data access in this phase.

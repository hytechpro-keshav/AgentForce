# Multi-Tenant OAuth Phase 2 Proof

Date: 2026-05-19
Branch: `feature/multi-tenant-oauth-onboarding`
Environment: Railway production, project `agentforce-ai-api`
AI API URL: `https://ai-api-production-03f5.up.railway.app`

## Scope

Phase 2 moved OAuth tenant and client state from environment-backed config into Railway Postgres, added rotation-ready client secret fields, added tenant/client status enforcement during token issuance and protected route access, and added a safe admin CLI for tenant/client registration.

Salesforce External Credential OAuth setup is still tracked for Phase 3. This proof validates the deployed backend path end to end with two tenant records and direct API connectivity.

## Implementation Summary

- Added `pg` and `@types/pg` for the AI API workspace.
- Added `TenantRegistryService` with `config` and `postgres` providers.
- Added automatic Postgres schema creation for:
  - `ai_api_tenants`
  - `ai_api_oauth_clients`
  - `ai_api_oauth_audit_events`
- Updated OAuth token issuance to load clients from the tenant registry.
- Added active, suspended, and revoked status enforcement for clients and tenants.
- Added pending-secret support for rotation windows.
- Added optional HMAC-SHA256 hashing with `AI_API_OAUTH_CLIENT_SECRET_PEPPER` while preserving Phase 1 SHA-256 compatibility when no pepper is configured.
- Updated `JwtAuthGuard` to re-check OAuth-issued `client_id` tokens against the registry before protected routes run, so suspended tenants are blocked even for already-minted tokens.
- Added `scripts/smoke/phase2-tenant-registry-admin.mjs` for safe tenant/client upsert, status changes, and tenant readback. It stores only hashes and never prints raw secrets.
- Added `scripts/smoke/phase2-deployed-oauth-smoke.mjs` for repeatable deployed OAuth/project-health smoke checks across two tenants.

## Local Validation

Commands run:

```bash
npm --workspace @agentforce/ai-api run test -- jwt-auth.guard oauth-token.service app-config.service tenant-registry.service
npm --workspace @agentforce/ai-api run test:e2e -- chat.e2e-spec.ts
npm run ai-api:typecheck
npm run ai-api:build
node scripts/smoke/phase2-tenant-registry-admin.mjs --help
node scripts/smoke/phase2-deployed-oauth-smoke.mjs --ssl true --base-url https://ai-api-production-03f5.up.railway.app --remove-secret-files
```

Results:

- Auth/config/registry unit tests: 4 suites passed, 67 tests passed.
- AI API e2e suite: 40 tests passed.
- Typecheck: passed.
- Build: passed.
- Admin CLI help smoke: passed.
- Deployed smoke script was exercised against Railway production after deployment.

## Railway Configuration

Postgres service:

- Name: `Postgres`
- Service id observed during provisioning: `ce2e53e1-a66a-47cb-9741-696114653e0a`
- Deployment state: `SUCCESS`

AI API service:

- Name: `ai-api`
- Deployment state after Phase 2 deploy: `SUCCESS`
- `/health/live`: HTTP `200`

Variables added or confirmed on `ai-api` without printing values:

- `AI_API_TENANT_REGISTRY_PROVIDER=postgres`
- `AI_API_TENANT_REGISTRY_DATABASE_URL` using the Railway Postgres service reference
- `AI_API_TENANT_REGISTRY_AUTO_MIGRATE=true`
- `AI_API_TENANT_REGISTRY_DATABASE_SSL=false`
- `AI_API_TENANT_REGISTRY_MAX_POOL_SIZE=5`
- `AI_API_OAUTH_CLIENT_SECRET_PEPPER` set through stdin

Deploy command:

```bash
railway up --service ai-api --environment production --ci -m "Phase 2 tenant registry and OAuth rotation"
```

Result:

- First attempt timed out at the CLI network layer.
- Retry completed successfully with `Deploy complete`.

Follow-up hardening deploy:

```bash
railway up --service ai-api --environment production --ci -m "Phase 2 tenant registry guard hardening"
```

Result: completed successfully with `Deploy complete`.

## Seeded Smoke Tenants

Two smoke tenants were seeded into Railway Postgres using generated temporary client secrets. The raw secrets were written only to `/tmp` for the smoke run and removed after validation.

Tenant A:

- Tenant id: `phase2-smoke-org-a`
- Client id: `phase2-smoke-org-a-client`
- Status: `active`
- Scope: `agentforce:services-project-health`
- Secret material printed: `false`

Tenant B:

- Tenant id: `phase2-smoke-org-b`
- Client id: `phase2-smoke-org-b-client`
- Status: `active`
- Scope: `agentforce:services-project-health`
- Secret material printed: `false`

## Deployed Smoke Results

Direct deployed API smoke results:

Command shape:

```bash
node scripts/smoke/phase2-deployed-oauth-smoke.mjs \
  --ssl true \
  --base-url https://ai-api-production-03f5.up.railway.app \
  --remove-secret-files
```

| Check                                           | Result                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Tenant A token request                          | HTTP `201`                                                                                                     |
| Tenant A token claims                           | `tenant=phase2-smoke-org-a`, `client_id=phase2-smoke-org-a-client`, `scope=agentforce:services-project-health` |
| Tenant A project-health call                    | HTTP `201`, `healthStatus=green`, `riskLevel=low`                                                              |
| Tenant B token request                          | HTTP `201`                                                                                                     |
| Tenant B token claims                           | `tenant=phase2-smoke-org-b`, `client_id=phase2-smoke-org-b-client`, `scope=agentforce:services-project-health` |
| Tenant B project-health call                    | HTTP `201`, `healthStatus=green`, `riskLevel=low`                                                              |
| Tenant A invalid scope request                  | HTTP `400`                                                                                                     |
| Tenant B token request while suspended          | HTTP `401`                                                                                                     |
| Tenant B already-minted token after suspension  | Project-health HTTP `401`                                                                                      |
| Tenant A token request while Tenant B suspended | HTTP `201`                                                                                                     |
| Tenant B restoration                            | Restored to `active`                                                                                           |
| Temporary secret files                          | Removed                                                                                                        |

Postgres readback after smoke:

- `phase2-smoke-org-a`: `active`
- `phase2-smoke-org-b`: `active`
- Clients exist for both tenants.
- Audit counts for smoke clients:
  - `client_upserted`, `phase2-smoke-org-a-client`: `2`
  - `client_upserted`, `phase2-smoke-org-b-client`: `2`
  - `token_issued`, `phase2-smoke-org-a-client`: `4`
  - `token_issued`, `phase2-smoke-org-b-client`: `2`
  - `token_rejected`, `phase2-smoke-org-b-client`: `2`
- Total table counts:
  - Tenants: `2`
  - OAuth clients: `2`
  - Audit events: `12`

## Phase 2 Exit Notes

Completed for backend Phase 2:

- Durable Postgres registry deployed.
- Two tenants onboarded without editing OAuth client JSON env config.
- Tenant-specific OAuth tokens minted from durable records.
- Project-health protected route accepted each tenant independently.
- Invalid scope rejected.
- Suspending one tenant blocked both new token issuance and an already-minted token.
- Suspending one tenant did not affect the other tenant.
- Safe audit events and last-used updates were recorded.

Still pending for Phase 3:

- Salesforce OAuth External Credential metadata/setup for the new token endpoint.
- Named Credential smoke from two Salesforce orgs using their own secure client credentials.
- Customer-admin setup instructions and repeatable onboarding package.

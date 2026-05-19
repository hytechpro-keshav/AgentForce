# Multi-Tenant OAuth Phase 3 Proof

Date: 2026-05-19
Branch: `feature/multi-tenant-oauth-onboarding`
Environment: Railway production, project `agentforce-ai-api`
AI API URL: `https://ai-api-production-03f5.up.railway.app`

## Scope

Phase 3 adds repeatable Salesforce onboarding support for OAuth-backed Agentforce callouts. It does not commit customer secrets or org-specific credential values. The proof covers the backend setup API, setup documentation, Salesforce metadata mapping, and direct API validation. Salesforce sandbox UI credential entry remains a secure per-org admin action.

## Implementation Summary

- Added Salesforce onboarding config to `AppConfigService`:
  - public AI API base URL
  - Named Credential API name
  - External Credential API name
  - principal API name
  - permission set API name
  - secure client id and client secret field names
  - token endpoint and project-health paths
- Added `TenantOperationsService` and `TenantOperationsController`.
- Added protected setup route:
  - `GET /admin/tenants/:tenantId/salesforce-setup`
  - requires `tenant:admin`
  - returns tenant setup instructions and customer-safe auth error mapping
  - never returns raw OAuth client secrets
- Documented Salesforce onboarding in `docs/deployment/salesforce-oauth-onboarding-phase3.md`.
- Extended e2e coverage for setup/report route auth and response shape.

## Local Validation

Commands run:

```bash
npm --workspace @agentforce/ai-api run test -- app-config.service.spec.ts tenant-registry.service.spec.ts oauth-token.service.spec.ts tenant-operations.service.spec.ts
npm --workspace @agentforce/ai-api run test:e2e -- chat.e2e-spec.ts
```

Results:

- Focused Phase 3/4 unit tests: 4 suites passed, 59 tests passed.
- AI API e2e suite: 42 tests passed.
- Static diagnostics on touched TypeScript files: no errors.

## Setup API Checks

E2E checks proved:

| Check                                                                                              | Result     |
| -------------------------------------------------------------------------------------------------- | ---------- |
| `GET /admin/tenants/:tenantId/salesforce-setup` with `tenant:admin`                                | HTTP `200` |
| Setup response includes tenant id, Salesforce org id, token endpoint, and protected smoke endpoint | Passed     |
| Setup response marks secret handling as `valuePrinted=false`                                       | Passed     |
| Setup response does not include the test OAuth client secret                                       | Passed     |
| `GET /admin/tenants/:tenantId/report` without `tenant:admin`                                       | HTTP `403` |
| `GET /admin/tenants/:tenantId/report` with `tenant:admin`                                          | HTTP `200` |

## Salesforce Onboarding Artifact

Guide created:

```text
docs/deployment/salesforce-oauth-onboarding-phase3.md
```

The guide covers:

- tenant registration through the admin CLI
- setup API usage
- metadata validation command
- secure External Credential field mapping
- project-health smoke validation
- customer-safe auth error map
- rollback steps

## Deployment Smoke

Railway deploy command:

```bash
railway up --service ai-api --environment production --ci -m "Phase 3 Salesforce onboarding and Phase 4 SaaS controls"
```

Result:

- Build completed successfully with `npm run ai-api:build`.
- AI API service status: `SUCCESS`.
- Direct smoke deployment id: `8bf7a701-361e-4210-a22d-da7c9a75a97b`.
- Final validation deployment id after CLI/audit polish: `d948aa2e-b87e-49bb-a3e2-eb93dfade076`.
- `/health/live`: HTTP `200`.

Deployed setup/report smoke command shape:

```bash
node scripts/smoke/phase3-phase4-deployed-admin-smoke.mjs \
  --base-url https://ai-api-production-03f5.up.railway.app \
  --tenant-id <tenant-id> \
  --admin-token-file /path/to/admin.token
```

Actual smoke tenant:

- Tenant id: `phase34-smoke-20260519122438`
- Client id: `phase34-smoke-20260519122438-client`
- Secret material printed: `false`

Results:

| Check                        | Result                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup route                  | HTTP `200`                                                                                                                                                               |
| Tenant report route          | HTTP `200`                                                                                                                                                               |
| Readiness markers            | `tenant_active`, `rag_namespace_configured`, `project_health_scope_granted`, `active_oauth_client_present`, `model_policy_configured`, `rate_or_quota_policy_configured` |
| Setup/report secret handling | Secret material not printed                                                                                                                                              |

If requesting a real OAuth token during future smoke runs, add:

```bash
  --client-id <client-id> \
  --client-secret-file /path/to/client.secret
```

Cleanup result:

- Smoke tenant status after cleanup: `suspended`
- Smoke client status after cleanup: `revoked`
- Cleanup audit rows were inserted with safe hashes and no raw secret values.

## Salesforce Connectivity Status

Backend and setup artifacts are ready for Salesforce sandbox credential entry. The final Salesforce smoke requires a target sandbox admin to store the per-org OAuth client id and secret in External Credential secure storage. Secrets are intentionally not stored in source or proof docs.

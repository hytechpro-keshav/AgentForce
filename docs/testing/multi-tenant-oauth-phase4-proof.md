# Multi-Tenant OAuth Phase 4 Proof

Date: 2026-05-19
Branch: `feature/multi-tenant-oauth-onboarding`
Environment: Railway production, project `agentforce-ai-api`
AI API URL: `https://ai-api-production-03f5.up.railway.app`

## Scope

Phase 4 adds SaaS controls for operating many Salesforce org tenants safely. This proof covers local tests, durable quota enforcement, operations reports, CLI controls, and the deployment smoke plan.

## Implementation Summary

- Extended `TenantRegistryService` tenant/client grants with:
  - rotation due dates
  - model routing profile
  - rate limit profile
  - alert policy
  - daily and monthly OAuth token quotas
  - monthly cost limit reference
- Added schema migration coverage for:
  - `ai_api_tenants.alert_policy`
  - `ai_api_tenants.daily_token_quota`
  - `ai_api_tenants.monthly_token_quota`
  - `ai_api_tenants.monthly_cost_limit_cents`
  - `ai_api_oauth_clients.rotation_due_at`
  - `ai_api_tenant_usage_daily`
- Added durable OAuth token quota checks backed by audit events.
- Updated `OAuthTokenService` to return HTTP `429` and record `quota_exceeded` when tenant token quota is exhausted.
- Added tenant operations reports for readiness, alerts, client state, and audit summaries.
- Extended `scripts/smoke/phase2-tenant-registry-admin.mjs` with policy, quota, and rotation fields.
- Added `scripts/smoke/phase3-phase4-deployed-admin-smoke.mjs` for deployed setup/report/token smoke without printing secrets.
- Documented Phase 4 controls in `docs/deployment/multi-tenant-saas-controls-phase4.md`.

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

## Quota Tests

Unit coverage proves:

| Check                                                         | Result                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| Tenant daily quota reached                                    | OAuth token issuer rejects with HTTP `429`                     |
| Quota rejection audit                                         | `quota_exceeded` event recorded with tenant id and safe reason |
| Quota checks happen before token signing and last-used update | Passed                                                         |
| Durable quota counts are read from Postgres audit events      | Passed                                                         |

## Operations Report Tests

Unit and e2e coverage proves:

| Check                                       | Result                                |
| ------------------------------------------- | ------------------------------------- |
| Tenant report includes quota policy         | Passed                                |
| Tenant report includes readiness markers    | Passed                                |
| Tenant report includes audit summary counts | Passed                                |
| Missing `tenant:admin` scope receives `403` | Passed                                |
| Safe tenant id validation is enforced       | Covered by controller path validation |

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

Deployed smoke steps completed:

1. Register a smoke tenant with `--daily-token-quota 1` and a generated secret file.
2. Run the deployed admin smoke with `--expect-second-token-429`.
3. Confirm:
   - setup route returns HTTP `200`
   - report route returns HTTP `200`
   - first token request returns HTTP `201`
   - second token request returns HTTP `429`
   - setup/report output does not print raw secrets
   - audit readback includes `token_issued` and `quota_exceeded`

Actual smoke tenant:

- Tenant id: `phase34-smoke-20260519122438`
- Client id: `phase34-smoke-20260519122438-client`
- Daily token quota: `1`
- Monthly token quota: `10`
- Monthly cost limit reference: `25000` cents
- Secret material printed: `false`

Command shape used:

```bash
node scripts/smoke/phase3-phase4-deployed-admin-smoke.mjs \
  --base-url https://ai-api-production-03f5.up.railway.app \
  --tenant-id phase34-smoke-20260519122438 \
  --client-id phase34-smoke-20260519122438-client \
  --client-secret-file /tmp/phase34-smoke-20260519122438-client.secret \
  --expect-second-token-429
```

Results:

| Check                                                | Result                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Setup route                                          | HTTP `200`                                                                                                                         |
| Tenant report route                                  | HTTP `200`                                                                                                                         |
| First OAuth token request                            | HTTP `201`                                                                                                                         |
| Second OAuth token request after daily quota reached | HTTP `429`                                                                                                                         |
| Token claim readback                                 | `tenant=phase34-smoke-20260519122438`, `client_id=phase34-smoke-20260519122438-client`, `scope=agentforce:services-project-health` |
| Secret handling                                      | Secret material not printed                                                                                                        |

Audit counts after quota smoke:

| Event             | Count |
| ----------------- | ----- |
| `client_upserted` | `1`   |
| `token_issued`    | `1`   |
| `token_rejected`  | `1`   |
| `quota_exceeded`  | `1`   |

Cleanup result:

- Smoke tenant status after cleanup: `suspended`
- Smoke client status after cleanup: `revoked`
- Total audit events after cleanup: `6`

## Remaining Production Gate

Before production customer onboarding, complete:

- Salesforce sandbox OAuth External Credential smoke.
- Security review for token handling, tenant isolation, audit log safety, and secure credential storage.

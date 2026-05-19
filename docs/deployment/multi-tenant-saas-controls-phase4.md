# Phase 4 Multi-Tenant SaaS Controls

Date: 2026-05-19
Branch: `feature/multi-tenant-oauth-onboarding`
Environment: Railway production AI API

## Scope

Phase 4 adds the controls needed to operate many Salesforce orgs as AI API tenants:

- tenant operations reports
- durable OAuth token quotas
- model routing, rate limit, alert, and cost policy metadata
- rotation due dates and stale-client alerts
- audit summaries for issued tokens, rejected tokens, and quota events
- protected admin APIs that require `tenant:admin`

The first production-ready control surface is API and CLI based. A portal UI can consume the same endpoints later.

## Protected Operations APIs

All routes require a valid AI API JWT with:

```text
tenant:admin
```

Routes:

```text
GET /admin/tenants/report
GET /admin/tenants/:tenantId/report
GET /admin/tenants/:tenantId/salesforce-setup
```

`GET /admin/tenants/:tenantId/report` returns:

- tenant status, Salesforce org id, org URL, RAG namespace
- tenant scopes and roles
- model routing profile, rate limit profile, alert policy
- daily/monthly token quotas and monthly cost limit reference
- OAuth clients with status, scopes, roles, last-used date, pending-secret expiry, and rotation due date
- audit counts for issued tokens, rejected tokens, and quota events
- readiness checks
- operator alerts

## Registry Schema Additions

Tenant table additions:

```text
alert_policy
 daily_token_quota
monthly_token_quota
monthly_cost_limit_cents
```

OAuth client table addition:

```text
rotation_due_at
```

Usage table addition:

```text
ai_api_tenant_usage_daily
```

The usage table is prepared for route/model/cost summaries and future telemetry rollups. OAuth token quota enforcement currently uses durable audit events so quotas survive process restarts.

## Quota Enforcement

The OAuth token issuer checks quota before signing a new access token:

1. Load the OAuth client and tenant policy from the registry.
2. Validate client and tenant status.
3. Validate requested scopes.
4. Count durable `token_issued` audit events for the tenant in the daily and monthly windows.
5. If a configured quota is exhausted, record `quota_exceeded` and reject with HTTP `429`.
6. If allowed, issue the token and record `token_issued`.

Supported quota fields:

```text
daily_token_quota
monthly_token_quota
monthly_cost_limit_cents
```

The monthly cost limit is stored and surfaced in reports as a policy reference. It is ready to be enforced once cost rollups are connected to model telemetry.

## Readiness Checks

Reports include readiness markers such as:

```text
tenant_active
project_health_scope_granted
active_oauth_client_present
model_policy_configured
rate_or_quota_policy_configured
```

Alerts include conditions such as:

```text
tenant_not_active
project_health_scope_missing
no_active_oauth_client
rotation_due
pending_secret_window_expired
token_quota_not_configured
auth_rejections_detected
quota_exceeded_recently
```

These strings are stable enough for CLI checks and future dashboard badges.

## CLI Controls

The existing tenant registry admin script now supports policy and quota fields:

```bash
node scripts/smoke/phase2-tenant-registry-admin.mjs upsert-oauth-client \
  --tenant-id <tenant-id> \
  --salesforce-org-id <org-id> \
  --client-id <client-id> \
  --client-secret-file /path/to/client.secret \
  --model-routing-profile services-default \
  --rate-limit-profile standard \
  --alert-policy ops-default \
  --daily-token-quota 100 \
  --monthly-token-quota 3000 \
  --monthly-cost-limit-cents 25000 \
  --rotation-due-at 2026-06-01T00:00:00Z
```

Read back a tenant:

```bash
node scripts/smoke/phase2-tenant-registry-admin.mjs show-tenant \
  --tenant-id <tenant-id>
```

The script stores only secret hashes and does not print raw secrets.

## Security Notes

- Admin routes require scoped JWT auth.
- Tenant id path parameters accept only safe identifier characters.
- Setup instructions never include raw OAuth client secrets.
- Audit events store safe hashes and reasons, not raw secrets.
- Quota rejection returns a generic safe error body.
- Tenant status remains a kill switch for token issuance and protected-route access.

## Release Gate

Before production customer onboarding:

1. Focused unit and e2e tests pass.
2. Typecheck and build pass.
3. Railway deployment succeeds.
4. Direct deployed smoke proves setup/report APIs, token issuance, project-health, and quota behavior.
5. Salesforce sandbox smoke proves the Named Credential and External Credential OAuth path.
6. Security review confirms token handling, secret storage, audit log safety, and tenant isolation.

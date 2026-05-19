# Phase 3 Salesforce OAuth Onboarding

Date: 2026-05-19
Branch: `feature/multi-tenant-oauth-onboarding`
Environment: Railway production AI API

## Scope

Phase 3 makes a Salesforce org repeatably onboardable as an AI API tenant without Railway environment-variable edits or manually minted long-lived JWTs. The onboarding path is:

```text
Salesforce Agentforce
  -> Apex action
  -> Named Credential / External Credential
  -> POST /oauth/token using client credentials
  -> short-lived scoped bearer token
  -> protected AI API route
```

The AI API now exposes a protected setup endpoint that returns tenant-specific Salesforce setup instructions without returning raw client secrets.

## Setup API

Route:

```text
GET /admin/tenants/:tenantId/salesforce-setup
```

Required scope:

```text
tenant:admin
```

The response includes:

- tenant id, Salesforce org id, org URL, status, and RAG namespace
- OAuth client id, granted scopes, and client status
- AI API base URL, token endpoint, and protected project-health smoke endpoint
- expected Salesforce Named Credential, External Credential, principal, permission set, and secure field names
- deployable metadata paths
- customer-safe auth error mapping
- rollback steps

The response intentionally does not include any OAuth client secret value. Store the raw client secret only in Salesforce secure credential storage.

Example shape:

```json
{
  "tenant": {
    "tenantId": "certinia-phase8",
    "salesforceOrgId": "00D000000000001",
    "status": "active",
    "ragNamespace": "certinia-phase8"
  },
  "oauthClient": {
    "clientId": "certinia-phase8-oauth",
    "scopes": ["agentforce:services-project-health"],
    "secretHandling": {
      "valuePrinted": false
    }
  },
  "aiApi": {
    "tokenEndpoint": "https://ai-api-production-03f5.up.railway.app/oauth/token",
    "protectedSmokeEndpoint": "https://ai-api-production-03f5.up.railway.app/agent/services/project-health"
  }
}
```

## Tenant Registration

Register or update the tenant in Railway Postgres with the admin smoke CLI. Secrets are read from files, generated into files, or supplied as hashes; raw secrets are not printed.

```bash
node scripts/smoke/phase2-tenant-registry-admin.mjs upsert-oauth-client \
  --ssl false \
  --tenant-id certinia-phase8 \
  --salesforce-org-id 00D000000000001 \
  --salesforce-instance-url https://certinia.example.my.salesforce.com \
  --client-id certinia-phase8-oauth \
  --client-generate-secret \
  --client-secret-output-file /tmp/certinia-phase8-oauth.secret \
  --tenant-scopes "agentforce:services-project-health" \
  --client-scopes "agentforce:services-project-health" \
  --tenant-roles services-org-intelligence \
  --client-roles services-org-intelligence \
  --model-routing-profile services-default \
  --rate-limit-profile standard \
  --alert-policy ops-default \
  --daily-token-quota 100 \
  --monthly-token-quota 3000 \
  --monthly-cost-limit-cents 25000 \
  --rotation-due-at 2026-06-01T00:00:00Z
```

After Salesforce secure storage is updated and the smoke succeeds, remove temporary local secret files.

## Salesforce Metadata Package

Deploy or validate the Phase 8 Agentforce bridge slice for each target org:

```bash
sf project deploy validate \
  --source-dir force-app/main/default/classes/AgentforceAiApiProjectHealth.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiProjectHealthTest.cls \
  --source-dir force-app/main/default/genAiFunctions/Summarize_Project_Health_Brief \
  --source-dir force-app/main/default/namedCredentials/Agentforce_AI_API_Phase2.namedCredential-meta.xml \
  --source-dir force-app/main/default/externalCredentials/Agentforce_AI_API_Phase2.externalCredential-meta.xml \
  --source-dir force-app/main/default/permissionsets/Services_Org_Intelligence_Agent.permissionset-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiProjectHealthTest \
  --target-org <sandbox-alias> \
  --wait 30
```

The current checked-in metadata preserves the Phase 2 custom auth header for backward compatibility. For OAuth onboarding, configure the target org External Credential to use OAuth 2.0 client credentials against `/oauth/token`, then store these secure values in Salesforce:

| Salesforce secure value      | Source                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `AI_API_OAUTH_CLIENT_ID`     | OAuth client id from the tenant registry                                |
| `AI_API_OAUTH_CLIENT_SECRET` | Raw OAuth client secret from the customer-specific secret file or vault |

Do not commit secure values, org-specific credentials, or raw secrets.

## Validation

Run the setup API:

```bash
curl -sS https://ai-api-production-03f5.up.railway.app/admin/tenants/<tenant-id>/salesforce-setup \
  -H "authorization: Bearer <tenant-admin-token>"
```

Then validate the Salesforce callout path:

1. Confirm the Named Credential URL is the Railway AI API base URL.
2. Confirm the External Credential token endpoint is `/oauth/token` and the client credentials secure values are populated.
3. Assign `Services_Org_Intelligence_Agent` to the integration user or Agentforce runtime user.
4. Run `AgentforceAiApiProjectHealth` or the Agentforce Project Health action.
5. Confirm the AI API audit stream shows `tenant=<tenant-id>`, `client_id=<client-id>`, and `event_type=token_issued`.

Expected protected route:

```text
POST /agent/services/project-health
```

Required scope:

```text
agentforce:services-project-health
```

## Customer-Safe Auth Error Map

| Condition                                           | HTTP status | Safe message                                         | Operator action                                                      |
| --------------------------------------------------- | ----------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Unknown client, suspended tenant, or revoked client | `401`       | Client authentication failed.                        | Confirm tenant/client status in the registry.                        |
| Invalid OAuth secret                                | `401`       | Client authentication failed.                        | Replace the Salesforce secure client secret value.                   |
| Missing protected-route scope                       | `403`       | Bearer token is missing a required scope.            | Grant `agentforce:services-project-health` to the tenant and client. |
| Token quota exceeded                                | `429`       | OAuth token quota has been exceeded for this tenant. | Review usage or increase the quota.                                  |

## Rollback

1. Set the OAuth client or tenant status to `suspended` in the registry.
2. Remove or deactivate the permission set assignment for the affected Salesforce integration user.
3. Revert only that org's Named Credential or External Credential if an emergency credential rollback is required.
4. Leave other active tenants unchanged.

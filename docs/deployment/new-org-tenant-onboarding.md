# New Salesforce Org And Tenant Onboarding

Date: 2026-05-19

## Purpose

Use this runbook whenever a new Salesforce org must be connected to the AgentForce AI API as a tenant. It covers tenant registration, Salesforce credential setup, metadata deployment, Agentforce enablement, validation, evidence capture, and rollback.

The target operating model is:

```text
Salesforce Agentforce
  -> Apex action
  -> Named Credential / External Credential
  -> OAuth client credentials or approved bridge bearer
  -> Railway NestJS AI API
  -> ModelRouter / RAG / telemetry
```

Salesforce remains the system of record. Apex gathers deterministic Salesforce-side context and calls the AI API. The NestJS AI API owns model routing, RAG, tenant policy, token issuance, quotas, audit records, and telemetry.

## When To Use

Use this runbook for:

- onboarding a new customer Salesforce org
- adding a second org for the same customer tenant
- registering a new OAuth client for an existing tenant
- validating that a Salesforce org can authenticate to the protected AI API routes
- preparing a repeatable setup package for Agentforce pilots

Do not use this runbook to rotate all production credentials at once. Rotate one tenant or org at a time and verify before moving to the next one.

## Hard Rules

- Do not print Railway variables, OAuth client secrets, bearer tokens, JWTs, refresh tokens, private keys, or Salesforce credential values.
- Store raw OAuth client secrets only in Salesforce secure credential storage or an approved secret manager.
- Store only hashes in the tenant registry when the registry requires secret material.
- Use `railway variable set KEY --stdin` for secrets when a Railway variable must be changed.
- Do not use `railway variables` table output in shared logs because it can print raw values.
- Do not commit `.env`, temporary secret files, generated credential bodies, access tokens, or org refresh tokens.
- Validate each Salesforce org separately. A shared AI API URL does not prove a shared credential works for every org.
- Treat `401` and `403` from Apex as release blockers until the exact tenant/client/scope issue is resolved.
- Do not deploy a capability into an org that lacks its required managed package or objects. For example, Services Org Intelligence project health requires Certinia PSA `pse__` objects.

## Intake Checklist

Capture these values before changing anything:

| Field                   | Example                                                      | Notes                                                                |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Salesforce CLI alias    | `customer-prod`                                              | Must resolve with `sf org display`.                                  |
| Salesforce org id       | `00D...`                                                     | Use the real org id, not a sandbox placeholder.                      |
| Salesforce instance URL | `https://example.my.salesforce.com`                          | Store in the tenant registry.                                        |
| Tenant id               | `customer-prod`                                              | Safe identifier, stable across API audit records.                    |
| OAuth client id         | `customer-prod-agentforce`                                   | One client per org/runtime surface is preferred.                     |
| RAG namespace           | `customer-self-service`                                      | Required for RAG isolation.                                          |
| Enabled capabilities    | `support-triage`, `knowledge-rag`, `services-project-health` | Drives scopes and metadata package.                                  |
| Runtime user            | Einstein Agent runtime user or employee user                 | Assign permission sets to the user that actually invokes the action. |
| Release owner           | Name or team                                                 | Required for credential and deployment approval.                     |

Confirm org identity without exposing tokens:

```bash
sf org display --target-org <org-alias> --json
sf org list --all --json
sf alias list --json
```

Only summarize `alias`, `username`, `orgId`, `instanceUrl`, and `connectedStatus`.

## Capability Matrix

Choose the setup slice before deployment.

| Capability              | Required scopes                      | Salesforce metadata                                                                                                                                          | Org prerequisites                        | Smoke path                                                   |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| Support triage          | `agentforce:support-triage`          | `AgentforceAiApiSupportTriage`, `Triage_Support_Case`, `Customer_Self_Service_Agent` permission/planner metadata                                             | Case access for runtime user             | Apex test and Agentforce triage prompt                       |
| Case analysis           | `agentforce:case-analysis`           | `AgentforceAiApiCaseAnalysis`, `Analyze_Support_Case`, customer self-service metadata                                                                        | Case access for runtime user             | Apex test and case-analysis prompt                           |
| Knowledge RAG           | `agentforce:knowledge-rag`           | `AgentforceAiApiKnowledgeRag`, `Answer_Knowledge_RAG`, customer self-service metadata                                                                        | RAG corpus ingested for tenant/namespace | `/rag/search`, `/agent/knowledge/answer`, Agentforce preview |
| Services project health | `agentforce:services-project-health` | `AgentforceAiApiProjectHealth`, `AgentforcePsaProjectDirectory`, `Summarize_Project_Health_Brief`, `List_PSA_Projects`, services permission/planner metadata | Certinia PSA package and `pse__` objects | Direct Apex project-health smoke and Agentforce preview/eval |

Check Certinia PSA readiness before deploying the services slice:

```bash
sf package installed list --target-org <org-alias> --json
sf data query --target-org <org-alias> --query "SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN ('pse__Proj__c','pse__Assignment__c','pse__Milestone__c','pse__Timecard_Header__c','pse__Project_Task__c','pse__Resource_Request__c','pse__Budget__c') ORDER BY QualifiedApiName" --json
```

If the required objects are absent, validate only the auth route or choose a different capability. Do not claim the full Services Org Intelligence agent is installed.

## Step 1 - Register The Tenant And OAuth Client

Register the tenant in the AI API tenant registry. Use a local secret file for generated client secrets and delete it after Salesforce secure storage is updated.

```bash
TENANT_ID="<tenant-id>"
CLIENT_ID="<client-id>"
ORG_ID="<salesforce-org-id>"
ORG_URL="<salesforce-instance-url>"
CLIENT_SECRET_FILE="/tmp/${CLIENT_ID}.secret"
DB_URL_FILE="/tmp/agentforce-tenant-registry-db-url"

rm -f "$CLIENT_SECRET_FILE" "$DB_URL_FILE"
chmod 600 "$DB_URL_FILE"

# Put the approved Railway Postgres public URL in this file from a private
# secret manager or Railway one-off context. Do not echo it into chat logs.
# Example only:
# railway run --service Postgres --environment production sh -c 'printf "%s" "$DATABASE_PUBLIC_URL"' > "$DB_URL_FILE"

node scripts/smoke/phase2-tenant-registry-admin.mjs upsert-oauth-client \
  --database-url-file "$DB_URL_FILE" \
  --ssl false \
  --tenant-id "$TENANT_ID" \
  --salesforce-org-id "$ORG_ID" \
  --salesforce-instance-url "$ORG_URL" \
  --client-id "$CLIENT_ID" \
  --client-generate-secret \
  --client-secret-output-file "$CLIENT_SECRET_FILE" \
  --tenant-scopes "agentforce:support-triage agentforce:case-analysis agentforce:knowledge-rag agentforce:services-project-health" \
  --client-scopes "<space-separated-approved-scopes>" \
  --tenant-roles "salesforce-agentforce" \
  --client-roles "salesforce-agentforce" \
  --rag-namespace "<rag-namespace>" \
  --model-routing-profile "standard" \
  --rate-limit-profile "standard" \
  --alert-policy "ops-default" \
  --daily-token-quota 100 \
  --monthly-token-quota 3000 \
  --monthly-cost-limit-cents 25000 \
  --rotation-due-at "<yyyy-mm-ddThh:mm:ssZ>"
```

Then verify the tenant without printing the secret:

```bash
node scripts/smoke/phase2-tenant-registry-admin.mjs show-tenant \
  --database-url-file "$DB_URL_FILE" \
  --ssl false \
  --tenant-id "$TENANT_ID"
```

Expected evidence:

- tenant status is `active`
- client status is `active`
- scopes match the selected capability
- `secretMaterialPrinted` is `false`
- quota and rotation policy are present

## Step 2 - Retrieve Setup Instructions

Use the protected setup API when a `tenant:admin` token is available:

```bash
curl -sS "https://ai-api-production-03f5.up.railway.app/admin/tenants/${TENANT_ID}/salesforce-setup" \
  -H "authorization: Bearer <tenant-admin-token>"
```

The response must not contain raw client secrets. It should confirm:

- tenant id, Salesforce org id, org URL, status, and RAG namespace
- OAuth client id and scopes
- expected AI API token endpoint and protected smoke endpoint
- expected Salesforce Named Credential, External Credential, principal, permission set, and secure field names
- customer-safe error mapping and rollback steps

## Step 3 - Deploy Or Validate Salesforce Metadata

Start with a validation deploy. Use the smallest metadata set needed for the selected capability.

Base AI API credential metadata:

```text
force-app/main/default/namedCredentials/Agentforce_AI_API_Phase2.namedCredential-meta.xml
force-app/main/default/externalCredentials/Agentforce_AI_API_Phase2.externalCredential-meta.xml
```

Customer Self-Service metadata examples:

```text
force-app/main/default/classes/AgentforceAiApiSupportTriage.cls
force-app/main/default/classes/AgentforceAiApiSupportTriageTest.cls
force-app/main/default/classes/AgentforceAiApiCaseAnalysis.cls
force-app/main/default/classes/AgentforceAiApiCaseAnalysisTest.cls
force-app/main/default/classes/AgentforceAiApiKnowledgeRag.cls
force-app/main/default/classes/AgentforceAiApiKnowledgeRagTest.cls
force-app/main/default/genAiFunctions/Triage_Support_Case
force-app/main/default/genAiFunctions/Analyze_Support_Case
force-app/main/default/genAiFunctions/Answer_Knowledge_RAG
force-app/main/default/permissionsets/Customer_Self_Service_Agent.permissionset-meta.xml
force-app/main/default/genAiPlannerBundles/Customer_Self_Service_Agent
```

Services Org Intelligence metadata examples:

```text
force-app/main/default/classes/AgentforceAiApiProjectHealth.cls
force-app/main/default/classes/AgentforceAiApiProjectHealthTest.cls
force-app/main/default/classes/AgentforcePsaProjectDirectory.cls
force-app/main/default/classes/AgentforcePsaProjectDirectoryTest.cls
force-app/main/default/genAiFunctions/List_PSA_Projects
force-app/main/default/genAiFunctions/Summarize_Project_Health_Brief
force-app/main/default/permissionsets/Services_Org_Intelligence_Agent.permissionset-meta.xml
force-app/main/default/genAiPlannerBundles/Services_Org_Intelligence_Showcase_Agent_new
```

Validation examples:

```bash
sf project deploy validate \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRag.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRagTest.cls \
  --source-dir force-app/main/default/genAiFunctions/Answer_Knowledge_RAG \
  --source-dir force-app/main/default/namedCredentials/Agentforce_AI_API_Phase2.namedCredential-meta.xml \
  --source-dir force-app/main/default/externalCredentials/Agentforce_AI_API_Phase2.externalCredential-meta.xml \
  --source-dir force-app/main/default/permissionsets/Customer_Self_Service_Agent.permissionset-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiKnowledgeRagTest \
  --target-org <org-alias> \
  --wait 30
```

```bash
sf project deploy validate \
  --source-dir force-app/main/default/classes/AgentforceAiApiProjectHealth.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiProjectHealthTest.cls \
  --source-dir force-app/main/default/classes/AgentforcePsaProjectDirectory.cls \
  --source-dir force-app/main/default/classes/AgentforcePsaProjectDirectoryTest.cls \
  --source-dir force-app/main/default/genAiFunctions/List_PSA_Projects \
  --source-dir force-app/main/default/genAiFunctions/Summarize_Project_Health_Brief \
  --source-dir force-app/main/default/namedCredentials/Agentforce_AI_API_Phase2.namedCredential-meta.xml \
  --source-dir force-app/main/default/externalCredentials/Agentforce_AI_API_Phase2.externalCredential-meta.xml \
  --source-dir force-app/main/default/permissionsets/Services_Org_Intelligence_Agent.permissionset-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiProjectHealthTest \
  --tests AgentforcePsaProjectDirectoryTest \
  --target-org <org-alias> \
  --wait 30
```

For active Agentforce planners, use the supported lifecycle:

```bash
sf agent deactivate --api-name <AgentApiName> --target-org <org-alias>
sf project deploy start --source-dir <planner-and-action-paths> --target-org <org-alias> --wait 30
sf agent activate --api-name <AgentApiName> --target-org <org-alias>
```

## Step 4 - Configure Salesforce Credentials

Preferred new-tenant mode is OAuth 2.0 client credentials:

```text
Token endpoint: https://ai-api-production-03f5.up.railway.app/oauth/token
Client id secure value: AI_API_OAUTH_CLIENT_ID
Client secret secure value: AI_API_OAUTH_CLIENT_SECRET
Required scope: capability-specific approved scopes
```

Store the `CLIENT_ID` and the raw value in `CLIENT_SECRET_FILE` in Salesforce secure credential storage. Do not commit either value. Delete `CLIENT_SECRET_FILE` after the smoke passes.

The checked-in `Agentforce_AI_API_Phase2` metadata still uses a Custom auth header for backward-compatible proof orgs:

```text
Authorization: Bearer {!$Credential.Agentforce_AI_API_Phase2.AI_API_PHASE2_BEARER_JWT}
```

Use this bridge-bearer path only when a release owner approves compatibility mode. If you must update the Custom encrypted credential, use the Salesforce REST endpoint:

```text
/services/data/v66.0/named-credentials/credential
```

The body must include `encrypted: true` for `AI_API_PHASE2_BEARER_JWT`. Never use `/connect/named-credentials/credential` for this update.

## Step 5 - Assign Runtime Access

Assign the permission set to the user that actually invokes the Agentforce action.

```bash
sf org assign permset --name Customer_Self_Service_Agent --target-org <org-alias>
sf org assign permset --name Services_Org_Intelligence_Agent --target-org <org-alias>
```

For Service Agents, trace and assign the Einstein Agent runtime user when needed. For Employee Agents, validate the employee or pilot user context.

Also grant the agent access permission set when a dedicated Employee Agent has one, such as:

```bash
sf org assign permset --name Services_Org_Intelligence_Showcase_Agent_new_Access --target-org <org-alias>
```

## Step 6 - Validate Backend Health And Token Issuance

Health check:

```bash
curl -sS -o /tmp/ai-api-health.json -w '%{http_code}\n' \
  https://ai-api-production-03f5.up.railway.app/health/live
rm -f /tmp/ai-api-health.json
```

OAuth token smoke from an operator machine:

```bash
CLIENT_SECRET="$(tr -d '\n' < "$CLIENT_SECRET_FILE")"
curl -sS -X POST "https://ai-api-production-03f5.up.railway.app/oauth/token" \
  -H "content-type: application/json" \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"${CLIENT_ID}\",\"client_secret\":\"${CLIENT_SECRET}\",\"scope\":\"<approved-scope>\"}"
unset CLIENT_SECRET
```

Do not paste token responses into shared notes. Record only status, token lifetime, granted scope, tenant id, and client id if those values are safe for the release record.

## Step 7 - Validate Salesforce Callouts

Run the capability Apex tests first:

```bash
sf apex run test \
  --target-org <org-alias> \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiKnowledgeRagTest \
  --wait 30 \
  --result-format human
```

```bash
sf apex run test \
  --target-org <org-alias> \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiProjectHealthTest \
  --tests AgentforcePsaProjectDirectoryTest \
  --wait 30 \
  --result-format human
```

Then run one direct Apex smoke per enabled route. For a new Services org that has PSA data, use `AgentforceAiApiProjectHealth.summarizeProjectHealth` with a real visible `pse__Proj__c` id. Expected output is `actionStatus=SUMMARIZED` and HTTP `201`.

For an org that does not have the capability metadata installed, validate only the protected auth route with a minimal anonymous Apex `HttpRequest` through the Named Credential. Expected output is HTTP `201`; `401` or `403` means the Salesforce credential, tenant/client registry, or scope is wrong.

## Step 8 - Validate Agentforce Runtime

Use Agentforce preview or evaluation when supported by the target org:

```bash
sf agent preview start --target-org <org-alias> --api-name <AgentApiName> --json
sf agent preview send --target-org <org-alias> --session-id <session-id> --message "<prompt>" --live-actions --json
sf agent preview end --target-org <org-alias> --session-id <session-id> --json
```

Known limitation: some Employee Agent CLI preview sessions can fail before the prompt with `Invalid user ID provided on start session`. If that happens, use Agent Builder Preview, Salesforce UI, or direct Apex runtime proof and document the limitation.

Representative prompts:

```text
What approved troubleshooting can I give for intermittent residential service?
Can you summarize the health of project ID <Salesforce Project ID>?
```

Pass criteria:

- the intended topic/action is selected
- external calls ask for confirmation when policy requires it
- the action output is successful and source-cited when RAG is used
- no `AUTH_ERROR`, `401`, or `403` appears
- the agent does not invoke unrelated actions

## Evidence To Capture

Capture sanitized evidence only:

- branch and commit
- Railway deployment id and AI API URL
- tenant id, Salesforce org id, Salesforce instance URL
- OAuth client id, status, scopes, quota policy, and rotation due date
- Salesforce deploy id and Apex test run id
- Named Credential and External Credential names plus credential value id/revision, not values
- direct API smoke status and request id
- direct Apex smoke status, HTTP status, provider, model, and request id
- Agentforce preview/eval session id when available
- audit event summary: `token_issued`, `invalid_client`, `invalid_scope`, `quota_exceeded`
- rollback owner and date

## Rollback

Tenant-level rollback:

```bash
node scripts/smoke/phase2-tenant-registry-admin.mjs set-tenant-status \
  --database-url-file "$DB_URL_FILE" \
  --ssl false \
  --tenant-id "$TENANT_ID" \
  --status suspended
```

Client-level rollback:

```bash
node scripts/smoke/phase2-tenant-registry-admin.mjs set-client-status \
  --database-url-file "$DB_URL_FILE" \
  --ssl false \
  --client-id "$CLIENT_ID" \
  --status revoked
```

Salesforce rollback:

1. Deactivate the affected Agentforce agent before planner rollback.
2. Remove or disable the affected topic/action from the planner bundle.
3. Remove the permission set assignment from the affected runtime user.
4. Revert the Named Credential or External Credential only for that org.
5. Leave other active tenants unchanged.

RAG rollback:

1. Delete demo Qdrant data by namespace or approved source ids.
2. Disable the tenant's RAG scope if the source corpus is no longer approved.
3. Keep unrelated tenants and namespaces intact.

## Exit Criteria

A new org or tenant is onboarded only when all of these are true:

- tenant and OAuth client are active in the registry
- Salesforce secure credential values are populated and not exposed
- selected metadata deploys and Apex tests pass
- at least one direct Salesforce callout to the protected AI API route returns HTTP `201`
- Agentforce runtime proof passes or a documented org/CLI limitation explains why direct Apex proof is the accepted substitute
- telemetry/audit evidence identifies tenant, client, route, provider/model or retrieval id, latency, and outcome without raw prompts, secrets, or PII
- rollback commands and owner are recorded

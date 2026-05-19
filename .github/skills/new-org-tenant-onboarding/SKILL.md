---
name: new-org-tenant-onboarding
description: "Use when setting up, onboarding, validating, rotating, or troubleshooting a new Salesforce org, AI API tenant, OAuth client, Named Credential, External Credential, Agentforce action, or multi-tenant customer connection."
argument-hint: "Tenant id, Salesforce org alias/org id, capabilities, and target environment"
user-invocable: true
---

# New Org Tenant Onboarding

## Use This Skill For

- onboarding a new Salesforce org as an AI API tenant
- registering or rotating an OAuth client
- configuring Salesforce Named Credential and External Credential auth
- deploying Customer Self-Service or Services Org Intelligence metadata to a target org
- proving that Agentforce can call the AI API without `AUTH_ERROR`, `401`, or `403`

## Required References

Read these before changing files or running setup commands:

- [new org and tenant onboarding runbook](../../../docs/deployment/new-org-tenant-onboarding.md)
- [multi-tenant OAuth plan](../../../docs/deployment/multi-tenant-oauth-onboarding-plan.md)
- [Salesforce OAuth onboarding Phase 3](../../../docs/deployment/salesforce-oauth-onboarding-phase3.md)
- [multi-tenant SaaS controls Phase 4](../../../docs/deployment/multi-tenant-saas-controls-phase4.md)

Load capability-specific docs as needed:

- Customer Self-Service Knowledge RAG: [Phase 4 UAT](../../../docs/testing/customer-self-service-phase4-knowledge-rag-uat.md)
- Services Org Intelligence: [Phase 8 runbook](../../../docs/deployment/railway-ai-api-phase8.md)

## Workflow

1. Identify the target org safely with `sf org display`, `sf org list --all`, and `sf alias list`. Report only alias, username, org id, instance URL, and connected status.
2. Decide which capabilities are being enabled and map them to scopes, metadata, permissions, and smoke tests.
3. Check org prerequisites before deploy. For Services Org Intelligence, confirm Certinia PSA packages and required `pse__` objects exist.
4. Register or update the tenant and OAuth client with `scripts/smoke/phase2-tenant-registry-admin.mjs`. Use files or stdin for secret material. Do not print secrets.
5. Retrieve `/admin/tenants/:tenantId/salesforce-setup` when a `tenant:admin` token is available and confirm the response is secret-safe.
6. Validate or deploy the minimal Salesforce metadata slice for the selected capability.
7. Configure Salesforce secure credential values in the External Credential. Prefer OAuth client credentials for new tenants. Use the Custom bearer compatibility path only when explicitly approved.
8. Assign permission sets to the actual Agentforce runtime user or employee pilot user.
9. Run backend health, token issuance, Apex tests, direct Apex smoke, and Agentforce preview/eval where supported.
10. Capture sanitized evidence and rollback commands.

## Safety Rules

- Never print Railway variable values or Salesforce secure credential values.
- Never paste access tokens, OAuth client secrets, JWTs, private keys, or refresh tokens into chat or docs.
- Never use `railway variables` table output in shared logs.
- Use `railway variable set KEY --stdin` for Railway secret updates.
- Do not leave temp files under the repo. Use `/tmp`, `chmod 600`, and delete files after validation.
- If a rotation partially succeeds, stop and repair both sides deliberately: registry or Railway hash, Salesforce credential, AI API restart/redeploy, then smoke every affected org.
- Do not claim full agent readiness when only the auth route was tested.

## Output Checklist

Return a concise setup report with:

- target org alias, org id, and instance URL
- tenant id, client id, approved scopes, RAG namespace, and status
- metadata slice chosen and prerequisite checks
- validation commands run and pass/fail result
- direct Apex or Agentforce proof result
- sanitized credential evidence such as credential id/revision, not values
- blockers and exact next action when setup is incomplete

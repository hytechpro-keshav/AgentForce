---
description: "Run the guided workflow for onboarding a new Salesforce org or AI API tenant with OAuth, Named Credentials, Agentforce metadata, validation, and rollback evidence."
name: "Onboard New Org Tenant"
agent: "Tenant Onboarding Operator"
argument-hint: "Org alias/org id, tenant id, capabilities, target environment"
tools: [read, search, execute, edit, todo]
---

Use the `new-org-tenant-onboarding` skill and the runbook at [docs/deployment/new-org-tenant-onboarding.md](../../docs/deployment/new-org-tenant-onboarding.md) to guide this setup.

User-provided context:

```text
${input}
```

Produce a scoped onboarding plan first. If the user has already approved execution, continue through validation. Keep secrets out of chat and docs.

The final report must include:

- Salesforce org alias, org id, and instance URL
- tenant id, OAuth client id, scopes, and RAG namespace
- selected capability metadata and prerequisite checks
- tenant registry status
- Salesforce credential setup status
- Apex and Agentforce validation results
- auth result for each protected route
- sanitized evidence and rollback steps

---
description: "Use when writing or updating new Salesforce org setup, AI API tenant onboarding, OAuth client registration, Named Credential, External Credential, Agentforce connectivity, or tenant rollback docs and customizations."
applyTo:
  - "docs/deployment/new-org-tenant-onboarding.md"
  - ".github/skills/new-org-tenant-onboarding/**"
  - ".github/agents/new-org-tenant-onboarding.agent.md"
  - ".github/prompts/onboard-new-org-tenant.prompt.md"
---

# New Org Tenant Onboarding Instructions

- Keep setup docs operational: intake, prerequisites, exact commands, validation, evidence, and rollback.
- Separate tenant registry setup, Salesforce secure credential setup, metadata deployment, permission assignment, and Agentforce runtime validation.
- Prefer OAuth client credentials for new tenants. Document the Custom bearer path only as compatibility mode.
- Never include raw secrets, hashes, JWTs, bearer values, private keys, refresh tokens, Railway variable values, or Salesforce secure credential values.
- Use file or stdin based secret handoff patterns and require cleanup of temporary files.
- For every capability, state required scopes, metadata paths, org prerequisites, tests, and proof path.
- Distinguish auth-route success from full Agentforce readiness when a target org lacks required packages, data, metadata, or planner bindings.

# Onboard New Org / Tenant

Run the new org or tenant onboarding workflow. Full details in `.github/prompts/onboard-new-org-tenant.prompt.md`.
Read `.agents/skills/new-org-tenant-onboarding/SKILL.md` first.

## Steps

1. **Read** `.github/instructions/new-org-tenant-onboarding.instructions.md`

2. **Gather** from the user:
   - Org type: Salesforce sandbox / production / scratch org?
   - Tenant ID / namespace
   - Which platform services to connect: NestJS AI API, Open WebUI, React chat?
   - Auth method: Named Credential, JWT, session-based?

3. **Salesforce side**:
   - Deploy permission sets, Named Credentials, External Credentials
   - Deploy Agentforce actions for this tenant
   - Validate with `sf project deploy validate`

4. **NestJS side**:
   - Add tenant config to `LlmProviderConfig`
   - Set up tenant-scoped Pinecone namespace
   - Verify auth guard recognizes the new tenant JWT/token

5. **Verification**:
   - Smoke test: `npm run ai-api:smoke:health`
   - Confirm tenant isolation: RAG query returns only this tenant's chunks
   - Confirm no cross-tenant data leakage in logs

$ARGUMENTS

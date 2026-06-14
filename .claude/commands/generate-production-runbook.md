# Generate Production Runbook

Generate a production runbook for a service, feature, or incident. Full details in `.github/prompts/generate-production-runbook.prompt.md`.

## Steps

1. **Gather context** — ask for:
   - Service or feature name
   - Runbook type: deployment / incident response / rollback / health check?
   - Target environment: Railway (NestJS), Salesforce, React chat?

2. **Structure the runbook** in `docs/deployment/<service>-runbook.md`:

   ```
   ## Overview
   ## Prerequisites
   ## Pre-deployment Checks
   ## Deployment Steps
   ## Smoke Tests
   ## Rollback Procedure
   ## Monitoring & Alerts
   ## Known Issues
   ```

3. **Requirements**:
   - Smoke test commands must be runnable: `npm run ai-api:smoke:health`, `npm run openwebui:smoke:gateway`
   - Salesforce deploy steps must use `sf project deploy validate` before `sf project deploy start`
   - Rollback must be explicit and documented
   - No secrets in the runbook — reference env var names only

$ARGUMENTS

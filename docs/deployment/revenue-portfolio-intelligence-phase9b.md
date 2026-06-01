# Phase 9B Revenue Portfolio Intelligence Runbook

## Purpose

Phase 9B adds portfolio-level Account Manager intelligence on top of the existing
Phase 9 account-health and account-directory flow. The slice is additive:

- `POST /agent/revenue/account-health` remains the single-account summary route.
- `List_Account_Manager_Accounts` remains the Salesforce-only directory route.
- `POST /agent/revenue/portfolio-intelligence` ranks and plans across the
  Account Manager portfolio using sanitized aggregate facts.

The workflow is read-only. It may recommend proactive actions, but it must not
create or mutate Salesforce, Certinia, support, finance, product, or services
records.

## Backend Contract

Route:

```text
POST /agent/revenue/portfolio-intelligence
```

Required scope:

```text
agentforce:revenue-portfolio-intelligence
```

ModelRouter use case:

```text
agentforce_revenue_portfolio_intelligence
```

Apex sends an `accounts[]` array with safe `accountReference` values and
aggregate metrics only. It must not send raw Salesforce Account IDs or Account
names to the backend prompt.

Expected response families:

- `portfolioStatus`
- `summary`
- `topRiskAccounts`
- `topExpansionAccounts`
- `urgentRenewals`
- `escalationAccounts`
- `silentAccounts`
- `portfolioWatchlists`
- `portfolioTrends`
- `recommendedActions`
- `weeklyExecutionPlan`
- provider, model, fallback, and latency metadata

## Salesforce Metadata

Deploy the Phase 9B metadata with the existing Revenue Operations agent package:

- `classes/AgentforceAccountManagerAccountDirectory.cls`
- `classes/AgentforceAmAccountDirectoryTest.cls`
- `classes/AgentforceAiApiRevPortfolioIntel.cls`
- `classes/AgentforceAiApiRevPortfolioIntelTest.cls`
- `genAiFunctions/List_Account_Manager_Accounts/**`
- `genAiFunctions/Analyze_Revenue_Portfolio_Intelligence/**`
- `genAiFunctions/Summarize_Revenue_Account_Health/**`
- `genAiPlugins/Revenue_Operations_Intelligence_Account_Directory.genAiPlugin-meta.xml`
- `genAiPlugins/Revenue_Operations_Intelligence_Account_Health.genAiPlugin-meta.xml`
- `genAiPlugins/Revenue_Operations_Intelligence_Portfolio.genAiPlugin-meta.xml`
- `permissionsets/Revenue_Operations_Intelligence_Agent.permissionset-meta.xml`
- `genAiPlannerBundles/Revenue_Operations_Intelligence_Agent/Revenue_Operations_Intelligence_Agent.genAiPlannerBundle`

Agentforce metadata can cache stale action bindings. If validation fails because
the active agent blocks topic or planner updates, deactivate the agent version,
run the targeted validation, deploy the same payload, reactivate the agent, and
then run the smoke prompts below.

### Certinia Deployment Recovery Notes - 2026-05-27

The Builder org at `mp05022026.lightning.force.com` maps to the Salesforce CLI
alias `certinia-phase8`, not the earlier `AgentForce` alias. Before deployment,
confirm the target with:

```bash
sf org display --target-org certinia-phase8 --json
sf org list metadata --target-org certinia-phase8 --metadata-type GenAiPlugin --json
sf org list metadata --target-org certinia-phase8 --metadata-type GenAiFunction --json
```

This issue repeated the Phase 8 stale-planner lesson: deploy the global
functions, global plugins, and planner bundle together while the active agent is
deactivated. Deploying only a function or only a plugin can leave the
planner-scoped runtime copy stale in Agent Builder.

The failed 2026-05-27 deploy attempts also exposed a CLI/Metadata API queue
problem. With Salesforce CLI `@salesforce/cli/2.132.14`, small certinia deploys
were created as `DeployRequest` rows that stayed `Pending` with `StartDate =
null`. Cancel those jobs and update the CLI before retrying:

```bash
sf project deploy report --target-org certinia-phase8 --job-id <job-id> --json
sf project deploy cancel --target-org certinia-phase8 --job-id <job-id> --json
npm install -g @salesforce/cli@latest
sf --version
```

After updating to `@salesforce/cli/2.135.7`, the old canceled jobs reconciled in
Tooling API and a new check-only validation received a real `StartDate`. The
first proof was directory Apex validation `0Afam00002UrkGvCAJ`: `Succeeded`, 2/2
components, 7/7 tests, 0 test errors. The updated CLI also rejects
`sf project deploy validate --test-level NoTestRun`; use `RunSpecifiedTests` for
validate commands and reserve `NoTestRun` only for deploy commands where the CLI
allows it and the package is metadata-only. Use this queue-health check before
every retry:

```bash
sf data query --target-org certinia-phase8 --use-tooling-api \
  --query "SELECT Id, Status, StateDetail, CreatedDate, StartDate, CompletedDate, CheckOnly FROM DeployRequest ORDER BY CreatedDate DESC LIMIT 8" \
  --result-format human
```

If any new non-check-only deploy is `Pending` with no `StartDate`, cancel it and
do not start another deployment. If a report command says `Canceled` but the
Tooling API still says `Pending`, run the same Tooling query after the CLI
update; do not stack deploys while the status is inconsistent.

Certinia org automation can also break otherwise isolated Apex tests. In this
org, `dlrs_OpportunityTrigger` can fail test `Opportunity` DML, so the directory
and portfolio tests avoid live Opportunity inserts and use provider seams or
other standard records for deterministic coverage.

Recommended certinia recovery sequence:

1. Confirm org identity and live metadata names.
2. Confirm no active deploy is stuck in `Pending` without `StartDate`.
3. Validate Account Directory Apex by itself.
4. Validate Portfolio Apex by itself.
5. Deactivate `Revenue_Operations_Intelligence_Agent`.
6. Deploy functions, all three plugins, planner bundle, and permission set in
   one package so planner-scoped copies refresh together.
7. Reactivate the agent immediately.
8. Re-list `GenAiFunction` metadata and retrieve the live planner bundle to
   prove Portfolio and Account Directory are bound in the target org. Do not
   rely on top-level `GenAiPlugin` list output for planner-local topics.
9. Smoke test plain user prompts; do not require the user to mention the AI API
   or any implementation route.

Current recovery evidence:

- Salesforce CLI updated from `@salesforce/cli/2.132.14` to
  `@salesforce/cli/2.135.7` using the npm-global install at
  `~/.nvm/versions/node/v22.22.0/bin/sf`.
- Stale non-check deploy jobs `0Afam00002UrjMTCAZ`, `0Afam00002UrjazCAB`, and
  `0Afam00002UrjfpCAB` reconciled to `Canceled` in Tooling API.
- Directory Apex check-only validation `0Afam00002UrkGvCAJ` succeeded with 2/2
  components and 7/7 `AgentforceAmAccountDirectoryTest` methods.
- Directory Apex real deploy `0Afam00002UrkiLCAR` succeeded with 2/2 components
  and 7/7 `AgentforceAmAccountDirectoryTest` methods. This created
  `AgentforceAccountManagerAccountDirectory` and
  `AgentforceAmAccountDirectoryTest` in `certinia-phase8`.
- Portfolio Apex check-only validation `0Afam00002Url4vCAB` succeeded with 2/2
  components and 10/10 `AgentforceAiApiRevPortfolioIntelTest` methods.
- Portfolio Apex real deploy `0Afam00002UrlGDCAZ` succeeded with 2/2 components
  and 10/10 `AgentforceAiApiRevPortfolioIntelTest` methods.
- Agentforce metadata validation `0Afam00002UrlXxCAJ` succeeded with 8/8
  components and 30/30 focused Revenue Operations tests.
- Agentforce metadata real deploy `0Afam00002UrjzCCAR` succeeded with 8/8
  components and 30/30 focused Revenue Operations tests.
- `Revenue_Operations_Intelligence_Agent v1` was reactivated after the real
  metadata deploy.
- Live function metadata showed `Summarize_Revenue_Account_Health`,
  `List_Account_Manager_Accounts`, and
  `Analyze_Revenue_Portfolio_Intelligence`, each last modified at
  `2026-05-27T11:32:37.000Z`.
- Retrieving the live planner bundle proved the three Revenue Operations topics
  are planner-local topics, not top-level `GenAiPlugin` list entries:
  Account Directory, Portfolio, and Account Health were present under
  `localTopics`, with matching `localActions` for directory, portfolio, and
  single-account health.
- Post-reactivation focused Apex tests passed 30/30, test run
  `707am00002xQIAw`.
- Direct Account Directory smoke passed with `directoryStatus=LISTED`,
  `accountCount=3`, and top account `Prestige Worldwide`.

### Certinia Auth Recovery Notes - 2026-05-27

The active `certinia-phase8` Salesforce callout path is a Custom External
Credential header, not the OAuth client-credentials registry path. The relevant
metadata is:

- Named Credential: `Agentforce_AI_API_Phase2`
- External Credential: `Agentforce_AI_API_Phase2`
- Principal: `Agentforce_AI_API_Phase2_Principal`
- Custom header formula:
  `Authorization: Bearer {!$Credential.Agentforce_AI_API_Phase2.AI_API_PHASE2_BEARER_JWT}`

If portfolio Apex smoke returns HTTP 403 after backend scope updates, inspect
the Custom External Credential first. In this incident, updating
`AI_API_AGENTFORCE_BEARER_SCOPES` and the Postgres OAuth tenant/client registry
was necessary hygiene but did not change the token already stored in Salesforce.

Safe rotation pattern used:

1. Generate a new high-entropy opaque bearer in a chmod `600` temp file.
2. Store only its SHA-256 digest in Railway
   `AI_API_AGENTFORCE_BEARER_TOKEN_SHA256` via `railway variable set --stdin`.
3. Wait for the ai-api redeploy triggered by the hash change to succeed.
4. Verify the raw bearer against
   `POST /agent/revenue/portfolio-intelligence` without printing it.
5. Store the raw bearer in Salesforce secure credential storage with:

   ```text
   PUT /services/data/v66.0/named-credentials/credential
   ```

   using `externalCredential=Agentforce_AI_API_Phase2`,
   `principalName=Agentforce_AI_API_Phase2_Principal`,
   `principalType=NamedPrincipal`, and encrypted credential key
   `AI_API_PHASE2_BEARER_JWT`.

6. Confirm the Salesforce encrypted credential revision changed, then delete all
   temp token/hash files.

Final auth evidence:

- Railway ai-api redeploy after the first scope update succeeded as deployment
  `4a22365d-dc9c-4bd1-bb59-7ff755ca9015`.
- Tenant registry entries for `certinia-phase8` and `certinia-phase8-oauth` were
  updated to include `agentforce:revenue-portfolio-intelligence`.
- Railway ai-api redeploy after bearer-hash rotation succeeded as deployment
  `254bc169-75f0-4e7f-b25e-fd62b31f6d73`.
- Salesforce secure credential `AI_API_PHASE2_BEARER_JWT` moved from encrypted
  revision 3 to revision 4.
- Direct portfolio Apex smoke passed through the Named Credential path with
  `analysisStatus=ANALYZED`, HTTP `201`, `portfolioStatus=WATCH`,
  `accountCount=3`, top account `TelAmeriCorp`, and no auth error.
- Existing single-account account-health regression passed after the bearer
  rotation with `actionStatus=SUMMARIZED`, HTTP `201`, provider `openai`, and
  model `gpt-4o-mini`.
- `sf agent preview start` still failed in this org with
  `PreviewStartFailed: Invalid user ID provided on start session`; use direct
  Apex smoke, focused tests, live metadata retrieval, and Builder/manual preview
  evidence until that org runtime-user configuration is corrected.

## Validation Commands

Backend focused checks:

```bash
npm run ai-api:build
npm run ai-api:test -- revenue-portfolio-intelligence
npm run ai-api:test:e2e -- --runInBand chat.e2e-spec.ts
```

Salesforce focused Apex tests:

```bash
sf apex run test --class-names AgentforceAiApiRevPortfolioIntelTest,AgentforceAiApiRevenueAccountHealthTest,AgentforceAmAccountDirectoryTest --wait 30 --result-format human
```

Targeted deploy validation:

```bash
sf project deploy validate \
  --target-org certinia-phase8 \
  --source-dir force-app/main/default/classes/AgentforceAccountManagerAccountDirectory.cls \
  --source-dir force-app/main/default/classes/AgentforceAccountManagerAccountDirectory.cls-meta.xml \
  --source-dir force-app/main/default/classes/AgentforceAmAccountDirectoryTest.cls \
  --source-dir force-app/main/default/classes/AgentforceAmAccountDirectoryTest.cls-meta.xml \
  --source-dir force-app/main/default/classes/AgentforceAiApiRevPortfolioIntel.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiRevPortfolioIntel.cls-meta.xml \
  --source-dir force-app/main/default/classes/AgentforceAiApiRevPortfolioIntelTest.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiRevPortfolioIntelTest.cls-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAmAccountDirectoryTest \
  --tests AgentforceAiApiRevPortfolioIntelTest \
  --wait 30
```

Agentforce metadata deployment after Apex validates:

```bash
sf agent deactivate --api-name Revenue_Operations_Intelligence_Agent --target-org certinia-phase8

sf project deploy start \
  --target-org certinia-phase8 \
  --source-dir force-app/main/default/genAiFunctions/List_Account_Manager_Accounts \
  --source-dir force-app/main/default/genAiFunctions/Analyze_Revenue_Portfolio_Intelligence \
  --source-dir force-app/main/default/genAiFunctions/Summarize_Revenue_Account_Health \
  --source-dir force-app/main/default/genAiPlugins/Revenue_Operations_Intelligence_Account_Directory.genAiPlugin-meta.xml \
  --source-dir force-app/main/default/genAiPlugins/Revenue_Operations_Intelligence_Account_Health.genAiPlugin-meta.xml \
  --source-dir force-app/main/default/genAiPlugins/Revenue_Operations_Intelligence_Portfolio.genAiPlugin-meta.xml \
  --source-dir force-app/main/default/genAiPlannerBundles/Revenue_Operations_Intelligence_Agent/Revenue_Operations_Intelligence_Agent.genAiPlannerBundle \
  --source-dir force-app/main/default/permissionsets/Revenue_Operations_Intelligence_Agent.permissionset-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAmAccountDirectoryTest \
  --tests AgentforceAiApiRevPortfolioIntelTest \
  --tests AgentforceAiApiRevenueAccountHealthTest \
  --wait 30

sf agent activate --api-name Revenue_Operations_Intelligence_Agent --target-org certinia-phase8
```

## Smoke Prompts

Use an employee user with the Revenue Operations Intelligence Agent permission
set and visible Account data.

Portfolio ranking:

```text
Which accounts in my portfolio need immediate attention this week?
```

Expected: the agent invokes `Analyze_Revenue_Portfolio_Intelligence` and returns
only the Revenue Portfolio Intelligence Brief. It should include portfolio
status, ranked accounts, watchlists or trends, proactive recommendations, a
weekly plan, and a top account drilldown candidate. The user should not need to
mention the implementation or any technical system name.

Expansion planning:

```text
Find the best expansion opportunities across my accounts this quarter. I confirm.
```

Expected: the portfolio brief ranks expansion opportunities, includes safe
supporting signals, and does not create Opportunities, quotes, tasks, forecasts,
or staffing requests.

Churn watchlists:

```text
Are any accounts trending toward churn, and can you build my watchlists? I confirm.
```

Expected: the portfolio brief groups churn, renewal, escalation, or quiet-account
watchlists and recommends retention actions without exposing backend payloads.

Drilldown handoff:

```text
What should I focus on first today across my portfolio?
```

If the agent asks for confirmation, reply:

```text
I confirm.
```

Then:

```text
Yes, drill into the recommended account.
```

Expected: the agent uses the planner-visible `topAccountId` from the portfolio
response to invoke `Summarize_Revenue_Account_Health` after confirmation without
requiring manual Account-ID copy/paste.

Regression prompts:

```text
Show me the accounts in my book that need attention.
```

Expected: the agent still invokes `List_Account_Manager_Accounts` and returns the
directory, not the portfolio analysis route.

```text
Summarize revenue account health for this Account. I confirm.
```

Expected: the agent still invokes `Summarize_Revenue_Account_Health` and returns
only the Revenue Account Health Brief.

## Rollback

Salesforce metadata rollback:

- Deactivate `Revenue_Operations_Intelligence_Agent` before changing the planner
  bundle in a live org.
- Remove `Analyze_Revenue_Portfolio_Intelligence` from
  `Revenue_Operations_Intelligence_Account_Health.genAiPlugin-meta.xml`.
- Redeploy the previous planner bundle and plugin payload, then reactivate the
  agent.
- Keep `Summarize_Revenue_Account_Health` and `List_Account_Manager_Accounts`
  deployed so the existing Phase 9 single-account and directory flows continue.
- If the new Apex bridge caused runtime issues, remove only
  `AgentforceAiApiRevPortfolioIntel` class access and the global function
  binding; do not remove the shared Named Credential used by existing validated
  flows.

Backend rollback:

- Revert Railway to the last release that did not expose
  `/agent/revenue/portfolio-intelligence` if the route itself is unhealthy.
- If rollback must be configuration-only, remove
  `agentforce:revenue-portfolio-intelligence` from the deployed bearer/OAuth
  scopes while leaving `agentforce:revenue-account-health` intact. In
  `certinia-phase8`, the active Salesforce path is the Custom External
  Credential bearer stored under `AI_API_PHASE2_BEARER_JWT`, so scope rollback
  must be paired with a deliberate bearer rotation if the old token should no
  longer call portfolio routes.
- Confirm `/agent/revenue/account-health` and existing support/services routes
  still pass their smoke checks after rollback.

## Evidence To Capture

- Backend route returns 201 with `portfolioStatus`, watchlists, trends, and plan
  fields under a scoped token.
- Backend rejects missing `agentforce:revenue-portfolio-intelligence` scope.
- Apex test confirms payload redaction: no raw Account IDs or Account names in
  the outbound body.
- Direct Apex smoke through the Named Credential returns `ANALYZED` for
  portfolio and `SUMMARIZED` for the existing account-health action.
- Agentforce transcript shows confirmation before external context is sent when
  Builder or runtime preview is available.
- Agentforce transcript shows portfolio-to-account drilldown using the existing
  single-account summary action when Builder or runtime preview is available.

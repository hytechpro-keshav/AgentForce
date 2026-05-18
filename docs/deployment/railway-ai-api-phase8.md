# Phase 8 — Services Org Intelligence Project Health

Date: 2026-05-14

This runbook covers the Phase 8 project-health route for Certinia PSA Services
Org Intelligence. The runtime path remains Salesforce Agentforce -> Apex ->
Named Credential -> Railway NestJS AI API -> ModelRouter.

For next-session continuity, pair this runbook with
`docs/agents/services-org-intelligence.md`,
`docs/context/phase8-session-summary.md`, and
`specs/services-org-intelligence-agent.yaml`.

## Service Shape

```text
Agentforce
  -> Services Org Intelligence Showcase Agent new
    -> Services Org Intelligence Project Health topic
      -> List PSA Projects
        -> AgentforcePsaProjectDirectory
          -> read-only user-mode SOQL over pse__Proj__c
      -> Summarize Project Health Brief
        -> AgentforceAiApiProjectHealth
          -> callout:Agentforce_AI_API_Phase2/agent/services/project-health
            -> ProjectHealthService
              -> deterministic PSA risk metrics
              -> ModelRouter summary/explanation
```

The backend never queries Salesforce directly. Apex collects Certinia PSA facts,
masks or omits sensitive text, and sends a flat aggregate payload to Railway.
The project directory action is Salesforce-only and does not call Railway.

## Backend Contract

- Route: `POST /agent/services/project-health`
- Scope: `agentforce:services-project-health`
- Use case: `agentforce_services_project_health`
- Request: flat aggregate project facts from PSA objects.
- Response: flat Agentforce-friendly fields for health, risk, schedule, budget,
  staffing, summary, risk drivers, recommended actions, confidence, provider,
  model, fallback, and latency.

The user-facing `Project Health Brief` is not raw model text. It is assembled by
Apex from validated backend output and includes a compact `Signals reviewed`
section so demos can explain why the result was produced.

Scoring basis:

- Schedule uses project status, late milestones, overdue tasks, passed end date
  with less than 95% hours complete, rejected timecards, and submitted
  timecards awaiting approval.
- Budget uses estimated hours at completion versus planned hours, project
  remaining amount, budget remaining amount, and margin signal.
- Staffing uses open resource requests, close-to-start resource requests,
  at-risk assignments, active assignment counts, and planned hours without
  assignments.
- Category scores map to Green at 0, Yellow at 1-2, and Red at 3+. Overall
  health is the worst of schedule, budget, staffing, and project status. Risk is
  Low, Medium, High, or Critical based on total score and whether health is Red.
- Confidence is based on how many major signal groups were populated before the
  external summary call.

Main Certinia PSA field sources: `pse__Proj__c.pse__Project_Status__c`,
`pse__Start_Date__c`, `pse__End_Date__c`,
`pse__Percent_Hours_Complete__c`, `pse__Planned_Hours__c`,
`pse__Estimated_Hours_at_Completion__c`, `pse__Remaining_Amount__c`,
`pse__Margin__c`, plus aggregate counts and sums from `pse__Assignment__c`,
`pse__Milestone__c`, `pse__Timecard_Header__c`, `pse__Project_Task__c`,
`pse__Resource_Request__c`, and `pse__Budget__c`.

Suggested model routing override:

```json
{
  "routes": {
    "agentforce_services_project_health": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "budget": {
        "maxOutputTokensPerRequest": 320,
        "maxTokensPerMinute": 5000
      },
      "allowProviderOverride": false,
      "allowModelOverride": false
    }
  }
}
```

Merge this with existing `MODEL_ROUTING_CONFIG_JSON` rather than replacing live
routes unintentionally.

## Salesforce-Only Directory Contract

- Function: `List_PSA_Projects`
- Apex target: `AgentforcePsaProjectDirectory`
- Input: optional `statusFilter`, `searchText`, `maxResults`.
- Output: displayable `projectDirectory` plus planner fields
  `directoryStatus`, `projectCount`, `resultLimit`, `hasMore`, and `projectIds`.
- Default limit: 10; hard cap: 25.
- Security: `with sharing` plus `WITH USER_MODE`; no callout and no record
  mutation.

The directory intentionally shows only projects visible to the running Employee
Agent user. It includes copyable Salesforce Project IDs so the user can ask a
second prompt such as `Summarize health for project ID <id>`.

## Credential Scope

The existing `Agentforce_AI_API_Phase2` Named Credential is reused. Its bearer
credential must include the new scope:

```text
agentforce:services-project-health
```

For the durable opaque service-bearer path, update Railway
`AI_API_AGENTFORCE_BEARER_SCOPES` to include the new scope and update the
Salesforce encrypted external credential value with the raw opaque token when
rotating. Do not print raw token values in CLI logs.

For multiple Salesforce orgs sharing the same Railway ai-api service, do not
reuse one raw bearer token across orgs. Prefer the multi-bearer variable and
store only SHA-256 token hashes in Railway:

```json
[
  {
    "tokenSha256": "<sha256-of-certinia-phase8-token>",
    "subject": "certinia-phase8-agentforce",
    "tenantId": "certinia-phase8",
    "ragNamespace": "certinia-phase8",
    "scopes": ["agentforce:services-project-health"],
    "roles": ["services-org-intelligence"]
  },
  {
    "tokenSha256": "<sha256-of-second-org-token>",
    "subject": "second-org-agentforce",
    "tenantId": "second-org",
    "ragNamespace": "second-org",
    "scopes": ["agentforce:services-project-health"],
    "roles": ["services-org-intelligence"]
  }
]
```

Set that JSON in Railway as `AI_API_AGENTFORCE_BEARERS_JSON`. Each Salesforce
org must store its own raw bearer only in its own External Credential secure
value, such as `AI_API_PHASE2_BEARER_JWT`; Railway stores the matching hash,
not the raw token. The legacy single-org variables
`AI_API_AGENTFORCE_BEARER_TOKEN_SHA256`, `AI_API_AGENTFORCE_BEARER_SCOPES`, and
related subject/tenant variables remain supported for backward compatibility.
When both legacy and JSON bearers are present, token hashes must be unique.

The application default service-bearer scope set includes Phase 8 for new
deployments. Existing Railway environments with an explicit
`AI_API_AGENTFORCE_BEARER_SCOPES` value still need that variable refreshed.

Optional Phase 8 route limits:

```text
AGENTFORCE_RATE_LIMIT_WINDOW_MS=60000
AGENTFORCE_RATE_LIMIT_MAX_REQUESTS=60
```

These guard model-backed Agentforce routes by tenant, subject, route, and client
address. Use Railway or edge limits as an outer production control.

## Salesforce Metadata

Deploy only the changed Phase 8 slice:

```bash
sf project deploy validate \
  --source-dir force-app/main/default/classes/AgentforceAiApiProjectHealth.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiProjectHealthTest.cls \
  --source-dir force-app/main/default/classes/AgentforcePsaProjectDirectory.cls \
  --source-dir force-app/main/default/classes/AgentforcePsaProjectDirectoryTest.cls \
  --source-dir force-app/main/default/genAiFunctions/Summarize_Project_Health_Brief \
  --source-dir force-app/main/default/genAiFunctions/List_PSA_Projects \
  --source-dir force-app/main/default/genAiPlugins/p_16jam000001LYPV_Services_Org_Intelligence_Project_Health_new.genAiPlugin-meta.xml \
  --source-dir force-app/main/default/genAiPlannerBundles/Services_Org_Intelligence_Showcase_Agent_new \
  --source-dir force-app/main/default/permissionsets/Services_Org_Intelligence_Agent.permissionset-meta.xml \
  --source-dir force-app/main/default/externalCredentials/Agentforce_AI_API_Phase2.externalCredential-meta.xml \
  --source-dir force-app/main/default/namedCredentials/Agentforce_AI_API_Phase2.namedCredential-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiProjectHealthTest \
  --tests AgentforcePsaProjectDirectoryTest \
  --target-org certinia-phase8 \
  --wait 30
```

Include the `Agentforce_AI_API_Phase2` Named Credential and External Credential
metadata when the target org does not already have them. Without those
prerequisites, the permission set principal reference fails with `invalid cross
reference id`.

The Apex data provider uses sharing plus user-mode SOQL over the PSA objects and
the permission set grants read-only object and field access only for the queried
aggregate signals. Required managed-package fields cannot be represented in
field permission metadata and are intentionally omitted from the permission set.

No fallback custom objects are part of this deployment. Do not include a broad
`force-app/main/default/objects` deploy target unless a future org genuinely
lacks Certinia PSA fields and an approved fallback object model has been added.

## Showcase Agent

Phase 8 uses a dedicated Employee Agent showcase,
`Services_Org_Intelligence_Showcase_Agent_new`, instead of modifying existing
managed or custom Certinia agents. The target org currently exposes multiple
plausible services/project agents:

- `Project_Management_Agent`
- `Certinia_Winter_26_Project_Assistant_Agent`
- `Certinia_Staffing_Agent`
- managed Certinia project/staffing templates

The dedicated Employee Agent was created from the Certinia Project Assistant
template, then narrowed to one analysis-only topic,
`Services Org Intelligence Project Health`, with two read-only actions: `List
PSA Projects` and `Summarize Project Health Brief`. This keeps the showcase path
simple, avoids changing managed templates, and keeps the runtime in a PSA-capable
employee user context.
If a later production release promotes the action into an existing
project/staffing agent, use the supported lifecycle:

```bash
sf agent deactivate --api-name <AgentApiName> --target-org certinia-phase8
sf project deploy start --source-dir force-app/main/default/genAiPlannerBundles/<AgentApiName> --target-org certinia-phase8 --wait 30
sf agent activate --api-name <AgentApiName> --target-org certinia-phase8
```

Then validate with Agent Builder Preview or Salesforce UI. If the CLI preview
path works for the chosen agent type, `sf agent preview start`, `send`, and
`end` can also be used; for the current Employee Agent, the CLI preview path
returns an empty user id during session startup.

Open the dedicated runtime showcase agent after deployment:

```bash
sf org open agent --api-name Services_Org_Intelligence_Showcase_Agent_new --target-org certinia-phase8
```

Current target-org runtime details:

- Bot ID: `0Xxam000000tdGrCAI`
- Planner ID: `16jam000001LYPVAA4`
- Agent type/runtime type: `AgentforceEmployeeAgent` / `InternalCopilot`
- Bot version: version 1 active
- Access permission set:
  `Services_Org_Intelligence_Showcase_Agent_new_Access`
- Assigned pilot user: `mschaffer@mp05022026.com`
- The local metadata intentionally does not set `<botUser>` because attempts to
  force a named bot user returned `User doesn't have access to agent`.

The first metadata-only planner bundle, `Services_Org_Intelligence_Agent`, was
deployable as a planner definition but was not an activatable runtime agent. Do
not use that API name for preview or activation. It is still the permission set
API name used for the Phase 8 Apex and credential access.

## Pilot Data And Reports

Run read-only discovery first:

```bash
bash scripts/smoke/phase8-certinia-psa-discovery.sh certinia-phase8
```

Use existing Certinia report types and PSA screens before adding new report
metadata. The org already includes PSA report surfaces for project milestones,
project tasks/time, assignments, resource requests, and timecards.

## Smoke Checks

Local validation before deployment:

```bash
npm run ai-api:typecheck
npm run ai-api:test
npm run ai-api:test:e2e
npm run ai-api:build
npm run prettier:verify
```

Direct backend smoke after deployment should use a scoped JWT or service bearer
with `agentforce:services-project-health` and a sanitized aggregate payload. Do
not include project names, account names, notes, timecard comments, or secrets.

Current deployed proof points:

- Railway deployment `7e435f13-8c71-41f6-8e2b-c20408c65c6a`: Phase 8
  project-health route deployment `SUCCESS`.
- Railway deployment `6e545e8c-c696-4146-b8de-986a3cdffc28`:
  backward-compatible multi-org Agentforce bearer isolation deployment
  `SUCCESS`; no Railway variable values were changed. Live smoke returned
  `/health/live=200` and unauthenticated `/agent/services/project-health=401`.
- Live unauthenticated route returns 401 `Missing bearer token`, proving
  `/agent/services/project-health` is deployed.
- Salesforce deploy `0Afam00002Ui3EPCAZ`: succeeded with 14/14 Apex tests.
- Showcase topic deploy `0Afam00002Ui3j3CAB`: succeeded after removing the
  generated native knowledge action.
- New Employee Agent planner deploy `0Afam00002Ui5o5CAB`: succeeded with the
  initial one-topic, one-action Phase 8 planner.
- New Employee Agent corrected plugin/function binding deploy
  `0Afam00002Ui7hpCAB`: succeeded, creating GenAiPlugin
  `p_16jam000001LYPV_Services_Org_Intelligence_Project_Health_new` and binding
  it to global function `Summarize_Project_Health`.
- Project directory and readable health output deploy `0Afam00002Ui9OfCAJ`:
  succeeded with 19/19 Apex tests, creating `AgentforcePsaProjectDirectory` and
  `List_PSA_Projects`, adding a formatted health `executiveBrief`, and binding
  both actions into the Services Org Intelligence topic.
- Planner resync deploy `0Afam00002UiAZFCA3`: succeeded and refreshed the
  planner-scoped runtime topic for `Services_Org_Intelligence_Showcase_Agent_new`
  so the active planner exposes both scoped actions:
  `List_PSA_Projects_179am000000zEXV` and
  `Summarize_Project_Health_179am000000zEXV`.
- Project directory display polish deploy `0Afam00002UiFdlCAF`: succeeded with
  5/5 Apex tests, changing directory output to show `Margin signal` instead of
  incorrectly formatting every margin field as a percentage.
- Brief-action UX deploy `0Afam00002UiGJhCAN`: succeeded, creating
  `Summarize_Project_Health_Brief` and resyncing the planner-scoped runtime
  topic to expose `Summarize_Project_Health_Brief_179am000000zEm2`. This avoids
  the stale Agent Builder Preview scalar-output rendering from the original
  `Summarize_Project_Health` action copy.
- Service Org output polish deploy `0Afam00002UiH9JCAV`: succeeded with 19/19
  Apex tests, creating cleaner project-directory blocks and adding a
  `Signals reviewed` source-basis section to the health brief. The refreshed
  planner-scoped actions are `List_PSA_Projects_179am000000zEqs` and
  `Summarize_Project_Health_Brief_179am000000zEqs`.
- Final health brief typo fix deploy `0Afam00002UiHHNCA3`: succeeded with 14/14
  Apex health tests.
- New Employee Agent access permission set deploy `0Afam00002Ui60zCAB`:
  succeeded and was assigned to `mschaffer@mp05022026.com`.
- Apex hardening deploy `0Afam00002Ui1KgCAJ`: succeeded with 14/14 Apex tests.
- Direct Apex smoke request `manual-phase8-smoke-001` returned `SUMMARIZED`,
  HTTP 201, provider `openai`, model `gpt-4o-mini`, `healthStatus=yellow`, and
  `riskLevel=medium`.
- The first Service Agent preview reached the action and asked for confirmation,
  but final through-agent summarization was blocked because the generated
  Agentforce runtime user lacks a Certinia PSA (`pse`) package license. Runtime
  debug shows `System.QueryException: sObject type 'pse__Proj__c' is not
supported`.
- The new Employee Agent is active and avoids that generated-runtime-user path.
  CLI published preview currently fails at session startup with `Invalid user ID
provided on start session:` before any prompt is sent.
- Salesforce Evaluation API proof using
  `agent-eval/services-org-intelligence-phase8-new-agent-proof.yaml` passed for
  both prompts:
  - `Show me the projects in the system.` returned `directoryStatus=LISTED` and
    a `Project Directory` containing copyable `Salesforce Project ID` values and
    `Margin signal` details.
  - `Can you summarize the health of project ID aAiam000006oM3eCAE?` plus
    confirmation `I confirm you may send sanitized aggregate project facts to the
external AI API. Summarize the project health now.` invoked
    `Summarize_Project_Health_Brief_179am000000zEqs` and returned
    `actionStatus=SUMMARIZED`, `healthStatus=yellow`, `riskLevel=medium`,
    `scheduleStatus=green`, `budgetStatus=yellow`, `staffingStatus=green`,
    provider `openai`, model `gpt-4o-mini`, and an `executiveBrief` containing
    `Project Health Brief`, `Signals reviewed`, and `Next best action plan`.
    Captured Conversation Preview state shows only displayable `executiveBrief`
    in the action result; raw scalar fields remain in planner state only.

## Rollback

- Remove `agentforce:services-project-health` from the service-bearer scope to
  stop new Phase 8 calls.
- Remove or unassign the `Services_Org_Intelligence_Agent` permission set from
  the pilot runtime user.
- Deactivate or remove the dedicated
  `Services_Org_Intelligence_Showcase_Agent_new`
  runtime agent if the showcase surface needs to be withdrawn.
- Remove the related
  `Services_Org_Intelligence_Showcase_Agent_new_Access` permission-set
  assignment from pilot users.
- Remove the Phase 8 `Agentforce_AI_API_Phase2` credential metadata only if it
  was introduced solely for this pilot and no earlier phases depend on it.
- Roll Railway back to the previous deployment if the route or model routing
  behaves unexpectedly.
- Revert the `MODEL_ROUTING_CONFIG_JSON` route override if it causes provider or
  budget validation issues.
- If the action is later promoted into an existing managed/custom planner,
  deactivate that agent, deploy the previous planner bundle, and reactivate.

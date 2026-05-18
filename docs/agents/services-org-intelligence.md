# Services Org Intelligence Agent

## Overview

Phase 8 adds a dedicated internal Employee Agent for services leaders who need
to browse visible Certinia PSA projects and request read-only delivery-health
summaries.

The implementation keeps Salesforce and Certinia PSA as the system of record:

- Apex gathers only sanitized aggregate PSA facts.
- Named Credential `Agentforce_AI_API_Phase2` calls Railway.
- The NestJS AI API computes deterministic schedule, budget, staffing, health,
  and risk values first.
- `ModelRouter` turns those controlled facts into a short executive-safe brief.

This is a read-only showcase path. It does not create, update, rebaseline,
approve, reject, or otherwise mutate PSA records.

## Agent Flow

```text
Services leader
  -> Services_Org_Intelligence_Showcase_Agent_new
    -> Services Org Intelligence Project Health topic
      -> List_PSA_Projects
        -> AgentforcePsaProjectDirectory
          -> user-mode SOQL over visible pse__Proj__c records
      -> Summarize_Project_Health_Brief
        -> AgentforceAiApiProjectHealth
          -> callout:Agentforce_AI_API_Phase2/agent/services/project-health
            -> ProjectHealthService deterministic scoring
            -> ModelRouter summary/explanation
```

## Preferred Runtime

- Runtime agent: `Services_Org_Intelligence_Showcase_Agent_new`
- Runtime type: `AgentforceEmployeeAgent` / `InternalCopilot`
- Planner ID: `16jam000001LYPVAA4`
- Topic: `Services Org Intelligence Project Health`

The earlier service-agent proof path was superseded because the generated
runtime user could not reliably read Certinia PSA objects. The Employee Agent is
the supported showcase path because it runs in a PSA-capable employee context.

Planner-scoped action names are generated local copies and can change whenever
the planner is resynced. The last proved scoped actions were:

- `List_PSA_Projects_179am000000zEqs`
- `Summarize_Project_Health_Brief_179am000000zEqs`

## Current UX Contract

### Project Directory

`List_PSA_Projects` is Salesforce-only. It returns a readable project list in
per-project blocks with:

- project name
- copyable Salesforce Project ID
- PSA Project ID
- visible status, dates, and hours complete
- margin signal
- forecast EAC vs planned hours
- remaining amount

### Project Health Brief

`Summarize_Project_Health_Brief` requires confirmation because sanitized
aggregate project facts are sent to the external AI API. The user-facing answer
must display only the formatted `executiveBrief` and not the raw planner fields.

The brief is organized as:

- `Overall`
- `Status snapshot`
- `Why this result`
- `Signals reviewed`
- `Next best action plan`
- `Confidence`

## Deterministic Basis

The model does not invent health status. The scores come from controlled PSA
facts first, then the model writes the short narrative.

Primary sources:

- `pse__Proj__c`
- `pse__Assignment__c`
- `pse__Milestone__c`
- `pse__Timecard_Header__c`
- `pse__Project_Task__c`
- `pse__Resource_Request__c`
- `pse__Budget__c`

High-level scoring rules:

- Schedule risk uses project status, late milestones, overdue tasks, passed end
  date with low completion, and rejected timecards.
- Budget risk uses EAC versus planned hours, remaining amount, budget remaining
  amount, and margin signal.
- Staffing risk uses open resource requests, close-to-start requests,
  at-risk assignments, and planned hours without assignments.
- Overall health is the worst of schedule, budget, staffing, and project
  status.
- Confidence depends on how many major signal groups are populated.

## Current Proof Status

Key completed proof points:

- Brief-action identity fix deploy: `0Afam00002UiGJhCAN`
- UX polish deploy: `0Afam00002UiH9JCAV`
- Final brief typo fix deploy: `0Afam00002UiHHNCA3`
- Final scoped action proof sessions:
  - project list: `019e2658-08a1-7f7b-9089-c3dc450939f2`
  - project health: `019e2658-088e-76b4-a4be-a8d9fbb3a548`
- Final eval result: project list passed `4/4`; project health passed `8/8`

The final proved health output contains `Project Health Brief`,
`Signals reviewed`, and `Next best action plan`.

## Manual Prompts

Use these prompts for manual demo or regression checks:

- `Show me the projects in the system.`
- `List projects I can inspect, limit 5.`
- `Show me yellow projects.`
- `Can you summarize the health of project ID <Salesforce Project ID>?`
- `What is this project health based on?`
- `What signals were reviewed for this project?`
- `What are the top delivery risks and next best actions for project ID <id>?`
- `Rebaseline this project for me.` Expected result: read-only refusal.

## Key Lessons From Phase 8

- If an Employee Agent preview keeps showing stale raw fields after a schema
  change, the planner-scoped local action copy may still be stale.
- In that case, create a fresh global action identity, deploy the planner bundle
  together with the plugin and functions while the agent is deactivated, then
  reactivate.
- For UX changes, evals should assert the action identity and the visible
  section labels, not just the hidden status fields.
- Keep raw planner fields for reasoning, but expose only one formatted display
  field for the final UX contract.

## References

- Proof: [../testing/phase8-services-org-intelligence-proof.md](../testing/phase8-services-org-intelligence-proof.md)
- Runbook: [../deployment/railway-ai-api-phase8.md](../deployment/railway-ai-api-phase8.md)
- Session summary: [../context/phase8-session-summary.md](../context/phase8-session-summary.md)
- Agent spec: [../../specs/services-org-intelligence-agent.yaml](../../specs/services-org-intelligence-agent.yaml)

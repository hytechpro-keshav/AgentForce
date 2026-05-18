# 2026-05-14 Phase 8 Session Summary

## What Was Completed

- Added the Phase 8 Services Org Intelligence backend route
  `POST /agent/services/project-health` behind the existing Railway ai-api.
- Added deterministic `ProjectHealthService` scoring for schedule, budget,
  staffing, overall health, delivery risk, and confidence before the model
  writes the summary.
- Added Salesforce Apex `AgentforceAiApiProjectHealth` for read-only Certinia
  PSA aggregation and `AgentforcePsaProjectDirectory` for visible project
  browsing.
- Added Agentforce actions `Summarize_Project_Health_Brief` and
  `List_PSA_Projects` with input/output schemas.
- Added the dedicated Employee Agent showcase
  `Services_Org_Intelligence_Showcase_Agent_new` instead of modifying existing
  Certinia project/staffing agents.
- Added project-picker behavior so the user can list visible projects, copy a
  Salesforce Project ID, and ask for a health summary in a second prompt.
- Implemented multi-org opaque bearer isolation in Railway with
  `AI_API_AGENTFORCE_BEARERS_JSON`, so multiple Salesforce orgs can share one
  ai-api service without sharing raw tokens.
- Fixed stale Agent Builder output by introducing a fresh global action
  identity, `Summarize_Project_Health_Brief`, and resyncing the planner bundle.
- Polished the UX so the Project Directory renders in readable project blocks
  and the Project Health Brief renders as `Overall`, `Status snapshot`, `Why
this result`, `Signals reviewed`, `Next best action plan`, and `Confidence`.

## Runtime Proof Evidence

- Preferred runtime agent: `Services_Org_Intelligence_Showcase_Agent_new`
- Runtime type: `AgentforceEmployeeAgent` / `InternalCopilot`
- Planner ID: `16jam000001LYPVAA4`
- Brief-action identity fix deploy: `0Afam00002UiGJhCAN`
- UX polish deploy: `0Afam00002UiH9JCAV`
- Final brief typo fix deploy: `0Afam00002UiHHNCA3`
- Final scoped project-list action:
  `List_PSA_Projects_179am000000zEqs`
- Final scoped health action:
  `Summarize_Project_Health_Brief_179am000000zEqs`
- Final project-list proof session:
  `019e2658-08a1-7f7b-9089-c3dc450939f2`
- Final project-health proof session:
  `019e2658-088e-76b4-a4be-a8d9fbb3a548`
- Final eval result:
  - project list passed `4/4`
  - project health passed `8/8`

## Demo Basis

The demo story is deterministic scoring plus a safe narrative:

- Salesforce/Apex gathers aggregate facts from live Certinia PSA objects using
  sharing and `WITH USER_MODE`.
- Railway computes the actual status fields first.
- `ModelRouter` only explains those controlled facts in short business language.

Main source objects:

- `pse__Proj__c`
- `pse__Assignment__c`
- `pse__Milestone__c`
- `pse__Timecard_Header__c`
- `pse__Project_Task__c`
- `pse__Resource_Request__c`
- `pse__Budget__c`

High-level scoring basis:

- Schedule: project status, late milestones, overdue tasks, passed end date,
  rejected timecards.
- Budget: EAC vs planned hours, remaining amount, budget remaining amount,
  margin signal.
- Staffing: open resource requests, close-to-start requests, at-risk
  assignments, planned hours without assignments.
- Overall health: worst of schedule, budget, staffing, and project status.

## Key Lessons

- The generated Service Agent runtime user was not a good PSA showcase path.
  The Employee Agent path is preferred because it runs in a PSA-capable employee
  user context.
- Planner-scoped local action copies can stay stale even after source metadata
  is correct.
- If stale display flags remain, create a fresh action identity and redeploy the
  planner bundle together with the plugin and functions while the agent is
  deactivated, then reactivate.
- For UX regressions, evals should assert the action identity and required
  visible labels such as `Project Health Brief`, `Signals reviewed`, and `Next
best action plan`.

## Questions To Ask The Agent

- `Show me the projects in the system.`
- `Can you summarize the health of project ID <Salesforce Project ID>?`
- `What signals were reviewed for this project?`
- `What is this project health based on?`
- `What are the next best actions for this project?`
- `Rebaseline this project for me.`

Expected boundary: the last prompt must be refused because the Phase 8 agent is
analysis-only.

## How To Verify Logs During A Manual Prompt

1. Trace the employee user or the runtime surface being used for the demo.
2. Ask the project-list or project-health prompt in Agent Builder Preview or the
   published internal surface.
3. Query `ApexLog` and inspect the newest log.
4. For project list, confirm `AgentforcePsaProjectDirectory.listProjects` ran.
5. For project health, confirm `AgentforceAiApiProjectHealth.summarizeProjectHealth`
   ran and called
   `callout:Agentforce_AI_API_Phase2/agent/services/project-health`.
6. Confirm the user-visible answer matches the structured output and contains
   the expected labeled sections.

## Repo-Owned Guidance Updated

- Salesforce Agentforce instruction guidance:
  `.github/instructions/salesforce-agentforce.instructions.md`
- Testing/eval instruction guidance:
  `.github/instructions/testing-evals.instructions.md`
- Agent doc: `docs/agents/services-org-intelligence.md`
- Deployment runbook: `docs/deployment/railway-ai-api-phase8.md`
- Proof doc: `docs/testing/phase8-services-org-intelligence-proof.md`
- Agent spec: `specs/services-org-intelligence-agent.yaml`
- Repo project memory: `docs/context/project-memory.md`
- Repo memory notes: `/memories/repo/phase8-services-org-intelligence.md`

There are no repo-owned custom `SKILL.md` files in this workspace for Phase 8,
so there were no local skill-definition files to update.

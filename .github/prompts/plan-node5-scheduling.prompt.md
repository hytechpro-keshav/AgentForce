---
name: "Plan Node 5 Scheduling"
description: "Deep technical analysis and implementation readiness review for Node 5 Scheduling before any coding: architecture, Salesforce Field Service audit, gap analysis, prerequisite checklist, and phased implementation plan."
agent: "Node 5 Scheduling Planner"
argument-hint: "Org alias (default AgentForce), optional focus (Field Service prep, contracts only, UI/verdict, demo Case id), and whether to include live SF inspection"
tools: [read, search, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Agentforce Reviewer"
  - "Security Reviewer"
  - "Telemetry Reviewer"
  - "Release Checker"
  - "Code Review Orchestrator"
---

# Execution mode — plan and research only, do not implement

You are in **planning mode**. Perform a complete investigation and produce an implementation-readiness report. **Do not start coding** unless `${input}` explicitly asks to implement in the same session.

Use the installed workspace skills for this task.

## Required skill-loading order

1. `framework-selection` — confirm LangGraph orchestrator remains the right layer for Node 5
2. `langgraph-fundamentals` — graph placement, state channels, non-interrupting node pattern
3. `langgraph-case-triage-slice` — mirror Nodes 1–3 boundary contracts and status events
4. `langgraph-node4-parts-logistics` — upstream `partsLogistics` channel and fulfillment-readiness semantics that gate scheduling
5. `langgraph-human-in-the-loop` — Node 6 guardrail context; Node 5 must not call `interrupt()`
6. `langgraph-persistence` — durable workflow lookup and restart-safe Case resolution
7. `salesforce-node4-parts-prep` — Field Service inventory baseline already shipped (scheduling builds on same org)
8. `langgraph-node5-scheduling` — Node 5 skill stub; defers to phase plan after planning pass
9. `new-org-tenant-onboarding` — only if OAuth run-as user lacks Field Service / scheduling FLS
10. `salesforce-case-create` — only if demo Cases are needed for live proof planning

> **Note:** Complete `docs/orchestrator/node-5-scheduling-phase-plan.md` via this planning prompt before expanding the Node 5 skill for implementation.

## Agent persona

Adopt `.github/agents/node5-scheduling-planner.agent.md`.

Escalate to specialist agents when the analysis touches that surface (see agent file).

## Relevant repo instructions (honor during analysis)

- [AGENTS.md](../../AGENTS.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)
- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [Salesforce Agentforce instructions](../instructions/salesforce-agentforce.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)
- [telemetry instructions](../instructions/telemetry.instructions.md)
- [testing and eval instructions](../instructions/testing-evals.instructions.md)
- [new org tenant onboarding instructions](../instructions/new-org-tenant-onboarding.instructions.md)

## Canonical documents (read before analysis)

| Document                        | Path                                                                        | Why                                                             |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Orchestrator flow (primary)** | `docs/orchestrator/case-triage-orchestrator-flow.md`                        | Node 5 placement, UI story, eight-node chain                    |
| Node phase completion checklist | `docs/orchestrator/new-node-phase-completion-checklist.md`                  | Cross-cutting requirements every node must satisfy              |
| Node 4 phase plan (pattern)     | `docs/orchestrator/node-4-parts-logistics-phase-plan.md`                    | §0 shipped state, contracts, acceptance, demo matrix            |
| Node 4 4b/4c plan               | `docs/orchestrator/node-4-parts-4b-4c-plan.md`                              | Write-back patterns; scheduling may follow similar gated writes |
| Node 3 design                   | `docs/orchestrator/node-3-knowledge-base-agent.md`                          | Upstream recommended actions                                    |
| Node 2 design                   | `docs/orchestrator/node-2-customer-history-agent.md`                        | SLA / account context for scheduling priority                   |
| Remediation backlog             | `docs/orchestrator/service-workflow-remediation-backlog.md`                 | Reserved `scheduling` channel namespace                         |
| Service ops architecture        | `docs/agents/service-operations-operating-system.md`                        | Technician assignment, Field Service agent mapping              |
| Customer self-service           | `docs/agents/customer-self-service.md`                                      | Scheduling Agent bundle status, Field Service gaps              |
| Node 4 auth lessons             | `docs/context/node4-auth-session-lessons.md`                                | OAuth run-as user + Field Service PSL patterns                  |
| Warehouse / ship-to data        | `data/warehouse-transit-rules.json`, `data/products-and-location-data.json` | Geographic context for technician territory                     |
| KB corpus                       | `apps/ai-api/data/knowledge/kb-laptop-corpus.json`                          | Service visit duration hints if any                             |

## Shipped implementation references (validate against code)

| Area                     | Path                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| Graph                    | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                               |
| Orchestrator service     | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts`                |
| Lifecycle IDs            | `apps/ai-api/src/orchestrator/dto/case-triage-lifecycle.ts`                       |
| Parts channel (upstream) | `apps/ai-api/src/orchestrator/dto/parts-logistics.ts`                             |
| Knowledge channel        | `apps/ai-api/src/orchestrator/dto/knowledge-guidance.ts`                          |
| Customer channel         | `apps/ai-api/src/orchestrator/dto/customer-context.ts`                            |
| Case context             | `apps/ai-api/src/orchestrator/dto/salesforce-case-context.ts`                     |
| Verdict synthesizer      | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`                |
| Status events            | `apps/ai-api/src/orchestrator/dto/orchestration-status-event.ts`                  |
| Parts planner            | `apps/ai-api/src/orchestrator/parts-logistics-planner.service.ts`                 |
| Inventory gateway        | `apps/ai-api/src/salesforce/salesforce-inventory.gateway.ts`                      |
| Case gateway             | `apps/ai-api/src/salesforce/salesforce-case.gateway.ts`                           |
| UI                       | `apps/react-chat-window/components/OrchestrationView.tsx`, `lib/orchestration.ts` |
| Smoke                    | `scripts/smoke/all-3-nodes-deployed.sh` (or successor)                            |
| Scheduling Agent (SF)    | `force-app/main/default/genAiPlannerBundles/Scheduling_Agent/`                    |

## User-provided context

```text
${input}
```

Defaults when the user provides no arguments:

- Org alias: **AgentForce**
- Focus: full readiness review (architecture + Salesforce + contracts + UI + tests)
- Output: create or update `docs/orchestrator/node-5-scheduling-phase-plan.md`
- Live SF inspection: **required** (use `sf` CLI against connected org)

---

## Objectives

### 1. Understand the existing architecture

- Review the complete orchestrator flow document.
- Understand how Nodes 1–4 were designed and implemented.
- Analyze the current graph structure, channels, state management, UI surfaces, APIs, Salesforce integrations, and deployment architecture.
- Identify all dependencies between Node 5 and previous nodes — especially how `partsLogistics.fulfillmentReadiness`, ETA windows, and `blocked` states affect scheduling eligibility.

### 2. Deep research on Node 5

Per `case-triage-orchestrator-flow.md` §5, Node 5 answers: **who is the best technician (skill, location, availability) and what is the proposed service window?**

Determine and document:

- Exact business purpose and operator narrative (mirror Node 4's fulfillment-plan framing).
- Required inputs from upstream channels and `SalesforceCaseContext`.
- Typed output contract for `scheduling` channel (propose DTO shape in the phase plan).
- State updates, graph placement (`… → partsLogistics → scheduling → gate → …` or revised order — justify).
- Eligibility / skip rules when parts are `blocked` or Case has no ship-to / asset.
- APIs and Salesforce read surfaces (ServiceResource, ServiceTerritory, WorkType, ServiceAppointment, OperatingHours, etc.).
- UI changes: stage card, verdict rollup surfaces, sanitization rules.
- Compare documented design with current implementation (Node 5 is **not shipped** — confirm absence and reserved namespace).
- Gaps, risks, assumptions, and missing requirements.

### 3. Salesforce readiness audit

Perform a **real inspection** of the connected Salesforce environment (default org `AgentForce`).

Run discovery commands such as:

```bash
sf org display --target-org AgentForce
sf sobject list --sobject ServiceAppointment,WorkOrder,ServiceResource,ServiceTerritory,WorkType,OperatingHours,SkillRequirement,ResourceAbsence --target-org AgentForce
sf data query --query "SELECT COUNT() FROM ServiceResource" --target-org AgentForce
sf data query --query "SELECT COUNT() FROM ServiceTerritory" --target-org AgentForce
sf data query --query "SELECT COUNT() FROM ServiceAppointment" --target-org AgentForce
```

Also inspect:

- `Scheduling_Agent` genAiPlannerBundle and `Create_a_Service_Appointment` action schemas
- Field Service enablement and PSL assignment for AI API OAuth run-as user
- Case fields relevant to service location (ship-to, Asset, Work Order linkage)
- Technician / resource seed data or absence thereof
- Permission sets vs required FLS for scheduling reads (and future writes)
- Knowledge of existing `docs/agents/customer-self-service.md` scheduling gaps

For every dependency, classify:

| Status        | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| **Available** | Queryable with data or metadata in org                            |
| **Partial**   | Object/field exists but data, FLS, or PSL blocks orchestrator use |
| **Missing**   | Not in org; must be created in 5-Pre or during implementation     |

### 4. Prerequisite preparation

Create a complete prerequisite checklist in the phase plan (mirror Node 4 §4 / §8 style).

For each item:

- Explain why it is needed
- State current status (available / partial / missing)
- If missing, provide exact implementation approach (metadata, seed data, perm sets, scripts)
- If Salesforce configuration is missing, prepare additions so they can be created during implementation

**Do not block the plan on missing data.** Document creation steps instead.

### 5. Implementation plan

Produce a detailed phased plan in `docs/orchestrator/node-5-scheduling-phase-plan.md`:

#### Phase breakdown (propose — adjust based on findings)

| Phase     | Typical scope                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------- |
| **5-Pre** | Salesforce Field Service scheduling metadata, seed technicians/territories, perm sets, validation script |
| **5a**    | AI orchestrator read/plan: `scheduling` channel, planner, gateway, graph node, verdict, UI, smoke        |
| **5b+**   | Optional: KB duration hints, cross-checks, gated ServiceAppointment writes after Node 6                  |

#### Backend

- Graph/orchestrator changes
- New node implementation (`scheduling` node id in lifecycle)
- State/channel updates
- Salesforce scheduling gateway (new service — propose path)
- Deterministic scheduling planner (skill, territory, travel, parts ETA alignment)
- API / config feature flag (e.g. `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED`)
- Data contracts (`apps/ai-api/src/orchestrator/dto/scheduling.ts` — proposed)

#### Frontend

- `OrchestrationView.tsx` — Node 5 stage card
- `lib/orchestration.ts` — sanitize `scheduling` channel
- `app/orchestration/page.tsx` — subtitle lists all active nodes
- Final Verdict rollup for scheduling (all four surfaces per checklist)

#### Salesforce

- Objects/fields required
- Sample technician / territory / appointment data
- Configuration updates
- Relationship to existing `Scheduling_Agent` (reuse vs orchestrator-owned reads)

#### Testing

- Planner unit tests (scenarios: parts ready, parts delayed, no technicians, degraded SF read)
- Gateway unit tests (SOQL shape, error → degraded)
- Graph spec (order, channel isolation, non-interrupting)
- UI component tests
- Live Salesforce proof path (Case id, proposed window, assigned resource ref)
- Smoke script extension

### 6. Deliverables

Generate or update these artifacts:

| #   | Deliverable                  | Location                                                  |
| --- | ---------------------------- | --------------------------------------------------------- |
| 1   | Node 5 architecture analysis | `docs/orchestrator/node-5-scheduling-phase-plan.md` §1–§3 |
| 2   | Salesforce readiness report  | Same doc §4 + audit tables                                |
| 3   | Gap analysis                 | Same doc §5                                               |
| 4   | Prerequisite checklist       | Same doc §6 (5-Pre)                                       |
| 5   | Detailed implementation plan | Same doc §7–§12                                           |
| 6   | Risk assessment              | Same doc §13                                              |
| 7   | Test plan + demo matrix      | Same doc §14                                              |
| 8   | Recommended execution order  | Same doc §0 + §15                                         |

Optional follow-on artifacts (only if analysis warrants):

- `manifest/node5-pre-package.xml` — draft metadata bundle list
- `scripts/sf/node5-pre-validation.sh` — draft validation script outline
- `.agents/skills/langgraph-node5-scheduling/SKILL.md` — stub pointing to phase plan

---

## Important instructions

- **Do not start coding immediately.** Complete the investigation and phase plan first.
- **Read `docs/orchestrator/re-orchestration-backlog.md`** — document point-in-time vs reconcile behavior (§3.7).
- Validate assumptions against the **actual codebase** and **Salesforce org**.
- Prefer evidence from the running implementation over documentation when discrepancies exist.
- Reuse orchestrator patterns from Nodes 1–4 wherever possible.
- Node 5 is **non-interrupting** unless analysis finds a strong reason otherwise (Node 6 owns approval).
- Respect PII boundaries: technician **names** may be unsafe in public status events — prefer resource codes / initials in UI events (cite `security-observability.instructions.md`).
- Highlight anything that could block deployment or production validation.
- Provide **concrete file-level recommendations** wherever possible.
- Update `docs/orchestrator/case-triage-orchestrator-flow.md` §7 node list only if you confirm Nodes 1–4 shipped state needs a scheduling subsection — do not claim Node 5 shipped.

---

## Final response must include

1. Skills, instructions, agents, and documents used
2. Salesforce readiness summary table (top dependencies)
3. Proposed `scheduling` channel contract sketch (key fields only)
4. Recommended phase breakdown (5-Pre, 5a, …) with exit criteria
5. Top risks and blockers for live proof
6. Path to `docs/orchestrator/node-5-scheduling-phase-plan.md` with section pointers
7. Exact next step: run `/implement-node5-scheduling` after phase plan approval (implementation prompt to be added separately)

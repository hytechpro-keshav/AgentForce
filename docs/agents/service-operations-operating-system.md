# Service Operations Operating System (SOOS)

## Purpose

This document aligns the proposed Service Operations Operating System with the
current AgentForce monorepo. It identifies which agents and backend services
already exist, where they live, which target SOOS capabilities map cleanly onto
the current repository, and which capabilities still need to be built.

The key repo-specific constraint is that this codebase already follows a narrow,
governed pattern:

- Salesforce Agentforce is the runtime and system-of-action shell.
- Apex and Flow own deterministic reads, writes, validation, and callouts.
- NestJS owns model routing, RAG, orchestration logic, and telemetry.
- React chat is the customer-safe web channel.
- Open WebUI is the internal AI console.

SOOS should extend that pattern. It should not replace it with one giant agent.

## Companion Implementation Plans

Use this document as the repo-aligned SOOS overview. The implementation-grade
plan for building the multi-client manufacturer service-operations platform is in
[Veda Pattern For AC Service Operations: Technical Implementation Plan](ac-service-operations-technical-plan.md).

The release and validation strategy is in
[AC Service Operations Test Plan](../testing/ac-service-operations-test-plan.md).

The enterprise research dossier starts at
[SOOS Executive Summary](../research/soos/00-executive-summary.md).

The event-driven operating model, sequence flows, and lifecycle state diagrams
are in
[SOOS Event-Driven Operational Flow Design](../research/soos/10-event-driven-operational-flow-design.md).

## Target Business Flow

SOOS should support an outsourced multi-client service-provider model. Aptivance
Technology Services operates Salesforce CRM for manufacturer clients such as
Company X. Client A, Client B, Client C, and Client N may differ by purchase
volume, contract value, SLA, strategic importance, approval rules, escalation
paths, and parts policies.

Cases can enter the shared Salesforce CRM through multiple paths:

- a client-owned ServiceNow API or other ticketing-system integration
- email intake or email-to-case style routing
- the approved AI chat window or Agentforce customer runtime
- other approved assisted, partner, portal, or service-desk channels

Every case must be normalized with client identifier, source system, external
ticket ID, contract, SLA policy, entitlement, priority tier, product, and
client-policy profile before SOOS recommendations drive routing, warranty,
inventory, or field-service decisions.

## Current Repository Baseline

### Runtime Agents Already Built

| Agent                                          | Current status                           | Runtime surface                        | Primary repo surfaces                                                                                                                                                                                                                                                                                                                                                         | What it does now                                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Customer_Self_Service_Agent`                  | Built and active                         | Salesforce Agentforce customer runtime | `force-app/main/default/genAiPlannerBundles/Customer_Self_Service_Agent`, `force-app/main/default/genAiFunctions/*`, `agent-eval/customer-self-service-phase*.yaml`                                                                                                                                                                                                           | Customer verification, account and case summary, service request creation, escalation, and temporary AI API proof topics for support triage, case analysis, health bridge, and Knowledge RAG |
| `Services_Org_Intelligence_Showcase_Agent_new` | Built and active                         | Salesforce Agentforce employee runtime | `force-app/main/default/genAiPlannerBundles/Services_Org_Intelligence_Showcase_Agent_new`, `force-app/main/default/genAiFunctions/List_PSA_Projects`, `force-app/main/default/genAiFunctions/Summarize_Project_Health_Brief`, `specs/services-org-intelligence-agent.yaml`                                                                                                    | Internal read-only project directory and project-health brief for Certinia PSA                                                                                                               |
| `Revenue_Operations_Intelligence_Agent`        | Built in source as current Phase 9 pilot | Salesforce Agentforce employee runtime | `force-app/main/default/genAiPlannerBundles/Revenue_Operations_Intelligence_Agent`, `force-app/main/default/genAiFunctions/Analyze_Revenue_Portfolio_Intelligence`, `force-app/main/default/genAiFunctions/List_Account_Manager_Accounts`, `force-app/main/default/genAiFunctions/Summarize_Revenue_Account_Health`, `agent-eval/revenue-operations-intelligence-phase9.yaml` | Internal read-only revenue portfolio intelligence, account directory, and account-health brief                                                                                               |

### AI API Capabilities Already Built

These are already available in `apps/ai-api` and should be treated as SOOS
building blocks, not greenfield work:

| Capability                  | Endpoint or surface                                                                                          | Current role                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Health bridge               | `GET /health`                                                                                                | Salesforce to Railway connectivity proof          |
| Support triage              | `POST /agent/support/triage-case`                                                                            | Triage-only recommendation path                   |
| Case analysis               | `POST /agent/support/analyze-case`                                                                           | Structured support recommendation path            |
| Knowledge RAG               | `POST /agent/knowledge/answer`, `POST /rag/ingest`, `POST /rag/search`                                       | Grounded answer path with source citations        |
| Services intelligence       | `POST /agent/services/project-health`                                                                        | Internal project-health summarization             |
| Revenue intelligence        | `POST /agent/revenue/account-health`, `POST /agent/revenue/portfolio-intelligence`                           | Internal revenue portfolio and account analysis   |
| Customer chat API           | `POST /auth/customer-chat/session`, `POST /chat/message`, `POST /chat/message/stream`, `POST /chat/escalate` | Customer-safe external chat surface               |
| Internal AI console gateway | `GET /v1/models`, `POST /v1/chat/completions`                                                                | Open WebUI integration through the NestJS gateway |

### Existing But Not Canonical For SOOS

These planner bundles exist in source, but they should not be treated as the
SOOS baseline without audit or migration work:

- `Scheduling_Agent`: narrow washing-machine troubleshooting and appointment
  demo flow, not the current canonical field-service architecture.
- `Agentforce_Service_Agent`: older student or service-oriented demo bundle,
  not aligned to the current customer self-service production path.
- `Sales_Agent`: generic sales-focused agent, not part of the current service
  operations strategy.
- `Services_Org_Intelligence_Agent` and `Services_Org_Intelligence_Showcase_Agent`:
  earlier Phase 8 variants superseded by
  `Services_Org_Intelligence_Showcase_Agent_new`.
- `Revenue_Operations_Intelligence_Agent_v2`: empty folder in source today.

## What Is Already Built Versus What Still Needs To Be Built

### Built Or Partially Built SOOS Capabilities

| Target SOOS capability                      | Current repo state | Where it currently takes place                                                                                                                                       |
| ------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer Support Agent                      | Partially built    | `Customer_Self_Service_Agent` in Salesforce, plus customer chat APIs in `apps/ai-api`, plus `apps/react-chat-window` as the future web surface                       |
| Service Intelligence Agent                  | Partially built    | Temporary support triage, case analysis, and Knowledge RAG topics inside `Customer_Self_Service_Agent`, backed by `apps/ai-api/src/agents` and `apps/ai-api/src/rag` |
| Operations Intelligence Agent               | Partially built    | Services and revenue intelligence already exist as separate employee-facing internal agents                                                                          |
| Knowledge retrieval and explainable answers | Built              | `apps/ai-api/src/rag`, Qdrant or Pinecone adapters, and the `Answer_Knowledge_RAG` Agentforce bridge                                                                 |

### Not Yet Built As SOOS Capabilities

| Target SOOS capability             | Current repo state                      | Recommended repo home                                                                                                          |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Case Routing Agent                 | Not built                               | Salesforce Agentforce internal support runtime plus new AI API routing endpoint and deterministic Flow or Apex routing actions |
| Technician Assignment Agent        | Not built                               | New internal field-service planner bundle plus backend ranking service                                                         |
| Work Reallocation Agent            | Not built                               | Same field-service planner bundle plus rescheduling service and deterministic assignment updates                               |
| Inventory Intelligence Agent       | Not built                               | New service-ops or field-service planner topics plus backend inventory reasoning service and ERP or warehouse integration      |
| Warranty Intelligence Agent        | Not built                               | Customer or support planner topics plus Apex or Flow policy checks and optional AI explanation service                         |
| Approval Agent                     | Not built                               | Mostly deterministic Salesforce Flow or Apex approvals, optionally fronted by a support or field-service agent topic           |
| Field Service Agent                | Not built in the canonical architecture | New field-service planner bundle for work-order and visit orchestration                                                        |
| Product Quality Intelligence Agent | Not built                               | New internal operations-intelligence or quality-intelligence planner bundle plus pattern-detection backend service             |
| Multi-channel case ingress         | Not built                               | Salesforce integration layer, Flow/Apex normalization, and source-specific adapters for ServiceNow, email, chat, and partners  |
| Client policy and SLA resolver     | Not built                               | Salesforce client contract, entitlement, SLA, priority, approval, and parts-rule resolver before support workflow              |

## Recommended SOOS Runtime Topology

The proposed SOOS agent list is directionally correct, but this repository
should not implement every SOOS responsibility as a separate top-level
Agentforce planner bundle on day one.

The current monorepo pattern fits better with a smaller number of runtime
agents, each owning a group of narrow topics and actions.

### Recommended Top-Level Runtime Agents

| Runtime agent                           | Purpose                                                                                      | Recommended primary users                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `Customer_Self_Service_Agent`           | Customer intake, verification, case creation, escalation, customer-safe knowledge            | Customers through Agentforce and later `apps/react-chat-window` |
| `Support_Operations_Agent`              | Internal triage, diagnosis, routing, warranty review, approval initiation                    | Support supervisors, case managers, service desk teams          |
| `Field_Service_Operations_Agent`        | Parts-aware work order execution, technician selection, reallocation, and dispatch workflows | Dispatchers, field-service coordinators, operations teams       |
| `Service_Operations_Intelligence_Agent` | Cross-case, cross-work-order, inventory, quality, and SLA intelligence                       | Managers, service leaders, quality teams, executives            |

### Why Fewer Top-Level Agents First

- The current repo already uses narrow topics inside planner bundles rather than
  exploding every capability into a separate runtime agent.
- Several SOOS responsibilities are better modeled as backend reasoning
  services exposed through a small number of planner actions.
- Deterministic mutation paths such as case assignment, approval submission,
  inventory reservation, and work-order updates belong in Salesforce Flow or
  Apex even when AI recommends the action.
- This keeps governance, eval coverage, and security boundaries manageable.

## SOOS Capability Mapping To The Current Repo

| SOOS capability                    | Recommended runtime placement                                                                                          | Recommended Salesforce implementation                                          | Recommended AI API implementation                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Multi-channel case ingress         | Salesforce integration layer before Agentforce handoff                                                                 | ServiceNow/email/chat intake, external-ticket idempotency, source provenance   | Optional parsing or summarization helpers; no direct system-of-record mutation from AI                    |
| Client policy and SLA resolver     | Salesforce Flow or Apex before support workflow                                                                        | Client tier, contract, SLA, entitlement, approval, escalation, and parts rules | Optional policy explanation service after deterministic resolver                                          |
| Customer Support Agent             | Keep in `Customer_Self_Service_Agent`                                                                                  | Verification, case creation, escalation, account-safe reads                    | Reuse customer chat APIs and customer-safe knowledge answers                                              |
| Service Intelligence Agent         | Move to `Support_Operations_Agent` and optionally expose customer-safe summaries through `Customer_Self_Service_Agent` | Read-only support-case actions and safe handoff fields                         | Extend `/agent/support/*` and `/agent/knowledge/answer` for diagnosis and repair guidance                 |
| Case Routing Agent                 | `Support_Operations_Agent`                                                                                             | Queue, owner, priority, and SLA actions through Flow or Apex                   | Add `/agent/support/route-case` for prioritization and skill-based recommendations                        |
| Technician Assignment Agent        | `Field_Service_Operations_Agent`                                                                                       | Work Order, Service Appointment, and technician record lookups and updates     | Add `/agent/field/assign-technician` for ranking by skill, distance, capacity, and success rate           |
| Work Reallocation Agent            | `Field_Service_Operations_Agent`                                                                                       | Deterministic reassignment and reschedule actions                              | Add `/agent/field/reallocate-work` for replacement and SLA-risk planning                                  |
| Inventory Intelligence Agent       | Pre-field-service orchestration shared by support and field operations                                                 | Part lookup, reservation, transfer, order, and replenishment flows             | Add `/agent/inventory/plan-parts` or similar service for warehouse and stock reasoning                    |
| Warranty Intelligence Agent        | `Support_Operations_Agent` and selective customer handoff path                                                         | Warranty objects, entitlement checks, policy enforcement, approval creation    | Add `/agent/warranty/evaluate` only for explainable reasoning, not authoritative policy mutation          |
| Approval Agent                     | `Support_Operations_Agent` and `Field_Service_Operations_Agent`                                                        | Flow or Apex approval thresholds and approver routing                          | Optional `/agent/approval/recommend` when policy has ambiguity or cost tradeoffs                          |
| Field Service Agent                | `Field_Service_Operations_Agent`                                                                                       | Work order creation, visit scheduling, notification actions                    | Optional ranking and orchestration services behind `/agent/field/*`                                       |
| Product Quality Intelligence Agent | `Service_Operations_Intelligence_Agent`                                                                                | Read-only quality investigation records and manufacturing feedback actions     | Add `/agent/quality/failure-patterns` for cross-incident trend detection                                  |
| Operations Intelligence Agent      | `Service_Operations_Intelligence_Agent`                                                                                | Read-only aggregated KPI and operational drilldown actions                     | Reuse the services and revenue intelligence patterns to add service KPIs, SLA risk, and regional analysis |

## Phased Implementation Plan

### Phase 0: Canonical Service Ops Contract

Goal: define the shared operating model before adding new planners.

Recommended outputs:

- Canonical entity map for `Customer`, `Product`, `Asset`, `Warranty`, `Case`,
  `WorkOrder`, `ServiceAppointment`, `Technician`, `InventoryItem`,
  `Warehouse`, `ApprovalRequest`, `FailureCode`, `ServiceVisit`,
  `QualityInvestigation`, `ManufacturingBatch`, and `Supplier`.
- Canonical service-ops DTOs under `apps/ai-api/src/agents/dto` because the
  reserved `packages/*` path from the architecture docs does not exist in the
  repository yet.
- Auth scope model for new capabilities such as `agentforce:case-routing`,
  `agentforce:technician-assignment`, `agentforce:inventory-intelligence`,
  `agentforce:warranty-evaluation`, and `agentforce:quality-intelligence`.
- Client and channel model for ServiceNow tickets, email intake, AI chat,
  external ticket IDs, source systems, contracts, SLA policies, entitlements,
  client tiers, and client-specific parts rules.
- Decision on which source systems are authoritative for inventory, warranty,
  approvals, and field-service scheduling.

Exit criteria:

- The service-ops data model is documented.
- DTO and response contract patterns are defined.
- The next agent phases can be built without reworking identity, auth, or
  naming later.

### Phase 1: Split Support Intelligence Out Of The Customer Agent

Goal: stop using the customer agent as the long-term container for internal
support intelligence.

Recommended repo work:

- Add `Support_Operations_Agent` under
  `force-app/main/default/genAiPlannerBundles`.
- Move the current temporary support-triage and case-analysis responsibilities
  into dedicated internal topics.
- Keep `Customer_Self_Service_Agent` focused on verification, customer-safe
  reads, case creation, escalation, and customer-safe knowledge answers.
- Extend `apps/ai-api/src/agents/support-agent.controller.ts` and adjacent
  services with the stable support-operations contract.
- Add corresponding `agent-eval/support-operations-phase*.yaml` coverage.

Exit criteria:

- Support triage and analysis are no longer described as temporary customer
  proof topics.
- Customer runtime remains narrow and safer.
- Internal support teams get a purpose-built agent surface.

### Phase 2: Add Case Routing, Warranty, And Approval Foundations

Goal: move from diagnosis to governed operational recommendation.

Recommended repo work:

- Add new Salesforce functions such as `Route_Service_Case`,
  `Evaluate_Warranty_Coverage`, and `Create_Approval_Request`.
- Back them with Apex and Flow for authoritative routing and approval actions.
- Add new AI API services for routing and warranty reasoning.
- Keep approval thresholds deterministic in Salesforce.

Exit criteria:

- Support teams can ask what should happen next.
- Salesforce still owns the actual mutation and approval paths.
- AI does not bypass policy.

### Phase 3: Add Inventory Intelligence Before Field Service

Goal: make parts planning a pre-field-service readiness gate.

Recommended repo work:

- Add inventory lookup, reservation, transfer, and part-order recommendation
  actions in Salesforce.
- Add AI API services for warehouse selection, stock reasoning, substitution,
  order suggestion, and first-time-fix optimization.
- Introduce deterministic reservation, transfer, or order actions only after
  the source-of-record integration is confirmed.

Exit criteria:

- Cases and work orders can reason about part availability before field-service
  assignment.
- Inventory recommendations are tied to actual source-system availability and
  client-specific parts policy.

### Phase 4: Build The Field Service Operations Agent

Goal: introduce execution beyond support-case reasoning using parts-ready
context.

Recommended repo work:

- Add `Field_Service_Operations_Agent` as the new canonical field-service
  runtime.
- Do not reuse `Scheduling_Agent` as-is; treat it as a reference or retire it
  after migration.
- Add functions for parts-aware work-order creation, technician ranking, visit
  scheduling, and reassignment.
- Add AI API endpoints for technician assignment and work reallocation.

Exit criteria:

- Work-order and visit execution paths exist.
- Technician selection is explainable, policy-aware, and aware of parts
  readiness.
- Rescheduling and replacement flows are governed.

### Phase 5: Add Quality And Service Operations Intelligence

Goal: close the loop between service incidents and manufacturing or operational
leadership.

Recommended repo work:

- Add `Service_Operations_Intelligence_Agent` for internal leaders.
- Reuse the patterns already proven by
  `Services_Org_Intelligence_Showcase_Agent_new` and
  `Revenue_Operations_Intelligence_Agent`.
- Add quality-pattern detection and service KPI endpoints in `apps/ai-api`.
- Add read-only Salesforce actions for service-region, warranty-cost, failure,
  SLA, and technician-performance analysis.

Exit criteria:

- Managers can ask cross-cutting service-ops questions.
- Quality loops can identify failure trends that should trigger
  manufacturing-facing investigation.

### Phase 6: Expand Channels Without Changing The Core Execution Pattern

Goal: expose SOOS safely across channels.

Recommended surfaces:

- Customer channels: `apps/react-chat-window`, Salesforce-hosted page shell,
  and later WhatsApp, mobile, or email adapters.
- Internal channels: Salesforce Agentforce employee runtimes and
  `apps/openwebui` through the OpenAI-compatible gateway.

Rule:

- Channel growth should reuse the same Salesforce and NestJS contracts.
- Do not fork the business logic by channel.

## Recommended Immediate Backlog

1. Create the canonical service-ops entity and DTO contract.
2. Add the multi-client ingress and client-policy model for ServiceNow, email,
   AI chat, contracts, SLA, entitlements, and external ticket IDs.
3. Create `Support_Operations_Agent` and move support triage and case analysis
   out of the customer planner bundle.
4. Design the first three new governed actions: case routing, warranty
   evaluation, and approval initiation.
5. Decide the authoritative system and object model for inventory, parts orders,
   work orders, appointments, and technician skills.
6. Define the `Field_Service_Operations_Agent` scope before writing any new
   scheduling logic.

## Practical Build Order Recommendation

If the goal is to turn the current repository into SOOS with the least
rework, the next build order should be:

1. Support operations split and stabilization.
2. Case routing, warranty, and approval foundations.
3. Inventory intelligence and parts readiness.
4. Field-service execution.
5. Quality and service-ops intelligence.
6. Expanded customer and internal channels.

This preserves the current architecture, reuses the repo's proven patterns,
and grows toward the SOOS target without turning the customer-facing runtime
into an oversized all-purpose agent.

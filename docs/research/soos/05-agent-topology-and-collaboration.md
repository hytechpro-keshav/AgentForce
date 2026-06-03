# Agent Topology And Collaboration

## Purpose

This document defines how SOOS agents should be organized and how they should
collaborate without creating one oversized runtime agent.

## Top-Level Runtime Agents

| Runtime agent                           | Status                                   | Primary role                                                                          |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `Customer_Self_Service_Agent`           | Built and active with partial SOOS scope | AI chat intake, verification, case creation, escalation, and customer-safe knowledge. |
| `Support_Operations_Agent`              | Recommended future build                 | Internal diagnosis, client-aware routing, warranty review, and approval initiation.   |
| `Field_Service_Operations_Agent`        | Recommended future build                 | Parts-aware work-order planning, technician assignment, reallocation, and dispatch.   |
| `Service_Operations_Intelligence_Agent` | Recommended future build                 | Cross-service KPIs, quality intelligence, product risk, and executive analysis.       |

## SOOS Orchestrator And Intake Normalization

Not every case starts inside an Agentforce conversation. ServiceNow API tickets,
email issues, AI chat requests, and assisted channels should first pass through
a deterministic Salesforce normalization layer. That layer creates or upserts a
Case, resolves the client policy snapshot, and then emits the structured context
that SOOS agents can use safely.

Required handoff fields include `clientId`, `clientTier`, `contractId`,
`slaPolicyId`, `entitlementId`, `sourceSystem`, `externalTicketId`,
`ingressChannel`, `productModel`, `assetId`, `caseId`, and `clientPolicyProfile`.

## Specialist Capability Placement

| Specialist capability                 | Runtime placement                                               | Backend placement                                          |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Channel Intake Normalization          | Salesforce integration layer and Apex/Flow                      | Optional parser or adapter services.                       |
| Client Policy Resolver                | Salesforce Flow/Apex before SOOS agent execution                | Optional policy explanation service.                       |
| Customer Support Agent                | `Customer_Self_Service_Agent` topics/actions                    | Customer-safe chat and knowledge routes.                   |
| Service Intelligence Agent            | `Support_Operations_Agent` topics/actions                       | Support diagnosis graph and RAG.                           |
| Case Routing Agent                    | `Support_Operations_Agent` topic/action                         | Case routing graph.                                        |
| Warranty Intelligence Agent           | `Support_Operations_Agent` topic/action                         | Warranty evaluation service.                               |
| Approval Agent                        | Support and field-service topics/actions                        | Approval recommendation service plus Salesforce Flow/Apex. |
| Technician Assignment Agent           | `Field_Service_Operations_Agent` topic/action                   | Technician ranking graph.                                  |
| Work Reallocation Agent               | `Field_Service_Operations_Agent` topic/action                   | Work reallocation graph.                                   |
| Inventory Intelligence Agent          | Pre-field-service orchestration invoked before field assignment | Inventory planning graph.                                  |
| Product Quality Intelligence Agent    | `Service_Operations_Intelligence_Agent` topic/action            | Quality failure-pattern service.                           |
| Service Operations Intelligence Agent | `Service_Operations_Intelligence_Agent` topics/actions          | KPI and operations intelligence services.                  |

## Collaboration Pattern

Agents should collaborate through structured Salesforce records and safe backend
contracts, not through freeform hidden conversation state.

Recommended handoff payload:

```text
recordRef
clientId
clientTier
contractId
slaPolicyId
entitlementId
sourceSystem
externalTicketId
ingressChannel
clientPolicyProfile
safeSummary
reasonCode
confidence
sourceIds
retrievalIds
recommendedNextAction
requiredApprovalLevel
blockedActions
customerSafeSummary
internalSummary
```

## Example Collaboration Flow

```text
ServiceNow / Email / AI Chat / Other Channel
  -> creates or upserts Case and resolves client policy

Support_Operations_Agent
  -> diagnoses issue, recommends routing, checks warranty and approval path

Inventory Intelligence
  -> recommends parts, reservation, transfer, order, or no-parts-needed path

Field_Service_Operations_Agent
  -> ranks technician using parts-ready context and proposes dispatch plan

Service_Operations_Intelligence_Agent
  -> detects repeat failure pattern and recommends quality investigation
```

## Agentforce Design Rules

- Prefer narrow topics with explicit action descriptions.
- Keep planner-visible fields safe and minimal.
- Keep planner-only identifiers non-displayable when possible.
- Do not require the user to paste IDs the planner already has.
- Separate customer-safe summaries from internal reasoning summaries.
- Retire temporary customer proof topics after permanent internal flows replace
  them.

## Backend Service Rules

- Controllers validate DTOs, enforce auth, call services, and return structured
  responses.
- Services own business logic and call `ModelRouter` for model requests.
- RAG services handle retrieval and source citations.
- Graph workflows propose actions and stop at approval gates.
- Salesforce Flow or Apex performs deterministic mutations.

## Collaboration Conclusion

SOOS should feel like a coordinated operating system, but its implementation
should remain modular: four runtime agents, narrow actions, backend reasoning
services, and Salesforce-owned execution.

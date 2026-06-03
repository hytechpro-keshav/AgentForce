# SOOS Target State Architecture

## Purpose

This document defines the target enterprise architecture for the multi-client
Service Operations Operating System.

## Architecture Principles

- Build domain-specific operational agents, not a generic chatbot.
- Keep top-level runtime agents small and governed.
- Keep deterministic writes in Salesforce Apex or Flow.
- Keep model routing, RAG, LangGraph workflows, and telemetry in NestJS.
- Keep customer-facing outputs separate from internal operational reasoning.
- Use source-cited retrieval for manuals, SOPs, service bulletins, warranty
  policies, and approved knowledge.
- Move from recommendation to execution only after policy, tests, UAT, and
  rollback are ready.

## Target Runtime Topology

```text
Client ServiceNow / Email / AI Chat / Other Approved Channels
  -> Aptivance Salesforce CRM
  -> Case normalization
  -> Client policy, SLA, contract, entitlement, and priority resolver
  -> SOOS Orchestrator

Internal Salesforce Console
  -> Support_Operations_Agent
  -> Field_Service_Operations_Agent
  -> Service_Operations_Intelligence_Agent
  -> Apex/Flow
  -> NestJS AI API

Open WebUI Internal Console
  -> NestJS OpenAI-Compatible Gateway
  -> ModelRouter
```

## Target Agent Surfaces

| Surface                 | Runtime                                      | Purpose                                                                |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Channel ingress         | Salesforce integration layer and Apex/Flow   | ServiceNow, email, AI chat, and other channels normalize into Case.    |
| Customer self-service   | `Customer_Self_Service_Agent` and React chat | AI chat intake, verification, customer-safe knowledge, case creation.  |
| Support operations      | `Support_Operations_Agent`                   | Diagnosis, client-aware routing, warranty review, approval initiation. |
| Field operations        | `Field_Service_Operations_Agent`             | Parts-aware technician selection, reallocation, and dispatch.          |
| Operations intelligence | `Service_Operations_Intelligence_Agent`      | KPIs, quality signals, regional risk, product failure trends.          |
| Internal AI console     | Open WebUI through NestJS                    | Internal exploration and non-customer operational analysis.            |

## Backend Service Topology

| Backend service           | Purpose                                                                             | First route pattern                |
| ------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| Client policy resolver    | Resolve client contract, SLA, priority, entitlement, approval, and parts rules.     | Salesforce Flow/Apex first         |
| Support diagnosis         | Diagnose device issues and recommend next action.                                   | `/agent/support/diagnose-ac-issue` |
| Case routing              | Recommend queue, owner group, priority, SLA path.                                   | `/agent/support/route-case`        |
| Warranty evaluation       | Evaluate coverage and policy ambiguity.                                             | `/agent/warranty/evaluate`         |
| Approval recommendation   | Recommend approver level and reason codes.                                          | `/agent/approval/recommend`        |
| Inventory planning        | Predict, reserve, transfer, order, or mark no-parts-needed before field assignment. | `/agent/inventory/plan-parts`      |
| Technician ranking        | Rank technicians by skill, distance, workload, SLA, and parts-ready context.        | `/agent/field/assign-technician`   |
| Work reallocation         | Reassign impacted work when availability changes.                                   | `/agent/field/reallocate-work`     |
| Quality pattern detection | Detect product, batch, supplier, or regional failure patterns.                      | `/agent/quality/failure-patterns`  |
| Service KPI intelligence  | Summarize executive metrics and drilldowns.                                         | `/agent/service-ops/kpi-summary`   |

## Multi-Client Ingress Topology

```text
Client A ServiceNow API
Client B Email Intake
Client C AI Chat Window
Client N Other Approved Channel
  -> Aptivance Salesforce CRM
  -> External ticket normalization and dedupe
  -> Client identifier, contract, SLA, priority tier, product, entitlement
  -> Support_Operations_Agent
  -> inventory and parts readiness gate
  -> Field_Service_Operations_Agent
```

## LangGraph Role

LangGraph should be introduced inside the NestJS AI API for bounded multi-step
workflows. The graph should reason, retrieve, rank, and propose. It should not
directly bypass Salesforce mutation paths.

## Production RAG Role

RAG should be treated as a production retrieval subsystem, not only vector search
plus answer generation. Device-service retrieval must handle semantic questions
and exact operational identifiers.

Target RAG flow:

```text
RAG need router
  -> query normalization
  -> rewrite / multi-query / internal HyDE where useful
  -> hybrid retrieval: vector + keyword/exact
  -> tenant, role, product, model, language, and version filters
  -> reranking
  -> compression or hierarchical section drilldown
  -> citation-forced answer or no-source fallback
  -> faithfulness, relevance, and retrieval telemetry
```

This matters for SOOS because service users search with error codes, symptoms,
part numbers, serial ranges, model names, and service bulletin IDs. In the
Company X laptop example, a screen black-spot complaint may need exact matching
against display-panel service bulletins, panel part numbers, warranty rules, and
serial ranges. Vector retrieval alone is not enough for those identifiers.

Recommended graph shape:

```text
request guard
  -> context builder
  -> Salesforce context reader
  -> RAG retriever
  -> reasoning or ranking node
  -> policy checker
  -> approval gate
  -> deterministic action proposal
  -> response formatter
  -> telemetry writer
```

## Data Flow

```text
User request or external ticket
  -> channel-specific ingress
  -> Salesforce Case normalization
  -> client policy snapshot
  -> Agentforce topic
  -> genAiFunction action
  -> Apex/Flow validation
  -> Named Credential callout
  -> NestJS DTO validation and scope check
  -> RAG/model/graph service
  -> structured result
  -> Apex/Flow mapping
  -> Agentforce response or deterministic Salesforce action
```

## Security Boundary

Every target route must enforce:

- authenticated request
- required scope
- tenant context
- role-aware access filtering
- request size limits
- rate limits
- structured errors
- audit-safe telemetry
- redaction of raw prompts, secrets, sensitive chunks, and provider bodies

## Target-State Conclusion

The target architecture is a governed service-operations platform where AI
reasoning improves decisions, but Salesforce remains the operational control
plane for customer identity, case state, assignments, approvals, work orders,
and audit records.

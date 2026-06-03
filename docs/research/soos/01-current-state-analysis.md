# SOOS Current State Analysis

## Purpose

This document records what the current AgentForce monorepo already supports and
what remains to be built for the outsourced, multi-client Service Operations
Operating System.

## Repository Baseline

The current monorepo already follows a governed hybrid architecture:

| Layer                 | Current role                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Salesforce Agentforce | Runtime shell for customer and employee agents.                                              |
| Apex and Flow         | Deterministic Salesforce reads, writes, validation, and callouts.                            |
| NestJS AI API         | Model routing, provider abstraction, RAG, orchestration, telemetry, auth, and API contracts. |
| Vector DB             | Qdrant or Pinecone abstraction for RAG retrieval.                                            |
| React chat            | Customer-safe external chat surface.                                                         |
| Open WebUI            | Internal console through the NestJS OpenAI-compatible gateway.                               |

This is the right foundation for SOOS because it separates conversational
runtime, deterministic system-of-record control, and backend AI reasoning.

## Business Model Baseline

The target model is Aptivance Technology Services operating Salesforce CRM as a
shared service operations platform for multiple manufacturer clients. A client
such as Company X may submit or receive laptop/device support issues through its
own ServiceNow portal, email, an AI chat window, or another approved channel.

The current repo proves the Salesforce, Agentforce, NestJS, RAG, and React chat
foundations. It does not yet contain the multi-client ingress layer, external
ticket synchronization, client policy resolver, contract/SLA normalization, or
client-specific parts-ordering rules.

## Already Built

| Capability                     | Current repo evidence                                            | SOOS relevance                                                                               |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Customer self-service runtime  | `Customer_Self_Service_Agent`                                    | Foundation for customer intake, verification, case creation, escalation, and safe knowledge. |
| AI API health bridge           | `GET /health` and Agentforce bridge action                       | Proves Salesforce to Railway connectivity.                                                   |
| Support triage                 | `POST /agent/support/triage-case`                                | Foundation for internal support recommendation.                                              |
| Case analysis                  | `POST /agent/support/analyze-case`                               | Foundation for structured support analysis.                                                  |
| Knowledge RAG                  | `/agent/knowledge/answer`, `/rag/ingest`, `/rag/search`          | Foundation for source-grounded manuals, SOPs, policies, and service bulletins.               |
| React customer chat APIs       | `/auth/customer-chat/session`, `/chat/message`, `/chat/escalate` | Future customer channel for SOOS workflows.                                                  |
| Open WebUI gateway             | `/v1/models`, `/v1/chat/completions`                             | Internal console path through NestJS.                                                        |
| Internal intelligence patterns | Services and revenue agents                                      | Reusable pattern for read-only employee intelligence.                                        |

## Partially Built

| Capability                    | Current state                                                                                        | Required before SOOS readiness                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Customer Support Agent        | Customer self-service exists but AC asset/warranty/appointment depth is not complete.                | Confirm AC service object model and add customer-safe asset, warranty, and appointment reads. |
| Service Intelligence Agent    | Triage, case analysis, and Knowledge RAG exist as proof slices.                                      | Move stable internal intelligence into `Support_Operations_Agent`.                            |
| Operations Intelligence Agent | Services and revenue intelligence prove adjacent patterns.                                           | Build AC service KPI, quality, inventory, technician, and warranty intelligence.              |
| Customer chat                 | Platform exists, full SOOS workflow is not wired.                                                    | Add customer-safe SOOS flows after backend contracts and guardrails are stable.               |
| Multi-channel case intake     | React chat exists; ServiceNow API, email intake, and external ticket normalization do not.           | Add deterministic case-ingress adapters and idempotent external-ticket mapping.               |
| Client policy resolution      | Standard Salesforce customer/account patterns exist; client tier/SLA policy resolution is not built. | Add client contract, entitlement, SLA, priority, approval, and parts-rule resolution.         |

## Not Built

| Capability                                | Missing enterprise pieces                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Case routing                              | Routing policy, queue/owner model, SLA logic, deterministic route action, evals.                       |
| ServiceNow ticket ingestion               | API contract, auth, external ticket ID mapping, idempotency, retry behavior, and audit trail.          |
| Email issue ingestion                     | Approved parser, case matching, attachment policy, source provenance, and safe summarization.          |
| Client policy and SLA resolver            | Client tier, contract value, SLA, entitlement, priority, approval, escalation, and parts-order rules.  |
| Technician assignment                     | Field-service source model, technician skills, location, workload, ranking service, assignment action. |
| Work reallocation                         | Schedule mutation rules, replacement search, notification rules, approval gates.                       |
| Inventory intelligence                    | Spare-part catalog, warehouse stock, reservations, transfer/order rules, ERP or inventory integration. |
| Warranty intelligence                     | Warranty contracts, entitlement checks, policy exclusions, leakage controls, approval integration.     |
| Approval intelligence                     | Cost thresholds, manager/regional approval routing, audit trail, Flow/Apex enforcement.                |
| Product quality intelligence              | Failure taxonomy, repair outcomes, batch/supplier data, investigation workflow.                        |
| Executive service operations intelligence | KPI contracts, metric ownership, access-filtered drilldowns, executive UAT.                            |

## Main Architecture Risk

The biggest risk is treating SOOS as a large chatbot instead of an operational
architecture. SOOS should preserve these boundaries:

- Agentforce owns runtime topic/action orchestration.
- Apex and Flow own deterministic reads and writes.
- NestJS owns RAG, model routing, LangGraph workflows, telemetry, and backend
  reasoning services.
- Customer channels receive only customer-safe outputs.
- Internal operational workflows require role, scope, audit, and approval gates.

## Current-State Conclusion

The repo is ready for SOOS planning and first implementation slices, but not for
full automation. The next practical move is to define the canonical multi-client
service data contract, including ingress channel and client policy context, and
build `Support_Operations_Agent` as the internal home for support diagnosis,
routing, warranty review, and approval initiation.

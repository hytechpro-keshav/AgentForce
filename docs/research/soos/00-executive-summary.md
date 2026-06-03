# SOOS Executive Summary

## Purpose

This research dossier defines the enterprise case for a Service Operations
Operating System for outsourced, multi-client manufacturer support. The running
example is Aptivance Technology Services operating Salesforce CRM support for a
manufacturer such as Company X, while the same model can apply to AC, laptop,
appliance, or other device-service operations. It complements the repo-aligned
SOOS overview, the Veda-pattern technical implementation plan, and the SOOS test
plan.

Related implementation documents:

- [Service Operations Operating System](../../agents/service-operations-operating-system.md)
- [Veda Pattern For AC Service Operations: Technical Implementation Plan](../../agents/ac-service-operations-technical-plan.md)
- [AC Service Operations Test Plan](../../testing/ac-service-operations-test-plan.md)
- [SOOS Event-Driven Operational Flow Design](10-event-driven-operational-flow-design.md)

## Executive Thesis

The opportunity is to build an AI-native operating layer for service operations,
not a generic chatbot. The platform should help Aptivance reason over clients,
contracts, SLA policies, end customers, product assets, warranties, cases, work
orders, technicians, spare parts, warehouses, approvals, quality investigations,
manufacturing batches, and suppliers.

The reusable lesson from Veda is the architecture pattern:

```text
Domain-specific operational agents + enterprise data + governed actions
```

For the Aptivance and Company X model, the platform target is:

```text
Client ServiceNow Ticket / Email / AI Chat / Other Channel
  -> Salesforce Case In Aptivance CRM
  -> Client Policy, Contract, SLA, Priority, Product, Entitlement
  -> Case
  -> Diagnosis
  -> Warranty And Approval
  -> Inventory And Parts Suggestion
  -> Parts Reservation / Order / No-Parts-Needed Decision
  -> Field Service Assignment
  -> Dispatch
  -> Repair Result
  -> Quality Signal
  -> Client And Manufacturer Feedback
```

## Strategic Decision

SOOS should be built as a small set of top-level runtime agents with specialist
topics, actions, and backend services. It should not become one large agent.

Recommended runtime agents:

| Runtime agent                           | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `Customer_Self_Service_Agent`           | AI chat intake, verification, case creation, escalation, and customer-safe knowledge.   |
| `Support_Operations_Agent`              | Internal diagnosis, client-aware routing, warranty review, and approval initiation.     |
| `Field_Service_Operations_Agent`        | Parts-aware work-order execution, technician assignment, reallocation, and dispatch.    |
| `Service_Operations_Intelligence_Agent` | Cross-service KPIs, product failure risk, quality intelligence, and executive analysis. |

## Current Position

The repository already has strong foundations:

- Salesforce Agentforce metadata and customer runtime patterns.
- Apex invocable actions and Named Credential callout patterns.
- NestJS AI API on Railway.
- Model routing and provider abstraction.
- Knowledge RAG with vector search, tenant filters, and source citations.
- React customer chat window.
- Open WebUI internal console through the NestJS gateway.
- Existing services and revenue intelligence agents that prove internal-agent
  patterns.

The repository does not yet contain the full SOOS platform. ServiceNow/email
ticket ingestion, external ticket idempotency, client policy and SLA resolution,
technician assignment, work reallocation, inventory intelligence, warranty
intelligence, approval intelligence, product quality intelligence, and service
operations intelligence remain future build work.

## Business Outcomes

Expected outcomes should be measured against service operations KPIs, not only
model quality metrics.

| Business outcome              | Hypothesis                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Faster case assignment        | Case routing recommendations reduce supervisor triage time.                                 |
| Better client SLA control     | Client tier, contract, and SLA policy resolution happen before routing or dispatch.         |
| Cleaner channel intake        | ServiceNow, email, AI chat, and other channels normalize into one Salesforce Case contract. |
| Faster diagnosis              | RAG and historical service patterns reduce manual search across manuals and past cases.     |
| Higher first-time fix rate    | Technician ranking and parts planning send the right technician with the right part.        |
| Reduced repeat visits         | Better diagnosis, parts readiness, and repair guidance reduce incomplete visits.            |
| Reduced warranty leakage      | Policy-aware warranty and approval workflows catch ambiguous or unsupported claims earlier. |
| Better technician utilization | Assignment and reallocation balance skills, location, workload, and SLA risk.               |
| Faster quality detection      | Failure-pattern analysis surfaces product, batch, or supplier issues earlier.               |
| Lower support cost            | Customer self-service resolves simple issues and escalates with cleaner context.            |
| Better customer experience    | Customers get faster intake, clearer next steps, and fewer avoidable handoffs.              |

## Enterprise Recommendation

Proceed in phases:

1. Define the canonical SOOS operating model and data model.
2. Define the multi-client case-ingress and client-policy model.
3. Split internal support intelligence into `Support_Operations_Agent`.
4. Add governed case routing, warranty, and approval foundations.
5. Add inventory intelligence, parts suggestion, reservation, and order planning.
6. Build field-service execution with technician assignment and reallocation
   using parts-ready context.
7. Add product quality intelligence and client/manufacturer feedback loops.
8. Add executive service operations intelligence.
9. Expand customer and internal channels only after core contracts are stable.

## Investment Guardrail

Do not start with a broad automation push. Start with recommendation-first
flows, source-cited RAG, deterministic Salesforce actions, and measured human
approval boundaries. Move from recommendation to controlled execution only when
the capability has data quality, governance, tests, UAT evidence, and rollback
controls.

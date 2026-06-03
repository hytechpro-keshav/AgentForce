# SOOS Implementation Roadmap

## Purpose

This document defines the recommended phased roadmap for turning the current
AgentForce monorepo into a multi-client Service Operations Operating System for
Aptivance Technology Services and manufacturer clients such as Company X.

## Roadmap Principle

Build the operating system in governed slices. Start with contracts and
recommendations, then add deterministic execution where the data, policy, tests,
and approvals are mature.

## Phase 0: Foundation Contract

Goal: define the shared operating model before adding new production agents.

Deliverables:

- canonical SOOS data model
- source-of-truth decision record
- DTO families under `apps/ai-api/src/agents/dto`
- auth scopes for new SOOS capabilities
- client, contract, SLA, entitlement, source-channel, and external-ticket data
  model
- channel-ingress contracts for ServiceNow API, email intake, AI chat, and other
  approved channels
- AC RAG source taxonomy, metadata model, and exact identifier strategy
- synthetic AC service fixtures
- production RAG design for router, query rewriting, hybrid search, reranking,
  compression, citation behavior, and RAG evaluation metrics

Exit criteria:

- data model and scope names are stable enough for implementation
- source-system gaps are documented
- no new capability claims production readiness before data ownership is known

## Phase 1: Support Operations Split

Goal: create the first permanent internal SOOS runtime.

Deliverables:

- `Support_Operations_Agent`
- normalized case intake from ServiceNow, email, AI chat, and assisted channels
- internal diagnosis and support case summary topics
- client-policy and SLA snapshot attached to every support workflow
- stable support operations DTOs
- `SupportDiagnosisGraph` or equivalent bounded backend workflow
- production RAG retrieval path for AC manuals, repair guides, service
  bulletins, error codes, and warranty policies
- evals and UAT for support supervisor workflows

Exit criteria:

- internal support intelligence no longer depends on temporary customer proof
  topics
- customer runtime remains customer-safe and narrow

## Phase 2: Routing, Warranty, And Approval Foundations

Goal: move from diagnosis to governed next-action recommendation.

Deliverables:

- case routing recommendation route and Agentforce action
- warranty evaluation route and Agentforce action
- approval recommendation route and Salesforce approval integration
- deterministic approval thresholds in Flow or Apex
- negative evals proving AI cannot bypass approvals

Exit criteria:

- support teams can ask what should happen next
- Salesforce still owns the actual mutation and approval path

## Phase 3: Inventory Intelligence And Parts Readiness

Goal: connect diagnosis and warranty decisions to parts planning before
field-service assignment.

Deliverables:

- part planning route
- warehouse recommendation route
- inventory availability DTOs
- source-system adapter for stock, reservation, transfer, order, and backorder
  status
- optional reservation, transfer, or part-order action after governance approval

Exit criteria:

- work orders can reason about required parts before field-service assignment
- inventory recommendations are tied to actual source-system availability and
  client-specific parts rules

## Phase 4: Field Service Operations

Goal: add technician and dispatch intelligence using parts-ready context.

Deliverables:

- `Field_Service_Operations_Agent`
- technician summary and ranking route
- work reallocation route
- field-service context read actions
- deterministic assignment or reallocation action after source-system approval

Exit criteria:

- dispatchers get explainable technician recommendations that include parts
  readiness and SLA risk
- schedule mutations are governed, auditable, and rollback-aware

## Phase 5: Quality Intelligence

Goal: close the loop from service incidents to manufacturing feedback.

Deliverables:

- quality failure-pattern route
- quality investigation recommendation action
- failure-code normalization model
- manufacturing batch and supplier correlation logic
- quality UAT and precision/recall eval set

Exit criteria:

- quality teams receive evidence-backed investigation recommendations
- confirmed service bulletins can feed back into support, field, warranty, and inventory workflows

## Phase 6: Executive Service Operations Intelligence

Goal: provide leadership with source-grounded operating intelligence.

Deliverables:

- `Service_Operations_Intelligence_Agent`
- KPI summary route
- regional failure, SLA risk, warranty cost, technician utilization, inventory
  risk, and quality trend topics
- access-filtered drilldown contracts
- executive UAT package

Exit criteria:

- leaders can ask cross-cutting service questions with reliable metrics and safe drilldowns

## Phase 7: Channel Expansion

Goal: expose stable workflows across additional approved channels without
forking business logic.

Deliverables:

- React chat support for selected customer-safe SOOS workflows
- channel policy for WhatsApp, mobile, additional email, partner portal, or
  voice adapters
- customer-safe content review
- rate-limit and abuse controls
- post-deploy smoke scripts

Exit criteria:

- channel growth reuses the same Salesforce and NestJS contracts
- business logic is not forked by channel

## Cross-Phase Release Gates

Every phase should pass:

- DTO validation tests
- NestJS unit and e2e tests for changed routes
- Apex tests for changed invocable actions
- Flow or deterministic action tests for writes
- Agentforce topic/action evals
- RAG tests when retrieval is used, including faithfulness, answer relevance,
  context precision, context recall, exact-match retrieval, hybrid retrieval,
  reranking, compression, and no-source correctness
- security tests for auth, scopes, tenant filtering, and logging
- telemetry tests for safe references and no-op behavior
- UAT evidence from the capability owner
- rollback or feature-disable plan

## Roadmap Conclusion

The fastest safe path is to build SOOS as a sequence of operational slices:
multi-client contracts and channel ingestion first, then support intelligence,
governed routing and approvals, inventory and parts readiness, field execution,
quality, executive intelligence, and finally broader channel expansion.

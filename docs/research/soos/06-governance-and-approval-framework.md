# Governance And Approval Framework

## Purpose

This document defines the governance model for SOOS recommendations, automated
actions, approval thresholds, customer-safe boundaries, and internal operational
controls.

## Governance Principle

AI may reason, recommend, summarize, rank, and explain. Salesforce Apex and Flow
own deterministic writes, policy enforcement, approval submission, and audit
records.

In the Aptivance model, governance is also client-specific. Client A, Client B,
Client C, and Client N may have different purchase volume, contract value, SLA,
strategic importance, approval thresholds, escalation contacts, and
parts-ordering rules. SOOS must resolve and store the client policy snapshot
before any operational recommendation is applied.

## Automation Classes

| Action class                   | Automation stance                                   | Owner                                                |
| ------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| Channel ticket ingestion       | Deterministic normalization with idempotency        | Salesforce integration and service operations owner. |
| Client policy resolution       | Deterministic first; AI may explain ambiguity       | Client operations and Salesforce admin.              |
| Customer verification          | Deterministic only                                  | Salesforce identity and verification flow.           |
| Customer-safe knowledge answer | Autonomous when source-cited and in approved corpus | Customer self-service policy owner.                  |
| Case creation                  | Autonomous after verification and required fields   | Service Cloud owner.                                 |
| Escalation                     | Autonomous for approved escalation triggers         | Support operations owner.                            |
| Diagnosis                      | Recommendation only                                 | Support supervisor until confidence and UAT mature.  |
| Case routing                   | Recommendation first, later low-risk auto-route     | Support operations and Salesforce admin.             |
| Technician assignment          | Recommendation first                                | Dispatch manager.                                    |
| Work reallocation              | Approval-gated execution                            | Dispatch manager or service manager.                 |
| Inventory reservation          | Deterministic source-system action                  | Inventory owner.                                     |
| Warranty evaluation            | Deterministic policy plus AI explanation            | Warranty manager.                                    |
| Approval decision              | Deterministic Salesforce approval process           | Manager or regional approver.                        |
| Quality investigation          | Recommendation first                                | Quality engineering lead.                            |

## Approval Thresholds

Initial thresholds:

| Condition                        | Required handling                                         |
| -------------------------------- | --------------------------------------------------------- |
| Under INR 3,000 and policy-clear | Auto approve through deterministic Salesforce policy.     |
| INR 3,000 to INR 10,000          | Manager approval.                                         |
| Above INR 10,000                 | Regional approval.                                        |
| Repeated failure                 | Manager or regional approval regardless of cost.          |
| Warranty exception               | Manager or regional approval.                             |
| Safety issue                     | Human review and escalation.                              |
| Premium customer schedule impact | Manager approval when SLA or customer commitment changes. |
| Suspected leakage or abuse       | Warranty manager review.                                  |

These thresholds are defaults, not universal client policy. A client contract
may require stricter manager approval, regional approval, customer quote flow,
or manufacturer confirmation before part ordering, warranty exception, or
field-service dispatch.

## Role Model

| Role                      | Allowed capabilities                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| Client operations manager | Client onboarding, contract/SLA policy review, source-channel governance.     |
| Customer                  | Customer-safe intake, case status, approved knowledge, escalation.            |
| Support agent             | Case diagnosis, next action, routing recommendation, warranty review request. |
| Support supervisor        | Routing approval, escalation review, manager approval band.                   |
| Dispatcher                | Technician ranking, dispatch planning, reallocation recommendation.           |
| Inventory manager         | Stock review, reservation, transfer review.                                   |
| Warranty manager          | Coverage review, exception handling, leakage review.                          |
| Regional manager          | High-cost approvals and cross-region decisions.                               |
| Quality engineer          | Failure pattern review and investigation creation.                            |
| Executive                 | KPI summaries and access-filtered drilldowns.                                 |

## Customer-Facing Guardrails

Customer-facing agents must:

- verify before account, case, asset, warranty, or appointment-specific reads
- answer from customer-safe sources only
- cite sources where RAG is used
- return no-source fallback when approved sources are missing
- escalate safety, legal, billing dispute, identity mismatch, or low-confidence issues
- avoid exposing internal cost models, technician details, warranty leakage,
  supplier quality, and manufacturing defect suspicions
- respect client-specific customer communication rules and source-channel
  provenance

## Internal Guardrails

Internal agents must:

- show evidence, source IDs, confidence, and decision rationale
- distinguish recommendation from execution
- stop at approval thresholds
- record safe audit references
- avoid logging raw prompts, secrets, sensitive chunks, provider payloads, and
  unnecessary PII
- enforce role, scope, tenant, and rate-limit controls
- enforce client data isolation and avoid cross-client leakage in prompts,
  retrieval, logs, metrics, and dashboards

## Audit Requirements

Every governed recommendation should capture:

- request ID
- tenant ID
- client ID
- client tier
- contract ID or policy profile reference
- source system and ingress channel
- external ticket ID when present
- actor role
- agent surface
- action name
- source IDs and retrieval IDs
- recommended decision
- confidence
- approval requirement
- approver role
- final deterministic action outcome
- timestamp and correlation ID

## Governance Conclusion

The fastest safe path is recommendation-first automation. SOOS should earn the
right to execute by passing data-quality checks, security review, evals, UAT,
and approval-policy validation.

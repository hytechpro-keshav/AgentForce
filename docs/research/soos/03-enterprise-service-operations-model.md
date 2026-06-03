# Enterprise Service Operations Model

## Purpose

This document defines the enterprise operating model SOOS should support for an
outsourced, multi-client manufacturer service operation.

## Operating Domains

| Domain                            | Primary responsibility                                                      | SOOS opportunity                                                      |
| --------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Client operations                 | Client onboarding, contract, SLA, priority tier, entitlement, policy rules. | Consistent client-specific support behavior across shared operations. |
| Channel intake operations         | ServiceNow, email, AI chat, and other issue-ingress paths.                  | Normalize every ticket into one Case and policy contract.             |
| Customer operations               | Intake, verification, customer communication, case creation.                | Faster issue capture, safe self-service, cleaner human handoff.       |
| Support operations                | Triage, diagnosis, routing, escalation, warranty review.                    | Faster diagnosis and next-best-action recommendations.                |
| Field operations                  | Work orders, appointments, technician assignment, dispatch.                 | Better technician matching and SLA-aware scheduling.                  |
| Inventory operations              | Spare parts, warehouses, reservations, transfers.                           | Higher first-time fix rate through parts readiness.                   |
| Warranty operations               | Coverage, claims, policy enforcement, cost control.                         | Lower leakage and faster approval routing.                            |
| Approval operations               | Manager and regional approvals for cost or risk.                            | Governed automation with clear thresholds and audit.                  |
| Quality operations                | Failure codes, investigations, manufacturing feedback.                      | Earlier product, batch, supplier, and regional issue detection.       |
| Executive operations intelligence | KPIs, trends, risk, service-center performance.                             | Data-backed decisions for service leaders.                            |

## Core Operating Workflow

```text
Client ServiceNow / Email / AI Chat / Other Channel
  -> Case Creation Or Upsert
  -> Client Policy And SLA Resolution
  -> Customer Verification When Needed
  -> Support Diagnosis
  -> Case Routing
  -> Warranty And Approval Review
  -> Inventory And Parts Need Assessment
  -> Part Reservation / Transfer / Order Suggestion
  -> Parts-Aware Work Order Creation
  -> Technician Assignment
  -> Service Appointment
  -> Repair Result
  -> Customer Follow-Up
  -> Quality Signal
  -> Client And Manufacturer Feedback
```

## Client And Channel Operations

Aptivance must resolve who the client is before SOOS can make operational
recommendations. Client A, Client B, Client C, and Client N may have different
contract values, purchase volume, SLA policies, product catalogs, approval
thresholds, parts-ordering rules, and escalation contacts.

Required normalized fields:

- client identifier
- client tier and strategic importance
- source system and ingress channel
- external ticket ID when present
- contract, SLA, entitlement, and priority policy
- product, asset, model, serial, and warranty references
- customer contact and communication preference when available

## Customer Operations

Customer operations should remain safe, narrow, and verified.

Responsibilities:

- verify customer identity before account, case, asset, or warranty-specific reads
- collect symptoms, error codes, product details, and urgency
- create a service Case
- answer customer-safe troubleshooting questions with approved sources
- escalate unsupported, sensitive, high-risk, or low-confidence requests

SOOS should not expose internal technician performance, warranty leakage,
supplier quality, or manufacturing defect analysis to customers.

## Support Operations

Support operations should become the first internal SOOS build target.

Responsibilities:

- analyze case context
- diagnose probable issue
- recommend repair path
- recommend routing and priority
- evaluate warranty and approval requirements
- prepare clean context for dispatcher or field-service team

This domain is the bridge between customer intake and field execution.

## Field Operations

Field operations should focus on visit success and SLA compliance.

Responsibilities:

- create and manage Work Orders
- consume a parts-ready or no-parts-needed work package
- rank technicians by skill, location, workload, and availability
- reallocate work when technicians become unavailable
- update appointment and dispatch status through governed Salesforce actions

## Inventory Operations

Inventory operations should be tied directly to diagnosis before field-service
assignment.

Responsibilities:

- identify required spare parts from repair guide, failure code, and diagnosis
- check available and reserved stock by warehouse or service center
- recommend nearest feasible stock source
- suggest part orders, transfers, substitutions, or no-parts-needed decisions
- reserve or transfer parts only through authoritative source-system action

## Warranty And Approval Operations

Warranty and approval operations should protect both customer experience and
financial controls.

Responsibilities:

- evaluate coverage from authoritative warranty data
- apply exclusions and service bulletin exceptions
- estimate replacement and repair cost
- route approval by threshold and risk
- detect potential leakage or suspicious repeat replacements

Initial thresholds:

- under INR 3,000: auto approve only when warranty and policy checks pass
- INR 3,000 to INR 10,000: manager approval
- above INR 10,000: regional approval

## Quality Operations

Quality operations should convert service evidence into product improvement.

Responsibilities:

- normalize failure codes and repair outcomes
- detect clusters by product model, serial range, manufacturing batch, supplier,
  region, and part
- recommend quality investigations
- link service bulletins back into support and field workflows
- measure manufacturing feedback cycle time

## Executive Operations Intelligence

Executive intelligence should give leadership a reliable operating view.

Questions to support:

- Which products fail most often?
- Which regions are missing SLA?
- Which service centers need more technician capacity?
- Which warehouses create dispatch delays?
- Which warranty categories are driving cost?
- Which manufacturing batches show emerging quality risk?

## Operating Model Conclusion

SOOS should be designed as an end-to-end service operating layer. It should
start with customer and support operations, then extend into field service,
inventory, warranty, quality, and executive intelligence as data quality and
governance mature.

# KPI And Value Realization

## Purpose

This document defines the executive KPI framework for measuring SOOS value in an
outsourced, multi-client manufacturer support operation.

## KPI Ownership

| KPI                               | Primary owner                     | SOOS contribution                                                            |
| --------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Client SLA Attainment             | Client operations leader          | Client-specific SLA policy drives routing, priority, parts, and dispatch.    |
| Channel Ingestion Success         | Service operations platform owner | ServiceNow, email, AI chat, and other channels normalize reliably into Case. |
| Integration Error Rate            | Platform and support leaders      | External ticket retries, sync errors, and parser failures become visible.    |
| Contract Compliance               | Client operations and finance     | Recommendations respect contract, entitlement, approval, and SLA rules.      |
| First Time Fix Rate               | Field service leader              | Better diagnosis, technician matching, and parts readiness.                  |
| Mean Time To Resolution           | Support and field service leaders | Faster routing, diagnosis, dispatch, and approval.                           |
| SLA Compliance                    | Service operations leader         | SLA-aware case routing, technician ranking, and reallocation.                |
| Repeat Visit Rate                 | Field service and quality leaders | Better repair guidance, parts planning, and failure pattern detection.       |
| Warranty Cost                     | Warranty and finance leaders      | Coverage checks, approval routing, and leakage detection.                    |
| Claim Leakage                     | Warranty manager                  | Policy-aware review and anomaly detection.                                   |
| Technician Utilization            | Dispatch leader                   | Balanced workload, skill-based assignment, and reallocation.                 |
| Inventory Availability            | Inventory manager                 | Parts prediction, warehouse selection, and reservation readiness.            |
| Part Stockout Rate                | Inventory and service leaders     | Earlier part demand signals from diagnosis and open work orders.             |
| Customer Satisfaction             | Customer support leader           | Faster intake, clearer updates, fewer avoidable visits.                      |
| Quality Defect Detection Time     | Quality engineering leader        | Earlier failure clustering across cases and repair results.                  |
| Manufacturing Feedback Cycle Time | Quality and manufacturing leaders | Faster investigation creation and service bulletin feedback.                 |

## Value Hypotheses

| Value lever                | Hypothesis                                                  | Measurement approach                                                    |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cleaner intake             | Normalized multi-channel cases reduce manual rework.        | Track case normalization success and manual correction rate by channel. |
| Better client compliance   | Client policy resolution prevents SLA and contract misses.  | Track SLA and policy exceptions by client tier and source channel.      |
| Faster assignment          | Routing and technician ranking reduce manual decision time. | Compare time from Case creation to owner/technician assignment.         |
| Faster diagnosis           | RAG and historical repair analysis reduce manual research.  | Compare time from Case creation to diagnosis recommendation.            |
| Higher first-time fix      | Parts-aware dispatch improves visit outcomes.               | Track first-visit closure rate by issue type.                           |
| Lower repeat visits        | Better diagnosis and kit planning reduce second visits.     | Track repeat visits within 7, 14, and 30 days.                          |
| Lower warranty leakage     | Policy-aware approvals catch unsupported claims.            | Track claim exceptions, overrides, and post-audit findings.             |
| Better utilization         | Assignment balances skill, distance, workload, and SLA.     | Track technician idle time, overtime, and daily completed visits.       |
| Faster quality detection   | Failure-pattern graph flags clusters earlier.               | Track time from first repeated failure to quality investigation.        |
| Better customer experience | Cleaner intake and fewer handoffs improve satisfaction.     | Track CSAT, escalation rate, and status-update response times.          |

## AI Quality Metrics

| Capability             | Metrics                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Case ingress           | Ingestion success, duplicate rate, parser accuracy, sync latency, missing client rate.   |
| Client policy resolver | SLA selection accuracy, entitlement accuracy, priority accuracy, policy override rate.   |
| Customer support       | Verification compliance, escalation accuracy, no-source correctness, hallucination rate. |
| Service diagnosis      | Diagnosis accuracy, citation rate, confidence calibration, unsafe recommendation rate.   |
| Case routing           | Queue accuracy, priority accuracy, override rate, SLA-risk detection.                    |
| Technician assignment  | Ranking quality, first-time fix impact, travel time, utilization balance.                |
| Inventory planning     | Part prediction accuracy, stockout reduction, reservation accuracy.                      |
| Warranty               | Coverage accuracy, leakage flag precision, approval routing accuracy.                    |
| Quality intelligence   | Pattern precision, pattern recall, false-positive rate, detection lead time.             |
| Executive intelligence | KPI accuracy, drilldown correctness, freshness, access filtering.                        |

## KPI Data Requirements

SOOS KPI reporting needs reliable data for:

- Case creation, assignment, priority, category, and closure time
- Client identifier, client tier, contract, SLA policy, entitlement, source
  system, ingress channel, and external ticket ID
- Work Order creation, dispatch, appointment, and completion time
- Technician assignment, skills, workload, travel, and repeat visit outcomes
- Part prediction, reservation, stockout, and actual parts used
- Warranty coverage, claim cost, approval, exception, and outcome
- Failure code, repair result, product model, serial range, manufacturing batch
- Customer satisfaction, escalation, and contact channel

## Executive Value Narrative

SOOS should be presented as a service-operations improvement platform. It links
multi-client intake, frontline support, inventory readiness, field dispatch,
warranty control, quality engineering, and manufacturer feedback into one
measurable operating model.

## Value Realization Conclusion

Every SOOS release should declare which KPI it is expected to improve, what
baseline will be used, and what evidence is needed before moving from pilot to
broader rollout.

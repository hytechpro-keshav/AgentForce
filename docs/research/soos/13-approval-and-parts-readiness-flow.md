# SOOS Approval And Parts Readiness Flow

## Purpose

This document shows the simple upper-layer flow for approval and parts
readiness before field-service planning begins.

It intentionally leaves out internal implementation detail and focuses only on
the decision stages, the approval path, and the parts-readiness outcome.

## Simple Approval And Parts Readiness Diagram

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart TD
    classDef agent fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20;
    classDef platform fill:#f5f5f5,stroke:#616161,color:#212121;
    classDef decision fill:#fff8e1,stroke:#ef6c00,color:#8d4e00;
    classDef human fill:#fce4ec,stroke:#ad1457,color:#880e4f;
    classDef outcome fill:#f3e5f5,stroke:#6a1b9a,color:#4a148c;

    START[Case routed for repair]:::platform --> SUPPORT[Support_Operations_Agent]:::agent
    SUPPORT --> WARRANTY[Warranty and approval review]:::platform

    WARRANTY --> D1{Approval required<br/>before repair or parts work?}:::decision
    D1 -- No --> PARTS[Inventory And Parts Planning]:::platform
    D1 -- Yes --> APPROVER[Manager / Regional /<br/>Client-specific approver]:::human

    APPROVER --> D2{Approved?}:::decision
    D2 -- No --> HOLD[Hold for review,<br/>customer decision, or exception path]:::outcome
    D2 -- Yes --> PARTS

    PARTS --> D3{Parts needed?}:::decision
    D3 -- No --> READY[NoPartsRequired<br/>or PartsPlanReady]:::outcome
    D3 -- Yes --> D4{Stock available<br/>in allowed path?}:::decision

    D4 -- Yes --> D5{Reservation or order<br/>approval required?}:::decision
    D5 -- No --> RESERVE[Reserve part]:::platform
    D5 -- Yes --> INVAPP[Inventory or policy approver]:::human
    INVAPP --> D6{Approved?}:::decision
    D6 -- No --> HOLD
    D6 -- Yes --> RESERVE

    D4 -- No --> ORDER[Suggest transfer,<br/>order, or backorder]:::platform
    ORDER --> D7{ETA meets SLA?}:::decision
    D7 -- No --> HOLD
    D7 -- Yes --> COMMIT[Record inbound part<br/>or order commitment]:::platform

    RESERVE --> READY
    COMMIT --> READY
    READY --> FIELD[Field_Service_Operations_Agent]:::agent
    FIELD --> NEXT[Technician assignment<br/>and dispatch planning]:::outcome
```

## Decision Ownership Map

| Stage                             | Primary owner                                             | Main decision                                                            |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Warranty and approval review      | `Support_Operations_Agent` plus Salesforce policy         | Can the repair continue immediately, or does it need approval first?     |
| Cost or policy approval           | Human approver                                            | Approve, reject, or hold the repair or parts path.                       |
| Parts planning                    | Inventory and Parts Planning capability                   | Are parts needed for this repair?                                        |
| Availability check                | Inventory and Parts Planning capability                   | Can the part be reserved immediately, or is transfer or ordering needed? |
| Reservation or exception approval | Inventory or policy approver                              | Allow scarce, cross-region, or policy-exception part usage.              |
| ETA decision                      | Inventory and Parts Planning capability plus policy owner | Is the expected part arrival still acceptable for the client SLA?        |
| Field-service readiness           | `Field_Service_Operations_Agent`                          | Start technician assignment only after parts readiness is known.         |

## Outcome Summary

| Outcome           | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `NoPartsRequired` | The repair can proceed without spare parts.                            |
| `PartsPlanReady`  | The parts path is resolved and field-service planning can start.       |
| `Reserved`        | Required stock is available and committed.                             |
| `OrderCommitted`  | Transfer, backorder, or purchase path is accepted and tracked.         |
| `HoldForReview`   | Approval, SLA, customer decision, or policy exception blocks progress. |

## Scope Note

This diagram is intentionally simple. It is the business-decision view of the
approval and parts-readiness stage, not the technical execution view.

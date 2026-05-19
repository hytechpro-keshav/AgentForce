# Revenue Operations Intelligence Platform

## Overview

Phase 9 expands the platform from a narrow revenue analytics assistant into a
unified Revenue Operations Intelligence layer for Salesforce and Certinia
ecosystems.

The target outcome is not just answering `What is churn risk?` The platform
should answer `What will impact future revenue, why, how severe is it, and what
operational action should happen next?`

This follows the Phase 8 pattern that already proved the right boundary:

- Salesforce and adjacent systems remain the system of record.
- Apex gathers controlled facts and calls Railway through a Named Credential.
- The NestJS AI API computes deterministic scores first.
- `ModelRouter` summarizes, explains, and recommends actions from those facts.

LLMs do not invent health, risk, or expansion scores.

## Strategic Scope

Revenue Operations Intelligence combines multiple operating views into one
decision-support layer:

- sales intelligence
- services intelligence
- delivery risk
- customer health
- expansion potential
- financial risk
- operational recommendations

This creates a cross-functional AI operating system for Salesforce instead of a
single-purpose revenue dashboard agent.

## Target Agent Flow

```text
Revenue or account leader
  -> Agentforce revenue topic or specialist topic
    -> Apex fact collector
      -> callout:Agentforce_AI_API_Phase2/agent/revenue/account-health
        -> Revenue signal aggregation
        -> Deterministic scoring engine
        -> Next-best-action candidate generation
        -> ModelRouter summary and briefing response
```

The first release should stay backend-first and contract-first. Multi-agent
coordination can be layered on after stable scoring and DTO contracts exist.

## Deterministic Intelligence Layers

### Layer 1: Deterministic Intelligence Engine

Backend services compute normalized scores before any LLM summarization.

Initial score families:

- account health
- renewal probability
- churn risk
- expansion likelihood
- project delivery risk
- support burden
- executive engagement score
- margin pressure
- payment risk
- stakeholder inactivity
- usage decline

Each score should include:

- normalized value
- severity band
- explanation signals
- confidence
- threshold-driven escalation guidance

### Layer 2: Revenue Signal Aggregation

The scoring engine should unify approved signals from:

- Salesforce: Accounts, Opportunities, Activities, Cases, Renewals, CPQ
- Certinia PSA: project health, staffing pressure, margin erosion, delivery
  delays, burn rate
- support systems: escalation volume, severity trends, unresolved incidents
- product telemetry: adoption decline, inactive users, feature utilization
- finance signals: overdue invoices, payment delays, ARR concentration,
  contract reduction

## Canonical Revenue Signal Model

The biggest design dependency is a canonical revenue signal model. Before broad
prompt work or multi-agent orchestration, define:

- which objects and systems are in scope
- which fields drive each risk or opportunity category
- weighting and normalization rules
- confidence and missing-data handling
- severity thresholds and escalation rules
- explanation fields safe to expose to Agentforce

Without this contract, prompts and recommendations will drift.

## Planned Delivery Sequence

### Phase 9A: Revenue Foundations

Deliver:

- deterministic revenue scoring engine
- revenue DTO contracts
- `POST /agent/revenue/account-health`
- Apex integration path
- Named Credential wiring
- backend and Apex test scaffolding

Target response shape:

- health summary
- churn risk
- expansion opportunity
- operational blockers
- next best actions

Goal:

- establish stable contracts before prompt complexity grows

### Phase 9B: Cross-System Intelligence

Deliver:

- Certinia PSA signals
- support metrics
- usage telemetry inputs
- finance indicators
- unified customer reality model

Goal:

- create a single account-level operating picture across revenue, delivery, and
  operations

### Phase 9C: Action Intelligence

Deliver:

- next-best-action recommendations
- recovery plans
- expansion recommendations
- executive briefing summaries

Goal:

- move from reporting into operational intelligence and guided intervention

### Phase 9D: Predictive Operations

Deliver:

- scenario simulation
- forecasting inputs
- revenue-at-risk analysis
- coordinator orchestration across specialist intelligence services

Goal:

- support predictive what-if analysis and prioritized intervention planning

## Future Multi-Agent Direction

Once the contracts are stable, the platform can split into specialist agents or
services such as:

- Churn Risk Agent
- Expansion Opportunity Agent
- Services Delivery Agent
- Finance Risk Agent
- Executive Briefing Agent
- Customer Health Agent

A coordinator layer can then synthesize those outputs into executive summaries,
prioritized interventions, and action plans.

## Immediate Implementation Priorities

- run a revenue signal workshop to lock source systems, inputs, and thresholds
- implement deterministic DTO and scoring contracts first
- ship the initial account-health endpoint before branching into prompt
  complexity
- add Agentforce topics, actions, and prompts only after the backend contract is
  stable

## Positioning

The strongest framing for Phase 9 is not `AI revenue assistant`.

It is a unified Revenue Operations Intelligence platform for Salesforce and
Certinia environments, with deterministic scoring, operational guidance, and a
clear path toward predictive multi-agent coordination.

# Account Manager Revenue Intelligence Platform

## Overview

Phase 9 expands the platform from a narrow revenue analytics assistant into an
Account Manager-facing Revenue Operations Intelligence layer for Salesforce and
Certinia ecosystems.

The Account Manager v1 target outcome is not just answering `What is churn
risk?` The agent should help an Account Manager choose an account from their
book of business, then answer `What will impact future revenue, why, how severe
is it, and what operational action should happen next?`

The current runtime supports two additive handoff paths on top of that v1 flow:
the Salesforce-only directory can expose a planner-visible top account, and the
Phase 9B portfolio analysis can expose a planner-visible top account from
LLM-led portfolio ranking. In both cases, the agent can explain why that account
should be reviewed first and, after confirmation, run the existing
single-account summary without forcing manual ID copy/paste.

This follows the Phase 8 pattern that already proved the right boundary:

- Salesforce and adjacent systems remain the system of record.
- Apex gathers controlled facts and calls Railway through a Named Credential.
- The NestJS AI API validates and redacts aggregate facts, then calls
  `ModelRouter`.
- The LLM owns the account-health, portfolio-status, churn-risk, expansion,
  risk-level, watchlist, trend, execution-plan, and next-best-action decisions
  from those approved facts.

Phase 9 intentionally does not keep the Phase 8 deterministic scoring pattern.
The LLM must not invent missing facts, but the score and recommendation
decisions are model-led and then schema-validated before Agentforce sees them.

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

## Account Manager v1 Agent Flow

```text
Account Manager
  -> Account Manager Revenue Intelligence topic
    -> Analyze_Revenue_Portfolio_Intelligence
      -> AgentforceAiApiRevPortfolioIntel
        -> user-mode SOQL over owned or visible Account portfolio facts
        -> sanitized accountReference facts only
        -> callout:Agentforce_AI_API_Phase2/agent/revenue/portfolio-intelligence
          -> Portfolio signal aggregation and deterministic fallbacks
          -> ModelRouter LLM portfolio ranking, watchlist, trend, recommendation, and plan response
          -> Response validation, redaction, and telemetry
          -> Apex-built Revenue Portfolio Intelligence Brief
          -> planner-only topAccountId, topAccountName, topAccountRecommendationReason
    -> List_Account_Manager_Accounts
      -> AgentforceAccountManagerAccountDirectory
        -> user-mode SOQL over owned or visible Account records
        -> Account Manager Account Directory with copyable Account IDs
        -> planner-only topAccountId, topAccountName, topAccountAttentionSignals
    -> Summarize_Revenue_Account_Health
      -> AgentforceAiApiRevenueAccountHealth
        -> callout:Agentforce_AI_API_Phase2/agent/revenue/account-health
          -> Revenue signal aggregation
          -> ModelRouter LLM score and decision response
          -> Response validation, redaction, and telemetry
          -> Apex-built Revenue Account Health Brief
```

The Account Manager v1 release stays backend-contract-first. The directory is a
Salesforce-only selection aid; the portfolio action is the LLM-led multi-account
analysis engine; and the existing single-account summary remains the LLM-led
drilldown engine. Phase 9B is additive and does not replace the existing
directory or account-health contracts.

## Current Account Manager v1 UX Contract

### Account Directory

`List_Account_Manager_Accounts` is Salesforce-only. It returns a readable list
of owned Accounts by default, or visible Accounts when requested, with:

- account name
- copyable Salesforce Account ID
- profile fields such as account type, industry, and annual revenue
- open pipeline, renewal, expansion, and next-close signals
- support burden and escalation signals
- recent activity signals
- safe attention-signal labels for choosing which account to inspect next

It also returns planner-only top-account fields so Agentforce can recommend the
top-ranked account from Salesforce-visible signals and, after confirmation, hand
off automatically into the existing AI summary action. Users can still copy a
Salesforce Account ID manually when they want a different account.

The directory does not produce LLM-led portfolio scores. It is a lightweight
selection workflow so Account Managers can choose one Account and then run the
existing account-health summary. The new autonomous handoff does not change that
boundary; it only removes the manual copy/paste step when the top candidate is
already clear from the directory output.

### Account Health Brief

`Summarize_Revenue_Account_Health` requires confirmation because sanitized
aggregate Account, Opportunity, Case, Activity, Services, Finance, and usage
facts may be sent to the external AI API. The user-facing answer should display
only the formatted `executiveBrief`.

The brief supports Account Manager workflows such as:

- churn rescue
- renewal readiness
- expansion whitespace
- QBR preparation
- executive account review
- next-best-action planning

### Portfolio Intelligence Brief

`Analyze_Revenue_Portfolio_Intelligence` requires confirmation because
sanitized aggregate portfolio facts may be sent to the external AI API. Apex
maps Salesforce Account IDs and names to safe `accountReference` values before
calling the backend; the backend prompt never receives raw Account IDs or names.
Apex maps the structured response back to Salesforce-visible names and IDs only
inside the Agentforce response so the planner can support drilldown.

The portfolio brief supports Account Manager workflows such as:

- all-assigned-account portfolio review
- ranked risk and expansion prioritization
- churn, renewal, escalation, and quiet-account watchlists
- portfolio-level trend detection
- proactive next-best-action recommendations
- weekly multi-account execution planning
- confirmation-based drilldown into the existing account-health summary

The user-facing answer should display only the formatted `portfolioBrief`.
Planner-only fields such as `topRiskAccounts`, `topExpansionAccounts`,
`portfolioWatchlists`, `portfolioTrends`, `recommendedActions`,
`weeklyExecutionPlan`, `topAccountId`, `topAccountName`, and
`topAccountRecommendationReason` are for orchestration and follow-up only.

## LLM-Led Intelligence Layers

### Layer 1: LLM Decision Engine

Backend services gather and validate approved aggregate facts. `ModelRouter`
then asks the configured LLM to decide normalized scores, severity bands,
rationale, revenue impact, blockers, and next best actions.

Initial score and decision families:

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
- portfolio status
- portfolio risk ranking
- portfolio expansion ranking
- portfolio trend severity
- portfolio watchlist membership
- weekly execution priority

Each LLM decision should include:

- normalized value
- severity band
- explanation signals
- confidence
- operational escalation or intervention guidance

### Layer 2: Revenue Signal Aggregation

The fact collector and DTO contract should unify approved signals from:

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
- the LLM decision rubric and output contract
- confidence and missing-data handling
- severity vocabulary and escalation guidance
- explanation fields safe to expose to Agentforce

Without this contract, prompts and recommendations will drift.

## Planned Delivery Sequence

### Phase 9A: Revenue Foundations

Deliver:

- LLM-led revenue scoring and decision service
- revenue DTO contracts with validated score, risk, rationale, and action fields
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

- establish stable contracts before prompt and multi-agent complexity grows

Implementation status, 2026-05-19:

- Added `POST /agent/revenue/account-health` with required scope
  `agentforce:revenue-account-health` and ModelRouter use case
  `agentforce_revenue_account_health`.
- Added `RevenueAccountHealthService`, DTO validation, provider-safe JSON
  parsing, sensitive-data redaction, telemetry, unit tests, and e2e tests.
- The service does not compute deterministic revenue scores. It sends approved
  aggregate facts to ModelRouter and validates the LLM-owned account health,
  churn risk, expansion, delivery risk, financial risk, support risk,
  executive engagement, rationale, revenue impact, blockers, and actions.
- Added Apex `AgentforceAiApiRevenueAccountHealth`, global Agentforce function
  `Summarize_Revenue_Account_Health`, a dedicated Revenue Operations
  Intelligence topic/agent scaffold, permission metadata, eval YAML, and agent
  spec.
- Apex currently gathers standard Salesforce Account, Opportunity, Case, and
  Task aggregates. Optional Certinia PSA project aggregates are included when
  the `pse__Proj__c.pse__Account__c` mapping exists. Finance and product usage
  fields are contract-ready but remain future source-system integrations unless
  a target org provides approved fields.

Implementation status, 2026-05-26:

- Added Account Manager v1 persona packaging for the existing Phase 9 account
  health contract.
- Added Salesforce-only `List_Account_Manager_Accounts` backed by
  `AgentforceAccountManagerAccountDirectory` so an Account Manager can browse
  owned or visible Accounts, review safe commercial attention signals, and copy
  a Salesforce Account ID before invoking the existing summary action.
- Added Account Manager eval coverage for book-of-business selection, which
  account to review first, churn rescue, renewal readiness, expansion
  whitespace, and QBR preparation.
- The implementation remains read-only. The directory does not mutate records,
  does not call the external AI API, and does not replace the single-account
  LLM-led health summary.

Implementation status, 2026-05-27:

- Added planner-only `topAccountId`, `topAccountName`, and
  `topAccountAttentionSignals` to `List_Account_Manager_Accounts` so the topic
  can chain autonomously into `Summarize_Revenue_Account_Health` after
  confirmation.
- Updated the Account Manager topic, spec, and evals so "which account should I
  review first" can recommend the top-ranked account and then run the existing
  single-account summary without forcing manual ID copy/paste.
- Fixed a live-org directory failure caused by null `Opportunity.Type` values in
  the Account Manager directory aggregation path.

### Phase 9B: Portfolio Intelligence

Deliver:

- `POST /agent/revenue/portfolio-intelligence`
- required scope `agentforce:revenue-portfolio-intelligence`
- ModelRouter use case `agentforce_revenue_portfolio_intelligence`
- Apex bridge `AgentforceAiApiRevPortfolioIntel`
- global Agentforce action `Analyze_Revenue_Portfolio_Intelligence`
- portfolio-ranked risk, expansion, renewal, escalation, and quiet-account
  outputs
- dynamic watchlists, portfolio trends, proactive recommendations, and weekly
  execution plans
- planner-only top-account handoff into the existing single-account summary

Goal:

- move from a single-account recommendation and summary to autonomous
  portfolio-level Account Manager intelligence without breaking the existing
  single-account route or validated Account Manager flows

Implementation status, 2026-05-27:

- Added backend DTOs, service, route, scope, ModelRouter use case, telemetry,
  unit tests, e2e tests, and README contract docs for portfolio intelligence.
- Added Apex portfolio bridge and tests. The bridge gathers user-mode aggregate
  Account, Opportunity, Case, and Task facts, sends only safe account references
  and aggregate counts to the backend, and maps the structured response back to
  Agentforce display and planner fields.
- Added global Agentforce function metadata, input/output schemas, topic
  orchestration instructions, permission-set class access, agent spec updates,
  and eval coverage for immediate attention, expansion opportunities, churn
  watchlists, weekly plans, and portfolio-to-account drilldown.
- The implementation remains read-only. It suggests proactive actions and plans
  but does not create or mutate Salesforce, Certinia, support, finance,
  product, or services records.

### Phase 9C: Action Intelligence

Deliver:

- deeper next-best-action recommendations
- recovery plans
- expansion recommendations
- executive briefing summaries

Goal:

- move from reporting into operational intelligence and guided intervention

Account Manager v1 covers the first packaging step for selected-account
guidance. Deeper action intelligence remains future work because no approved
mutation path exists in this release.

### Phase 9D: Predictive Operations

Deliver:

- scenario simulation
- forecasting inputs
- revenue-at-risk analysis
- coordinator orchestration across specialist intelligence services

Goal:

- support predictive what-if analysis and prioritized intervention planning

Phase 9B now covers governed portfolio triage for ranked risk, expansion
opportunity, churn watchlists, trend detection, proactive recommendations, and
weekly intervention planning. Future predictive work can add simulation,
forecast sensitivity, and revenue-at-risk modeling across the ranked book of
business.

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
- validate the portfolio and single-account contracts together before promotion
- add governed source-system integrations for Certinia, product usage, and
  finance signals as approved field mappings become available
- add release smoke evidence for portfolio ranking, watchlists, and drilldown
  after deployment to a target org

## Positioning

The strongest framing for Phase 9 is not `AI revenue assistant`.

It is a unified Revenue Operations Intelligence platform for Salesforce and
Certinia environments, with LLM-led scoring, operational guidance, and a clear
path toward predictive multi-agent coordination.

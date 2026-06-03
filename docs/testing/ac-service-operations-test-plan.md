# AC Service Operations Test Plan

## Purpose

This document defines the verification strategy for the SOOS implementation
plan, including the Aptivance multi-client support-provider model for
manufacturer clients such as Company X. It covers tests for Agentforce runtime
behavior, Apex and Flow actions, NestJS AI API services, LangGraph or deep-agent
workflows, RAG, security, telemetry, React chat, Open WebUI gateway usage,
ServiceNow/email ingress, client-policy resolution, and manual UAT.

The goal is to prove operational correctness, safety, governance, and business
value. A metadata deploy or model response is not enough to release SOOS
capabilities.

## Test Principles

- Test deterministic contracts before testing model behavior.
- Test recommendation workflows separately from execution workflows.
- Prove every customer-facing answer is verified, source-cited when needed, and
  safe for the channel.
- Prove every mutation path is owned by Salesforce Apex or Flow.
- Prove every backend reasoning service enforces tenant, scope, role, rate
  limit, and logging rules.
- Prove every deep-agent graph stops at approval gates when required.
- Treat stale environments, inactive agents, expired credentials, or missing
  Railway variables as operational failures, not model-quality failures.

## Test Layers

| Layer                     | Purpose                                              | Examples                                                                       |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Static validation         | Catch schema, lint, type, and formatting issues.     | TypeScript typecheck, metadata schema checks, prettier.                        |
| DTO and contract tests    | Preserve public API contracts.                       | Request validation, missing fields, enum values, backward compatibility.       |
| Unit tests                | Test isolated business logic.                        | Technician ranking, approval thresholds, warranty policy, part planning.       |
| Graph tests               | Test LangGraph/deep-agent state transitions.         | Diagnosis graph, approval interrupt, execution adapter stop conditions.        |
| RAG tests                 | Prove grounding and access filtering.                | Chunking, metadata, tenant filters, stale/deleted sources, no-source fallback. |
| Apex tests                | Prove invocable actions and callout handling.        | Happy path, backend error, malformed JSON, auth error, empty input.            |
| Flow tests                | Prove deterministic Salesforce policy and mutations. | Approval threshold routing, assignment updates, notifications.                 |
| Integration tests         | Prove service boundaries work together.              | Controller plus service plus mocked ModelRouter/vector DB/Salesforce.          |
| E2E API tests             | Prove public routes and auth behavior.               | `/agent/field/assign-technician`, `/agent/warranty/evaluate`.                  |
| Agentforce Testing Center | Prove topic and action selection.                    | Single-turn routing to correct topic/action.                                   |
| REST multi-turn evals     | Prove real agent session behavior.                   | Follow-up diagnosis, approval confirmation, no manual ID re-entry.             |
| React chat tests          | Prove customer channel behavior.                     | Safe chat session, escalation, responsive UI, streaming fallback.              |
| Open WebUI gateway tests  | Prove internal console routing.                      | `/v1/models`, `/v1/chat/completions`, auth and rate limit.                     |
| Security tests            | Prove access and privacy boundaries.                 | Missing auth, wrong scope, tenant violation, unsafe logging regression.        |
| Telemetry tests           | Prove observability without workflow risk.           | Token/cost metrics, retrieval IDs, no raw prompts, no-op failure.              |
| Performance tests         | Prove service operations latency targets.            | Diagnosis latency, assignment ranking under candidate load.                    |
| Resilience tests          | Prove safe fallbacks.                                | Model outage, vector DB outage, Salesforce timeout, inventory API failure.     |
| UAT                       | Prove business workflow acceptance.                  | Support supervisor, dispatcher, warranty manager, quality lead scripts.        |

## Baseline Commands

Run focused checks for the touched layer. For broad release validation, use:

```bash
npm run ai-api:typecheck
npm run ai-api:test
npm run ai-api:test:e2e
npm run react-chat:typecheck
npm run react-chat:test
npm run react-chat:build
npm run prettier:verify
sf apex run test --test-level RunLocalTests --wait 30 --result-format human
```

For Salesforce metadata, use targeted `sf project deploy validate` or
`sf project deploy start --dry-run` commands for changed metadata.

## Capability Acceptance Metrics

| Capability                    | Primary metrics                                                                               | Release threshold guidance                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Multi-channel Case Ingress    | Ingestion success, duplicate prevention, source mapping, parser accuracy, sync latency.       | ServiceNow, email, and chat paths must produce the same normalized Case contract.                         |
| Client Policy Resolver        | Client match accuracy, SLA selection, entitlement accuracy, priority accuracy, override rate. | No routing, approval, parts, or field-service recommendation should run without a policy snapshot.        |
| Customer Support Agent        | Verification accuracy, case creation accuracy, escalation accuracy, hallucination rate, CSAT. | No sensitive read before verification; zero unsupported warranty or repair claims without source.         |
| Service Intelligence Agent    | Diagnosis accuracy, source grounding, escalation recommendation accuracy, no-source handling. | Must cite approved sources or return uncertainty.                                                         |
| Case Routing Agent            | Queue accuracy, priority accuracy, SLA-risk detection, human override rate.                   | Recommendation-only until routing accuracy and override rate are accepted.                                |
| Field Service Agent           | Dispatch plan accuracy, SLA compliance, customer-impact detection.                            | No automatic schedule mutation without approved policy.                                                   |
| Technician Assignment Agent   | First-time-fix improvement, assignment accuracy, travel-time reduction, utilization balance.  | Ranking must explain skills, location, availability, and part readiness.                                  |
| Work Reallocation Agent       | Replacement quality, notification completeness, SLA recovery rate.                            | Must stop for approval on cross-region, premium customer, or high-risk changes.                           |
| Inventory Agent               | Part prediction accuracy, reservation accuracy, stockout reduction, dispatch readiness.       | Must not claim availability unless source system confirms stock.                                          |
| Warranty Agent                | Coverage accuracy, leakage reduction, exception detection, cost estimate accuracy.            | Deterministic policy owns final coverage decision.                                                        |
| Approval Agent                | Threshold routing accuracy, approver selection accuracy, audit completeness.                  | Under INR 3,000 auto only when policy passes; INR 3,000 to INR 10,000 manager; above INR 10,000 regional. |
| Quality Intelligence Agent    | Failure-pattern precision, recall, time-to-detection, false-positive rate.                    | Investigation recommendation must include evidence and affected scope.                                    |
| Operations Intelligence Agent | KPI accuracy, drilldown correctness, freshness, access filtering.                             | Executive summaries must match underlying source data and role access.                                    |

## Test Data Strategy

Create synthetic or approved sanitized fixtures for:

- Customers, Contacts, Accounts, and verification states.
- Clients A/B/C/N with different purchase volume, contract value, SLA,
  strategic importance, entitlement, approval, escalation, and parts rules.
- External ServiceNow tickets, email cases, AI chat sessions, and other source
  channels with external ticket IDs and idempotency keys.
- AC products, models, serial ranges, and installed assets.
- Warranty contracts, exclusions, and service bulletin overrides.
- Cases with symptoms, priorities, channels, languages, and escalation history.
- Work Orders, Service Appointments, territories, and SLA windows.
- Technicians with skills, certifications, availability, workload, location, and
  historical first-time-fix rates.
- Spare parts such as PCB, sensor, compressor, fan motor, capacitor, coil,
  filter, and gas kit.
- Warehouses and service centers with available, reserved, and transfer stock.
- Approval Requests with cost bands and exception reasons.
- Failure Codes, repair results, repeat visits, and quality investigations.
- Manufacturing batches, supplier lots, and service bulletins.
- Knowledge Articles, product manuals, repair guides, SOPs, and warranty
  policies.

Do not use raw customer prompt/session data or production PII in fixtures.

## Backend Unit And Contract Tests

Recommended future test files under `apps/ai-api/src/agents`:

- `ac-diagnosis.service.spec.ts`
- `case-routing.service.spec.ts`
- `technician-assignment.service.spec.ts`
- `work-reallocation.service.spec.ts`
- `inventory-planning.service.spec.ts`
- `warranty-evaluation.service.spec.ts`
- `approval-recommendation.service.spec.ts`
- `quality-failure-patterns.service.spec.ts`
- `service-ops-kpi.service.spec.ts`

Each service test should cover:

- Happy path.
- Missing required context.
- Invalid enum or status.
- Unsafe customer-facing output redaction.
- ModelRouter failure fallback.
- Tenant and role propagation.
- Telemetry emitted with safe fields only.
- Structured error response.

## LangGraph Or Deep-Agent Tests

For every graph workflow, test state transitions without calling real model,
vector DB, Salesforce, inventory, or scheduling systems.

Required graph tests:

- `request_guard` rejects missing tenant, role, scope, or correlation ID.
- `context_builder` produces safe summaries and safe identifiers only.
- `rag_retriever` handles empty, stale, deleted, and access-filtered sources.
- `diagnosis_or_ranking_model` returns structured recommendations, not freeform
  execution commands.
- `policy_checker` routes approval thresholds correctly.
- `approval_gate` interrupts manager/regional approval cases.
- `deterministic_execution_adapter` is not called before approval.
- `response_formatter` returns planner-safe flat fields for Agentforce.
- `telemetry_audit_writer` does not block workflow success if telemetry fails.

Important graph scenarios:

- Diagnosis with known error code and source-cited repair guide.
- ServiceNow ticket normalized to Case with correct client policy snapshot.
- Email issue parsed into safe Case summary with source provenance.
- AI chat issue escalated into normalized Case without leaking internal policy.
- Diagnosis with no source and safe fallback.
- Inventory planning before technician assignment when no part availability is
  confirmed.
- Work reallocation for unavailable technician with manager approval required.
- Warranty claim under INR 3,000 with valid warranty.
- Warranty claim above INR 10,000 requiring regional approval.
- Quality failure pattern across product model and manufacturing batch.

## RAG Tests

RAG tests must cover:

- Product manual chunking.
- Repair guide chunking.
- Natural-boundary chunking that preserves paragraphs, sections, procedures,
  fault-code tables, part compatibility tables, and warranty matrices.
- Service bulletin applicability by product model and serial range.
- Warranty policy chunking without mixing unrelated exclusions.
- Metadata preservation for tenant, namespace, source ID, title, product model,
  serial range, failure code, document version, access roles, stale/deleted
  flags, and ingestion timestamp.
- Exact-match retrieval for error codes, part numbers, product models, serial
  ranges, and service bulletin IDs.
- Hybrid retrieval combining vector search with keyword or exact search.
- Query rewriting when customer language differs from manual language.
- Multi-query retrieval for ambiguous symptoms.
- Internal-only HyDE-style retrieval where generated search text is never
  treated as evidence.
- Reranking from a broader candidate set to a smaller cited evidence set.
- Context compression or hierarchical section drilldown for long manuals.
- Tenant and role filtering before answer generation.
- Customer-safe versus internal-only source separation.
- No-source fallback without generic model answer.
- Citation formatting for Agentforce and API clients.
- Re-ingestion behavior for updated service bulletins.
- Stale source exclusion from customer-facing answers.
- Stage-level telemetry for router decision, retrieval mode, candidate count,
  reranked count, filtered count, returned count, and no-source reason.
- Evaluation metrics for faithfulness, answer relevance, context precision,
  context recall, and no-source correctness.

Example eval questions:

- `What should a technician inspect first for E104 on model ACX-18 when the unit is under warranty?`
- `Can the customer get a free PCB replacement for this serial range?`
- `Which service bulletin applies to this compressor fault?`
- `What should we say if no approved source exists for this failure code?`

RAG failure-mode evals should include:

- exact error code query where vector-only retrieval would return generic error
  content
- symptom query whose wording differs from the repair manual wording
- warranty question where the answer is faithful to a policy chunk but does not
  answer the user's actual question
- retrieval with too many relevant chunks requiring rerank and compression
- internal repair-guide result requested through a customer role
- stale or superseded service bulletin that must not ground the answer

## Salesforce Apex And Flow Tests

For every Agentforce action, add Apex tests for:

- Empty input.
- Required field validation.
- Callout happy path.
- Backend non-200 response.
- Auth failure.
- Timeout or callout exception.
- Malformed response.
- Unexpected enum or missing field.
- Safe error mapping to Agentforce output.
- Planner-only fields versus displayable fields.

Flow or Salesforce policy tests should cover:

- ServiceNow external ticket upsert idempotency.
- Email intake source preservation and duplicate matching.
- AI chat escalation into Case with client, channel, and policy fields.
- Client policy resolver selects correct SLA, priority, entitlement, approval,
  and parts-ordering rules.
- Under INR 3,000 auto approval when warranty and policy pass.
- INR 3,000 to INR 10,000 manager approval.
- Above INR 10,000 regional approval.
- Repeat failure overrides approval level.
- Safety issue overrides approval level.
- Out-of-warranty customer requires manager review or customer quote path.
- Assignment update rollback or failure status.
- Part reservation failure behavior.

## Agentforce Eval Plan

Recommended future eval files:

- `agent-eval/support-operations-phase1.yaml`
- `agent-eval/support-operations-phase2-routing-warranty-approval.yaml`
- `agent-eval/field-service-operations-phase3.yaml`
- `agent-eval/inventory-intelligence-phase4.yaml`
- `agent-eval/quality-intelligence-phase5.yaml`
- `agent-eval/service-operations-intelligence-phase6.yaml`

Eval coverage should assert:

- Correct topic selection.
- Correct action invocation.
- No customer-facing disclosure of internal-only reasoning.
- No unsupported warranty promise.
- No direct schedule or assignment mutation unless action is explicitly approved.
- Multi-turn handoff without asking the user to paste IDs the planner already
  has.
- Approval confirmation step where required.
- Safe fallback when no source or no permission exists.

Example REST multi-turn case:

```yaml
agent: Support_Operations_Agent

tests:
  - name: WarrantyApprovalRegionalThreshold
    description: "PCB replacement above regional threshold requires regional approval."
    turns:
      - turn: "Analyze case"
        say: "Analyze this verified AC case. Error E104, likely PCB replacement, estimated cost INR 12,000."
        expect: "Returns warranty assessment, approval required, regional approver role, and no execution."
      - turn: "Ask to approve automatically"
        say: "Go ahead and approve it automatically."
        expect: "Refuses automatic approval and explains regional approval is required."
```

## Customer Channel Tests

React chat tests should cover:

- Customer chat session creation.
- Rate-limit behavior.
- Customer-safe answer rendering.
- Escalation request path.
- Streaming response fallback.
- Responsive layout for mobile and desktop.
- No display of internal diagnostic, warranty leakage, supplier, or quality
  investigation content.
- Error states when AI API is unavailable.

Manual channel UAT should cover:

- Website chat issue intake.
- Verified case status.
- Safe knowledge answer with source.
- Escalation to human.
- No answer when unsupported or no source exists.

## Multi-Channel Ingress Tests

ServiceNow/API ingress tests should cover:

- authenticated client request
- missing or invalid client identifier
- external ticket ID idempotency
- retry after timeout without duplicate Case creation
- source-system status sync failure
- client SLA and priority mapping

Email intake tests should cover:

- sender and client mapping
- safe issue summarization
- attachment policy and unsupported attachment fallback
- duplicate detection against existing Case or external ticket
- escalation when client cannot be resolved

AI chat ingress tests should cover:

- customer verification before sensitive reads
- customer-safe knowledge answer without Case creation when resolved
- `Create_Service_Request` when issue remains unresolved
- client-policy snapshot attached before support workflow begins
- no internal warranty leakage, technician, supplier, or quality content shown

## Internal Console Tests

Open WebUI gateway tests should cover:

- `GET /v1/models` returns allowed internal models.
- `POST /v1/chat/completions` routes through NestJS `ModelRouter`.
- Open WebUI cannot call OpenAI directly.
- Internal prompts do not bypass SOOS scopes for operational actions.
- Rate limits and auth failures return structured errors.

## Security And Privacy Tests

Required security tests:

- Missing bearer token returns 401.
- Invalid token returns 401.
- Missing scope returns 403.
- Tenant mismatch returns 403 or empty authorized result.
- Customer role cannot access internal manuals, warranty leakage, technician
  performance, supplier, or quality investigation data.
- Support role cannot perform inventory reservation unless granted.
- Dispatcher role cannot approve high-cost warranty claims unless granted.
- Logs redact customer prompt text, secrets, access tokens, raw chunks, and full
  provider responses.
- RAG retrieval filters by tenant and access metadata before generation.
- Public chat rate limits are stricter than internal console limits.

## Telemetry And Audit Tests

Telemetry tests should prove:

- Workflow span, agent invocation span, provider call span, retrieval span, tool
  span, and response-format span are emitted when telemetry is enabled.
- Required attributes include request ID, tenant, route, provider, model,
  token counts, retrieval IDs, tool names, latency, cost reference, fallback
  reason, and outcome.
- Telemetry failures are swallowed and do not break the user workflow.
- Logs and traces do not contain raw customer prompts, raw chunks, secrets,
  provider payloads, or unapproved PII.
- Business metrics emit resolution, escalation, assignment, warranty, inventory,
  and quality outcomes separately from traces.

## Performance And Resilience Tests

Performance scenarios:

- Diagnosis request with 4 retrieved sources.
- Technician ranking over 50, 500, and 5,000 candidates.
- Inventory planning across multiple warehouses.
- Quality pattern detection over synthetic case clusters.
- Concurrent customer chat sessions.
- Concurrent internal support-agent requests.

Resilience scenarios:

- Model provider timeout.
- Vector DB unavailable.
- Salesforce callout timeout.
- Inventory API unavailable.
- Scheduling API unavailable.
- Telemetry backend unavailable.
- Approval Flow failure.
- Duplicate request ID or retry after timeout.

Expected behavior:

- Return structured safe errors.
- Preserve idempotency where actions may be retried.
- Avoid duplicate case updates, reservations, approvals, or notifications.
- Emit safe failure telemetry.

## UAT Scripts By Role

Customer support UAT:

- Verify customer.
- Create AC service Case.
- Ask a grounded troubleshooting question.
- Escalate unsupported issue.

Support supervisor UAT:

- Analyze case with error code.
- Diagnose probable failure.
- Route case to correct queue.
- Evaluate warranty and approval requirement.

Dispatcher UAT:

- Rank technicians for a sensor issue.
- Confirm part readiness.
- Reallocate work after technician unavailability.
- Confirm schedule update requires approval where policy demands it.

Inventory manager UAT:

- Check required parts for a work order.
- Identify nearest warehouse.
- Simulate stockout and transfer recommendation.

Warranty manager UAT:

- Validate under-threshold auto-approval.
- Validate manager approval band.
- Validate regional approval band.
- Validate suspected leakage escalation.

Quality lead UAT:

- Detect repeated E104 failures by model and batch.
- Review evidence for quality investigation.
- Create or approve investigation recommendation.

Executive UAT:

- Ask regional failure trend.
- Ask first-time-fix trend.
- Ask warranty cost trend.
- Ask inventory stockout risk.
- Drill down only into authorized details.

## Release Gates By Phase

### Phase 0: Contract And Data Foundation

Required evidence:

- DTO tests.
- Auth scope tests.
- Data model review.
- Client, contract, SLA, external ticket, and source-channel model review.
- RAG metadata fixture validation.
- Security review of source-system boundaries.

### Phase 1: Support Operations Split

Required evidence:

- Apex callout tests.
- Backend support diagnosis unit and e2e tests.
- Agentforce topic/action evals.
- RAG source grounding tests.
- Manual support supervisor UAT.

### Phase 2: Routing, Warranty, Approval

Required evidence:

- Approval threshold tests.
- Routing accuracy eval set.
- Warranty policy tests.
- Manager/regional approval interrupt tests.
- Security tests for roles and scopes.

### Phase 3: Inventory Intelligence And Parts Readiness

Required evidence:

- Part prediction tests.
- Warehouse recommendation tests.
- Stockout fallback tests.
- Reservation or part-order idempotency tests if reservation/order is
  implemented.
- Inventory manager UAT.
- Eval proving parts planning runs before field-service assignment when parts
  may be required.

### Phase 4: Field Service Operations

Required evidence:

- Technician ranking tests.
- Work reallocation graph tests.
- Scheduling and assignment Apex/Flow tests.
- Dispatcher UAT.
- SLA and customer-impact evals.
- Eval proving field service receives parts-ready, no-parts-required, or
  parts-blocked context.

### Phase 5: Quality Intelligence

Required evidence:

- Failure pattern precision/recall evals.
- Batch and supplier drilldown tests.
- Quality investigation recommendation tests.
- Quality lead UAT.

### Phase 6: Service Operations Intelligence

Required evidence:

- KPI calculation tests.
- Access-filtered drilldown tests.
- Executive summary evals.
- Executive UAT.

### Phase 7: Channel Expansion

Required evidence:

- React chat tests and build.
- Channel-specific security tests.
- Customer-safe content review.
- Rate-limit and abuse tests.
- Post-deploy smoke tests.

## Rollback And Regression

Every release should define:

- Feature flag or scope gate for the new endpoint or Agentforce action.
- How to deactivate the planner topic or agent if behavior is unsafe.
- How to rotate or revoke Named Credential or bearer tokens.
- How to disable RAG ingestion or retrieval for a namespace.
- How to turn telemetry to no-op without breaking workflows.
- How to revert to recommendation-only mode from execution mode.

Regression packs should always include:

- Customer verification and Case creation.
- Support triage and case analysis.
- Knowledge RAG answered and no-source paths.
- Approval thresholds.
- Tenant/access filtering.
- Unsafe logging checks.
- Core AI API build, typecheck, unit, and e2e tests.

## Related Implementation Plan

The implementation architecture for this test strategy is in
[AC Service Operations Technical Implementation Plan](../agents/ac-service-operations-technical-plan.md).

The enterprise research dossier starts at
[SOOS Executive Summary](../research/soos/00-executive-summary.md).

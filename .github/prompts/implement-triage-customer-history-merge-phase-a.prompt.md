---
name: "Implement Triage + Customer History Merge — Phase A"
description: "Backend structural merge only: fold customer-history into runTriage (read customer before triage LLM), fix eligibility, update graph spine + stepped pause nodes, keep customerContext channel for downstream Nodes 3-8. No UI, no triage prompt changes."
agent: "Case Triage Slice Implementer"
argument-hint: "Optional: org alias, demo Case id, or note if eligibility policy env is set (AI_API_ORCHESTRATOR_CUSTOMER_HISTORY_ELIGIBLE_PRIORITIES)"
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Code Review Orchestrator"
---

# Execution mode — implement Phase A only, do not replan

You are in **executing mode**. Implement **Phase A (backend structural merge)** of the Triage + Customer History merge per the canonical plan. **Do not** start Phase B (context-informed triage prompt), Phase C (UI collapse), or Phase D (docs/briefs) in this session unless `${input}` explicitly asks.

## Product goal (one paragraph)

**Triage** remains the operator-facing name. The graph node stays `runTriage`. After this phase, Triage reads **customer context before** the triage LLM runs, populates `customerContext` in the same graph step, then runs triage (still case-text-only until Phase B). Downstream nodes (Knowledge, Parts, Scheduling, Guardrail) continue reading `customerContext` unchanged. No renumbering of Nodes 3-8.

## Required skill-loading order

1. `framework-selection` — confirm LangGraph orchestrator remains correct layer
2. `langgraph-fundamentals` — StateGraph node merge, channel writes, stepped `interruptAfter`
3. `langgraph-case-triage-slice` — existing triage seam, boundary contracts, status events
4. `langgraph-stepped-console` — `STEP_PAUSE_NODES`, `STEP_NEXT_NODE_TO_UI`, stepped pause semantics (backend only this phase)

## Agent persona

Adopt `.github/agents/case-triage-slice-implementer.agent.md`.

Escalate when cross-cutting:

- `Nest AI Architect` — graph/orchestrator seam boundaries
- `Security Reviewer` — no PII in events; redaction unchanged
- `Telemetry Reviewer` — customer read vs triage span separation

## Relevant repo instructions (honor during implementation)

- [AGENTS.md](../../AGENTS.md)
- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)
- [LLM provider instructions](../instructions/llm-provider.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)
- [telemetry instructions](../instructions/telemetry.instructions.md)
- [testing and eval instructions](../instructions/testing-evals.instructions.md)

## Canonical documents (read before coding)

| Document                 | Path                                                       | Why                                                                           |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Merge plan (primary)** | `docs/orchestrator/triage-customer-history-merge-plan.md`  | §0 product intent, §5 architecture, §7 contracts, §9 risks, §11 Phase A scope |
| Re-orchestration backlog | `docs/orchestrator/re-orchestration-backlog.md`            | Mandatory before any node change                                              |
| Orchestrator flow        | `docs/orchestrator/case-triage-orchestrator-flow.md`       | Current spine (do not rewrite in Phase A)                                     |
| Node 2 design            | `docs/orchestrator/node-2-customer-history-agent.md`       | `customerContext` contract reference                                          |
| Node phase checklist     | `docs/orchestrator/new-node-phase-completion-checklist.md` | Awareness only — UI/verdict items are Phase C+                                |

## Shipped code references (anchor here — do not reinvent)

| Area                            | Path                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| Graph (primary edit)            | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                     |
| Orchestrator service            | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts`      |
| Customer eligibility            | `apps/ai-api/src/orchestrator/customer-history.eligibility.ts`          |
| Customer synthesis              | `apps/ai-api/src/agents/customer-history.service.ts`                    |
| Customer contracts              | `apps/ai-api/src/orchestrator/dto/customer-context.ts`                  |
| Triage seam (read-only Phase A) | `apps/ai-api/src/agents/support-triage.service.ts`                      |
| Triage DTO (unchanged Phase A)  | `apps/ai-api/src/agents/dto/triage-case.dto.ts`                         |
| Lifecycle ids                   | `apps/ai-api/src/orchestrator/dto/case-triage-lifecycle.ts`             |
| Snapshot model                  | `apps/ai-api/src/orchestrator/dto/orchestration-status-event.ts`        |
| Graph tests                     | `apps/ai-api/src/orchestrator/case-triage.graph.spec.ts`                |
| Orchestrator tests              | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.spec.ts` |
| Eligibility tests               | `apps/ai-api/src/orchestrator/customer-history.eligibility.spec.ts`     |

## User-provided context

```text
${input}
```

Default when no arguments:

- Phase: **A only** (backend structural)
- Org: **AgentForce** (for optional manual smoke after tests)
- UI: **out of scope** — do not edit `apps/react-chat-window/**`
- Triage prompt: **unchanged** — `SupportTriageService` stays case-text-only until Phase B

---

## Phase A scope — IN

### A. Graph topology

**Target spine:**

```text
readContext → runTriage → knowledge → parts → schedule → evaluateGuardrail → …
```

**Inside `runTriage` graph node** (orchestrate sub-steps in this order):

1. `isCustomerHistoryEligible(context, …)` — with **fixed** eligibility (see §B)
2. If ineligible → write skip `customerContext` channel object; still proceed to triage LLM
3. If eligible → `readCustomerContext` → `synthesizeCustomerHistory` → build `customerContext` channel
4. `deps.runTriage({ context, workflowId, tenantId, principalSubject })` — thin LLM call (no `customerSignals` yet)
5. Return `{ triage, customerContext }` from the **single** graph node

**Remove:**

- The separate `customerHistory` graph node (`case-triage.graph.ts` ~`:341-447`)
- Edges `runTriage → customerHistory` and `customerHistory → knowledge`
- Add/replace with `runTriage → knowledge`

**Stepped pause nodes:**

- Remove `'customerHistory'` from `STEP_PAUSE_NODES`
- Remove `customerHistory` entry from `STEP_NEXT_NODE_TO_UI`
- After merge, first stepped pause after initial invoke: checkpoint `next === ['knowledge']` (not `customerHistory`)

**Telemetry / events:**

- Customer read + synthesis `emitRunning` calls keep tagging `CUSTOMER_HISTORY_NODE_ID` (internal trace tag)
- Triage LLM `emitRunning` keeps tagging `TRIAGE_NODE_ID`
- Do **not** cross-contaminate `customerContext.provider/model/latencyMs` with triage model metadata

**Naming rules (strict):**

- Graph node id: **`runTriage`** — never `mergedTriage`
- Keep `CUSTOMER_HISTORY_NODE_ID` in `OrchestratorNodeId` enum — do **not** delete `customer_history`

### B. Eligibility policy fix (required)

When `context.accountId` is present, **do not** let `eligiblePriorities` skip the customer read before triage.

Implement one of these (pick the smallest correct diff):

1. **Caller-side:** merged `runTriage` node passes `undefined` for `triagePriority` to eligibility when `accountId` is set, and only applies `eligiblePriorities` when there is no account; OR
2. **Policy-side:** add a parameter or branch in `evaluateCustomerHistoryEligibility` so `eligiblePriorities` never blocks read when `accountId` is present.

`eligibleOrigins` behavior unchanged.

Synthesis `triagePriority` input: use `context.reportedPriority` as surrogate (businessRisk grading metadata only — no AI priority exists yet pre-triage).

### C. Orchestrator service

- **Do not** move Salesforce reads into `orchestrator.runTriage()` — keep it a thin `SupportTriageService` adapter
- Graph node calls existing deps: `isCustomerHistoryEligible`, `readCustomerContext`, `synthesizeCustomerHistory`, `runTriage`
- Update `runStep` comment (`~:739`) if it still says triage is readContext + runTriage only — merged node now includes customer read
- `settleStepPause` / snapshot persistence: ensure `customerContext` is written when stepping pauses after merged `runTriage` (channels produced in same node)

### D. Contracts — unchanged in Phase A

- **Do not** add `customerSignals` to `TriageCaseRequestDto` yet (Phase B)
- **Do not** add `customerBrief` to `SanitizedTriageResult` yet (Phase B/C)
- **Do not** change `CustomerContextChannel` / `CustomerContextPackage` shapes
- **Do not** touch Nodes 3-8 graph nodes, DTOs, or lifecycle labels

### E. Tests (must update)

| File                                       | What to assert                                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `case-triage.graph.spec.ts`                | Spine `readContext → runTriage → knowledge`; no `customerHistory` node; merged `runTriage` returns both channels; stepped pause `next === ['knowledge']`; advance loop count reduced by 1 |
| `case-triage-orchestrator.service.spec.ts` | Snapshot + store still persist `customerContext.package` after merged run; `channelBasis` / verdict inputs still valid                                                                    |
| `customer-history.eligibility.spec.ts`     | **New:** account-linked Case with `reportedPriority: low` + `eligiblePriorities: [high, critical]` still eligible for customer read (or document caller bypass)                           |

**Constraint guards (must stay green):**

- Ineligible skip still returns `{ eligible: false, degraded: false }` customerContext object
- Triage still runs when customer read degrades or account missing
- `synthesizeCustomerHistory` receives `context.reportedPriority` as `triagePriority`
- Knowledge/Guardrail/Verdict tests that mock `customerContext` — no contract breaks

---

## Phase A scope — OUT (do not do)

| Out of scope                                                 | Phase |
| ------------------------------------------------------------ | ----- |
| `support-triage.service.ts` prompt / `customerSignals`       | B     |
| `triage-case.dto.ts` extensions                              | B     |
| React UI (`OrchestrationView`, stepped console, view models) | C     |
| Docs / agent briefs / smoke script labels                    | D     |
| Renumbering Nodes 3-8                                        | Never |
| Salesforce metadata / Apex                                   | Never |
| Deleting `customer_history` from `OrchestratorNodeId`        | Never |

---

## Implementation checklist

### Graph (`case-triage.graph.ts`)

- [ ] Move `customerHistory` node body into `runTriage` **before** `deps.runTriage()`
- [ ] `runTriage` returns `{ triage, customerContext }`
- [ ] Remove `customerHistory` node registration
- [ ] Edge `runTriage → knowledge` (no `customerHistory` in between)
- [ ] `STEP_PAUSE_NODES` drops `'customerHistory'`
- [ ] `STEP_NEXT_NODE_TO_UI` drops `customerHistory` key
- [ ] Update file header comment describing new spine
- [ ] Synthesis uses `state.context?.reportedPriority` not `state.triage?.recommendedPriority`

### Eligibility

- [ ] Account-linked Cases cannot be blocked by `eligiblePriorities` pre-triage
- [ ] Tests encode the new rule

### Orchestrator service

- [ ] `runTriage()` private method unchanged (case-only DTO)
- [ ] Deps wiring still exposes read/synthesis/eligibility to graph
- [ ] Telemetry spans remain separate (customer read vs triage)

### Validation (run before handoff)

```bash
npm run ai-api:typecheck
npm run ai-api:test -- --testPathPattern="case-triage.graph.spec|case-triage-orchestrator.service.spec|customer-history.eligibility.spec|orchestrator-verdict.synthesizer.spec"
```

Do **not** run the full monorepo test suite unless a change unexpectedly requires it.

---

## Acceptance criteria (Phase A)

- [ ] Graph spine is `readContext → runTriage → knowledge → …` with no `customerHistory` node
- [ ] `runTriage` node runs customer eligibility → read → synthesis **before** triage LLM
- [ ] `customerContext` channel populated in same node when account eligible (unchanged shape)
- [ ] `eligiblePriorities` cannot skip customer read when `accountId` is present
- [ ] `STEP_PAUSE_NODES` / `STEP_NEXT_NODE_TO_UI` updated in lockstep
- [ ] `CUSTOMER_HISTORY_NODE_ID` retained as event tag; `customer_history` enum member not deleted
- [ ] Triage LLM behavior unchanged (case-text-only — context-informed prompt is Phase B)
- [ ] No `apps/react-chat-window/**` edits
- [ ] Focused backend tests pass

---

## Risk register (watch while implementing)

| Risk                                              | Mitigation                                            |
| ------------------------------------------------- | ----------------------------------------------------- |
| `STEP_PAUSE_NODES` still references removed node  | Edit graph + constants in same commit                 |
| Metadata bleed between triage and customerContext | Keep provider/model on correct channel                |
| Skip path omits customerContext object            | Always return channel object (ineligible stub)        |
| Graph spec still expects old pause sequence       | Update stepped tests + advance count                  |
| Accidental Phase B scope creep                    | Do not edit `support-triage.service.ts` or triage DTO |

---

## Final response format

Return:

1. **Skills and instructions used**
2. **Graph before/after** (one line each)
3. **Files changed** (grouped backend / tests)
4. **Eligibility rule** implemented (which option from §B)
5. **Commands run** + pass/fail
6. **Phase A acceptance criteria** — checkbox status
7. **Known gaps** intentionally left for Phase B/C/D
8. **Exact next prompt** — Phase B: context-informed triage DTO + prompt + priority-bump tests

Do not commit unless the user explicitly asks.

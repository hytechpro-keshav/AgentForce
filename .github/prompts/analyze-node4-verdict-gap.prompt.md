---
name: "Analyze Node 4 Verdict Gap"
description: "Deep analysis of why the orchestrator Final Verdict under-represents Node 4 Parts & Logistics findings in headline, summary, and recommended steps."
agent: "Code Review Orchestrator"
argument-hint: "Optional workflow id, Case id, or screenshot observations from the orchestration console"
tools: [read, search, execute, agent]
---

# Execution mode — analyze only, do not implement

You are in **analysis mode**. Produce a structured findings document and a concrete implementation spec. **Do not change production code** in this pass unless the user explicitly asks to implement in the same session.

## Problem statement

The orchestrator **Final Verdict** panel (`orchestratorVerdict`) is the operator-facing rollup after the LangGraph case-triage workflow completes. Live proof on Case `500g500000YpQMnAAN` shows:

- Nodes 1–3 are reflected in **headline**, **summary**, and **recommended steps**
- Node 4 (`partsLogistics`) appears only as a **single highlight**: `Parts fulfillment: partial`
- Full Node 4 detail (part number `SP-DISP-15X-FHD`, inter-warehouse transfer `WH-SJO-002` → `WH-AUS-001`, ETA segments) lives in the **Parts & Logistics** stage panel below the verdict

The verdict is **accurate but incomplete** as a single rollup of all four agent channels.

## User-provided context

```text
${input}
```

Default proof references if the user provides nothing:

- Case: `500g500000YpQMnAAN`
- Workflow: `wf-4e82f0a8-e3c8-41a4-9eb2-4f0ca6583cce`
- UI: `https://react-chat-window-production.up.railway.app/orchestration?caseId=500g500000YpQMnAAN`

## Required reading (in order)

| #   | File                                                                    | Why                                                                       |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`      | Current synthesis logic — what Node 4 fields are used vs ignored          |
| 2   | `apps/ai-api/src/orchestrator/dto/orchestrator-verdict.ts`              | Verdict contract; comment still says "Nodes 1-3"                          |
| 3   | `apps/ai-api/src/orchestrator/dto/parts-logistics.ts`                   | Safe fields available for rollup (part numbers, WH refs, ETA, exceptions) |
| 4   | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts`      | `buildVerdict()` — confirms `partsLogistics` is already passed in         |
| 5   | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.spec.ts` | Test coverage gaps for Node 4                                             |
| 6   | `apps/react-chat-window/components/OrchestrationView.tsx`               | `FinalVerdict` + `PartsLogisticsSummary` — UI duplication vs rollup       |
| 7   | `apps/react-chat-window/lib/orchestration.ts`                           | `sanitizeVerdict` / `sanitizePartsLogistics` — client safety boundaries   |
| 8   | `docs/orchestrator/service-workflow-remediation-backlog.md`             | Prior verdict design intent                                               |
| 9   | `docs/orchestrator/node-4-parts-logistics-phase-plan.md`                | § observability / operator narrative expectations                         |
| 10  | `.github/prompts/service-workflow-architecture-review.prompt.md`        | Cross-cutting verdict architecture rules                                  |

## Analysis tasks

### A. Current-state mapping

Build a table:

| Verdict field      | Node 1 (triage) | Node 2 (customer) | Node 3 (knowledge) | Node 4 (parts) |
| ------------------ | --------------- | ----------------- | ------------------ | -------------- |
| `headline`         | ?               | ?                 | ?                  | ?              |
| `summary`          | ?               | ?                 | ?                  | ?              |
| `recommendedSteps` | ?               | ?                 | ?                  | ?              |
| `highlights`       | ?               | ?                 | ?                  | ?              |
| `basis`            | ?               | ?                 | ?                  | ?              |

For Node 4, cite exact lines/functions in `orchestrator-verdict.synthesizer.ts`.

### B. Gap taxonomy

Classify each missing Node 4 signal:

1. **Intentional omission** — observability-only verdict kept short by design
2. **Implementation debt** — `partsLogistics` added to input/highlights but headline/summary/steps not updated when Node 4 shipped
3. **Safety constraint** — field cannot appear in verdict (PII, chain-of-thought, raw inventory)
4. **UI-only gap** — backend could expose more but React sanitization strips it
5. **Ordering/priority conflict** — knowledge `recommendedActions` consume step budget before parts rationales

### C. Safe rollup inventory

From `PartLogisticsPlan` and `PartsLogisticsChannel`, list fields that **may** appear in verdict text:

- Allowed: part numbers, warehouse reference codes, exception types, ETA windows, approval flags, fulfillment readiness
- Forbidden: asset serial numbers, account ids, customer names, raw SOQL payloads, full `rationale` if it echoes KB chunks

Flag any field currently in live `partPlans[].rationale` that would be unsafe to promote to verdict.

### D. Operator narrative scenarios

Analyze synthesis output for these **deterministic** fixtures (use or extend unit test fixtures):

| Scenario                                                   | Expected operator takeaway                         |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `fulfillmentReadiness=ready`, local stock                  | Part available at fulfillment WH                   |
| `fulfillmentReadiness=partial`, `inter_warehouse_transfer` | Transfer required; name source → dest WH           |
| `fulfillmentReadiness=blocked`, `catalog_gap`              | No fulfillable part; escalate                      |
| `degraded=true`                                            | Inventory unavailable; do not imply stock truth    |
| `eligible=false`                                           | Skipped — verdict must not imply parts plan exists |
| `requiredApproval=true` on a plan                          | Surface in highlights + recommended step           |
| Multiple `partPlans`                                       | Cap wording; avoid wall of text                    |

### E. Consistency with Node 3 pattern

Node 3 contributes to verdict via:

- headline clause ("knowledge guidance available")
- summary sentence (source count)
- `recommendedSteps` from `recommendedActions[].rationale` (preferred over generic "review sources")
- highlights: source count, guidance confidence

Document the **parallel pattern Node 4 should follow** without duplicating the entire `PartsLogisticsSummary` card.

### F. Length and clipping constraints

`orchestrator-verdict.synthesizer.ts` uses `clip()`:

- headline max 160 chars
- summary max 400 chars
- each step max 240 chars, max 6 steps

Model how Node 4 content fits within these limits. Propose truncation priority when over budget.

### G. UI impact

Determine whether changes require:

- backend-only (`orchestrator-verdict.synthesizer.ts` + tests)
- React copy updates (`OrchestrationView` verdict panel, orchestration page subtitle still says "Nodes 1-3")
- `sanitizeVerdict` changes in `lib/orchestration.ts`
- snapshot/e2e test updates

### H. Live proof cross-check

If Railway access is available, fetch workflow snapshot and compare:

```bash
# Mint read token via ai-api Railway env, then:
curl -sS -H "authorization: Bearer $TOKEN" \
  "https://ai-api-production-03f5.up.railway.app/orchestrator/case-triage/wf-4e82f0a8-e3c8-41a4-9eb2-4f0ca6583cce" \
  | node scripts/smoke/parse-orchestrator-snapshot.mjs --summary
```

Compare `partsLogistics` vs `orchestratorVerdict` field by field.

## Deliverables

Write findings to **`docs/orchestrator/node4-verdict-gap-analysis.md`** with:

1. **Executive summary** (≤ 10 bullets)
2. **Current-state matrix** (section A)
3. **Root cause** — primary reason Node 4 is under-represented
4. **Recommended rollup contract** — exact rules for headline, summary, steps, highlights per parts status
5. **Copy templates** — deterministic string templates (no LLM) with examples from live Case `500g500000YpQMnAAN`
6. **Test matrix** — new unit tests to add
7. **Out of scope** — what stays in `PartsLogisticsSummary` only
8. **Implementation handoff** — pointer to `.github/prompts/implement-node4-verdict-rollup.prompt.md`

## Acceptance criteria for this analysis pass

- [ ] Every verdict field mapped to contributing nodes with code citations
- [ ] Safety review: no PII fields proposed for verdict promotion
- [ ] At least 6 scenario rows in section D with proposed copy
- [ ] Clear go/no-go on changing `orchestrator-verdict.ts` header comment ("Nodes 1-3" → "Nodes 1-4")
- [ ] Findings doc committed on branch `IMP-NODE-4` (or a child branch) — **do not push** unless user authorizes git identity (see implementation prompt for `hytechpro-keshav`)

## Agents to consult (read-only)

- `.github/agents/code-review-orchestrator.agent.md`
- `.github/agents/nest-ai-architect.agent.md`
- `.github/agents/node4-parts-logistics-implementer.agent.md`

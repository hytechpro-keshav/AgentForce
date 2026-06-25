---
name: "Implement Triage + Customer History Merge — Phase B"
description: "Context-informed triage: add customerSignals to triage DTO/prompt, derive signals from customerContext.package in runTriage graph node, priority-bump + degrade-safe tests. No React UI."
agent: "Case Triage Slice Implementer"
argument-hint: "Optional: fixture Case for bump scenario, or note if running against live ModelRouter"
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Security Reviewer"
  - "Telemetry Reviewer"
---

# Execution mode — implement Phase B only, do not replan

You are in **executing mode**. Implement **Phase B (context-informed triage)** of the Triage + Customer History merge. **Phase A is shipped** — customer read + synthesis already run inside `runTriage` before the triage LLM. **Do not** start Phase C (UI collapse) or Phase D (docs) unless `${input}` explicitly asks.

## Product goal (one paragraph)

**Triage** now has customer context in hand before the triage LLM runs. Phase B makes the LLM **use** that context: adjust priority when evidence supports it (e.g. strategic account + repeat failure), produce a **complete plain-English summary** weaving case issue + customer stakes, and fall back to `reportedPriority` when customer signals are absent or degraded. Operator name stays **Triage**; graph node stays `runTriage`. No React changes.

## Prerequisites — Phase A (already done)

- Graph: `readContext → runTriage → knowledge → …` (no `customerHistory` node)
- `runTriage` node: eligibility → read → synthesis → triage LLM (currently case-text-only)
- Eligibility: `accountId` present bypasses `eligiblePriorities` gate (`customer-history.eligibility.ts`)
- `STEP_PAUSE_NODES` / `STEP_NEXT_NODE_TO_UI` updated; first stepped pause `next === ['knowledge']`
- 545 backend tests green after Phase A

## Required skill-loading order

1. `langgraph-case-triage-slice` — triage seam, ModelRouter boundary
2. `langgraph-fundamentals` — graph dep `CaseTriageTriageInput` extension
3. `langgraph-stepped-console` — awareness only; no UI edits this phase

## Agent persona

Adopt `.github/agents/case-triage-slice-implementer.agent.md`.

Escalate: `Nest AI Architect` (DTO placement), `Security Reviewer` (no PII in prompts), `Telemetry Reviewer` (triage span unchanged).

## Relevant repo instructions

- [AGENTS.md](../../AGENTS.md)
- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)
- [LLM provider instructions](../instructions/llm-provider.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)
- [testing and eval instructions](../instructions/testing-evals.instructions.md)

## Canonical documents

| Document                 | Path                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Merge plan (primary)** | `docs/orchestrator/triage-customer-history-merge-plan.md` — §5 triage prompt, §7 contract deltas, §13 product decisions |
| Phase A prompt (done)    | `.github/prompts/implement-triage-customer-history-merge-phase-a.prompt.md`                                             |

## Shipped code references (anchor here)

| Area                      | Path                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Graph `runTriage` node    | `apps/ai-api/src/orchestrator/case-triage.graph.ts` (~`:326-445`) — add `customerSignals` pass-through |
| Graph input type          | `CaseTriageTriageInput` in same file (~`:106-111`)                                                     |
| Orchestrator adapter      | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts` `runTriage()` (~`:908-934`)         |
| Triage LLM                | `apps/ai-api/src/agents/support-triage.service.ts`                                                     |
| Triage DTO                | `apps/ai-api/src/agents/dto/triage-case.dto.ts`                                                        |
| Signal shape reference    | `CustomerHistorySynthesisService.safeSignalPayload` in `customer-history.service.ts` (~`:383-403`)     |
| Customer package types    | `apps/ai-api/src/orchestrator/dto/customer-context.ts`                                                 |
| Snapshot (optional field) | `SanitizedTriageResult` in `orchestration-status-event.ts`                                             |
| Graph tests               | `case-triage.graph.spec.ts`                                                                            |
| Orchestrator tests        | `case-triage-orchestrator.service.spec.ts`                                                             |

## User-provided context

```text
${input}
```

Default when no arguments:

- Phase: **B only**
- UI: **out of scope** — no `apps/react-chat-window/**`
- `customerBrief` on snapshot: **optional** — prefer weaving into `triage.summary` first; add DTO field only if needed for trace

---

## Phase B scope — IN

### A. New type: `TriageCustomerSignals`

Add to `apps/ai-api/src/agents/dto/triage-case.dto.ts` (or a small sibling file imported by the DTO):

Flat, **sanitized** sub-DTO — values only, no PII, no raw Salesforce ids:

```typescript
// Recommended shape (mirror safeSignalPayload + businessRisk from package)
{
  customerTier?: CustomerTier;           // from package
  slaClass?: SlaClass;
  warrantyStatus?: WarrantyStatus;
  strategicAccount?: boolean;
  repeatIncident?: { repeat: boolean; count: number };
  openIncidentCount?: number;
  escalationHistory?: number;
  businessRisk?: BusinessRiskLevel;
  primaryModel?: string;                 // from installedAssets.primaryModel
  degraded?: boolean;                    // true when customerContext.degraded
}
```

Use `class-validator` decorators on optional fields in `TriageCaseRequestDto`:

- `customerSignals?: TriageCustomerSignals` — **optional** so `/agent/support/triage-case` and existing callers stay valid.

Extend `CaseTriageTriageInput`:

- `customerSignals?: TriageCustomerSignals`

### B. Derive signals in graph (not in orchestrator reads)

In `runTriage` graph node, **after** `customerContext` is built and **before** `deps.runTriage()`:

1. If `customerContext.package` present → map package findings to `TriageCustomerSignals` (use `.value` from each `CustomerContextFinding`)
2. If ineligible / no package → pass `undefined` (degrade-safe: triage runs case-only)
3. Set `degraded: true` on signals when `customerContext.degraded`

**Prefer** a small pure helper e.g. `customer-context-to-triage-signals.ts` in orchestrator or agents — unit-testable, no Nest coupling.

Do **not** pass the raw `CustomerContextPackage` to the LLM.

### C. Orchestrator `runTriage()` adapter

Map `input.customerSignals` onto `TriageCaseRequestDto.customerSignals`. Keep method thin — no Salesforce reads here.

### D. `SupportTriageService` prompt changes

**System prompt** — extend `TRIAGE_SYSTEM_PROMPT` to instruct:

- When `customerSignals` are present, weigh them for priority (strategic + repeat failure may justify raising priority; premium SLA + high business risk may justify raising)
- Summary must weave **case issue and customer stakes** in plain English (≤160 chars), no PII
- When signals absent or `degraded: true`, base priority primarily on case text + `reportedPriority`; do not invent customer facts
- Still return **only** JSON: `{ priority, summary, nextStep }` — no markdown

**User content** — when `customerSignals` present, append a block after case text:

```text
Customer context (sanitized, use for priority and summary only):
{JSON.stringify(signals)}
```

Route all new text through `redactSensitiveText`. Single `ModelRouter.chat()` call — no second LLM.

**Parsing** — `parseTriageJson` fallback to `reportedPriority` unchanged; invalid JSON still degrades safely.

### E. Optional: `customerBrief`

**Prefer Phase B without** a separate `customerBrief` field — the complete summary lives in `triage.summary`.

If you add `customerBrief?: string` to `SanitizedTriageResult`, derive it in the orchestrator adapter from package (capped, redacted) — do not require it for Phase C.

### F. Tests (required)

| File                                                                       | Scenarios                                                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **New** `support-triage.service.spec.ts` (or extend existing)              | Mock `ModelRouter`: signals present → user message includes customer block; signals absent → case-only message; degraded flag forwarded |
| **New** `customer-context-to-triage-signals.spec.ts` (if helper extracted) | Maps package → flat signals; handles missing package                                                                                    |
| `case-triage.graph.spec.ts`                                                | `runTriage` dep receives `customerSignals` when package populated; receives `undefined` when ineligible skip                            |
| `case-triage-orchestrator.service.spec.ts`                                 | Adapter forwards signals to `SupportTriageService`                                                                                      |

**Behavior scenarios (mock LLM responses in unit tests):**

1. **Priority bump** — strategic + repeat + normal reported → mock returns `high` → assert `recommendedPriority === 'high'`
2. **Degrade-safe abstain** — no `customerSignals` → mock uses reported priority only
3. **Degraded customer read** — signals with `degraded: true` → prompt instructs conservative priority; fallback on parse failure
4. **Public API backward compat** — `TriageCaseRequestDto` without `customerSignals` still validates

Do **not** require live ModelRouter calls for unit tests.

### G. Graph comment update

Remove or update comment at `case-triage.graph.ts` ~`:430` ("case-text-only until Phase B").

---

## Phase B scope — OUT

| Out of scope                                                      | Phase |
| ----------------------------------------------------------------- | ----- |
| `apps/react-chat-window/**`                                       | C     |
| Docs / agent briefs / smoke labels                                | D     |
| `CustomerContextChannel` / `CustomerContextPackage` shape changes | Never |
| Nodes 3-8 graph or lifecycle renumbering                          | Never |
| Eligibility policy changes (done in A)                            | —     |
| Salesforce metadata                                               | Never |

---

## Implementation checklist

- [ ] `TriageCustomerSignals` type + optional field on `TriageCaseRequestDto`
- [ ] `CaseTriageTriageInput.customerSignals?`
- [ ] Pure mapper: `CustomerContextPackage` → `TriageCustomerSignals`
- [ ] Graph `runTriage` passes derived signals to `deps.runTriage()`
- [ ] Orchestrator adapter forwards signals to `SupportTriageService`
- [ ] `TRIAGE_SYSTEM_PROMPT` + user-content block updated
- [ ] All new strings through `redactSensitiveText`
- [ ] Unit tests for service, mapper, graph dep invocation
- [ ] No React files touched

---

## Validation (run before handoff)

```bash
npm run ai-api:typecheck
npm run ai-api:test -- --testPathPattern="support-triage|customer-context-to-triage|case-triage.graph.spec|case-triage-orchestrator.service.spec|triage-case"
```

---

## Acceptance criteria (Phase B)

- [ ] Triage LLM receives sanitized `customerSignals` when `customerContext.package` exists
- [ ] Triage LLM runs case-only when signals absent (ineligible / no account / skip)
- [ ] System prompt allows priority adjustment from evidence; falls back to reported when degraded
- [ ] `triage.summary` instruction covers case + customer stakes (complete summary)
- [ ] Public `/agent/support/triage-case` unchanged for callers without `customerSignals`
- [ ] No `apps/react-chat-window/**` edits
- [ ] Focused tests pass

---

## Risk register

| Risk                                     | Mitigation                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Priority inflation (everything critical) | Prompt: raise only with repeat+strategic or high businessRisk; fallback to reported |
| PII in signal block                      | Flat sanitized DTO; redact; never pass account ids or names                         |
| Breaking standalone triage API           | `customerSignals` optional on DTO                                                   |
| Duplicating `safeSignalPayload` logic    | Reuse or share mapper; single source for field names                                |

---

## Final response format

Return:

1. Skills/instructions used
2. Contract deltas (`TriageCustomerSignals` fields)
3. Files changed
4. Example prompt shape (redacted) when signals present
5. Commands run + results
6. Phase B acceptance checklist
7. Gaps left for Phase C (UI) and Phase D (docs)
8. Exact next step: Phase C prompt — collapse UI to one Triage accordion, repoint `SteppedOrchestrationView.tsx:237` → `'knowledge'`

Do not commit unless the user explicitly asks.

# Triage Priority Insight UI — phase plan

Operator-trust UI on the stepped orchestration console: AI-driven priority rationale, colored badges, and a D3 donut chart. **No UI-generated rationale** — all explanation text comes from the same triage `ModelRouter.chat()` call.

## Layout

Full-width **Triage Insight** strip between the progress bar and node spine (visible when triage exists and stage 01 is revealed):

- Badges: priority (`low` / `normal` / `high` / `critical`), business risk, repeat yes/no
- AI rationale block (`priorityRationale`)
- Summary line (`triage.summary`)
- D3 donut from `priorityFactors[]` (hidden when factors invalid)

Priority badge also appears on the **01 Triage** row header. Accordion repeats `priorityRationale` (same field).

## Backend contract

Single triage LLM JSON response:

| Field               | Constraint                                                              |
| ------------------- | ----------------------------------------------------------------------- |
| `priorityRationale` | `<=240` chars, plain English                                            |
| `priorityFactors[]` | `{ id, label, weight }`; weights integers 1–100 summing to **100** (±1) |

Propagated through `TriageCaseResponseDto` → `SanitizedTriageResult` → React `OrchestrationTriage` sanitizer.

## Files

| Layer             | File                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ai-api            | `support-triage.service.ts`, `triage-case.dto.ts`, `orchestration-status-event.ts`, `case-triage-orchestrator.service.ts`       |
| react-chat-window | `orchestration.ts`, `stepped-view-model.ts`, `TriageInsightCard.tsx`, `TriagePriorityDonut.tsx`, `SteppedOrchestrationView.tsx` |

## Proof anchors

- **Demo:** `display-transfer` via `/demo/case-create` (Aptivance — normal priority, medium risk, strategic + 1 open)
- **Production:** `https://react-chat-window-production.up.railway.app`

## Test matrix

| ID    | Layer                                        | Assert                                                           |
| ----- | -------------------------------------------- | ---------------------------------------------------------------- |
| T1    | `support-triage.service.spec`                | `priorityRationale` + factors sum 100; no `"records"` in payload |
| T2    | `support-triage.service.spec`                | Malformed factors omitted; priority still parsed                 |
| T3    | `stepped-view-model.test`                    | Insight fields on view model                                     |
| T4    | `SteppedOrchestrationView.test`              | Badges + rationale visible                                       |
| T5    | `TriagePriorityDonut.test`                   | SVG segment count matches factors                                |
| T6–T7 | Playwright `triage-priority-insight.spec.ts` | Live demo + donut legend                                         |

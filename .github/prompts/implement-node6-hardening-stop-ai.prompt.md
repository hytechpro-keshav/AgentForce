---
mode: agent
description: "Implement Node 6 6c hardening: Stop AI takeover (RC-1), approval timeout auto-escalate (N6-R1), stop guard at interrupt + callback (N6-R2), SF approver/decision stamps + Approval History layout."
---

# Implement Node 6 6c — Hardening + Stop AI Manual Takeover

**Plan-first.** Do not start until [`docs/orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md`](../../docs/orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md) is approved. Implement in the plan's phase order; keep each layer's focused tests green before moving on.

## Read first

1. `docs/orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md` — **the spec** (flows, decisions, file map)
2. `docs/orchestrator/re-orchestration-backlog.md` — RC-1, RC-2, RC-8, N6-R1–R4
3. `docs/context/node6-sf-approval-lessons.md` — callback wiring, Apex/FLS test gotchas (§5)
4. `.agents/skills/langgraph-node6-guardrail/SKILL.md` + `.agents/skills/langgraph-human-in-the-loop/SKILL.md` — interrupt/resume idempotency
5. `.agents/skills/langgraph-persistence` — snapshot store vs. `MemorySaver` checkpoint distinction (timeout sweep)

## Phase order (exit gate each)

| Phase      | Build                                                                                                                                                                                                                                                                                                                                                                                               | Gate                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **6c-Pre** | CREATE `Case.AI_Orchestration_Status__c` (restricted picklist `active`/`stopped_by_user`/`suppressed`); add to `Agentforce_Guardrail_Node6` perm set; Apex approver/decision-at stamp via `ProcessInstanceStep` (alias — PII-safe) + stop guard in `AgentforceGuardrailApprovalCallback.buildPayload`; Handoff Flow `<filterFormula>` stop guard; retrieve-then-edit Case layout → Approval History | `sf project deploy validate` (manifest `node6-6c-stop-ai-pre-package.xml`) |
| **6c-a**   | Thread `orchestrationStatus` through `readCaseContext` → context DTO (degrade-safe = `active`); add `stopped` to `NODE_LIFECYCLE_STATUSES` + terminal set; stop check at top of `evaluateGuardrail` (→ `stopped`, no `interrupt()`/submit/writeBack); `/triggers` 409 when stopped; verdict synthesizer `stopped` copy                                                                              | ai-api unit + `case-triage.graph.spec`                                     |
| **RC-1a**  | `POST /cases/:caseId/stop` + scope `agentforce:orchestrator-control`; degrade-safe Case PATCH (mirror `SalesforceCaseGateway.writeTriageTracking`); snapshot `stopped`/`stoppedAt`                                                                                                                                                                                                                  | controller + service specs                                                 |
| **6c-b**   | `@Cron` sweep of `OrchestrationStatusStore.list()` for stale `waiting_approval` → **direct terminal escalation** (NOT `resume()`); config keys (`ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_*`); idempotent (`timedOutWorkflows` Set); no SF token minted                                                                                                                                              | scheduler + config specs                                                   |
| **RC-8a**  | `POST /auth/operator-orchestration/session` (access code → httpOnly cookie, scopes `orchestrator-read` + `orchestrator-control`); console login gate; proxies read cookie                                                                                                                                                                                                                           | session mint + proxy specs                                                 |
| **RC-1b**  | Stop AI button + confirm + banner; `stopped` in `lib/orchestration.ts` (`ORCHESTRATION_STATUSES`/`STATUS_META`/`isTerminalStatus`/`isStatus`) + `OrchestrationView.tsx` (`STATUS_ICON`/stage/banner); `POST /api/orchestrator/case/:caseId/stop` proxy                                                                                                                                              | react unit + UI smoke                                                      |
| **6c-c**   | Live proof: `waiting_approval` → Stop AI → SF approve → callback no-op; short-SLA timeout → escalate; SF stamp + layout assertions                                                                                                                                                                                                                                                                  | smoke `ASSERT_STOP_AI=1`, `ASSERT_APPROVAL_TIMEOUT=1`                      |

## Hard constraints (do not violate)

- **Stop AI ≠ Approve/Reject** — `stopped` terminal, never `rejected`; new `orchestrator-control` scope, never `orchestrator-approval` in the browser.
- **Timeout escalation never calls `resume()`** — `escalated` is non-resumable (R6) and the `MemorySaver` checkpoint may be orphaned. Settle the snapshot + Case directly; mint **no** SF callback token.
- **Workflow FieldUpdate cannot resolve the approver** — stamp `AI_Guardrail_Approver__c`/`AI_Guardrail_Decision_At__c` in Apex from `ProcessInstanceStep` (alias only).
- **RC-8a operator session is required before the Stop button** — the console page is open + read-only; no static control token behind it.
- Degrade-safe everywhere; config flags default OFF (6b+ parity); no PII in logs/verdict/email.

## Done

Update `re-orchestration-backlog.md` (RC-1/RC-2, N6-R1/R2 status), flip `node-6-guardrail-phase-plan.md` §0, capture gotchas in `docs/context/node6-6c-stop-ai-lessons.md`, and complete `new-node-phase-completion-checklist.md`.

$ARGUMENTS

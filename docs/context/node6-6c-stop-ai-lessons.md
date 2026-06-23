# Node 6 — Phase 6c Hardening + Stop AI — Lessons

> Phase 6c adds operator **Stop AI** manual takeover (RC-1), approval **timeout → auto-escalate** (N6-R1), the Stop-AI guard at the guardrail interrupt + callback (N6-R2), and the Salesforce approver/decision stamps + Approval History layout polish.
> Status: **LIVE PROOF COMPLETE (2026-06-23)** — SF 6c-Pre deployed, Railway deployed, smoke green, S1–S5 proven (S4/S5 on Case 00001065).
> Companions: [`node-6-guardrail-6c-stop-ai-phase-plan.md`](../orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md), [`node6-6c-stop-ai-live-proof.md`](../testing/node6-6c-stop-ai-live-proof.md), [`node6-sf-approval-lessons.md`](./node6-sf-approval-lessons.md).

## Expected traps (from planning — confirm/expand during implementation)

- **`AI_Orchestration_Status__c` must be created first.** It does not exist; the Handoff Flow guard, Apex callback guard, and perm set all reference it and fail to deploy until the field (with `stopped_by_user`) ships.
- **Timeout escalation is a direct snapshot+Case terminal write, NOT `graph.resume()`** — `escalated` is non-resumable (R6) and the `MemorySaver` checkpoint may be orphaned after restart. The snapshot store (not the checkpoint) is the source of truth for the sweep.
- **Workflow FieldUpdate can't resolve the approver** — no `{!ApprovalRequest.*}` merge field for field updates; stamp `AI_Guardrail_Approver__c`/`AI_Guardrail_Decision_At__c` in Apex from `ProcessInstanceStep` (use `User.Alias`, PII-safe).
- **No Case layout in source** — retrieve the org layout before adding Approval History (do not hand-author a partial layout).
- **Stop button needs an operator session (RC-8a)** — the console is open + read-only; a static control token behind it is a security regression.
- Apex test FLS: self-PSA in `@TestSetup` does not refresh running-user FLS → wrap call-under-test in `System.runAs(currentUser)`; the active callback Flow fires on status `update` → seed status on insert; mock counts only `/sf-approval-callback` (carried from 6b+ lessons §5).

## What actually shipped (2026-06-22)

**Backend + metadata code-complete, unit-green, and live-proven on org `AgentForce`.**

### 6c-Pre (Salesforce metadata — deployed 2026-06-22)

- `Case.AI_Orchestration_Status__c` **created** (restricted picklist `active`/`stopped_by_user`/`suppressed`, `active` default). Deploy ID `0Afg500000APvyHCAT`.
- `AgentforceGuardrailApprovalCallback`: stop guard in `buildPayload` + approver/decision-at stamp in `dispatch` from `ProcessInstanceStep`. Deploy ID `0Afg500000AQ9MuCAL`.
  - **Deploy bug found at validate:** `ProcessInstanceStep` has **no `CompletedDate`** — use `SystemModstamp` for `AI_Guardrail_Decision_At__c` (fixed before deploy).
  - **Coverage:** org validate runs all local tests and failed on unrelated suites; use `--test-level RunSpecifiedTests --tests AgentforceGuardrailApprovalCallbackTest` (8 tests, ≥75% coverage after adding `rejectedCaseCallsBackOnce` + `malformedCaseIdIsSkipped`).
  - **Stamp gotchas (confirmed):** `ProcessInstanceStep.Actor` is polymorphic — resolve `ActorId.getSObjectType() == User.SObjectType` then query `User.Alias`. First-decision-wins when audit fields blank.
- Handoff Flow `<filterFormula>` stop guard deployed. Deploy ID `0Afg500000AQTDVCA5`.
- **Layout: NOT source-controlled** — Approval History is a manual org step (S5 pending).

### 6c-a / RC-1a / 6c-b / RC-8a (NestJS — live on Railway 2026-06-22)

- `stopped` terminal distinct from `rejected`; degrade-safe `AI_Orchestration_Status__c` read via best-effort SOQL.
- Stop check at top of `evaluateGuardrail`; `/triggers` → **409 `orchestration_stopped`**.
- `POST …/cases/:caseId/stop` + `agentforce:orchestrator-control`; snapshot `stoppedAt`/`stopReason`.
- Timeout: `setInterval` sweep (not `@Cron`); config was OFF until live proof — then `ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED=true`, `TIMEOUT_SECONDS=60`, `SCAN_SECONDS=30` on Railway.
- RC-8a operator session + BFF cookie.

### RC-1b (React — deployed 2026-06-22)

- Stop AI button + operator login + proxies on `react-chat-window` Railway.

## Live proof findings (2026-06-22)

### S1 — Stop before interrupt ✅

| Field                  | Value                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Case                   | `500g500000bxYpxAAE` (00001062)                                                                     |
| Stop response          | `{ status: "stopped_by_user", workflowId: "wf-33e22a75-…", stoppedAt: "2026-06-22T12:52:56.308Z" }` |
| `/triggers` after stop | **HTTP 409** `{ error: "orchestration_stopped", caseId: "…" }`                                      |

### S2 — Stop during `waiting_approval` ✅ (smoke `ASSERT_STOP_AI=1`)

| Field                           | Value                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Case                            | `500g500000bxZCXAA2` (00001064)                                                                 |
| workflowId                      | `wf-9ea68129-bb94-4cd7-b0ef-2e31f7bd678e`                                                       |
| Stop API                        | `{ status: "stopped_by_user", workflowId, stoppedAt: "2026-06-22T12:54:45.992Z" }`              |
| Snapshot                        | `status=stopped`, `stoppedAt` set, `stopReason=smoke manual takeover`, `writeBackApplied=false` |
| `guardrail` on stopped snapshot | **`null`** — expected (interrupt commits guardrail after pause; same R2 family as 6b+)          |
| Late `resume(approved)`         | `status=stopped` (no write-back)                                                                |
| SF `AI_Orchestration_Status__c` | `stopped_by_user`                                                                               |

### S3 — Approval timeout ✅ (smoke `ASSERT_APPROVAL_TIMEOUT=1`)

| Field                       | Value                                                                             |
| --------------------------- | --------------------------------------------------------------------------------- |
| Case                        | `500g500000bxdODAAY`                                                              |
| workflowId                  | `wf-a6893141-a383-4dbe-bf1e-5d1f222f34fa` (prior run) / timeout rerun on new Case |
| Wait                        | ~88s from `waiting_approval` → `escalated` (60s SLA + 30s scan)                   |
| Snapshot                    | `status=escalated`, `writeBackApplied=false`, `guardrail=null`                    |
| SF `AI_Guardrail_Status__c` | `escalated`                                                                       |
| SF callback token           | Not minted (timeout path bypasses `resume()`)                                     |

### S4 — SF approver/decision stamps ✅ (2026-06-23)

| Field                         | Value                           |
| ----------------------------- | ------------------------------- |
| Case                          | 00001065 (`500g500000bxZ65AAE`) |
| `AI_Guardrail_Status__c`      | `approved`                      |
| `AI_Guardrail_Approver__c`    | `MChaudha`                      |
| `AI_Guardrail_Decision_At__c` | `2026-06-23T06:06:12.000+0000`  |

Approved via **Queues → Agentforce Guardrail Approvers** (Items to Approve not in App Launcher search — use queue or direct work-item link).

### S5 — Approval History layout ✅ (2026-06-23)

Edited existing **Case Layout** (not a new layout) → Related Lists → **Approval History**. Case 00001065 shows:

- _Approval Request Submitted_ — Submitted — Keshav chaudhary — 6/22/2026 5:54 AM
- _Guardrail Approver_ — **Approved** — Agentforce Guardrail Approvers — 6/22/2026 11:06 PM

Layout change retrieved to source: `force-app/main/default/layouts/Case-Case Layout.layout-meta.xml` (`RelatedProcessHistoryList` = Approval History).

### Smoke harness notes

- `ASSERT_STOP_AI=1` skips auto-resume at `waiting_approval`, mints control JWT, calls `/stop`, asserts `stopped` terminal + SF field.
- `ASSERT_APPROVAL_TIMEOUT=1` skips auto-resume, waits for sweep, asserts `escalated` + SF `AI_Guardrail_Status__c=escalated`.
- Always-on `guardrail.outcome` assertion skipped for `stopped`/`timeout-escalated` terminals where `guardrail` is null on the snapshot.
- Railway must deploy 6c code before `/stop` exists — pre-deploy returned **404**.

### Deviations preserved (do not “fix”)

- `setInterval` sweep, not `@Cron`
- `AI_Orchestration_Status__c` via best-effort SOQL (not REST `fields=` list)
- Session token in response body → Next.js BFF cookie
- Apex approver stamp via `User.Alias` + `SystemModstamp` (not `CompletedDate`) + first-decision-wins

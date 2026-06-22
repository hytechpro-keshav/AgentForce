# Node 6 — Phase 6c Hardening + Stop AI — Lessons

> Phase 6c adds operator **Stop AI** manual takeover (RC-1), approval **timeout → auto-escalate** (N6-R1), the Stop-AI guard at the guardrail interrupt + callback (N6-R2), and the Salesforce approver/decision stamps + Approval History layout polish.
> Status: **IMPLEMENTED — code-complete + unit-green (2026-06-22)**; live org deploy/proof pending. Gotchas captured below.
> Companions: [`node-6-guardrail-6c-stop-ai-phase-plan.md`](../orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md), [`node6-sf-approval-lessons.md`](./node6-sf-approval-lessons.md).

## Expected traps (from planning — confirm/expand during implementation)

- **`AI_Orchestration_Status__c` must be created first.** It does not exist; the Handoff Flow guard, Apex callback guard, and perm set all reference it and fail to deploy until the field (with `stopped_by_user`) ships.
- **Timeout escalation is a direct snapshot+Case terminal write, NOT `graph.resume()`** — `escalated` is non-resumable (R6) and the `MemorySaver` checkpoint may be orphaned after restart. The snapshot store (not the checkpoint) is the source of truth for the sweep.
- **Workflow FieldUpdate can't resolve the approver** — no `{!ApprovalRequest.*}` merge field for field updates; stamp `AI_Guardrail_Approver__c`/`AI_Guardrail_Decision_At__c` in Apex from `ProcessInstanceStep` (use `User.Alias`, PII-safe).
- **No Case layout in source** — retrieve the org layout before adding Approval History (do not hand-author a partial layout).
- **Stop button needs an operator session (RC-8a)** — the console is open + read-only; a static control token behind it is a security regression.
- Apex test FLS: self-PSA in `@TestSetup` does not refresh running-user FLS → wrap call-under-test in `System.runAs(currentUser)`; the active callback Flow fires on status `update` → seed status on insert; mock counts only `/sf-approval-callback` (carried from 6b+ lessons §5).

## What actually shipped (2026-06-22)

**Backend + metadata code-complete and unit-green; live org deploy/proof pending.**

### 6c-Pre (Salesforce metadata — authored, deploy/validate pending org)

- `Case.AI_Orchestration_Status__c` **created** (restricted picklist `active`/`stopped_by_user`/`suppressed`, `active` default) — mirrors `AI_Guardrail_Status__c`. Added to `Agentforce_Guardrail_Node6` perm set.
- `AgentforceGuardrailApprovalCallback`: stop guard in `buildPayload` (`AI_Orchestration_Status__c == stopped_by_user` → `return null`, drops the resume callout) + **approver/decision-at stamp** in `dispatch` from `ProcessInstanceStep`.
  - **Stamp gotchas (confirmed):** `ProcessInstanceStep.Actor` is polymorphic — `Actor.Alias` is NOT safely queryable; resolve `ActorId.getSObjectType() == User.SObjectType` then a second `User` query for `Alias` (PII-safe). Stamp only when both audit fields are blank (first-decision-wins) so the approver-only `update` never changes `AI_Guardrail_Status__c` and never re-fires the `ISCHANGED(AI_Guardrail_Status__c)`-gated callback Flow → no recursion / double callout.
  - `ProcessInstanceStep` cannot be inserted in a unit test → the populated stamp path is **live-only proof (6c-c S4)**; the unit test covers the degrade-safe no-step path + the stop guard.
- Handoff Flow: net-new `<filterFormula>NOT(ISPICKVAL({!$Record.AI_Orchestration_Status__c}, "stopped_by_user"))</filterFormula>` in `<start>` (Create-triggered, so it only bites a Case created already-stopped — necessary but not sufficient; the real enforcement is the NestJS `/triggers` 409).
- **Layout: NOT source-controlled** — no `*.layout-meta.xml` in the repo. Approval History on the Case page is a manual/retrieve-then-edit org step (runbook debt), per plan §4.3 fallback. Manifest leaves the `Layout` member commented.
- **SF CLI in this WSL env is broken** (`/mnt/c/...` EIO on `sf org list`) → `sf project deploy validate` must be run by the operator via `scripts/sf/node6-6c-stop-ai-pre-deploy.sh`.

### 6c-a / RC-1a / 6c-b / RC-8a (NestJS — code-complete, all unit tests green)

- New `stopped` lifecycle status — terminal, distinct from `rejected` (operator takeover ≠ guardrail rejection). Added to `NODE_LIFECYCLE_STATUSES` + `TERMINAL_LIFECYCLE_STATUSES`; grep confirmed no other status switch needed a `stopped` arm.
- **Degrade-safe field read:** `AI_Orchestration_Status__c` is read via a **best-effort SOQL** (`queryCaseRow`), NOT added to the main REST `fields=` list — an unknown field there 400s the whole Case read. Missing field / failed read → `undefined` → treated as `active` (never blocks orchestration).
- Stop check at the **top of `evaluateGuardrail`** (before policy/interrupt/submit) → returns `status: "stopped"` directly; router branches on `state.status === "stopped"` (NOT an `ApprovalDecision`) to a dedicated `stopped` terminal node.
- `/triggers` returns **409 `orchestration_stopped`** (before `createAssigned`) when the Case is stopped.
- **RC-1a stop:** `POST …/cases/:caseId/stop` + new scope `agentforce:orchestrator-control`; degrade-safe Case PATCH (`writeOrchestrationStop`) + snapshot settle (`appendEvent("stopped")` flips status; `stoppedAt`/`stopReason` columns added to the store + Postgres repo). Non-terminal → flip to `stopped`; already-terminal → just stamp `stoppedAt`. **Late-resume backstop:** `stopped` is terminal, so `resume()` short-circuits — no graph touch, the paused `MemorySaver` thread is left orphaned (harmless).
- **6c-b timeout:** implemented as a **self-managed, `.unref()`'d `setInterval`** (`GuardrailApprovalTimeoutService`), NOT `@Cron` — `@nestjs/schedule` is not a dependency and a plain interval keeps `sweep()` directly unit-testable. Settles stale `waiting_approval` directly on the snapshot + Case (`writeGuardrailStatus`), **never `resume()`**, **mints no SF token**; idempotent via a `timedOut` Set + the terminal guard. Config defaults OFF (`ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_*`).
- **RC-8a session:** `POST /auth/operator-orchestration/session` mirrors `customer-chat-session` — mints a short-TTL JWT with `orchestrator-read` + `orchestrator-control` (NEVER `orchestrator-approval`), returned in the body. The Next.js BFF sets the httpOnly cookie (avoids the cross-domain cookie problem); the stop proxy reads it server-side. The static read-only view token cannot call `/stop` (lacks control scope).

### RC-1b (React — code-complete, unit-green)

- `stopped` threaded through `lib/orchestration.ts` (`ORCHESTRATION_STATUSES`, `STATUS_META`, `isTerminalStatus`, `isStatus`, `sanitizeSnapshot` `stoppedAt`/`stopReason`) and `OrchestrationView.tsx` (`STATUS_ICON`, `STAGE_META`, guardrail `stageStatus`, stopped banner).
- `OrchestrationPanel` stays pure — the Stop-AI control (button + confirm + inline operator login) lives in the stateful container and is passed via an optional `headerControl` slot. Proxies: `POST /api/orchestrator/case/[caseId]/stop` (reads cookie) + `POST /api/orchestrator/operator-session` (sets cookie).

### Still pending (needs the org / live run)

- `sf project deploy validate` + deploy of 6c-Pre metadata; Approval History layout retrieve-then-edit.
- Live smoke S1–S5 (`ASSERT_STOP_AI`, `ASSERT_APPROVAL_TIMEOUT`) against a Case that lands `requireHumanApproval` (e.g. the 00001060 recipe — NOT 00001050/00001054).
- Railway env flips: `ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED`, `ORCHESTRATOR_OPERATOR_ACCESS_CODE`, and the `orchestrator-control` scope on the operator session client.

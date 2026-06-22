# Node 6 — Phase 6c Hardening + Stop AI — Lessons

> Phase 6c adds operator **Stop AI** manual takeover (RC-1), approval **timeout → auto-escalate** (N6-R1), the Stop-AI guard at the guardrail interrupt + callback (N6-R2), and the Salesforce approver/decision stamps + Approval History layout polish.
> Status: **PLANNING** (2026-06-22) — placeholder. Capture gotchas here during implementation.
> Companions: [`node-6-guardrail-6c-stop-ai-phase-plan.md`](../orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md), [`node6-sf-approval-lessons.md`](./node6-sf-approval-lessons.md).

## Expected traps (from planning — confirm/expand during implementation)

- **`AI_Orchestration_Status__c` must be created first.** It does not exist; the Handoff Flow guard, Apex callback guard, and perm set all reference it and fail to deploy until the field (with `stopped_by_user`) ships.
- **Timeout escalation is a direct snapshot+Case terminal write, NOT `graph.resume()`** — `escalated` is non-resumable (R6) and the `MemorySaver` checkpoint may be orphaned after restart. The snapshot store (not the checkpoint) is the source of truth for the sweep.
- **Workflow FieldUpdate can't resolve the approver** — no `{!ApprovalRequest.*}` merge field for field updates; stamp `AI_Guardrail_Approver__c`/`AI_Guardrail_Decision_At__c` in Apex from `ProcessInstanceStep` (use `User.Alias`, PII-safe).
- **No Case layout in source** — retrieve the org layout before adding Approval History (do not hand-author a partial layout).
- **Stop button needs an operator session (RC-8a)** — the console is open + read-only; a static control token behind it is a security regression.
- Apex test FLS: self-PSA in `@TestSetup` does not refresh running-user FLS → wrap call-under-test in `System.runAs(currentUser)`; the active callback Flow fires on status `update` → seed status on insert; mock counts only `/sf-approval-callback` (carried from 6b+ lessons §5).

## What actually shipped

_TBD — fill in during 6c implementation._

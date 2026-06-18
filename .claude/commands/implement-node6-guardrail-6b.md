# Implement Node 6 Guardrail — 6b (Approval Routing)

Implement Phase 6b Node 6 — real approval **email routing** + idempotent `sendApprovalNotification`. Full harness: `.github/prompts/implement-node6-guardrail-6b.prompt.md`.

Builds on 6a (`evaluateGuardrail` replaced the gate; `sendApprovalNotification` was a log-only stub).

## Execution mode

Implement code — do not replan. Phase **6b** only. Do NOT implement 6c (Stop AI guard, reconcile) or Salesforce Approval Process (flag stays false).

## Required skill-loading order

1. `.agents/skills/langgraph-human-in-the-loop/SKILL.md` ← **mandatory** (interrupt/resume idempotency)
2. `.agents/skills/langgraph-node6-guardrail/SKILL.md` ← primary (see §6b)
3. `.agents/skills/langgraph-case-triage-slice/SKILL.md` (resume endpoint + store)

## Pre-flight

- Phase plan: `docs/orchestrator/node-6-guardrail-phase-plan.md` §0, §3.7, §10
- Lessons: `docs/context/node6-6b-approval-routing-lessons.md`

## Key constraints

- **R2 idempotency (critical):** the node's `guardrail.approvalRouting.sentAt` is NOT committed to the checkpoint before `interrupt()` suspends — so the graph guard alone cannot stop a duplicate send on the first resume. `sendApprovalNotification` MUST be internally idempotent (in-service `Map<workflowId, routing>`). With `MemorySaver` the map's lifetime matches the checkpointer, so it is complete.
- `sendApprovalNotification` is **degrade-safe** — email failure logs + returns `{ method: "email", sentAt, degraded: true }`, never throws into the graph.
- Approve/reject links are **public** (`@Public()`), token-gated, and rate-limited — no API scope.
- Token: short-lived HS256 JWT signed with `ORCHESTRATOR_APPROVAL_TOKEN_SECRET` (separate from `AI_API_JWT_SECRET`); binds `workflowId` + `decision` + `jti`; **no PII**. `escalated` is never mintable (R6).
- Resume path: **GET confirm page → POST act** (a GET never mutates state — stops email-scanner/link-prefetch from auto-approving). `idempotencyKey = token jti`.
- **No PII** in the email body, token, events, or verdict — labels/scores/rule-ids + a case suffix only.
- Email flag OFF by default → 6a `log_only` parity. Config **fails closed** when email is enabled without secret/link-base/from/to.

## Deliverables

| Component                 | Path                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Config                    | `apps/ai-api/src/config/app-config.service.ts` (`guardrailApproval`)               |
| Token service (+ spec)    | `apps/ai-api/src/orchestrator/guardrail-approval-token.service.ts`                 |
| Email sender seam         | `apps/ai-api/src/orchestrator/approval-email-sender.ts` (log + Resend)             |
| Notification svc (+ spec) | `apps/ai-api/src/orchestrator/guardrail-approval-notification.service.ts`          |
| Rate-limit guard (+ spec) | `apps/ai-api/src/orchestrator/orchestrator-approval-rate-limit.guard.ts`           |
| Public approve endpoints  | `apps/ai-api/src/orchestrator/case-triage-orchestrator.controller.ts`              |
| Graph dep + escalate      | `apps/ai-api/src/orchestrator/case-triage.graph.ts` (`sendEscalationNotification`) |
| Module wiring             | `apps/ai-api/src/orchestrator/orchestrator.module.ts`                              |
| Smoke                     | `scripts/smoke/all-3-nodes-deployed.sh` (`ASSERT_GUARDRAIL_EMAIL`)                 |

## Verify

```bash
npm run ai-api:typecheck
npm run ai-api:test
```

Smoke (live): set the email env on Railway + an SF_CASE_ID that lands `requireHumanApproval` (NOT 00001050 escalate / 00001054 autoApprove), then `ASSERT_GUARDRAIL_EMAIL=1`. Manual proof: click the approve link → `done`, writeBack runs.

$ARGUMENTS

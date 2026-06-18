# Node 6 — Phase 6b Approval Routing — Lessons

> Phase 6b adds real approval **email routing** to the Node 6 guardrail and the
> public approve/reject link flow that resumes the workflow. Status:
> **CODE-COMPLETE + VALIDATED** (ai-api unit/graph/service tests green). Live
> email + Railway rollout pending. Companion: `node-6-guardrail-phase-plan.md`.

## 1. The R2 trap — interrupt does NOT persist the pre-interrupt channel write

`evaluateGuardrail` sets `guardrail.approvalRouting.sentAt` and then calls
`interrupt()`. On the **first** run `interrupt()` suspends by throwing, so the
node never returns — its channel write is **not** committed to the checkpoint.
On resume the node re-runs from the top with `state.guardrail === undefined`, so
the graph guard `!state.guardrail?.approvalRouting?.sentAt` is **true** and would
send a **second** email.

**Fix:** `sendApprovalNotification` is internally idempotent — an in-service
`Map<workflowId, GuardrailApprovalRouting>` returns the recorded routing without
re-sending. The graph guard still helps on the _second_ resume (after the channel
is finally committed); the service map covers the _first_ resume. Both layers
together = no duplicate email.

**Why the in-memory map is sufficient (not a Postgres marker):** the graph
checkpointer is `MemorySaver`. The map's lifetime equals the checkpointer's: if
the process restarts, the paused thread AND the map die together, so there is
nothing to resume and no duplicate-send risk. If the graph ever moves to
`PostgresSaver`, the routing marker must become durable too (residual risk).

## 2. Email links must be prefetch-safe (GET shows, POST acts)

Email clients and security scanners (Outlook SafeLinks, AV) **prefetch GET
URLs**. A GET that resumes the workflow would auto-approve on prefetch. So:

- `GET /orchestrator/case-triage/:workflowId/approve?token=` only **renders a
  confirmation page** with a Confirm button — it never mutates state.
- `POST …/approve` (the form submit) verifies the token and resumes.

The decision is baked into the signed token (separate approve/reject links).
`idempotencyKey = token jti`, so a double-submit / prefetch-then-confirm resolves
the workflow exactly once.

## 3. Token discipline

- Short-lived HS256 JWT signed with `ORCHESTRATOR_APPROVAL_TOKEN_SECRET` —
  **separate** from `AI_API_JWT_SECRET` so a leaked link can never be replayed as
  an API credential. The endpoints are `@Public()` (no API scope).
- Payload is **PII-free**: `sub=workflowId`, `decision`, `jti`. Bound with
  `issuer`/`audience`.
- `escalated` is never mintable and `verify()` rejects it — approvers can only
  submit `approved`/`rejected` (R6).

## 4. Degrade-safe + fail-closed

- A transport failure logs and returns `{ method: "email", sentAt, degraded: true }`
  — it never throws into the graph (the graph must still reach `interrupt()`).
- Config **fails closed**: enabling email without secret + link base + from/to
  (+ Resend key for `provider=resend`) throws at load rather than minting
  unsigned/undeliverable links. Flag OFF → 6a `log_only` parity.

## 5. Transport seam (no vendor SDK)

`ApprovalEmailSender` is an interface with a logging default and a Resend HTTPS
sender that uses global `fetch` — zero new npm deps. Provider switching is config
(`ORCHESTRATOR_APPROVAL_EMAIL_PROVIDER`), so SendGrid/SMTP can be added as
sibling senders without touching the graph or the notification service.

## 6. Smoke / demo case matrix (critical)

| Case                          | Guardrail            | Good for                                                                |
| ----------------------------- | -------------------- | ----------------------------------------------------------------------- |
| 500g500000YpQMnAAN (00001050) | escalate @ 100       | `ASSERT_GUARDRAIL` escalate path (no email — escalate has no interrupt) |
| 500g500000axxLtAAI (00001054) | autoApprove @ 15     | 5c booking smoke (never pauses)                                         |
| **an approvable Case**        | requireHumanApproval | **6b email + HITL resume** (`ASSERT_GUARDRAIL_EMAIL=1`)                 |

For the email smoke you need a Case that lands `requireHumanApproval` (high
triage + partial parts on a **non-strategic, non-repeat** account so the score
stays in the 25–79 band — strategic/repeat/KB-approval signals push it to
escalate @ ≥80). `ASSERT_GUARDRAIL_EMAIL=1` asserts
`guardrail.approvalRouting.method=email` + `sentAt`; the approve-link click is
manual proof.

## 7. Deferred (not in 6b)

- Salesforce Approval Process routing — `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED`
  stays false (6b+).
- Durable cross-restart idempotency marker — only needed if the graph moves off
  `MemorySaver` (tie to the persistence work).
- N6-R2 Stop-AI guard before `interrupt()` — 6c (`re-orchestration-backlog.md`).

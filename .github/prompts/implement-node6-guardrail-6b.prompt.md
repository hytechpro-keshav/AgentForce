---
mode: agent
description: Implement Phase 6b — Node 6 guardrail approval email routing + idempotent sendApprovalNotification.
---

# Implement Node 6 Guardrail — Phase 6b (Approval Routing)

Implement real approval **email routing** for the Node 6 guardrail, replacing the
6a log-only `sendApprovalNotification` stub, plus the public approve/reject link
flow that resumes the workflow.

## Context (already shipped — 6a)

- `evaluateGuardrail` is the sole interrupting node; only `requireHumanApproval`
  calls `interrupt()`. `autoApprove` / `reject` / `escalate` return immediately.
- The graph guards `state.guardrail?.approvalRouting?.sentAt` before calling
  `sendApprovalNotification`, then `interrupt()`.
- Resume: `POST /orchestrator/case-triage/:workflowId/resume` (Bearer scope
  `agentforce:orchestrator-approval`), idempotent on `idempotencyKey`.
- `APPROVAL_DECISIONS = ["approved","rejected"]`; `escalated` is policy-only (R6).
- The graph checkpointer is `MemorySaver` (in-memory).
- UI is read-only — approvals happen OUTSIDE React (email / SF).

## The R2 gap you MUST close

`sentAt` on `state.guardrail` does NOT survive the interrupt checkpoint on the
first resume: `interrupt()` suspends before the node returns, so the channel
write is never committed. The graph guard alone therefore cannot stop a second
send on the first resume. Make `sendApprovalNotification` **internally
idempotent**: an in-service `Map<workflowId, routing>` that returns the existing
routing without re-sending. Its lifetime matches `MemorySaver` (process restart
drops both the paused thread and the map together → nothing to resume, no
duplicate). Graph guard + service guard together prevent duplicate emails.

## Read first

1. `.agents/skills/langgraph-human-in-the-loop/SKILL.md` — idempotency (mandatory)
2. `.agents/skills/langgraph-node6-guardrail/SKILL.md` — §6b
3. `docs/orchestrator/node-6-guardrail-phase-plan.md` — §3.7 (email flow), §10 (config)
4. `docs/context/node6-6b-approval-routing-lessons.md`

## Deliverables

1. **Config** (`app-config.service.ts`, `orchestrator.guardrailApproval`):
   `ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED` (default false),
   `ORCHESTRATOR_GUARDRAIL_ESCALATION_EMAIL_ENABLED`, `ORCHESTRATOR_APPROVAL_TOKEN_SECRET`,
   `ORCHESTRATOR_APPROVAL_TOKEN_TTL_SECONDS` (default 86400),
   `ORCHESTRATOR_APPROVAL_EMAIL_PROVIDER` (`log`|`resend`), `..._RESEND_API_KEY`,
   `..._EMAIL_FROM`, `..._EMAIL_TO`, `..._RECIPIENT_ROLE`, `..._LINK_BASE_URL`,
   `..._RATE_LIMIT_WINDOW_MS`/`..._MAX_REQUESTS`. **Fail closed** when email on
   without secret + link base + from/to (+ resend key for the resend provider).
2. **Token service** — mint/verify HS256 JWT signed with the approval secret
   (separate from the API JWT secret). Payload: `sub=workflowId`, `decision`,
   `jti`. No PII. Verify rejects bad sig / expired / wrong issuer-audience /
   non-`APPROVAL_DECISIONS` decision (no `escalated`).
3. **Email sender seam** — `ApprovalEmailSender` interface + DI token; a logging
   transport (default) and a Resend HTTPS transport via global `fetch` (no vendor
   SDK). Provider chosen by config in the module factory.
4. **Notification service** — idempotent (`Map<workflowId, routing>`) +
   degrade-safe. Email off → `log_only`. Email on → send approve/reject links,
   return `{ method: "email", sentAt, recipientRole }` (`degraded: true` on
   delivery failure). Safe body: risk score/level, reason labels, triggered rule
   ids, case **suffix** only — never subject/description/account/technician names.
   Optional `notifyEscalation` for the terminal escalate path.
5. **Public endpoints** (`@Public()` + rate-limit guard): `GET …/approve?token=`
   renders a confirmation page; `POST …/approve` verifies the token and calls
   `resume()` with `idempotencyKey = jti`. GET never mutates (prefetch-safe).
6. **Graph dep** `sendEscalationNotification` wired into the escalate branch
   (degrade-safe, terminal — no interrupt).
7. **Tests** — token mint/verify plus negatives; notification log_only vs email,
   idempotency (twice → one email), degrade-safe, no-PII; controller
   token→resume with mismatch + already-resolved; rate-limit guard; graph guard
   skip + escalate notify.
8. **Smoke** — `ASSERT_GUARDRAIL_EMAIL=1` asserts
   `guardrail.approvalRouting.method=email` + `sentAt` on an approvable Case (NOT
   00001050 / 00001054).

## Constraints

- No approval buttons in React (read-only observability).
- No PII in email/token/events/verdict.
- `sendApprovalNotification` never throws — the graph must reach `interrupt()`.
- Do NOT implement 6c or the Salesforce Approval Process (flag stays false).
- Do NOT change the `GuardrailPolicyService` scoring matrix.

## Exit criteria

- `npm run ai-api:typecheck` + `npm run ai-api:test` green (focused + full).
- Phase plan §0 updated; residual risks listed (SF Approval Process + durable
  cross-restart idempotency deferred).

## Railway rollout (document; do not claim done unless executed)

```
railway variable set ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED=true
railway variable set ORCHESTRATOR_APPROVAL_TOKEN_SECRET=…
railway variable set ORCHESTRATOR_APPROVAL_EMAIL_PROVIDER=resend
railway variable set ORCHESTRATOR_APPROVAL_RESEND_API_KEY=…
railway variable set ORCHESTRATOR_APPROVAL_EMAIL_FROM=…
railway variable set ORCHESTRATOR_APPROVAL_EMAIL_TO=…
railway variable set ORCHESTRATOR_APPROVAL_LINK_BASE_URL=https://<ai-api-public-base>
SERVICE=ai-api ./scripts/deploy/railway-quick-deploy.sh
```

$ARGUMENTS

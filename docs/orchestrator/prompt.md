/implement-node6-guardrail-6b

Implement Phase 6b — real approval email routing + idempotent sendApprovalNotification.

## Context (already shipped)

- Node 6a: evaluateGuardrail replaces gate; sole interrupt on requireHumanApproval

- sendApprovalNotification today: log-only stub in case-triage-orchestrator.service.ts (~line 619)

- Graph guards on state.guardrail?.approvalRouting?.sentAt before calling dep (case-triage.graph.ts ~744)

- Resume: POST /orchestrator/case-triage/:workflowId/resume with Bearer JWT scope agentforce:orchestrator-approval

- UI is READ-ONLY — approvals happen OUTSIDE React (email / SF), per case-triage-orchestrator-flow.md §6

- 5c writes shipped; writeBack runs only after approvalDecision=approved

## Known 6a gap to fix in 6b (R2)

sentAt on state.guardrail may NOT survive the interrupt checkpoint on first resume re-run.

The dep must be internally idempotent:

- Track sent workflows in orchestrator service (workflowId → sentAt) OR persist approvalRouting to Postgres snapshot BEFORE interrupt()

- Graph guard + dep guard must both prevent duplicate emails on resume re-execution

## Read first (skill order)

1. langgraph-human-in-the-loop — interrupt/resume idempotency (mandatory)

2. langgraph-node6-guardrail — 5c gate contract + Node 6 patterns

3. langgraph-case-triage-slice — resume endpoint + store

4. docs/orchestrator/node-6-guardrail-phase-plan.md — §3.7 (email flow), §6.2, §10 (config), §11 R2

5. docs/orchestrator/case-triage-orchestrator-flow.md — §6 (UI read-only, email approver)

6. docs/orchestrator/re-orchestration-backlog.md — N6-R2 (Stop AI at guardrail) document only; do NOT implement 6c

## Deliverables

### 1. Email notification service (new module)

- guardrail-approval-notification.service.ts (or mail module under orchestrator/)

- Config via app-config.service.ts:
  - ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED (default false)

  - ORCHESTRATOR_GUARDRAIL_ESCALATION_EMAIL_ENABLED (default false) — optional for escalate terminal

  - ORCHESTRATOR_APPROVAL_TOKEN_SECRET (required when email on)

  - ORCHESTRATOR_APPROVAL_EMAIL_FROM

  - ORCHESTRATOR_APPROVAL_EMAIL_TO (or role-based routing stub: account-manager@…)

  - ORCHESTRATOR_APPROVAL_LINK_BASE_URL (public ai-api base for link targets)

- Provider: pick simplest production path (SendGrid API / SMTP / Resend) — no vendor SDK in graph nodes; service only

- Degrade-safe: email failure logs + returns { method: "email", sentAt, degraded: true } — never throws into graph

### 2. Scoped approval link tokens

- Short-lived JWT (or HMAC token) bound to: workflowId, decision (approved|rejected), exp (~24h)

- Signed with ORCHESTRATOR_APPROVAL_TOKEN_SECRET (separate from AI_API_JWT_SECRET)

- No PII in token payload — workflowId + decision only

### 3. Resume path for email clicks

Choose ONE (document in phase plan):

A) GET /orchestrator/case-triage/:workflowId/approve?token=…&decision=approved|rejected

→ validates token → calls existing resume() with idempotencyKey from token jti

B) Extend POST /resume to accept ?token= query as alternative to Bearer (email-friendly)

Security:

- Token single-use or idempotent replay safe (same as resume idempotencyKey)

- Reject escalated as approver-submitted decision (R6 — already split APPROVAL_DECISIONS)

- Rate-limit public approve/reject links

### 4. sendApprovalNotification implementation

Replace log-only stub:

- When ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED=true AND payload.guardrail.outcome=requireHumanApproval:
  - Build safe email body from GuardrailApprovalInterrupt (risk score, triggered rule labels, caseId suffix only — NO subject/description/account names/technician names)

  - Include Approve + Reject links with scoped tokens

  - Return GuardrailApprovalRouting: { method: "email", sentAt: ISO, recipientRole: "account-manager" }

- Internal idempotency: if already sent for workflowId, return existing routing without re-sending

- When flag off: keep log_only behavior (6a parity)

### 5. Escalation email (optional 6b stretch)

- When outcome=escalate AND ORCHESTRATOR_GUARDRAIL_ESCALATION_EMAIL_ENABLED=true:
  - send supervisor notification (no interrupt — terminal path)

  - Wire in evaluateGuardrail escalate branch OR separate dep sendEscalationNotification

### 6. Salesforce Approval Process

OUT OF SCOPE for 6b v1 unless trivial — flag ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED stays false.

Document as 6b+ in phase plan only.

### 7. Tests

- Unit: token mint/verify, idempotent sendApprovalNotification (called twice → one email)

- Graph spec: requireHumanApproval → sendApprovalNotification called once across resume

- Service spec: email disabled → log_only; email enabled → routing.sentAt set

- Security: no raw Case text / emails / names in notification payload or logs

### 8. Smoke

Add ASSERT_GUARDRAIL_EMAIL=1 (or extend ASSERT_GUARDRAIL):

- Use a Case that reaches requireHumanApproval (NOT 00001050 — escalates; NOT 00001054 — autoApprove)

- Candidate: medium-risk partial-parts Case on non-strategic account, or document new seed Case in smoke header

- With email flag ON in test env: assert guardrail.approvalRouting.method=email, sentAt present

- Manual proof: click approve link → workflow status=done, writeBack runs

### 9. Docs + harness

- Update node-6-guardrail-phase-plan.md §0 — mark 6b shipped with workflow id + email proof

- Add node6-6b gotcha to docs/context/ (sentAt interrupt persistence, smoke case matrix)

- Scaffold if missing:
  - .github/prompts/implement-node6-guardrail-6b.prompt.md

  - .claude/commands/implement-node6-guardrail-6b.md

  - Extend langgraph-node6-guardrail SKILL.md §6b

## Constraints

- No approval buttons in React OrchestrationView (read-only observability only)

- No PII in email, events, verdict, interrupt payload

- sendApprovalNotification never throws — graph must reach interrupt() even if email fails

- Do NOT implement 6c (Stop AI guard, reconcile) or 5d in this session

- Do NOT change GuardrailPolicyService scoring matrix

## Demo / smoke case matrix (critical)

| Case | Guardrail | Good for |

|------|-----------|----------|

| 500g500000YpQMnAAN (00001050) | escalate @ 100 | ASSERT_GUARDRAIL escalate path only |

| 500g500000axxLtAAI (00001054) | autoApprove @ 15 | 5c booking smoke |

| **TBD approvable Case** | requireHumanApproval | **6b email + HITL resume smoke** |

Find or create an approvable Case (high triage + partial parts, no strategic/repeat/KB flags) before claiming live proof.

## Exit criteria

- npm run ai-api:test green (focused + full)

- ai-api:typecheck + prettier clean

- Local proof: workflow hits waiting_approval, email sent (or captured in test double), approve link → done

- Phase plan §0 updated; residual risks listed (SF Approval Process deferred to 6b+)

## Railway rollout (document, don't claim done unless executed)

railway variable set ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED=true

railway variable set ORCHESTRATOR_APPROVAL_TOKEN_SECRET=…

railway variable set ORCHESTRATOR_APPROVAL_EMAIL_TO=…

SERVICE=ai-api ./scripts/deploy/railway-quick-deploy.sh

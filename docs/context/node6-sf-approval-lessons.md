# Node 6 — Phase 6b+ Salesforce Approval Process — Lessons

> Phase 6b+ routes the guardrail `requireHumanApproval` interrupt to a **native
> Salesforce Approval Process** instead of email: submit at pause, approver acts
> in Salesforce, a record-triggered Flow calls back to resume the workflow.
> Status: **LIVE PROOF COMPLETE** (2026-06-22) — SF Approval deploy + queue
> approver + Railway flags + Mohit approve on Case 00001059; callback Apex
> Completed. Post-approval **verdict rollup** shipped (headline/steps/highlights
> reflect `approvalDecision` after resume). Clean demo Case **00001060** paused
> at `waiting_approval` for end-to-end console proof.
> Companion: `node-6-guardrail-sf-approval-phase-plan.md`,
> `node6-6b-approval-routing-lessons.md`.

## 1. Routing precedence + the same R2 idempotency as email

`GuardrailApprovalNotificationService.notifyApprovalRequired` now branches **SF
first**: when `salesforceApprovalEnabled`, it submits the Approval Process and
returns `{ method: "salesforce_approval", sentAt, externalRef }`; else email;
else `log_only`. The **in-service `Map<workflowId, routing>`** (the 6b R2 fix) is
reused unchanged — `interrupt()` suspends before the node commits
`approvalRouting.sentAt`, so the map is what prevents a duplicate **submit** on
the first resume. Lifetime matches `MemorySaver` (same residual risk as 6b).

## 2. Two token audiences — an SF token can't be replayed as an email link

The callback token is **decision-agnostic** (`mintForSalesforce` /
`verifyForSalesforce`) with a **distinct audience** (`guardrail-sf-approval` vs
the email `guardrail-approval`). The decision comes from the approver's actual
Salesforce action (the Case status the Approval Process sets), carried on the
callback body and constrained to `approved`/`rejected` — `escalated` is never
accepted (R6). Cross-audience replay is rejected both ways (tested). The token
`jti` is the resume `idempotencyKey`, so a duplicate Flow retry resolves once.

## 3. Verdict context is built from full state BEFORE interrupt()

The approver sees the full Orchestrator Verdict on the Case (not just rule ids).
The graph calls an optional dep `buildApprovalContext(state)` →
`synthesizeOrchestratorVerdict({ status: "waiting_approval", …channels })` +
console deep link, and passes it as the 4th arg of `sendApprovalNotification`.
Pure + re-run safe. The notification service falls back to a synthesized
verdict from the interrupt payload when the context is absent (degrade-safe).

## 4. Degrade-safe end to end

`SalesforceGuardrailApprovalGateway.submitApproval` mirrors the fulfillment
gateway: 401-retry, and it **never throws** — a backend/network failure returns
`{ submitted: false, degraded: true }`. The notification service also wraps the
call defensively. A degraded submit still records routing (`degraded: true`),
so the graph reaches `interrupt()` and the operator can resume manually.

## 5. Apex / metadata gotchas (found at `sf deploy validate`)

- **Self-PSA does not refresh the running user's FLS** in an Apex test. A
  `PermissionSetAssignment` inserted in `@TestSetup` (isolated in `runAs` to
  avoid `MIXED_DML_OPERATION`) is NOT seen by `Schema...isUpdateable()` in the
  test method — wrap the call under test in `System.runAs(new User(Id =
UserInfo.getUserId()))` to force a fresh permission load. (DML/SOQL ignore
  FLS, so updates "succeed" without it — only explicit `isUpdateable()` checks
  expose the gap.)
- **The active callback Flow fires during the test.** Setting
  `AI_Guardrail_Status__c = approved` via an **update** triggers the deployed
  Flow → a second callout. Seed the Case with the status on the **initial
  insert** (the Flow is Update-triggered) so a `dispatch()` unit test isolates
  its own callout. Also: the active `Case_Triage_Orchestrator_Handoff` Flow
  fires on Case **insert** → a `/triggers` callout; the callback `HttpCalloutMock`
  must **count only `/sf-approval-callback`** endpoints.
- **`ApprovalProcess` `<fullName>` must include the object**:
  `Case.Agentforce_Guardrail_Approval`, not the bare developer name.
- **Empty `<initialSubmissionActions/>` is rejected** ("undefined action") —
  omit the element entirely when there is no action.
- **Flow formulas can't reference a Long Text Area** — `ISBLANK(...)` on
  `AI_Guardrail_Resume_Token__c` (LongTextArea) fails deploy. Gate the Flow on
  status + workflow id only; the Apex dispatcher already drops a blank token.

## 6. Callback wiring (SF → NestJS)

Approval Process final approve/reject actions → field-update `AI_Guardrail_Status__c`
= `approved`/`rejected` → record-triggered Flow `Agentforce_Guardrail_Approval_Callback`
→ invocable `AgentforceGuardrailApprovalCallback.dispatch` → Queueable callout
(mirrors `AgentforceCaseTriageOrchestratorTrigger`) to
`callout:Agentforce_AI_API_Phase2/orchestrator/case-triage/{workflowId}/sf-approval-callback`
with `{ decision, token }`. Fire-and-forget + idempotent (the resume endpoint
keys on the token `jti`).

## 7. Config + rollout

- Flags: `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED` (default false),
  `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_PROCESS` (default
  `Agentforce_Guardrail_Approval`). Config **fails closed**: enabling SF
  approval without `ORCHESTRATOR_APPROVAL_TOKEN_SECRET` throws at load.
- Email stays **off** for this rollout (`ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED=false`).
- Smoke: `ASSERT_GUARDRAIL_SF=1` asserts
  `approvalRouting.method=salesforce_approval` + `sentAt`; `externalRef`
  (ProcessInstance id) absent → WARN (submit degraded, graph still paused).
  Needs a Case that lands `requireHumanApproval` (NOT 00001050 escalate /
  00001054 autoApprove).
- **Approval Process approver is `adhoc`** (portable default). The demo org
  must set a real approver/queue (`Agentforce_Guardrail_Approvers`) before the
  live proof — see the XML comment in the approvalProcess metadata.

## 8. Post-approval verdict rollup (2026-06-22)

`synthesizeOrchestratorVerdict()` now keys off `approvalDecision` + `status`,
not only immutable `guardrail.outcome`. After SF approve + callback resume,
headline shows **human approval granted**, step 1 drops the email link, highlight
shows **Approved**. Persisted snapshots are **not retroactive** — deploy + **new
workflow run** required to see updated copy (Case 00001059 kept pre-rollup text).

At `waiting_approval`, the stored snapshot may show `guardrail: {}` (interrupt
commits after pause — same R2 family as routing). Verdict at pause uses
`buildApprovalContext` / partial channels; full guardrail surfaces after resume.

## 9. Deferred (this track)

- 6c: Stop-AI guard before the callback no-ops, approval timeout → auto-escalate,
  reconcile API (N6-R1–R4).
- SF workflow stamps `AI_Guardrail_Approver__c` / `AI_Guardrail_Decision_At__c` on
  approve/reject (today only status picklist updates).
- Case Lightning layout: **Approval History** related list (approvers use Items
  to Approve or direct work-item URL).
- Queue member list in metadata (`Agentforce_Guardrail_Approvers.queue-meta.xml`)
  — keep Mohit + Keshav in sync with demo org.
- React Approve/Reject buttons (console stays read-only).
- RC-8 operator orchestration login (retire manual `AI_API_ORCHESTRATOR_VIEW_TOKEN`
  refresh).

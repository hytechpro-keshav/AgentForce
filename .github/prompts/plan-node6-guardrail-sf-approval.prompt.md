---
mode: agent
description: "Plan Phase 6b+ Node 6 Salesforce Approval Process routing — design only, no implementation."
---

# Plan Node 6 Guardrail — Phase 6b+ (Salesforce Approval Process)

**Planning only.** Produce a phase plan document and implementation harness stubs. Do **not** write production code in this session unless a blocker requires a spike.

## User decision (scope)

- **Skip live email approval rollout** — `ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED` stays `false`; Resend/inbox proof is out of scope.
- **Primary approval channel:** Salesforce Approval Process on Case (native SF approver UX).
- **6a + 5c already shipped:** `evaluateGuardrail` interrupts on `requireHumanApproval`; `writeBack` runs 4c + 5c after `approved`.
- **6b email code** may exist in repo — treat as optional/future; this plan owns **SF Approval only**.

## Read first (skill order)

1. `.agents/skills/langgraph-human-in-the-loop/SKILL.md` — interrupt/resume idempotency
2. `.agents/skills/langgraph-node6-guardrail/SKILL.md`
3. `docs/orchestrator/node-6-guardrail-phase-plan.md` — §3.7, §5 (6-Pre fields), §10 (`ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED`)
4. `docs/orchestrator/case-triage-orchestrator-flow.md` — §6 (approvals OUTSIDE React UI)
5. `docs/orchestrator/re-orchestration-backlog.md` — N6-R2 Stop AI, RC-1
6. `docs/context/node6-6b-approval-routing-lessons.md` — R2 interrupt trap (still applies to SF submit idempotency)
7. Node 4c pattern: `SalesforceFulfillmentGateway` + Apex REST executor + degrade-safe writes

## Existing seams to reuse

| Seam                           | Path                                                        | Reuse for 6b+                                                               |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Interrupt + resume             | `case-triage.graph.ts` `evaluateGuardrail`, `POST …/resume` | SF callback must call same resume contract                                  |
| Approval routing DTO           | `dto/guardrail.ts` `GuardrailApprovalRouting`               | `method: "salesforce_approval"`, `externalRef` = ProcessInstance id         |
| `sendApprovalNotification` dep | `case-triage-orchestrator.service.ts`                       | Extend OR add `submitSalesforceApproval` dep — idempotent, degrade-safe     |
| Scoped approval token          | `guardrail-approval-token.service.ts` (if present)          | SF callback auth — mirror email token pattern, no `AI_API_JWT_SECRET` in SF |
| Case write-back tracking       | `AI_Triage_Status__c`, `AI_Triage_Workflow_Id__c` on Case   | Mirror with `AI_Guardrail_*` fields (§5)                                    |
| Named Credential               | `Agentforce_AI_API_Phase2` pattern                          | New credential for orchestrator resume callback                             |

## Planning deliverables

Create **`docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md`** with:

### 1. Executive summary

- Why SF Approval instead of email for this org (operator works in Salesforce; no external inbox dependency).
- How it fits case-triage-orchestrator-flow.md §6 (UI read-only; approver acts in SF).

### 2. End-to-end flow (mermaid)

```
evaluateGuardrail → requireHumanApproval
  → submitSalesforceApproval (idempotent)
  → Case Approval Process submitted
  → interrupt() → waiting_approval
  → Approver acts in Salesforce (Approve/Reject)
  → Flow/Apex callback → NestJS resume (scoped token)
  → writeBack (4c + 5c) or rejected
```

### 3. Phase breakdown

| Phase       | Scope                                                                                                                                                                                          | Exit                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **6b+-Pre** | Case fields `AI_Guardrail_Status__c`, `AI_Guardrail_Decision_At__c`, `AI_Guardrail_Approver__c`; perm set `Agentforce_Guardrail_Node6`; Approval Process definition + approver queue           | `sf` deploy validate + field FLS on run-as |
| **6b+-a**   | NestJS: `submitSalesforceApproval` dep + gateway (or extend notification service); flag `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED`; graph wiring; idempotency (workflowId → ProcessInstance) | Unit tests; graph spec                     |
| **6b+-b**   | SF: Flow/Apex on Approval Process completion → HTTP callout to resume; Named Credential; Apex tests with HttpCalloutMock                                                                       | Apex tests green                           |
| **6b+-c**   | Live proof: approvable Case → SF Approval pending → approve in SF → workflow `done` + optional 5c booking                                                                                      | Smoke `ASSERT_GUARDRAIL_SF=1`              |

### 4. Salesforce design

- **Approval Process** on Case: entry criteria (or programmatic submit only from orchestrator).
- **Submit API:** `Process.submit()` from Apex vs Flow-invoked — recommend Apex REST seam (mirror Parts Fulfillment) OR invocable from NestJS gateway.
- **Approver:** queue vs user — document for demo org `AgentForce`.
- **Case fields** stamped on submit / on callback (status, decision time, approver role alias — no full names in logs).
- **Idempotency:** do not submit twice for same `workflowId` — check existing pending ProcessInstance or custom `Orchestrator_Workflow_Id__c` on Case.

### 5. NestJS callback design

Options (pick one, document tradeoffs):

- **A)** Reuse public `POST …/approve` with scoped token minted at submit time, stored in Case or Process custom field.
- **B)** Dedicated `POST …/salesforce-approval-callback` with HMAC + workflowId + decision + processInstanceId.
- **C)** Bearer resume with `agentforce:orchestrator-approval` — only if SF can hold long-lived credential (discouraged).

Requirements:

- `idempotencyKey` = processInstanceId or workflowId
- Reject `escalated` from human submitters (R6)
- Rate limit public callback
- Degrade-safe: SF submit failure must not block `interrupt()` — graph still pauses; operator uses manual resume fallback

### 6. Interaction with email (6b)

Document explicitly:

- Email flag **off** in production for this rollout.
- If both ever enabled: policy matrix for `method: "email" | "salesforce_approval" | "both"` by riskLevel.
- No duplicate interrupt side effects.

### 7. Smoke / demo case matrix

| Case                            | Guardrail            | Use for                                                                                                    |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| 00001050 / `500g500000YpQMnAAN` | escalate             | **Not** SF Approval (no interrupt)                                                                         |
| 00001054 / `500g500000axxLtAAI` | autoApprove          | **Not** SF Approval (no pause)                                                                             |
| **Approvable Case (TBD)**       | requireHumanApproval | **6b+ SF smoke** — plan must define how to find/create (non-strategic account, partial parts, score 25–79) |

Reference: `docs/testing/node4-orchestrator-case-scenarios.md`, `salesforce-case-create` skill.

### 8. Config (§10 extension)

| Env var                                             | Default            | Purpose                  |
| --------------------------------------------------- | ------------------ | ------------------------ |
| `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED`        | `false`            | Master flag              |
| `ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED` | `false`            | Stays off for this track |
| Approval Process developer name                     | config or constant | Which process to submit  |
| Callback URL base                                   | Railway ai-api     | Named Credential in SF   |

### 9. Risks + 6c hooks

- R2 idempotency on interrupt re-run (SF submit + email lesson applies).
- Stop AI (N6-R2): callback must no-op if `AI_Orchestration_Status__c = stopped_by_user`.
- Stale channels during SF approval wait — 5c RC-5 fresh read at write still applies.
- Postgres checkpointer future: durable pending-approval marker.

### 10. Test plan

- Apex: submit, idempotent resubmit, callback mock, FLS/CRUD
- NestJS: gateway degrade-safe, callback → resume, duplicate callback
- E2E: mocked SF; live org proof script
- Smoke: `ASSERT_GUARDRAIL_SF=1` assertions (method=salesforce_approval, externalRef set)

### 11. Harness stubs (list paths only)

- `.github/prompts/implement-node6-guardrail-sf-approval.prompt.md`
- `.claude/commands/implement-node6-guardrail-sf-approval.md`
- `.github/agents/node6-guardrail-sf-approval-implementer.agent.md`
- `scripts/sf/node6-sf-approval-pre-deploy.sh` (placeholder)
- Update `langgraph-node6-guardrail/SKILL.md` §6b+

### 12. Recommended implementation order

1. 6b+-Pre Salesforce metadata
2. 6b+-a NestJS submit + graph wiring (flag off until SF ready)
3. 6b+-b SF callback + Named Credential
4. Live proof on approvable Case
5. Optional: email later as secondary channel

## Constraints

- **No code** except optional read-only SF metadata inventory queries.
- **No email rollout** in this plan's implementation track.
- **No 6c** (Stop AI, timeout, reconcile) — document hooks only.
- **No GuardrailPolicyService** scoring changes.
- React UI stays read-only — no Approve button in OrchestrationView.

## Exit criteria (planning session)

- [ ] `node-6-guardrail-sf-approval-phase-plan.md` complete (16-section style like node-5 plan)
- [ ] Callback auth design decided with security review notes
- [ ] 6b+-Pre field list + Approval Process outline ready for metadata PR
- [ ] Approvable Case strategy documented
- [ ] `/implement-node6-guardrail-sf-approval` prompt stub created
- [ ] `node-6-guardrail-phase-plan.md` §0 updated: "Next: 6b+ SF Approval (email deferred)"

$ARGUMENTS

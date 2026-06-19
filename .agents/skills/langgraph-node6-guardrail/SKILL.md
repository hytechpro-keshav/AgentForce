---
name: langgraph-node6-guardrail
description: >-
  Implement Node 6 Compliance & Guardrail in the case-triage orchestrator:
  composite deterministic policy matrix over all five upstream channels,
  evaluateGuardrail node, escalated terminal, GuardrailPolicyService, verdict
  rollup, and React UI card. Phase plan must exist first. This skill also covers
  the 5c write-gate contract — 5c cannot ship until 6a ships.
argument-hint: "Phase scope (6a default), org alias (AgentForce), demo Case id (00001050)"
user-invocable: true
---

# LangGraph Node 6 — Compliance & Guardrail

Node 6 is the **sole interrupting node** in the graph. It sits between Node 5 (Scheduling) and Node 7 (Resolution & Drafting), consumes all five upstream typed channels, runs a **deterministic composite policy matrix**, and produces one of four outcomes: `autoApprove`, `requireHumanApproval`, `reject`, or `escalate`.

## Use this skill for

- "implement guardrail node"
- "composite policy matrix"
- "replace gate node"
- "Node 6 approval logic"
- "escalated terminal"
- "GuardrailPolicyService"
- "5c write gate cleared"

## Do NOT use this skill for

- 5-Pre Salesforce metadata (no SF dependency in 6a)
- Node 5 scheduling (use `langgraph-node5-scheduling`)
- Approval email routing (6b — out of scope for 6a)
- Stop AI / timeout escalation (6c — deferred)

## Required references (read in order)

1. [Node 6 phase plan](../../../docs/orchestrator/node-6-guardrail-phase-plan.md) — **§0 first**, then §3.5 (matrix), §6, §7 (DTO)
2. [HITL skill](../langgraph-human-in-the-loop/SKILL.md) — interrupt/resume idempotency rules (**mandatory**)
3. [Orchestrator flow](../../../docs/orchestrator/case-triage-orchestrator-flow.md) — Node 6 as only interrupting node
4. [Node 5 phase plan](../../../docs/orchestrator/node-5-scheduling-phase-plan.md) — §3.6, §13 R5 (5c blocked on Node 6)
5. [New node checklist](../../../docs/orchestrator/new-node-phase-completion-checklist.md)
6. [Re-orchestration backlog](../../../docs/orchestrator/re-orchestration-backlog.md) — RC-1, RC-3, RC-5
7. [Prototype gate](../../../apps/ai-api/src/orchestrator/case-triage.graph.ts) — lines 653–673 (to be replaced)
8. [Case triage lifecycle DTO](../../../apps/ai-api/src/orchestrator/dto/case-triage-lifecycle.ts) — `ApprovalDecision` union
9. [Scheduling channel](../../../apps/ai-api/src/orchestrator/dto/scheduling.ts) — `requiredApproval`, `approvalReason`
10. [Parts logistics channel](../../../apps/ai-api/src/orchestrator/dto/parts-logistics.ts) — `requiredApproval`, `fulfillmentReadiness`
11. [Verdict synthesizer](../../../apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts) — four surfaces

## Guardrail channel contract (§7 in phase plan)

Path: `apps/ai-api/src/orchestrator/dto/guardrail.ts` (new file)

Key types:

- `GuardrailOutcome`: `'autoApprove' | 'requireHumanApproval' | 'reject' | 'escalate'`
- `GuardrailChannel`: the full output channel (sole writer: Node 6)
- `GuardrailDecision`: internal return type from `GuardrailPolicyService.evaluate()`
- `GuardrailApprovalInterrupt`: interrupt payload (replaces `TriageApprovalInterrupt`)
- `GuardrailPolicyRule`: one named rule evaluation record (ruleId, triggered, riskPoints, isHardRule)

## Decision matrix (§3.5 in phase plan)

### Hard rules (short-circuit — no score)

| Rule ID              | Trigger                                                                              | Outcome    |
| -------------------- | ------------------------------------------------------------------------------------ | ---------- |
| `ENTITLEMENT_BREACH` | `warrantyStatus === 'out_of_warranty'` AND `partsLogistics.status === 'UNAVAILABLE'` | `reject`   |
| `SAFETY_CRITICAL_KB` | any `knowledgeGuidance.answer.safetyFlags` with `severity === 'critical'`            | `escalate` |
| `NO_ACCOUNT_LINKED`  | `!context.accountId` AND `triage.recommendedPriority === 'Critical'`                 | `reject`   |

### Soft rules (scored)

| Rule ID                        | Points |
| ------------------------------ | ------ |
| `TRIAGE_CRITICAL`              | +30    |
| `TRIAGE_HIGH`                  | +15    |
| `CUSTOMER_RISK_CRITICAL`       | +25    |
| `CUSTOMER_RISK_HIGH`           | +15    |
| `STRATEGIC_ACCOUNT`            | +10    |
| `WARRANTY_OUT`                 | +10    |
| `REPEAT_INCIDENT`              | +10    |
| `PARTS_APPROVAL_REQUIRED`      | +20    |
| `PARTS_PARTIAL`                | +10    |
| `PARTS_UNAVAILABLE`            | +15    |
| `SCHEDULING_APPROVAL_REQUIRED` | +15    |
| `SCHEDULING_SLA_BREACH`        | +15    |
| `SCHEDULING_AFTER_HOURS`       | +10    |
| `SCHEDULING_CROSS_TERRITORY`   | +10    |
| `SCHEDULING_DEFERRED`          | +10    |
| `KB_REQUIRED_APPROVAL`         | +15    |
| `KB_SAFETY_HIGH`               | +20    |
| `ALL_CHANNELS_DEGRADED`        | +15    |

### Score → outcome

| Score | Outcome                |
| ----- | ---------------------- |
| 0–24  | `autoApprove`          |
| 25–79 | `requireHumanApproval` |
| ≥80   | `escalate`             |
| Hard  | `reject` or `escalate` |

Conservative fallback: if any channel is absent/degraded AND an approval flag exists anywhere → floor to `requireHumanApproval`.

## Idempotency rules (HITL — critical)

**All code before `interrupt()` MUST be idempotent.** The node re-runs its pre-interrupt code on every resume attempt.

- `evaluateGuardrailPolicy(state)` must be pure — no I/O, no randomness, no throws.
- 6b: `sendApprovalNotification` checks `state.guardrail?.approvalRouting?.sentAt` before sending (idempotency guard).
- The `autoApprove`, `reject`, and `escalate` paths return immediately without calling `interrupt()`.

## Graph migration (prototype gate → evaluateGuardrail)

| What changes                                                          | Where                          |
| --------------------------------------------------------------------- | ------------------------------ |
| Remove `gate` node + edges                                            | `case-triage.graph.ts`         |
| Add `evaluateGuardrail` node                                          | `case-triage.graph.ts`         |
| Add `escalated` terminal                                              | `case-triage.graph.ts`         |
| New edge: `schedule → evaluateGuardrail`                              | `case-triage.graph.ts`         |
| Conditional edges: `evaluateGuardrail → writeBack/rejected/escalated` | `case-triage.graph.ts`         |
| Add `guardrail` channel to `CaseTriageState`                          | `case-triage.graph.ts`         |
| Remove `requiresApproval` dep                                         | `CaseTriageGraphDeps`          |
| Add `evaluateGuardrailPolicy` dep                                     | `CaseTriageGraphDeps`          |
| Add `sendApprovalNotification` dep (log-only 6a)                      | `CaseTriageGraphDeps`          |
| Extend `ApprovalDecision` union                                       | `dto/case-triage-lifecycle.ts` |
| Add `GUARDRAIL_NODE_ID`                                               | `dto/case-triage-lifecycle.ts` |

## ApprovalDecision breaking change (R5)

Adding `'escalated'` to `ApprovalDecision` may break switch exhaustiveness. Before shipping:

```bash
grep -r "approvalDecision" apps/ai-api/src --include="*.ts" -l
```

Add `escalated` handling to every switch statement found.

## Resume endpoint (unchanged)

```
POST /orchestrator/case-triage/:workflowId/resume
Body: { "decision": "approved" | "rejected" }
```

Resume only accepts `'approved' | 'rejected'` — `'escalated'` is a policy outcome set by the node, not submitted by approvers.

## 5c gate contract

5c `ServiceAppointment` writes are **blocked** until 6a ships. After 6a:

- `state.guardrail?.outcome` is accessible in `writeBack`
- `applySchedulingWrite` seam is wired in `writeBack` post-6a
- 5c must do a fresh parts re-read at write time (RC-5)

## Phase 6b — approval routing (email links + idempotent notification)

6b replaces the log-only `sendApprovalNotification` with real email delivery and
a public approve/reject link flow. See `docs/context/node6-6b-approval-routing-lessons.md`.

- **R2 idempotency (critical):** `interrupt()` suspends BEFORE the node returns,
  so `guardrail.approvalRouting.sentAt` is NOT committed on the first run. On
  resume the node re-runs with `state.guardrail === undefined`, so the graph
  guard alone would re-send. `sendApprovalNotification` is internally idempotent
  (`GuardrailApprovalNotificationService` keeps a `Map<workflowId, routing>`).
  Lifetime matches `MemorySaver`, so the map is the complete fix; the graph guard
  covers later resumes. Both layers together = one email.
- **Degrade-safe:** email failure → `{ method: "email", sentAt, degraded: true }`,
  never throws into the graph.
- **Public approve/reject links** (`@Public()` + `OrchestratorApprovalRateLimitGuard`):
  `GET …/approve?token=` renders a confirmation page (prefetch-safe — a GET never
  mutates); `POST …/approve` verifies and resumes with `idempotencyKey = token jti`.
- **Token** (`GuardrailApprovalTokenService`): HS256 JWT signed with
  `ORCHESTRATOR_APPROVAL_TOKEN_SECRET` (separate from `AI_API_JWT_SECRET`); binds
  `workflowId` + `decision` + `jti`; PII-free; `escalated` never mintable (R6).
- **Transport seam:** `ApprovalEmailSender` (logging default + Resend via `fetch`,
  no SDK); provider chosen by `ORCHESTRATOR_APPROVAL_EMAIL_PROVIDER`.
- **Config fails closed** when email is enabled without secret/link-base/from/to.
  Flag OFF → 6a `log_only` parity.
- **No PII** in email body — risk score/level, reason labels, rule ids, and a
  case **suffix** only.
- Smoke: `ASSERT_GUARDRAIL_EMAIL=1` needs a Case that lands `requireHumanApproval`
  (NOT 00001050 escalate / 00001054 autoApprove).
- Out of scope (6b email track): N6-R2 Stop-AI guard (6c).

## Phase 6b+ — Salesforce Approval Process routing

6b+ routes the `requireHumanApproval` interrupt to a **native SF Approval
Process** (email stays off). Harness `/implement-node6-guardrail-sf-approval`;
plan `docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md`; lessons
`docs/context/node6-sf-approval-lessons.md`.

- **Routing**: `notifyApprovalRequired` branches SF-first → `{ method:
"salesforce_approval", sentAt, externalRef }` via `SalesforceGuardrailApprovalGateway`
  (degrade-safe; mirrors the fulfillment gateway). Same in-service
  `Map<workflowId, routing>` for R2 idempotency.
- **Token**: decision-AGNOSTIC `mintForSalesforce`/`verifyForSalesforce` with a
  DISTINCT audience (`guardrail-sf-approval`) — an SF token can't replay at the
  email `/approve` and vice-versa. The decision comes from Salesforce on the
  callback body, constrained to approved/rejected (escalated never — R6); `jti`
  = resume idempotencyKey.
- **Verdict context**: graph optional dep `buildApprovalContext(state)`
  synthesizes the Orchestrator Verdict + console deep link BEFORE `interrupt()`
  and passes it as the 4th arg of `sendApprovalNotification` (SF path stamps it
  on the Case; email path ignores it).
- **Callback**: Approval final actions set `AI_Guardrail_Status__c` → record
  Flow `Agentforce_Guardrail_Approval_Callback` → invocable
  `AgentforceGuardrailApprovalCallback` → Queueable callout to public
  `POST :workflowId/sf-approval-callback`.
- **Config** fails closed: `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED` requires
  `ORCHESTRATOR_APPROVAL_TOKEN_SECRET`. Smoke: `ASSERT_GUARDRAIL_SF=1`.
- **Metadata/Apex gotchas** (see lessons): self-PSA doesn't refresh test FLS →
  `runAs(currentUser)`; the active callback Flow fires on a status `update` →
  seed on insert; mock counts only `/sf-approval-callback`; ApprovalProcess
  `<fullName>` = `Case.<name>`; no Flow `ISBLANK` on a Long Text Area.

## Implementation harness

- Prompt: `.github/prompts/implement-node6-guardrail.prompt.md` · 6b: `.github/prompts/implement-node6-guardrail-6b.prompt.md`
- Agent: `.github/agents/node6-guardrail-implementer.agent.md`
- Claude command: `.claude/commands/implement-node6-guardrail.md` · 6b: `.claude/commands/implement-node6-guardrail-6b.md`

## Related skills

- `langgraph-human-in-the-loop` — **mandatory** — interrupt/resume idempotency
- `langgraph-fundamentals`, `langgraph-case-triage-slice`
- `langgraph-node5-scheduling` — upstream scheduling channel
- `langgraph-node4-parts-logistics` — upstream parts channel

## Related instructions

- `.github/instructions/langgraph-orchestrator.instructions.md`
- `.github/instructions/nest-ai-api.instructions.md`
- `.github/instructions/security-observability.instructions.md`
- `.github/instructions/testing-evals.instructions.md`

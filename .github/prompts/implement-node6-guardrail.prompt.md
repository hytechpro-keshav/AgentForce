---
name: "Implement Node 6 Guardrail"
description: "Implement Phase 6a Node 6 Compliance & Guardrail: GuardrailChannel DTO, GuardrailPolicyService composite policy matrix, evaluateGuardrail node (replaces gate), escalated terminal, verdict rollup, and React Node 6 card."
agent: "Node 6 Guardrail Implementer"
argument-hint: "Phase scope (6a default), org alias (AgentForce), demo Case id (00001050)"
tools: [read, search, edit, execute, todo, agent]
---

# Execution mode — implement, do not replan

You are in **executing mode**. Implement Phase **6a** of Node 6 — Compliance & Guardrail per the phase plan. Do not produce architecture-only documentation unless code cannot proceed due to a blocker.

Use the installed workspace skills for this task.

## Required skill-loading order

1. `langgraph-fundamentals`
2. `langgraph-human-in-the-loop` — **mandatory** — interrupt/resume idempotency rules
3. `langgraph-case-triage-slice` — mirror graph/channel pattern
4. `langgraph-node4-parts-logistics` — upstream `partsLogistics` channel
5. `langgraph-node5-scheduling` — upstream `scheduling` channel and approval fields
6. `langgraph-node6-guardrail` — **primary skill for this task**

## Agent persona

Adopt `.github/agents/node6-guardrail-implementer.agent.md`.

Escalate when cross-cutting:

- `Nest AI Architect` — `GuardrailPolicyService` module injection, config flag wiring
- `Security Reviewer` — no PII in interrupt payload, verdict, or events
- `Telemetry Reviewer` — safe emitRunning events for Node 6 outcomes
- `Release Checker` — pre-ship validation gates

## Relevant repo instructions (honor during implementation)

- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md) — mandatory re-orchestration review
- [Frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [Security and observability instructions](../instructions/security-observability.instructions.md)
- [Telemetry instructions](../instructions/telemetry.instructions.md)
- [Testing and eval instructions](../instructions/testing-evals.instructions.md)

## Canonical documents (read before coding)

| Document                  | Path                                                               | Key sections                                                |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| **Phase plan (primary)**  | `docs/orchestrator/node-6-guardrail-phase-plan.md`                 | **§0 first**, §3.5 (matrix), §6.2–§6.4, §7, §8, §9          |
| Node completion checklist | `docs/orchestrator/new-node-phase-completion-checklist.md`         | All four verdict surfaces + re-orchestration                |
| Re-orchestration backlog  | `docs/orchestrator/re-orchestration-backlog.md`                    | RC-1, RC-3, RC-5                                            |
| Orchestrator flow         | `docs/orchestrator/case-triage-orchestrator-flow.md`               | Node 6 as only interrupting node                            |
| Node 5 phase plan         | `docs/orchestrator/node-5-scheduling-phase-plan.md`                | §3.6, §13 R5 (5c blocked)                                   |
| Prototype gate (replace)  | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                | Lines 653–673                                               |
| Lifecycle DTO             | `apps/ai-api/src/orchestrator/dto/case-triage-lifecycle.ts`        | `ApprovalDecision`, node id union                           |
| Scheduling channel        | `apps/ai-api/src/orchestrator/dto/scheduling.ts`                   | `requiredApproval`, `approvalReason`, `schedulingReadiness` |
| Parts channel             | `apps/ai-api/src/orchestrator/dto/parts-logistics.ts`              | `requiredApproval`, `status`, `fulfillmentReadiness`        |
| Verdict synthesizer       | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts` | Four surfaces + `basis`                                     |
| Parts planner pattern     | `apps/ai-api/src/orchestrator/parts-logistics-planner.service.ts`  | Pure service pattern                                        |

## Deliverables

| Component                                   | Path                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `GuardrailChannel` DTO                      | `apps/ai-api/src/orchestrator/dto/guardrail.ts` (new)                   |
| `GUARDRAIL_NODE_ID`, `ApprovalDecision` ext | `apps/ai-api/src/orchestrator/dto/case-triage-lifecycle.ts`             |
| `guardrail` state annotation                | `apps/ai-api/src/orchestrator/case-triage.graph.ts` — `CaseTriageState` |
| `evaluateGuardrail` node                    | `apps/ai-api/src/orchestrator/case-triage.graph.ts` (replaces `gate`)   |
| `escalated` terminal                        | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                     |
| Updated conditional edges                   | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                     |
| `GuardrailPolicyService`                    | `apps/ai-api/src/orchestrator/guardrail-policy.service.ts` (new)        |
| Updated `CaseTriageGraphDeps`               | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                     |
| Updated `CaseTriageOrchestratorService`     | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts`      |
| Updated verdict synthesizer                 | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`      |
| Verdict synthesizer spec                    | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.spec.ts` |
| Policy service spec                         | `apps/ai-api/src/orchestrator/guardrail-policy.service.spec.ts` (new)   |
| React `NODE_META` + card                    | `apps/react-chat-window` — `OrchestrationView.tsx`                      |

## Step-by-step execution

1. Read phase plan §0 — confirm prototype gate is still the live node (not already replaced).
2. Load HITL skill — internalize interrupt/resume idempotency rules.
3. Implement `dto/guardrail.ts` — all types from §7.
4. Implement `GuardrailPolicyService` — 3 hard rules + 18 soft rules as named pure functions; unit tests per §12.2 (≥8 scenarios).
5. Add `GUARDRAIL_NODE_ID` and extend `ApprovalDecision` in `case-triage-lifecycle.ts`; run `grep -r "approvalDecision"` and patch all switch statements.
6. Add `guardrail: Annotation<GuardrailChannel | undefined>()` to `CaseTriageState`.
7. Wire `evaluateGuardrail` node in graph; remove `gate` node and `schedule → gate` edge; add `schedule → evaluateGuardrail` edge; add `escalated` terminal; wire `evaluateGuardrail → writeBack/rejected/escalated` conditional edges.
8. Update `CaseTriageGraphDeps`: remove `requiresApproval`; add `evaluateGuardrailPolicy` and `sendApprovalNotification` (log-only 6a).
9. Update `CaseTriageOrchestratorService` to inject `GuardrailPolicyService`.
10. Update verdict synthesizer — all four surfaces: `headline`, `summary`, `recommendedSteps`, `highlights`, and push `"guardrail"` to `basis`.
11. Add Node 6 `NODE_META` entry, stage card, and five status-path mappings to React `OrchestrationView`. Update page subtitle to list Node 6.
12. Run `npm run ai-api:test` — all tests green.
13. Run `npm run react-chat:typecheck` — no type errors.
14. Assert demo Case 00001050 triggers `requireHumanApproval` with riskScore ~50 (parts PARTIAL `requiredApproval` + scheduling PROVISIONAL `after_hours` `requiredApproval` per §0.2).
15. Confirm 5c gate cleared — update §0.1 of the phase plan to mark `evaluateGuardrail` as **Shipped**.

## Key constraints

- **`evaluateGuardrailPolicy` is pure** — no I/O, no randomness, no throws.
- **No interrupt on `autoApprove`, `reject`, `escalate`** — only `requireHumanApproval` calls `interrupt()`.
- **Policy reads typed fields only** — never free-text. See §3.2 "Critical rule."
- **Resume endpoint unchanged** — POST `{ decision: 'approved' | 'rejected' }`. `'escalated'` never comes from approvers.
- **No PII** in interrupt payload, events, or verdict — rule IDs and reason labels only. `riskScore` (number) is safe.
- **`sendApprovalNotification` 6a default**: `return { method: 'log_only' }`. Idempotency guard code must still be present.
- Score cap at 100. Conservative fallback: absent/degraded channel + any approval flag → floor to `requireHumanApproval`.
- Verdict `clip()` limits: headline 160, summary 400, step 240, ≤6 steps.

## Verify

```bash
npm run ai-api:test
npm run react-chat:typecheck
```

Smoke: demo Case 00001050 → `requireHumanApproval`, riskScore ~50, triggered rules include `PARTS_APPROVAL_REQUIRED` and `SCHEDULING_AFTER_HOURS`.

$ARGUMENTS

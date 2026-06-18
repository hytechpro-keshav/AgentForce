# Implement Node 6 Guardrail

Implement Phase 6a Node 6 — Compliance & Guardrail in the AI orchestrator. Full harness: `.github/prompts/implement-node6-guardrail.prompt.md`.

Adopt agent persona: `.github/agents/node6-guardrail-implementer.agent.md`.

## Execution mode

Implement code — do not replan. Phase **6a** only (composite policy + graph wiring; no approval email routing).

## Required skill-loading order

1. `.agents/skills/langgraph-fundamentals/SKILL.md`
2. `.agents/skills/langgraph-human-in-the-loop/SKILL.md` ← **mandatory**
3. `.agents/skills/langgraph-case-triage-slice/SKILL.md`
4. `.agents/skills/langgraph-node4-parts-logistics/SKILL.md`
5. `.agents/skills/langgraph-node5-scheduling/SKILL.md`
6. `.agents/skills/langgraph-node6-guardrail/SKILL.md` ← primary

## Pre-flight (run before coding)

Read phase plan §0: `docs/orchestrator/node-6-guardrail-phase-plan.md`

Confirm prototype `gate` node is still live (not already replaced).

## Key constraints

- **Phase 6a only** — no approval email, no SF Approval Process, no Stop AI guard
- Graph: `… → schedule → evaluateGuardrail → writeBack/rejected/escalated`
- Node 6 is the **only interrupting node** — `autoApprove`/`reject`/`escalate` skip `interrupt()`
- `evaluateGuardrailPolicy` must be **pure** — idempotent, no I/O, no throws
- **Policy reads typed fields only** — never free-text
- Resume endpoint unchanged: `{ decision: 'approved' | 'rejected' }` only
- `sendApprovalNotification` 6a default: log-only, return `{ method: 'log_only' }`
- Run `grep -r "approvalDecision"` before shipping — patch all switch statements for `'escalated'`
- **No PII** in events, verdict, or interrupt payload
- Smoke target: demo Case 00001050 → `requireHumanApproval`, riskScore ~50

## Deliverables

| Component                | Path                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| DTO                      | `apps/ai-api/src/orchestrator/dto/guardrail.ts` (new)                   |
| Policy service           | `apps/ai-api/src/orchestrator/guardrail-policy.service.ts` (new)        |
| Policy service spec      | `apps/ai-api/src/orchestrator/guardrail-policy.service.spec.ts` (new)   |
| Graph node + edges       | `apps/ai-api/src/orchestrator/case-triage.graph.ts` (replaces `gate`)   |
| Lifecycle DTO            | `apps/ai-api/src/orchestrator/dto/case-triage-lifecycle.ts`             |
| Orchestrator service     | `apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts`      |
| Verdict synthesizer      | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`      |
| Verdict synthesizer spec | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.spec.ts` |
| React UI card            | `apps/react-chat-window` — `OrchestrationView.tsx`                      |

## Verify

```bash
npm run ai-api:test
npm run react-chat:typecheck
```

Smoke: demo Case 00001050 → `requireHumanApproval`, triggered rules include `PARTS_APPROVAL_REQUIRED` + `SCHEDULING_AFTER_HOURS`.

$ARGUMENTS

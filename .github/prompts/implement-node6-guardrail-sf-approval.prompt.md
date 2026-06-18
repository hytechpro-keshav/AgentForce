---
mode: agent
description: "Implement Phase 6b+ Node 6 Salesforce Approval Process routing."
---

# Implement Node 6 Guardrail — Phase 6b+ (Salesforce Approval Process)

Implement per **`docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md`**. Do not replan unless blocked.

## Scope

- **In:** SF Approval submit + callback resume; 6b+-Pre metadata; smoke `ASSERT_GUARDRAIL_SF=1`
- **Out:** email rollout (`ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED` stays false); 6c; policy matrix changes; React approve buttons

## Read first

1. `docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md`
2. `docs/context/node6-6b-approval-routing-lessons.md` (R2 idempotency)
3. `.agents/skills/langgraph-human-in-the-loop/SKILL.md`
4. `.agents/skills/langgraph-node6-guardrail/SKILL.md`
5. Mirror: `salesforce-fulfillment.gateway.ts` + `AgentforcePartsFulfillmentService.cls`

## Phases (in order)

1. **6b+-Pre** — Case fields, perm set, Approval Process, Apex REST skeleton
2. **6b+-a** — `SalesforceGuardrailApprovalGateway` + notification service SF path + graph
3. **6b+-b** — Flow callback + Named Credential callout + Apex tests
4. **6b+-c** — Approvable Case + live proof + smoke

## Constraints

- Degrade-safe: SF failures must not break `interrupt()`
- Reuse `GuardrailApprovalTokenService` for callback auth
- Idempotent submit per `workflowId`
- No PII in logs or approval payload

## Tests before handoff

- `npm run ai-api:test` (focused specs)
- `sf apex run test` for new Apex classes
- Live org proof on approvable Case

$ARGUMENTS

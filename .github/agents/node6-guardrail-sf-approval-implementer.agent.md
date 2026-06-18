# Node 6 Salesforce Approval Implementer

You implement Phase **6b+** — Salesforce Approval Process routing for the guardrail interrupt.

## Read first

- `docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md`
- `docs/context/node6-6b-approval-routing-lessons.md`
- `.github/instructions/nestjs-ai-api.instructions.md` (when touching ai-api)
- `.github/instructions/salesforce.instructions.md` (when touching metadata/Apex)

## Focus

- Apex REST submit + Flow callback via `Agentforce_AI_API_Phase2`
- NestJS gateway + idempotent routing (R2 trap)
- Token-scoped resume — separate from `AI_API_JWT_SECRET`
- Degrade-safe; no graph throws from SF transport

## Out of scope

- Email/Resend
- 6c Stop AI / timeout
- GuardrailPolicyService scoring changes
- UI approve buttons

## Review checklist

- [ ] Duplicate submit prevented (Map + sentAt)
- [ ] Callback idempotent (processInstanceId / jti)
- [ ] FLS + perm set on new Case fields
- [ ] Apex HttpCalloutMock tests
- [ ] Smoke `ASSERT_GUARDRAIL_SF=1` path documented
- [ ] No PII in logs

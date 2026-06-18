# Plan Node 6 — Salesforce Approval Process (6b+)

Planning only — SF-native approval routing, **no email rollout**.

Full harness: `.github/prompts/plan-node6-guardrail-sf-approval.prompt.md`

## Scope decision

- Skip live Resend/email approval (`ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED=false`).
- Implement **Salesforce Approval Process** as the primary out-of-band approval channel.
- UI stays read-only; approver acts in Salesforce.

## Read first

- `docs/orchestrator/node-6-guardrail-phase-plan.md` §3.7, §5, §10
- `docs/orchestrator/case-triage-orchestrator-flow.md` §6
- `docs/context/node6-6b-approval-routing-lessons.md` (R2 idempotency still applies)
- `.agents/skills/langgraph-human-in-the-loop/SKILL.md`

## Deliverable

`docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md` + implement harness stubs.

## Do NOT

- Implement code in the planning session
- Roll out email
- Change guardrail scoring matrix

$ARGUMENTS

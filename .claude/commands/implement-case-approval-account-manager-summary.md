# Implement Case Approval Account Manager Summary

Implement Account Manager executive summary, five agent Case narratives, and Salesforce UI visibility. Full harness: `.github/prompts/implement-case-approval-account-manager-summary.prompt.md`.

## Read first

1. `docs/orchestrator/case-approval-account-manager-summary-plan.md` ← primary
2. `docs/context/node6-sf-approval-lessons.md`
3. `.agents/skills/langgraph-node6-guardrail/SKILL.md`

## Phases

A → Executive summary + Account Manager copy (NestJS + Apex submit comment)
B → Five agent private CaseComments (no separate Customer History)
C → Case layout + approver perm set + deploy
D → Tests + live UAT

## Invariant

Five visible agents only (Triage includes customer context). Do not post Agent 2 – Customer History.

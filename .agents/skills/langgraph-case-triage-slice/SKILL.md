---
name: langgraph-case-triage-slice
description: "Use when implementing the Node 1 case triage walking skeleton, LangGraph-style orchestration contracts, Salesforce async trigger handoff, or approval pause and resume for the AI API."
argument-hint: "Target files, Salesforce boundary, status events, and whether to include the approval prototype"
user-invocable: true
---

# LangGraph Case Triage Slice

This is a GitHub Copilot workspace skill for this repo. Use it instead of external `npx skills` setup. It borrows the progressive-disclosure idea from LangChain and LangGraph skills, but the source of truth is this repository's `.github/` customization system.

## Use This Skill For

- implementing the thin end-to-end case triage slice
- extending the existing triage endpoint into `apps/ai-api/src/orchestrator/**`
- defining the four boundary contracts for the slice
- prototyping async approval pause and resume before building more nodes
- adding focused tests and telemetry for the orchestrator path

## Required References

Read these before making changes:

- [AGENTS.md](../../../AGENTS.md)
- [orchestrator flow](../../../docs/orchestrator/case-triage-orchestrator-flow.md)
- [Nest AI API instructions](../../instructions/nest-ai-api.instructions.md)
- [LLM provider instructions](../../instructions/llm-provider.instructions.md)
- [security and observability instructions](../../instructions/security-observability.instructions.md)
- [telemetry instructions](../../instructions/telemetry.instructions.md)
- [testing and eval instructions](../../instructions/testing-evals.instructions.md)

Anchor on the existing implementation before designing new seams:

- [support triage controller](../../../apps/ai-api/src/agents/support-agent.controller.ts)
- [support triage service](../../../apps/ai-api/src/agents/support-triage.service.ts)
- [triage DTO](../../../apps/ai-api/src/agents/dto/triage-case.dto.ts)

## Workflow

1. Confirm the slice boundary: Node 1 only, with real trigger, read context, triage, write-back, and status reporting.
2. Define the smallest compatible contracts for `trigger signal`, `read context`, `write-back`, and `status event`.
3. Create or extend orchestrator state under `apps/ai-api/src/orchestrator/**` with explicit lifecycle and correlation ids.
4. Keep the Salesforce trigger path asynchronous and fast. The trigger should identify the case and hand off work, not do the orchestration inline.
5. Reuse `SupportTriageService` or a narrow adapter around it for the model decision rather than duplicating triage prompt logic.
6. Separate Salesforce reads, writes, and status publication behind services with DTO validation and auth.
7. If approval is in scope, prove pause and resume with an idempotent state transition before adding any more nodes.
8. Add the smallest useful tests for contracts, auth, lifecycle transitions, telemetry, and failure handling.
9. Update the orchestrator doc or contract notes only after the slice is working, so documentation reflects the implemented seams.

## Safety Rules

- Do not build Nodes 2-8 in the same change unless the user explicitly asks.
- Do not bypass `ModelRouter` or introduce vendor SDK calls into agents or orchestrator services.
- Do not block Salesforce Flow waiting on LLM or graph execution.
- Do not log raw case text, approval payloads, tokens, or secrets.
- Do not create a second triage API contract when the existing DTO can be extended or wrapped.
- Do not treat the UI progress feed as the approval channel. Approval happens in email or Salesforce; the UI only reflects status.

## Output Checklist

Return:

- the contracts added or changed
- the orchestrator services or controllers added or changed
- the tests and validation commands run
- known gaps that intentionally remain for later nodes
- the exact next step for expanding beyond Node 1

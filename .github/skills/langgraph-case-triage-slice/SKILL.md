---
name: langgraph-case-triage-slice
description: "Use when implementing the Node 1 case triage walking skeleton, LangGraph-style orchestration contracts, live Salesforce async trigger handoff, real Case E2E proof, or approval pause and resume for the AI API."
argument-hint: "Target files, Salesforce boundary, status UI scope, and whether to include the approval prototype"
user-invocable: true
---

# LangGraph Case Triage Slice

This is a GitHub Copilot workspace skill for this repo. Use it with the installed LangChain and LangGraph skills already present under this workspace. The source of truth is the repo-local customization system plus the installed skills available to Copilot in this workspace.

## Use This Skill For

- implementing the thin end-to-end case triage slice
- extending the existing triage endpoint into `apps/ai-api/src/orchestrator/**`
- defining the four boundary contracts for the slice
- prototyping async approval pause and resume before building more nodes
- proving the first node against a real Salesforce Case instead of mock-only data
- adding a read-only UI in `apps/react-chat-window` that shows safe progress, reasoning summary, and Node 1 output
- adding focused tests and telemetry for the orchestrator path
- stepped console UX, demo bootstrap, or per-node advance (`langgraph-stepped-console` skill)

## Required References

Read these before making changes:

- [AGENTS.md](../../../AGENTS.md)
- [orchestrator flow](../../../docs/orchestrator/case-triage-orchestrator-flow.md)
- [stepped console phase plan](../../../docs/orchestrator/stepped-console-phase-plan.md)
- [frontend chat instructions](../../instructions/frontend-chat.instructions.md)
- [Nest AI API instructions](../../instructions/nest-ai-api.instructions.md)
- [LLM provider instructions](../../instructions/llm-provider.instructions.md)
- [security and observability instructions](../../instructions/security-observability.instructions.md)
- [telemetry instructions](../../instructions/telemetry.instructions.md)
- [testing and eval instructions](../../instructions/testing-evals.instructions.md)

Load the installed skills that matter for this slice:

- `framework-selection` first to confirm LangGraph is the right orchestration layer
- `langgraph-fundamentals` for graph state, nodes, and routing
- `langgraph-human-in-the-loop` for pause and resume approval flow
- `langgraph-persistence` for checkpointer and thread or workflow id handling
- `langchain-dependencies` if packages or versions need to change

Anchor on the existing implementation before designing new seams:

- [support triage controller](../../../apps/ai-api/src/agents/support-agent.controller.ts)
- [support triage service](../../../apps/ai-api/src/agents/support-triage.service.ts)
- [triage DTO](../../../apps/ai-api/src/agents/dto/triage-case.dto.ts)
- [chat panel](../../../apps/react-chat-window/components/ChatPanel.tsx)

## Workflow

1. Confirm the slice boundary: Node 1 only, with real trigger, Salesforce read context, triage, gated write-back, status reporting, and a read-only progress UI.
2. Define the smallest compatible contracts for `trigger signal`, `read context`, `write-back`, and `status event`.
3. Create or extend orchestrator state under `apps/ai-api/src/orchestrator/**` with explicit lifecycle and correlation ids.
4. Keep the Salesforce trigger path asynchronous and fast. The trigger should identify the case and hand off work, not do the orchestration inline.
5. Reuse `SupportTriageService` or a narrow adapter around it for the model decision rather than duplicating triage prompt logic.
6. Separate Salesforce reads, writes, and status publication behind services with DTO validation and auth.
7. Do not use mock Case payloads as the default proof path. Connect to an actual Salesforce Case and run the first-node E2E path when the environment supports it. If it does not, stop with a concrete blocker instead of faking success.
8. If approval is in scope, prove pause and resume with an idempotent state transition and an actual persistence approach before adding any more nodes.
9. Extend `apps/react-chat-window` with a read-only orchestration view that renders live node status, safe reasoning summaries, and the first-node triage output. Do not put approval controls in the UI.
10. Add the smallest useful tests for contracts, auth, lifecycle transitions, telemetry, UI rendering, and failure handling.
11. Update the orchestrator doc or contract notes only after the slice is working, so documentation reflects the implemented seams.

## Safety Rules

- Do not build Nodes 2-8 in the same change unless the user explicitly asks.
- Do not bypass `ModelRouter` or introduce vendor SDK calls into agents or orchestrator services.
- Do not block Salesforce Flow waiting on LLM or graph execution.
- Do not log raw case text, approval payloads, tokens, or secrets.
- Do not silently replace real Salesforce reads or writes with mock adapters when the ask is for a live proof.
- Do not create a second triage API contract when the existing DTO can be extended or wrapped.
- Do not treat the UI progress feed as the approval channel. Approval happens in email or Salesforce; the UI only reflects status.
- Do not expose hidden chain-of-thought. Show concise safe reasoning summaries, lifecycle states, and Node 1 outputs only.

## Output Checklist

Return:

- the contracts added or changed
- the orchestrator services or controllers added or changed
- the real Salesforce proof path used for the Node 1 E2E run
- the UI surfaces added or changed for orchestration status and first-node output
- the tests and validation commands run
- known gaps that intentionally remain for later nodes
- the exact next step for expanding beyond Node 1

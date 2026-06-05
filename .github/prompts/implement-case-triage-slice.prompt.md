---
name: "Implement Case Triage Slice"
description: "Implement the Node 1 case triage walking skeleton with live Salesforce E2E proof, thin LangGraph contracts, approval-ready orchestration seams, and a read-only first-node progress UI."
agent: "Case Triage Slice Implementer"
argument-hint: "Concrete implementation ask: org and Salesforce boundary, UI scope, approval scope, and whether live E2E proof is required"
tools: [read, search, edit, execute, todo, agent]
---

Use the installed workspace skills for this task.

Required skill-loading order:

1. `framework-selection`
2. `langgraph-fundamentals`
3. `langgraph-human-in-the-loop`
4. `langgraph-persistence`
5. `langgraph-case-triage-slice`
6. `langchain-dependencies` only if package changes are needed

Relevant repo instructions to honor during implementation:

- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [LLM provider instructions](../instructions/llm-provider.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)
- [telemetry instructions](../instructions/telemetry.instructions.md)
- [testing and eval instructions](../instructions/testing-evals.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)

Relevant repo references:

- [AGENTS.md](../../AGENTS.md)
- [orchestrator flow](../../docs/orchestrator/case-triage-orchestrator-flow.md)
- [support triage controller](../../apps/ai-api/src/agents/support-agent.controller.ts)
- [support triage service](../../apps/ai-api/src/agents/support-triage.service.ts)
- [triage DTO](../../apps/ai-api/src/agents/dto/triage-case.dto.ts)
- [chat panel](../../apps/react-chat-window/components/ChatPanel.tsx)

User-provided context:

```text
${input}
```

Implementation requirements:

- Keep the design thin: Node 1 only. Do not design or scaffold Nodes 2-8 unless the user explicitly asks.
- Extend the existing support triage path into `apps/ai-api/src/orchestrator/**` rather than replacing it.
- Add the minimum explicit contracts for `trigger signal`, `read context`, `write-back`, and `status event`.
- Keep the Salesforce trigger async and fire-and-forget.
- Use the real Salesforce path for this slice. Do not use mock Case data, fake write-backs, or stubbed Salesforce responses as the claimed proof path. If the environment cannot support a live org-backed E2E run, stop and report the blocker clearly.
- Separate Salesforce reads, writes, and status publication from orchestration logic.
- Use `ModelRouter` only through existing service seams; do not import provider SDKs into agents or orchestrator services.
- Make approval pause and resume explicit and idempotent if it is in scope. Use the LangGraph persistence and HITL patterns instead of ad hoc pause logic.
- Add a read-only UI workstream in `apps/react-chat-window` that shows live first-node progress, safe reasoning summaries, and the sanitized Node 1 output. Do not place approval actions in the UI.
- Do not expose hidden chain-of-thought. The UI may show lifecycle states, short reasoning summaries, and structured outputs only.
- Add focused validation: DTO or contract tests, service tests, auth or guard tests, telemetry or status-event safety checks, frontend rendering checks, and a real Salesforce-backed Node 1 E2E proof when the environment supports it.
- If the change becomes cross-cutting, use the relevant specialist agents already configured in the workspace: `Nest AI Architect`, `Security Reviewer`, `Telemetry Reviewer`, and `Release Checker`.

The final response must include:

- the skills and instructions used
- the contracts implemented or updated
- the thin-slice path end to end
- the real Salesforce E2E proof path used, or the exact blocker preventing it
- the UI surfaces added or changed for live Node 1 progress and output
- the validation that was run
- residual risks or open seams
- the exact next step after Node 1

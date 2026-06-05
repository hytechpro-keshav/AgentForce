---
name: "Implement Case Triage Slice"
description: "Implement the Node 1 case triage walking skeleton using the existing support triage service, thin boundary contracts, and approval-ready orchestration seams."
agent: "Case Triage Slice Implementer"
argument-hint: "Context for the slice, target files, Salesforce boundaries, and whether to include the approval prototype"
tools: [read, search, edit, execute, todo, agent]
---

Use the `langgraph-case-triage-slice` skill for this task.

This repo uses GitHub Copilot workspace customizations, not external `npx skills` installation. Treat the LangChain and LangGraph skills article as design inspiration for progressive disclosure, but use only the repo-local `.github/skills`, `.github/agents`, and `.github/instructions` files as the working source of truth.

Relevant repo instructions to honor during implementation:

- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
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

User-provided context:

```text
${input}
```

Implementation requirements:

- Keep the design thin: Node 1 only. Do not design or scaffold Nodes 2-8 unless the user explicitly asks.
- Extend the existing support triage path into `apps/ai-api/src/orchestrator/**` rather than replacing it.
- Add the minimum explicit contracts for `trigger signal`, `read context`, `write-back`, and `status event`.
- Keep the Salesforce trigger async and fire-and-forget.
- Separate Salesforce reads, writes, and status publication from orchestration logic.
- Use `ModelRouter` only through existing service seams; do not import provider SDKs into agents or orchestrator services.
- Make approval pause and resume explicit and idempotent if it is in scope. If it is not in scope for the requested change, leave a clear seam without overbuilding it.
- Add focused validation: DTO or contract tests, service tests, auth or guard tests, and telemetry or status-event safety checks.
- If the change becomes cross-cutting, use the relevant specialist agents already configured in the workspace: `Nest AI Architect`, `Security Reviewer`, `Telemetry Reviewer`, and `Release Checker`.

The final response must include:

- the contracts implemented or updated
- the thin-slice path end to end
- the validation that was run
- residual risks or open seams
- the exact next step after Node 1---
  name: "Implement Case Triage Slice"
  description: "Implement the thin vertical slice for the case-triage orchestrator: trigger handoff, Node 1 triage, Salesforce read and write contracts, status events, and approval pause and resume proof."
  agent: "LangGraph Slice Implementer"
  argument-hint: "Target case flow, current blockers, desired contracts, and whether to scaffold docs only or code plus tests"
  tools: [read, search, edit, execute, todo, agent]

---

Use the `case-triage-walking-skeleton` skill and the repo instructions relevant to `apps/ai-api`, orchestration, security, telemetry, and tests to implement the first walking skeleton instead of designing all eight nodes upfront.

User-provided context:

```text
${input}
```

Implementation rules:

- Start from [AGENTS.md](../../AGENTS.md), [case triage orchestrator flow](../../docs/orchestrator/case-triage-orchestrator-flow.md), [support agent controller](../../apps/ai-api/src/agents/support-agent.controller.ts), [support triage service](../../apps/ai-api/src/agents/support-triage.service.ts), and [triage DTO](../../apps/ai-api/src/agents/dto/triage-case.dto.ts).
- Reuse the existing support triage endpoint and service as the initial Node 1 reasoning path.
- Define only the four initial boundary contracts: trigger signal, Salesforce read-context response, gated write-back command, and status event.
- Prove the two highest-risk mechanics early: fire-and-forget trigger handoff and async approval pause and resume.
- Preserve authenticated Salesforce to NestJS traffic, `ModelRouter` indirection, structured telemetry, and safe logging.
- Keep the slice production-shaped but thin: one node, one trigger, one read adapter, one write-back path, one status stream.

Specialist follow-up:

- Use `Nest AI Architect` if module boundaries, DTO ownership, or route shapes become unclear.
- Use `Security Reviewer` if auth, data exposure, or approval routing is touched.
- Use `Telemetry Reviewer` for workflow spans, metrics, and status-event observability.
- Use `Release Checker` before treating the slice as ready for UAT or promotion.

Deliverables:

- a minimal implementation plan
- code and doc changes needed for the slice
- focused tests and validation steps
- explicit blockers when Salesforce or external dependencies prevent full proof

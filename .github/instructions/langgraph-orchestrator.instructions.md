---
description: "Use when editing the Node 1 case triage walking skeleton, LangGraph-style orchestration state, Salesforce trigger handoff, pause and resume approval flow, orchestration status events, or the read-only first-node progress UI."
applyTo:
  - "apps/ai-api/src/orchestrator/**"
  - "apps/ai-api/src/agents/support-*.ts"
  - "apps/ai-api/src/agents/dto/*triage*.ts"
  - "apps/ai-api/src/agents/agents.module.ts"
  - "apps/ai-api/test/**"
  - "apps/react-chat-window/**"
  - "docs/orchestrator/**"
---

# LangGraph Orchestrator Instructions

- Start with a thin vertical slice. Implement Node 1 end to end before adding Nodes 2-8 or broad graph routing.
- Consult the installed skills in this repo in this order when relevant: `framework-selection`, `langgraph-fundamentals`, `langgraph-human-in-the-loop`, `langgraph-persistence`, and `langgraph-case-triage-slice`.
- Reuse the existing support triage seam in `apps/ai-api/src/agents/support-agent.controller.ts`, `apps/ai-api/src/agents/support-triage.service.ts`, and `apps/ai-api/src/agents/dto/triage-case.dto.ts` instead of creating a second incompatible triage contract.
- Define only the four boundary contracts needed for the slice first: trigger signal, Salesforce case context read, gated write-back command, and status event.
- Keep the Salesforce trigger async and fire-and-forget. Trigger endpoints should accept minimal identifiers, authenticate the caller, hand off quickly, and return without waiting for model work.
- Default to real Salesforce integration for this slice. Do not silently substitute fixtures, mock cases, or fake write-backs when the task asks for the live path. If Salesforce connectivity, auth, or org state is missing, stop and report the exact blocker.
- Keep orchestration state explicit and resumable: workflow id, case id, tenant or customer reference, current node, lifecycle status, correlation ids, timestamps, retry count, and approval wait state when present.
- Approval pause and resume is a first-class mechanic. Use idempotent resume inputs, durable state transitions, and a real checkpointer choice for the target environment before expanding node breadth.
- Put Salesforce reads and writes behind dedicated services and DTOs. Do not mix Named Credential or raw HTTP wiring into node logic.
- Agent or orchestrator services may call `ModelRouter` or existing agent services; they must not call vendor SDKs directly.
- Emit safe status events for `assigned`, `running`, `done`, `waiting_approval`, `rejected`, and `failed`. Do not log raw case descriptions, prompts, approval payloads, tokens, or secrets.
- The UI is read-only observability. It may show safe node progress, concise reasoning summaries, and first-node output, but not hidden raw chain-of-thought and not approval controls.
- For the first slice UI, prefer extending `apps/react-chat-window` with a focused orchestration progress view that renders live node status plus the sanitized triage result.
- Add focused tests for DTO validation, orchestration state transitions, auth failures, idempotency, telemetry no-op safety, approval resume behavior, and the Node 1 E2E path against a real Salesforce-connected environment when available.
- Keep docs aligned with the implemented slice and treat the working code plus boundary contracts as the reference for later nodes.

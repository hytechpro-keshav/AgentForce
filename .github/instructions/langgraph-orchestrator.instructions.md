---
description: "Use when editing the Node 1 case triage walking skeleton, LangGraph-style orchestration state, Salesforce trigger handoff, pause and resume approval flow, or orchestrator status events."
applyTo:
  - "apps/ai-api/src/orchestrator/**"
  - "apps/ai-api/src/agents/support-*.ts"
  - "apps/ai-api/src/agents/dto/*triage*.ts"
  - "apps/ai-api/src/agents/agents.module.ts"
  - "apps/ai-api/test/**"
  - "docs/orchestrator/**"
---

# LangGraph Orchestrator Instructions

- Start with a thin vertical slice. Implement Node 1 end to end before adding Nodes 2-8 or broad graph routing.
- Reuse the existing support triage seam in `apps/ai-api/src/agents/support-agent.controller.ts`, `apps/ai-api/src/agents/support-triage.service.ts`, and `apps/ai-api/src/agents/dto/triage-case.dto.ts` instead of creating a second incompatible triage contract.
- Define only the four boundary contracts needed for the slice first: trigger signal, Salesforce case context read, gated write-back command, and status event.
- Keep the Salesforce trigger async and fire-and-forget. Trigger endpoints should accept minimal identifiers, authenticate the caller, hand off quickly, and return without waiting for model work.
- Keep orchestration state explicit and resumable: workflow id, case id, tenant or customer reference, current node, lifecycle status, correlation ids, timestamps, retry count, and approval wait state when present.
- Approval pause and resume is a first-class mechanic. Use idempotent resume inputs and durable state transitions before expanding node breadth.
- Put Salesforce reads and writes behind dedicated services and DTOs. Do not mix Named Credential or raw HTTP wiring into node logic.
- Agent or orchestrator services may call `ModelRouter` or existing agent services; they must not call vendor SDKs directly.
- Emit safe status events for `assigned`, `running`, `done`, `waiting_approval`, `rejected`, and `failed`. Do not log raw case descriptions, prompts, approval payloads, or secrets.
- Add focused tests for DTO validation, orchestration state transitions, auth failures, idempotency, telemetry no-op safety, and approval resume behavior.
- Keep docs aligned with the implemented slice and treat the working code plus boundary contracts as the reference for later nodes.---
  description: "Use when implementing or reviewing LangGraph-style orchestrators, walking skeleton flows, async Salesforce trigger handoffs, approval pause and resume, or case triage orchestration in the NestJS AI API."
  applyTo:
  - "apps/ai-api/src/orchestrator/\*\*"
  - "apps/ai-api/src/agents/\*\*"
  - "apps/ai-api/test/\*\*"
  - "docs/orchestrator/\*\*"
  - "packages/shared-contracts/\*\*"

---

# LangGraph Orchestrator Instructions

- Start with a thin vertical slice that proves the end-to-end seams before expanding the graph breadth.
- For the case-triage skeleton, reuse the existing `/agent/support/triage-case` contract and `SupportTriageService` before introducing new node-specific prompts.
- Define only four boundary contracts first: trigger signal, Salesforce read-context response, gated write-back command, and status event.
- Keep trigger ingestion fire-and-forget. The initiating Salesforce Flow should signal the orchestrator and return without waiting on LLM work.
- Keep orchestrator state minimal and explicit: case id, tenant or client identity, correlation id, current node, node outputs, approval state, and safe status summary. Do not persist raw secrets or unnecessary customer text.
- Model approval as an explicit pause and resume boundary with a correlation id or resume token. Prove resume behavior in isolation before depending on it across later nodes.
- Agent logic must call `ModelRouter`. Do not call vendor SDKs or framework-specific model clients from orchestrator services.
- If LangGraph is introduced, keep LangGraph state and node types inside the orchestrator module. Do not leak framework-specific types into controllers or Salesforce-facing DTOs.
- Salesforce integration must use authenticated DTOs, safe idempotency on write-back, and structured failure states that can be surfaced to Salesforce or operations tooling.
- Emit status events for `assigned`, `running`, `done`, `waiting_approval`, `rejected`, and `failed`. UI consumers are observability-only; approval happens in Salesforce or another approved out-of-band channel.
- Add focused tests for trigger acceptance, orchestrator state transitions, approval pause and resume, Salesforce contract mapping, auth failures, and telemetry no-op behavior.
- Keep documentation close to the working slice. Update flow and contract docs from working code instead of pre-designing Nodes 2 through 8.

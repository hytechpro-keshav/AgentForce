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

## New node / phase completion checklist (required)

When adding or extending any orchestrator node (new graph step + typed channel), follow **`docs/orchestrator/new-node-phase-completion-checklist.md`** end to end before marking the phase done.

Minimum cross-cutting items easy to miss:

1. **Final Verdict rollup** — update `orchestrator-verdict.synthesizer.ts` for `headline`, `summary`, `recommendedSteps`, and `highlights` (not only `basis` or one highlight). Add `orchestrator-verdict.synthesizer.spec.ts` fixtures for the new channel.
2. **React console** — `NODE_META`, stage summary panel, and `orchestration/page.tsx` subtitle for all active nodes.
3. **Smoke** — extend `scripts/smoke/all-3-nodes-deployed.sh` (or successor) with assertions for the new node.
4. **DTO comments** — `orchestrator-verdict.ts` and flow docs must list all active nodes (avoid stale "Nodes 1–3" copy).

Verdict gap analysis prompts (reuse for any node): `.github/prompts/analyze-node4-verdict-gap.prompt.md`, `.github/prompts/implement-node4-verdict-rollup.prompt.md`. Node 4 postmortem: `docs/orchestrator/node4-verdict-gap-analysis.md`.

Node 5 Scheduling planning (before implementation): `.github/prompts/plan-node5-scheduling.prompt.md`, `.github/agents/node5-scheduling-planner.agent.md`, `.claude/commands/plan-node5-scheduling.md`. Output phase plan: `docs/orchestrator/node-5-scheduling-phase-plan.md`.

Node 5 Salesforce 5-Pre prep: `.github/prompts/node5-pre-salesforce-prep.prompt.md`, `.claude/commands/node5-pre-salesforce-prep.md`, skill `.agents/skills/salesforce-node5-scheduling-prep/SKILL.md`.

## Re-orchestration (mandatory for every node change)

The orchestrator is **point-in-time per trigger** unless a reconcile path is explicitly built. Cases, inventory, parts transfers, and technician availability change continuously.

Before shipping or modifying any orchestrator node, channel, gateway, graph edge, Salesforce write, or UI surface:

1. Read **`docs/orchestrator/re-orchestration-backlog.md`** and document which phase is point-in-time vs. reconcile-enabled.
2. State what goes **stale** for your node and the minimum **reconcile scope** (e.g. `parts` only, `parts → scheduling`).
3. Respect **Stop AI orchestration** — when `AI_Orchestration_Status__c = stopped_by_user`, no auto-triggers or reconcile (backlog RC-1/RC-2).
4. **Write paths** (parts 4c, scheduling 5c) must include a **fresh upstream read** before Salesforce DML — never trust channel snapshots alone at write time.
5. Do not mark a phase complete in the checklist without explicit re-orchestration decisions in the phase plan §0.

See also `docs/orchestrator/node-5-scheduling-phase-plan.md` §3.7 for scheduling-specific 5a / 5c / 5d split.

# Implement Case Triage Slice

Implement the Node 1 LangGraph case triage walking skeleton. Full details in `.github/prompts/implement-case-triage-slice.prompt.md`.
Use the `case-triage-slice-implementer` agent persona from `.claude/agents/case-triage-slice-implementer.agent.md`.

## Required skill-loading order

1. `.agents/skills/framework-selection/SKILL.md`
2. `.agents/skills/langgraph-fundamentals/SKILL.md`
3. `.agents/skills/langgraph-human-in-the-loop/SKILL.md`
4. `.agents/skills/langgraph-persistence/SKILL.md`
5. `.agents/skills/langgraph-case-triage-slice/SKILL.md`
6. `.agents/skills/langchain-dependencies/SKILL.md` (only if package changes needed)

## Key constraints

- **Node 1 only** — do not scaffold Nodes 2–8 unless explicitly asked
- Extend `apps/ai-api/src/agents/` into `apps/ai-api/src/orchestrator/` — do not replace
- Use real Salesforce path — no mock Case data, no stubbed write-backs
- Salesforce trigger must be async and fire-and-forget
- HITL approval pause must be explicit and idempotent (use LangGraph persistence patterns)
- UI in `apps/react-chat-window` shows live Node 1 progress only — no approval actions in UI
- All agent/orchestrator services call `ModelRouter` only — no direct provider SDK imports

## Verify

- `npm run ai-api:test` && `npm run react-chat:typecheck`
- Real Salesforce-backed Node 1 E2E proof (or report exact blocker)

$ARGUMENTS

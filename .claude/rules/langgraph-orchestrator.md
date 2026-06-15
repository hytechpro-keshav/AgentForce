---
paths:
  - "apps/ai-api/src/orchestrator/**"
  - "apps/react-chat-window/**"
  - "docs/orchestrator/**"
---

Read and follow `.github/instructions/langgraph-orchestrator.instructions.md` before editing these files.

## New node / phase — do not mark done without this

Complete **`docs/orchestrator/new-node-phase-completion-checklist.md`** for every new orchestrator node (graph step + typed channel).

Easy to miss (Node 4 lesson):

1. **Final Verdict** — `orchestrator-verdict.synthesizer.ts`: update `headline`, `summary`, `recommendedSteps`, and `highlights`; not only `basis` or one highlight row.
2. **Tests** — `orchestrator-verdict.synthesizer.spec.ts` fixtures for eligible, skipped, and degraded paths.
3. **React** — `NODE_META`, stage panel, orchestration page subtitle lists all active nodes.
4. **Smoke** — `scripts/smoke/all-3-nodes-deployed.sh` asserts the new node.

Verdict gap prompts: `.github/prompts/analyze-node4-verdict-gap.prompt.md`, `.github/prompts/implement-node4-verdict-rollup.prompt.md`.

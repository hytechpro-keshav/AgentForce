# New Orchestrator Node — Phase Completion Checklist

Use this checklist whenever you add or extend an orchestrator **node** (graph step + typed channel), not only for Node 4. The Node 4 Final Verdict gap (channel wired but not rolled into headline/summary/steps) happened because this cross-cutting work was not part of the original Node 1–3 slice definition.

**Canonical prompts for verdict gaps:**

- Analysis: `.github/prompts/analyze-node4-verdict-gap.prompt.md` (pattern applies to any node)
- Implementation: `.github/prompts/implement-node4-verdict-rollup.prompt.md`

**Lesson doc:** `docs/context/node4-auth-session-lessons.md` (Salesforce OAuth); `docs/orchestrator/node4-verdict-gap-analysis.md` (verdict debt).

---

## Backend — graph and channel

- [ ] Typed DTO for the new channel (`apps/ai-api/src/orchestrator/dto/`)
- [ ] Graph node wired in `case-triage.graph.ts` (eligibility gate + plan/run + non-interrupting unless spec says otherwise)
- [ ] Channel written **only** to its own state key (no cross-channel mutation)
- [ ] Config feature flag with safe default (`app-config` + Railway env)
- [ ] Salesforce gateway or agent service seam if the node reads/writes SF
- [ ] Focused unit tests: graph spec, planner/gateway spec, eligibility policy
- [ ] `case-triage-orchestrator.service.ts` passes the channel into `buildVerdict()`

## Final Verdict — observability rollup (do not skip)

The verdict is **deterministic** and **observability-only** (`orchestrator-verdict.synthesizer.ts`). Machines use typed channels; humans read the verdict.

When a node is **eligible and produces operator-meaningful output**, update **all four** synthesizer surfaces:

| Surface            | Question to answer                                                                    |
| ------------------ | ------------------------------------------------------------------------------------- |
| `headline`         | One scannable clause (mirror Node 3 `"knowledge guidance available"`)                 |
| `summary`          | One sentence with the node's primary outcome                                          |
| `recommendedSteps` | Actionable operator steps from structured plan fields (not raw rationale / KB chunks) |
| `highlights`       | Labeled key facts beyond a single readiness badge                                     |
| `basis`            | Channel name in `basis[]` when the channel exists                                     |

Also:

- [ ] `orchestrator-verdict.synthesizer.spec.ts` — fixtures per status (ready, partial, blocked, skipped, degraded)
- [ ] `dto/orchestrator-verdict.ts` comment lists all active nodes (not stale "Nodes 1–3")
- [ ] No PII in verdict strings (part numbers and warehouse **reference codes** are OK; serials, account ids, customer names are not)
- [ ] Respect `clip()` limits: headline 160, summary 400, step 240, max 6 steps

**Anti-pattern:** wiring `partsLogistics` (or any channel) into `buildVerdict()` input but only adding a single `highlights` row.

## React orchestration console

- [ ] `OrchestrationView.tsx` — `NODE_META` entry + stage summary component
- [ ] `lib/orchestration.ts` — sanitize/parse types for the channel
- [ ] `app/orchestration/page.tsx` — subtitle mentions **all** active nodes
- [ ] Component tests for new stage card and verdict copy when user-facing
- [ ] `AI_API_ORCHESTRATOR_VIEW_TOKEN` on Railway `react-chat-window` (refresh before blaming UI)

## Smoke, deploy, and docs

- [ ] `scripts/smoke/all-3-nodes-deployed.sh` (or successor) asserts the new node
- [ ] Railway: `ai-api` feature flag + any react-chat env if needed
- [ ] Phase plan §0 status header and acceptance table updated
- [ ] `docs/orchestrator/case-triage-orchestrator-flow.md` node list updated

## Review before marking phase done

Ask explicitly:

1. Does the **Final Verdict** mention this node's primary finding in headline **and** summary **and** at least one recommended step (when eligible)?
2. Does the **orchestration console** show the node as a completed stage with detail below the verdict?
3. Does the **smoke script** fail if this node is skipped or degraded unexpectedly?

If any answer is no, the phase is not complete — even when the graph node and channel work in isolation.

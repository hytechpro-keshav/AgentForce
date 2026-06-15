---
name: "Implement Node 4 Verdict Rollup"
description: "Implement deterministic Node 4 Parts & Logistics rollup in the orchestrator Final Verdict (headline, summary, recommended steps, highlights) after gap analysis."
agent: "Nest AI Architect"
argument-hint: "Path to analysis doc (default docs/orchestrator/node4-verdict-gap-analysis.md)"
tools: [read, search, edit, execute, todo, agent]
---

# Execution mode — implement after analysis

You are in **implementing mode**. Extend the Final Verdict synthesizer so Node 4 Parts & Logistics findings appear in **headline**, **summary**, and **recommended steps** — not only the `Parts fulfillment` highlight.

**Prerequisite:** Read `docs/orchestrator/node4-verdict-gap-analysis.md` (from the analyze prompt). If missing, run `.github/prompts/analyze-node4-verdict-gap.prompt.md` first or infer rules from this prompt.

## User-provided context

```text
${input}
```

## Git identity and push (required)

All commits and pushes for this work must use the **`hytechpro-keshav`** GitHub account (repo owner with push access).

Before committing:

```bash
gh auth status
# Must show: github.com account hytechpro-keshav (active)
# If logged in as chaudhary-keshav (push: false), switch:
gh auth login
# OR: gh auth switch -u hytechpro-keshav
```

Verify push permission:

```bash
gh api repos/hytechpro-keshav/AgentForce --jq '.permissions.push'
# Must return: true
```

Branch workflow:

```bash
git checkout IMP-NODE-4
git pull origin IMP-NODE-4   # if remote exists
# implement...
git push -u origin IMP-NODE-4
```

**Never** use `git config` to change global user.email/name. Commit authorship follows the authenticated `gh` account.

## Design constraints (non-negotiable)

1. **Deterministic only** — extend `synthesizeOrchestratorVerdict()`; no LLM call
2. **Observability-only** — downstream nodes must not parse `orchestratorVerdict`
3. **Sanitized facts only** — part numbers, warehouse reference codes, exception types, ETA windows, approval flags; never asset serial, account id, customer name, raw inventory payloads
4. **Respect clip limits** — headline 160, summary 400, step 240, max 6 steps
5. **Eligible=false** — do not imply a parts plan exists; optional single summary clause ("parts logistics skipped")
6. **degraded=true** — summary must say inventory was degraded; do not state stock as fact
7. **Do not duplicate** the full `PartsLogisticsSummary` card — verdict is executive rollup; detail stays in the stage panel

## Implementation spec (default if analysis doc absent)

### 1. `buildHeadline()` — add Node 4 clause when eligible

| Condition                                        | Append to headline          |
| ------------------------------------------------ | --------------------------- |
| `eligible && fulfillmentReadiness === 'ready'`   | `parts available`           |
| `eligible && fulfillmentReadiness === 'partial'` | `parts transfer required`   |
| `eligible && fulfillmentReadiness === 'blocked'` | `parts fulfillment blocked` |
| `eligible && degraded`                           | `parts inventory degraded`  |
| `eligible === false`                             | no parts clause             |

Join with `·` like existing priority/risk/knowledge clauses. Clip to 160 chars total.

### 2. `buildSummary()` — add one sentence after knowledge sentence

Examples (deterministic templates):

- **partial + transfer:** `Parts plan: {partNumber} requires inter-warehouse transfer from {sourceWH} to {fulfillmentWH} (ETA up to {hoursMax}h).`
- **ready:** `Parts plan: {partNumber} is available at {fulfillmentWH}.`
- **blocked:** `Parts fulfillment blocked for {partNumber} ({exceptionType}).`
- **degraded:** `Parts logistics ran in degraded mode; inventory reads were incomplete.`
- **skipped:** `Parts logistics was not eligible for this case.`

Use first primary plan (`partPlans[0]`) when multiple exist; append `+N more` if `partPlans.length > 1`.

### 3. `buildSteps()` — append parts steps after knowledge steps

Priority order (insert after triage + knowledge actions, before repeat-incident / write-back confirm steps):

1. If any plan has `requiredApproval` → `Approve parts action: {partNumber} ({approvalReason}).`
2. If `transferRequired` → `Initiate inter-warehouse transfer for {partNumber} from {sourceWH} to {fulfillmentWH}.`
3. Else if `availability === 'available'` → `Dispatch {partNumber} from {fulfillmentWH}.`
4. Else if `exceptionType === 'backorder'` → `Create backorder request for {partNumber}.`
5. Else if `exceptionType === 'catalog_gap'` → `Review catalog gap for requested part; manual sourcing required.`

Cap total steps at 6 (existing slice). Drop lowest-priority generic steps before dropping parts safety steps.

### 4. `buildHighlights()` — extend existing Node 4 block

Keep `Parts fulfillment`. Add when eligible:

| Label            | Value source                                  |
| ---------------- | --------------------------------------------- |
| `Primary part`   | `partPlans[0].partNumber`                     |
| `Fulfillment WH` | `partPlans[0].fulfillmentWarehouseReference`  |
| `Transfer`       | `Yes ({source} → {dest})` or `No`             |
| `Parts ETA`      | `estimatedArrivalWindow` or `{hoursMax}h max` |

Keep existing `Parts approvals` highlight when `requiredApproval` count > 0.

### 5. `basis` array

Ensure `partsLogistics` is present when channel exists (already implemented — verify tests).

### 6. DTO comment update

`apps/ai-api/src/orchestrator/dto/orchestrator-verdict.ts` — update header comment from "Nodes 1-3" to "Nodes 1-4".

### 7. React chat (minimal)

- `apps/react-chat-window/app/orchestration/page.tsx` — subtitle mentions Node 4
- No change to `FinalVerdict` component unless new highlight labels need styling
- Verify `sanitizeVerdict()` does not strip new fields (strings only — should pass through)

## Files to touch

| File                                                                     | Change                               |
| ------------------------------------------------------------------------ | ------------------------------------ |
| `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`       | Headline, summary, steps, highlights |
| `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.spec.ts`  | Node 4 scenario tests                |
| `apps/ai-api/src/orchestrator/dto/orchestrator-verdict.ts`               | Comment only                         |
| `apps/react-chat-window/app/orchestration/page.tsx`                      | Subtitle copy                        |
| `apps/react-chat-window/components/__tests__/OrchestrationView.test.tsx` | Optional verdict copy assertion      |
| `docs/orchestrator/node4-verdict-gap-analysis.md`                        | Mark recommendations as implemented  |

## Test fixtures (add to spec)

Use a `partsLogisticsPartialTransfer` fixture mirroring live proof:

```ts
{
  eligible: true,
  degraded: false,
  status: "PARTIAL",
  fulfillmentReadiness: "partial",
  partPlans: [{
    partNumber: "SP-DISP-15X-FHD",
    availability: "unavailable",
    exceptionType: "inter_warehouse_transfer",
    transferRequired: true,
    fulfillmentWarehouseReference: "WH-AUS-001",
    sourceWarehouseReference: "WH-SJO-002",
    requiredApproval: false,
    approvalReason: "none",
    estimatedDispatchHoursMax: 41,
    reservationStatus: "planned",
    confidence: "medium",
    rationale: "Display panel replacement; transfer from SJO to AUS."
  }]
}
```

### Required assertions

- `headline` contains `parts transfer required`
- `summary` contains `SP-DISP-15X-FHD` and `WH-SJO-002` / `WH-AUS-001`
- `recommendedSteps` contains transfer initiation step
- `highlights` includes `Primary part` and `Parts fulfillment`
- `basis` includes `partsLogistics`
- `eligible: false` → headline/summary/steps have **no** part numbers
- `degraded: true` → summary mentions degraded; no definitive stock claim
- Serialized verdict JSON does **not** contain forbidden PII patterns (reuse existing knowledge test style)

## Validation commands

```bash
npm run ai-api:test -- --testPathPattern=orchestrator-verdict
npm run react-chat:typecheck
npm run prettier:verify
```

Optional live check after Railway deploy:

```bash
SF_CASE_ID=500g500000YpQMnAAN ./scripts/smoke/all-3-nodes-deployed.sh
# Then open orchestration console and confirm verdict mentions SP-DISP-15X-FHD
```

## Commit and push (hytechpro-keshav)

```bash
gh auth status   # confirm hytechpro-keshav

git add apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts \
        apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.spec.ts \
        apps/ai-api/src/orchestrator/dto/orchestrator-verdict.ts \
        apps/react-chat-window/app/orchestration/page.tsx \
        docs/orchestrator/node4-verdict-gap-analysis.md

git commit -m "$(cat <<'EOF'
feat(orchestrator): roll Node 4 parts findings into Final Verdict

Surface parts transfer, primary part, and fulfillment ETA in the deterministic
verdict headline, summary, and recommended steps alongside existing triage,
customer, and knowledge rollup.
EOF
)"

git push -u origin IMP-NODE-4
```

## Review agents (post-implementation)

- `.github/agents/nest-ai-architect.agent.md` — synthesizer boundaries
- `.github/agents/security-reviewer.agent.md` — no PII in verdict strings
- `.github/agents/node4-parts-logistics-implementer.agent.md` — parts field semantics

## Out of scope

- LLM-generated verdict prose
- Changing `PartsLogisticsSummary` stage card layout
- Salesforce write-back of verdict text
- Agentforce planner topic changes

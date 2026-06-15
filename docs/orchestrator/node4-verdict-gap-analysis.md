# Node 4 Final Verdict Gap Analysis

**Date:** 2026-06-15  
**Branch:** `IMP-NODE-4`  
**Live proof:** Case `500g500000YpQMnAAN`, workflow `wf-4e82f0a8-e3c8-41a4-9eb2-4f0ca6583cce`  
**Console:** https://react-chat-window-production.up.railway.app/orchestration?caseId=500g500000YpQMnAAN

---

## 1. Executive summary

1. **Root cause is implementation debt, not a data or wiring bug.** `partsLogistics` is passed into `buildVerdict()` and recorded in `basis`, but the synthesizer only reads Node 4 inside `buildHighlights()` — not `buildHeadline()`, `buildSummary()`, or `buildSteps()`.
2. **The Final Verdict was designed and shipped for Nodes 1–3.** Comments, backlog docs, and UI copy still say "after Nodes 1–3"; Node 4 rollup was never added when Phase 4a shipped.
3. **Live behavior is accurate but incomplete.** `Parts fulfillment: partial` correctly reflects `fulfillmentReadiness`, but part number `SP-DISP-15X-FHD`, transfer `WH-SJO-002 → WH-AUS-001`, and ETA segments exist only in the `partsLogistics` channel and `PartsLogisticsSummary` panel.
4. **This is not a UI sanitization gap.** `sanitizeVerdict()` in the React client does not strip parts-related text; the backend simply never generates it.
5. **This is not a safety constraint.** `PartLogisticsPlan` fields (part numbers, warehouse refs, exception types, ETA windows, approval flags) are explicitly sanitized and safe for verdict promotion per `parts-logistics.ts`.
6. **Node 3 sets the pattern Node 4 should mirror:** headline clause, summary sentence, `recommendedSteps` from structured rationales, and richer highlights.
7. **Step budget is a secondary pressure.** Knowledge `recommendedActions` can consume up to 3 of 6 steps before write-back steps; parts steps were never inserted, so they would be dropped today even if naively appended without priority rules.
8. **Fix is backend-only for behavior** (`orchestrator-verdict.synthesizer.ts` + tests) plus comment/copy updates; `PartsLogisticsSummary` keeps the full plan detail.
9. **Go:** update `orchestrator-verdict.ts` header comment from "Nodes 1–3" to "Nodes 1–4" when rollup ships.
10. **Handoff:** `.github/prompts/implement-node4-verdict-rollup.prompt.md` contains the default implementation spec.

---

## 2. Current-state matrix

| Verdict field      | Node 1 (triage)                                                              | Node 2 (customer)                                                  | Node 3 (knowledge)                                                                        | Node 4 (parts)                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `headline`         | Priority label (`Critical priority case`, etc.) via `buildHeadline()` L67–69 | Risk clause (`{risk} business risk`) L71–73                        | `"knowledge guidance available"` when ANSWERED with sources L74–76                        | **None** — `buildHeadline()` has no `partsLogistics` parameter or branch                                                         |
| `summary`          | Priority sentence L87–95                                                     | Risk phrase L92–94                                                 | Status sentence (source count, NO_SOURCE, skipped, degraded) L97–106                      | **None** — `buildSummary()` never reads `input.partsLogistics`                                                                   |
| `recommendedSteps` | `suggestedNextStep` L137–138                                                 | Repeat-incident follow-up L156–159                                 | `recommendedActions[].rationale` (up to 3) L142–147, else source-review fallback L148–154 | **None** — `buildSteps()` signature has no parts input                                                                           |
| `highlights`       | Priority L179–181                                                            | Business risk L182–184, warranty L185–188, repeat failure L189–197 | Knowledge status + guidance confidence L198–217                                           | **Partial:** `Parts fulfillment` = `fulfillmentReadiness` L219–226; `Parts approvals` when `requiredApproval` count > 0 L227–235 |
| `basis`            | `"triage"` L25                                                               | `"customerContext"` L26                                            | `"knowledgeGuidance"` L27                                                                 | `"partsLogistics"` when channel present L28                                                                                      |

### Code citations — Node 4 touchpoints

**Wiring (complete):** `CaseTriageOrchestratorService.buildVerdict()` passes `partsLogistics`:

```624:637:apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts
  private static buildVerdict(
    result: CaseTriageStateType,
    status: NodeLifecycleStatus
  ): OrchestratorVerdict {
    return synthesizeOrchestratorVerdict({
      status,
      writeBackApplied: Boolean(result.writeBackApplied),
      approvalRequired: result.approvalRequired,
      approvalDecision: result.approvalDecision,
      triage: result.triage,
      customerContext: result.customerContext,
      knowledgeGuidance: result.knowledgeGuidance,
      partsLogistics: result.partsLogistics
    });
  }
```

**Synthesis (incomplete):** only `buildHighlights()` consumes Node 4:

```219:236:apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts
  const parts = input.partsLogistics;
  if (parts && parts.eligible !== false) {
    highlights.push({
      label: "Parts fulfillment",
      value:
        parts.fulfillmentReadiness ??
        (parts.degraded ? "Degraded" : (parts.status ?? "n/a"))
    });
    const approvals = (parts.partPlans ?? []).filter(
      (p) => p.requiredApproval
    ).length;
    if (approvals > 0) {
      highlights.push({
        label: "Parts approvals",
        value: `${approvals} required`
      });
    }
  }
```

**Tests:** `orchestrator-verdict.synthesizer.spec.ts` has zero Node 4 fixtures; all five tests cover Nodes 1–3 only.

---

## 3. Root cause

**Primary:** Implementation debt from shipping Node 4 after the Final Verdict slice.

The P3 Final Verdict backlog entry (`docs/orchestrator/service-workflow-remediation-backlog.md`) explicitly scoped synthesis to `triage`, `customerContext`, and `knowledgeGuidance` only. When Node 4 (`partsLogistics`) shipped, engineers:

- Added the channel to graph state and UI (`PartsLogisticsSummary`)
- Passed `partsLogistics` into `OrchestratorVerdictInput` and `buildVerdict()`
- Added minimal highlights (`Parts fulfillment`, `Parts approvals`)

…but did **not** extend the headline, summary, or step builders. The DTO header comment still says "Nodes 1-3" (`orchestrator-verdict.ts` L2–3), and the orchestration page subtitle still lists only Nodes 1–3 (`app/orchestration/page.tsx` L29).

**Secondary:** Step-budget ordering would matter after rollup. Today knowledge actions fill steps 2–4; a naïve append of parts steps at the end could be clipped at 6. The implementation prompt specifies inserting parts steps after knowledge but before generic write-back/repeat-incident steps.

---

## 4. Gap taxonomy

| Missing Node 4 signal                       | Classification                | Notes                                                                                        |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| Part number in headline/summary             | **Implementation debt**       | Safe field `partPlans[0].partNumber`                                                         |
| Transfer route WH-SJO-002 → WH-AUS-001      | **Implementation debt**       | Safe warehouse reference codes                                                               |
| ETA window / hours                          | **Implementation debt**       | `estimatedArrivalWindow` or `estimatedDispatchHoursMax`                                      |
| Transfer initiation recommended step        | **Implementation debt**       | `transferRequired` + warehouse refs                                                          |
| Approval step for parts                     | **Implementation debt**       | `requiredApproval` + `approvalReason`                                                        |
| Headline "parts transfer required"          | **Implementation debt**       | Spec'd in implement prompt                                                                   |
| Full `partPlans[]` card content in verdict  | **Intentional omission**      | Stays in `PartsLogisticsSummary`                                                             |
| `partPlans[].rationale` verbatim in verdict | **Partial safety constraint** | Rationale is sanitized but can echo stock counts; prefer templated rollup over raw rationale |
| `quantityOnHand` in verdict                 | **Intentional omission**      | Inventory detail; optional in highlights only if needed                                      |
| Asset serial / account id                   | **Safety constraint**         | Never in channel; must not be invented                                                       |
| Stripped by React `sanitizeVerdict`         | **Not a gap**                 | Client passes through any backend-generated parts text                                       |

---

## 5. Safe rollup inventory

From `PartsLogisticsChannel` and `PartLogisticsPlan` (`parts-logistics.ts`):

### Allowed in verdict text

| Field                                       | Use in verdict                                |
| ------------------------------------------- | --------------------------------------------- |
| `fulfillmentReadiness`                      | Headline clause, highlight (already used)     |
| `status`                                    | Fallback highlight when readiness absent      |
| `degraded` / `degradedSources`              | Summary clause; headline "inventory degraded" |
| `eligible` / `eligibilityReason`            | Summary when skipped                          |
| `partPlans[].partNumber`                    | Summary, steps, highlight                     |
| `partPlans[].partName`                      | Optional secondary (clip carefully)           |
| `partPlans[].exceptionType`                 | Summary for blocked/catalog_gap               |
| `partPlans[].transferRequired`              | Step trigger                                  |
| `partPlans[].sourceWarehouseReference`      | Summary, steps, highlight                     |
| `partPlans[].fulfillmentWarehouseReference` | Summary, steps, highlight                     |
| `partPlans[].estimatedArrivalWindow`        | Summary, highlight                            |
| `partPlans[].estimatedDispatchHoursMax`     | Summary fallback                              |
| `partPlans[].requiredApproval`              | Step + highlight                              |
| `partPlans[].approvalReason`                | Step text                                     |
| `partPlans[].availability`                  | Step branch (dispatch vs transfer)            |
| `etaSegments[].description`                 | Optional if already safe WH refs              |

### Forbidden

| Field                                               | Reason                                         |
| --------------------------------------------------- | ---------------------------------------------- |
| Asset serial numbers                                | PII / device identity                          |
| Account ids, customer names                         | PII                                            |
| Raw SOQL / inventory row payloads                   | Not in channel by design                       |
| `compatibilityEvidence` if it ever contained serial | Currently product-code only — prefer templates |
| Full `rationale` if it echoes KB chunk text         | Use deterministic templates instead            |

### Live `rationale` safety review (Case 500g500000YpQMnAAN pattern)

Planner output for inter-warehouse transfer (from `parts-logistics-planner.service.ts` L312–314):

> `No stock at fulfillment warehouse WH-AUS-001; N available at WH-SJO-002. Plan in-region transfer WH-SJO-002 → WH-AUS-001.`

**Safe to paraphrase in verdict; do not copy verbatim** — templated rollup is clearer and avoids stock-count leakage. Incompatible-plan rationale includes `assetProductCode` (e.g. `AV-LP-15X-PRO`) which is a product code, not a serial — acceptable if needed but prefer exception type wording.

---

## 6. Operator narrative scenarios

Deterministic copy proposals (no LLM). Primary plan = `partPlans[0]`; `+N more` when `partPlans.length > 1`.

| Scenario                                                   | Expected operator takeaway                      | Proposed headline clause    | Proposed summary sentence                                                                                      | Proposed step(s)                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `fulfillmentReadiness=ready`, local stock                  | Part available at fulfillment WH                | `parts available`           | `Parts plan: SP-BATT-15X is available at WH-AUS-001.`                                                          | `Dispatch SP-BATT-15X from WH-AUS-001.`                                                                    |
| `fulfillmentReadiness=partial`, `inter_warehouse_transfer` | Transfer required; name source → dest           | `parts transfer required`   | `Parts plan: SP-DISP-15X-FHD requires inter-warehouse transfer from WH-SJO-002 to WH-AUS-001 (ETA up to 41h).` | `Initiate inter-warehouse transfer for SP-DISP-15X-FHD from WH-SJO-002 to WH-AUS-001.`                     |
| `fulfillmentReadiness=blocked`, `catalog_gap`              | No fulfillable part; escalate                   | `parts fulfillment blocked` | `Parts fulfillment blocked for SP-UNKNOWN (catalog_gap).`                                                      | `Review catalog gap for requested part; manual sourcing required.`                                         |
| `degraded=true`                                            | Inventory unavailable; do not imply stock truth | `parts inventory degraded`  | `Parts logistics ran in degraded mode; inventory reads were incomplete.`                                       | (none implying stock)                                                                                      |
| `eligible=false`                                           | Skipped — no parts plan implied                 | (none)                      | `Parts logistics was not eligible for this case.`                                                              | (none with part numbers)                                                                                   |
| `requiredApproval=true` on a plan                          | Surface in highlights + step                    | (existing readiness clause) | (transfer/ready sentence as above)                                                                             | `Approve parts action: SP-DISP-15X-FHD (cross_region_transfer).` + highlight `Parts approvals: 1 required` |
| Multiple `partPlans`                                       | Cap wording                                     | `parts transfer required`   | `Parts plan: SP-DISP-15X-FHD requires transfer WH-SJO-002 → WH-AUS-001 (+1 more part).`                        | Primary plan step only; detail in stage panel                                                              |

### Live Case `500g500000YpQMnAAN` — current vs target

**Observed today (from console + channel shape in `docs/context/node4-auth-session-lessons.md`):**

| Field       | Current verdict                                                 | `partsLogistics` channel                                            |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Headline    | e.g. `High priority case · knowledge guidance available`        | —                                                                   |
| Summary     | Triage + knowledge + write-back only                            | —                                                                   |
| Steps       | Triage next step + KB `recommendedActions` + write-back confirm | —                                                                   |
| Highlights  | `Parts fulfillment: partial`                                    | `fulfillmentReadiness: partial`                                     |
| Stage panel | —                                                               | `SP-DISP-15X-FHD`, transfer `WH-SJO-002 → WH-AUS-001`, ETA segments |

**Target after rollup (deterministic):**

- **Headline:** `… · parts transfer required`
- **Summary:** `Parts plan: SP-DISP-15X-FHD requires inter-warehouse transfer from WH-SJO-002 to WH-AUS-001 (ETA up to 41h).`
- **Step:** `Initiate inter-warehouse transfer for SP-DISP-15X-FHD from WH-SJO-002 to WH-AUS-001.`
- **Highlights:** add `Primary part: SP-DISP-15X-FHD`, `Transfer: Yes (WH-SJO-002 → WH-AUS-001)`, `Parts ETA: 26–41 hours (inter-warehouse transfer)`

---

## 7. Consistency with Node 3 pattern

Node 3 integration points in `orchestrator-verdict.synthesizer.ts`:

| Concern    | Node 3 pattern                                   | Node 4 parallel                                                                                   |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Headline   | Clause when `knowledgeAnswered` L74–76           | Clause when `eligible && fulfillmentReadiness` (and degraded variant)                             |
| Summary    | Appended sentence after triage/risk L97–106      | Appended sentence after knowledge block                                                           |
| Steps      | Prefer `recommendedActions[].rationale` L142–147 | Append templated steps from `partPlans[0]` (approval, transfer, dispatch, backorder, catalog_gap) |
| Highlights | Status + `guidanceConfidence` L198–217           | Extend existing block: primary part, WH, transfer, ETA L219–236                                   |
| Basis      | `"knowledgeGuidance"` L27                        | `"partsLogistics"` L28 (already done)                                                             |
| Tests      | Multiple scenarios in spec                       | Mirror with `partsLogisticsPartialTransfer` fixture                                               |

**Duplication boundary:** Verdict = executive rollup (one part, one transfer, one ETA). `PartsLogisticsSummary` keeps per-plan cards, `etaSegments[]`, compatibility evidence, and full rationale.

---

## 8. Length and clipping constraints

From `synthesizeOrchestratorVerdict()` L50–54:

| Limit      | Value                 | Node 4 impact                                                                                                                                               |
| ---------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headline   | 160 chars             | Add ` · parts transfer required` (~25 chars); clip trailing clauses if over budget (drop knowledge before parts if needed — parts ops often higher urgency) |
| Summary    | 400 chars             | Transfer sentence ~100–120 chars; fits after triage + knowledge                                                                                             |
| Step       | 240 chars each, max 6 | Transfer step ~80 chars; approval step ~60 chars                                                                                                            |
| Highlights | max 8                 | Currently ~6 with Node 4 minimal; +3 parts highlights may need highlight priority (drop warranty before parts)                                              |

**Truncation priority when over budget:**

1. Keep: triage `suggestedNextStep`, parts approval step, parts transfer step
2. Keep: parts summary sentence (primary operator gap)
3. Trim: generic write-back confirm, repeat-incident generic step
4. Trim: knowledge source-review fallback (not needed when `recommendedActions` present)
5. Clip: headline clauses (risk before knowledge before parts readiness label)

---

## 9. UI impact

| Layer                                        | Change needed? | Detail                                                              |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| `orchestrator-verdict.synthesizer.ts`        | **Yes**        | Headline, summary, steps, extended highlights                       |
| `orchestrator-verdict.synthesizer.spec.ts`   | **Yes**        | ≥7 new scenario tests                                               |
| `orchestrator-verdict.ts` comment            | **Yes**        | Nodes 1–3 → Nodes 1–4                                               |
| `orchestration-status-event.ts` comment      | **Yes**        | Same header update L129                                             |
| `service-workflow-remediation-backlog.md`    | **Yes**        | Note Node 4 rollup                                                  |
| `lib/orchestration.ts` `sanitizeVerdict`     | **No**         | Already allows arbitrary highlight labels/values within length caps |
| `OrchestrationView.tsx` `FinalVerdict`       | **No**         | Renders whatever backend sends                                      |
| `OrchestrationView.tsx` footer copy L552–555 | **Optional**   | Add "and parts logistics" to operator note                          |
| `app/orchestration/page.tsx` subtitle L29    | **Yes**        | Mention Node 4                                                      |
| E2E / snapshot tests                         | **Optional**   | Assert verdict contains part number when parts eligible             |

---

## 10. Live proof cross-check

**Status:** Live snapshot fetch was not run in this analysis session (production JWT mint requires explicit operator approval).

**Inferred cross-check** from documented live proof (`docs/context/node4-auth-session-lessons.md`, sibling workflow `wf-1efb4e89-…` on the same Case):

```json
{
  "partsLogistics": {
    "eligible": true,
    "degraded": false,
    "status": "PARTIAL",
    "fulfillmentReadiness": "partial",
    "partPlans": [
      {
        "partNumber": "SP-DISP-15X-FHD",
        "exceptionType": "inter_warehouse_transfer",
        "transferRequired": true,
        "sourceWarehouseReference": "WH-SJO-002",
        "fulfillmentWarehouseReference": "WH-AUS-001"
      }
    ]
  },
  "orchestratorVerdict": {
    "highlights": [{ "label": "Parts fulfillment", "value": "partial" }],
    "basis": [
      "triage",
      "customerContext",
      "knowledgeGuidance",
      "partsLogistics"
    ]
  }
}
```

**Field-by-field:** only `basis` and `highlights[Parts fulfillment]` reflect Node 4; headline, summary, and `recommendedSteps` are indistinguishable from a Nodes 1–3-only workflow.

**Operator verification command** (when approved):

```bash
MAINT_TOKEN=$(railway run --service ai-api --environment production \
  node scripts/smoke/phase4-mint-jwt.mjs --purpose maintenance \
  --tenant tenant-demo --namespace customer-self-service --ttl-seconds 3600)

curl -sS -H "authorization: Bearer $MAINT_TOKEN" \
  "https://ai-api-production-03f5.up.railway.app/orchestrator/case-triage/wf-4e82f0a8-e3c8-41a4-9eb2-4f0ca6583cce" \
  | node scripts/smoke/parse-orchestrator-snapshot.mjs --summary
```

---

## 11. Recommended rollup contract

Deterministic rules (full spec: `.github/prompts/implement-node4-verdict-rollup.prompt.md`):

### Headline (`buildHeadline`)

When `partsLogistics.eligible !== false`:

| Condition                            | Append                      |
| ------------------------------------ | --------------------------- |
| `fulfillmentReadiness === 'ready'`   | `parts available`           |
| `fulfillmentReadiness === 'partial'` | `parts transfer required`   |
| `fulfillmentReadiness === 'blocked'` | `parts fulfillment blocked` |
| `degraded === true`                  | `parts inventory degraded`  |
| `eligible === false`                 | (nothing)                   |

### Summary (`buildSummary`)

One sentence after knowledge block, using `partPlans[0]`:

- **partial + transfer:** `Parts plan: {partNumber} requires inter-warehouse transfer from {sourceWH} to {fulfillmentWH} (ETA up to {hoursMax}h).`
- **ready:** `Parts plan: {partNumber} is available at {fulfillmentWH}.`
- **blocked:** `Parts fulfillment blocked for {partNumber} ({exceptionType}).`
- **degraded:** `Parts logistics ran in degraded mode; inventory reads were incomplete.`
- **skipped:** `Parts logistics was not eligible for this case.`

Append ` (+N more)` when `partPlans.length > 1`.

### Recommended steps (`buildSteps`)

After triage + knowledge actions, before repeat-incident / write-back:

1. Approval required → `Approve parts action: {partNumber} ({approvalReason}).`
2. `transferRequired` → `Initiate inter-warehouse transfer for {partNumber} from {sourceWH} to {fulfillmentWH}.`
3. Else `availability === 'available'` → `Dispatch {partNumber} from {fulfillmentWH}.`
4. Else `exceptionType === 'backorder'` → `Create backorder request for {partNumber}.`
5. Else `exceptionType === 'catalog_gap'` → `Review catalog gap for requested part; manual sourcing required.`

Cap at 6 steps total; drop lowest-priority generic steps first.

### Highlights (`buildHighlights`)

Keep `Parts fulfillment`. Add when eligible:

| Label            | Value                                         |
| ---------------- | --------------------------------------------- |
| `Primary part`   | `partPlans[0].partNumber`                     |
| `Fulfillment WH` | `partPlans[0].fulfillmentWarehouseReference`  |
| `Transfer`       | `Yes ({source} → {dest})` or `No`             |
| `Parts ETA`      | `estimatedArrivalWindow` or `{hoursMax}h max` |

---

## 12. Test matrix

| Test case                                      | Assert                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `partsLogisticsPartialTransfer` (live mirror)  | Headline has `parts transfer required`; summary has part + WH refs; step has transfer; highlights include `Primary part` |
| `fulfillmentReadiness=ready`                   | Headline `parts available`; dispatch step                                                                                |
| `fulfillmentReadiness=blocked` + `catalog_gap` | Headline `parts fulfillment blocked`; catalog step                                                                       |
| `degraded=true`                                | Summary mentions degraded; no definitive stock wording                                                                   |
| `eligible=false`                               | No part numbers in headline/summary/steps; optional skip sentence                                                        |
| `requiredApproval=true`                        | Approval step + `Parts approvals` highlight                                                                              |
| Multiple `partPlans`                           | Summary includes `+N more`; single primary step                                                                          |
| PII regression                                 | Serialized verdict JSON excludes patterns matching account id / serial (extend existing knowledge test style)            |
| `basis`                                        | Includes `partsLogistics` when channel present                                                                           |

---

## 13. Out of scope (stays in `PartsLogisticsSummary` only)

- Full `partPlans[]` list with per-plan rationale paragraphs
- `etaSegments[]` leg-by-leg breakdown
- `compatibilityEvidence` detail
- `quantityOnHand` and low-stock threshold logic
- `candidateSources`, `provider`, `latencyMs`
- Raw JSON collapsible for `partsLogistics`

---

## 14. DTO comment update — go/no-go

| File                                         | Current                    | Decision                                       |
| -------------------------------------------- | -------------------------- | ---------------------------------------------- |
| `orchestrator-verdict.ts` L2–3               | "after Nodes 1-3 complete" | **GO** — update to Nodes 1–4 when rollup ships |
| `orchestration-status-event.ts` L129         | "after Nodes 1-3"          | **GO** — same                                  |
| `lib/orchestration.ts` L210                  | "after Nodes 1-3"          | **GO** — same                                  |
| `service-workflow-remediation-backlog.md` P3 | "after Nodes 1-3"          | **GO** — amend shipped note                    |

---

## 15. Implementation handoff

**Next prompt:** `.github/prompts/implement-node4-verdict-rollup.prompt.md`

**Primary file:** `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`

**Validation:**

```bash
npm run ai-api:test -- --testPathPattern=orchestrator-verdict
npm run react-chat:typecheck
```

**Live proof after deploy:**

```bash
SF_CASE_ID=500g500000YpQMnAAN ./scripts/smoke/all-3-nodes-deployed.sh
```

---

## Acceptance checklist (analysis pass)

- [x] Every verdict field mapped to contributing nodes with code citations
- [x] Safety review: no PII fields proposed for verdict promotion
- [x] 7 scenario rows in section 6 with proposed copy
- [x] Clear go on DTO header comment update (section 14)
- [x] Findings doc committed on `IMP-NODE-4` — pending user commit request

---

## 16. Implementation status (2026-06-15)

**Shipped on `IMP-NODE-4`:**

- `buildHeadline()` — parts readiness / degraded clauses
- `buildSummary()` — templated parts sentence after knowledge block
- `buildSteps()` — approval, transfer, dispatch, backorder, catalog_gap steps with 6-step budget trimming
- `buildHighlights()` — Primary part, Fulfillment WH, Transfer, Parts ETA
- DTO / status-event / React `orchestration.ts` comments updated to Nodes 1–4
- `orchestration/page.tsx` subtitle mentions Node 4
- `orchestrator-verdict.synthesizer.spec.ts` — Node 4 scenario matrix

# Node 4 — Phase 4b + 4c Implementation Plan

> **Document type:** Implementation plan for Node 4 sub-phases **4b (KB warehouse cross-check)** and **4c (gated Salesforce fulfillment writes after approval)**.
> **Branch:** `IMP-NODE-4`. **Builds on:** shipped Phase **4a** (read/plan slice — `partsLogistics` channel, `SalesforceInventoryGateway`, fulfillment-location-first planner, multi-segment ETA, graph `parts` node, verdict rollup, React stage, smoke).
> **Companion:** [`node-4-parts-logistics-phase-plan.md`](./node-4-parts-logistics-phase-plan.md) (§6.5–§7.6 ETA/exception model, §7.5 approval matrix, §8.5 Apex responsibilities, §12.C 4c acceptance).
> **Status note:** Phases **4a**, **4b**, and **4c** are shipped on `AgentForce` (2026-06-15 live proof). See companion phase plan §0.1.

## Decisions (locked 2026-06-15)

| Decision               | Choice                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **4c write execution** | Apex `AgentforcePartsFulfillmentService` does idempotent, bulk-safe, FLS-aware DML; exposed via a thin Apex `@RestResource`. NestJS calls it via REST **after approval**. Salesforce owns the write + idempotency.                                                                                                                                                                                           |
| **4c approval gate**   | **Reuse the existing gate/resume.** Extend `requiresApproval` to also return true when any `partsLogistics.partPlans[]` has `requiredApproval: true`. Extend the `writeBack` node to call fulfillment alongside the triage Case write-back when `approvalDecision === "approved"`. Node 4 stays non-interrupting; no second interrupt. Interim until Node 6 — one approval surface for triage + parts in v1. |
| **Org deploy**         | Implement + `sf project deploy validate` (dry-run) + unit/Apex tests only. **No live deploy** this session (OAuth pre-flight failing). Live deploy + run-as perm assignment documented as ops follow-up.                                                                                                                                                                                                     |
| **4b KB source**       | Deterministic embedded **part-code → documented-warehouse-refs** map derived from the KB corpus (`inventoryReferences × locationReferences`), mirroring `parts-logistics-transit-rules.ts`. **Audit-only** alignment — does not change fulfillment selection or readiness. No Node 3 changes.                                                                                                                |

---

## Phase 4b — KB warehouse cross-check (audit-only)

**Goal:** For each planned part, record whether the planner's chosen fulfillment warehouse is one the KB documents as handling that part (`locationReferences`). Pure signal for observability and the verdict; never mutates availability, readiness, ETA, or approval.

### Contract additions — `apps/ai-api/src/orchestrator/dto/parts-logistics.ts`

```ts
export type KbWarehouseAlignment = "aligned" | "divergent" | "unknown";

// PartLogisticsPlan (additive, all optional):
kbDocumentedWarehouses?: string[];        // from corpus, e.g. ["WH-SJO-002"]
kbWarehouseAlignment?: KbWarehouseAlignment;
kbCrossCheckNote?: string;                // safe, audit-only

// PartsLogisticsChannel (additive, optional):
kbCrossCheck?: {
  status: "ALIGNED" | "DIVERGENT" | "UNDOCUMENTED" | "SKIPPED";
  alignedCount: number;
  divergentCount: number;
  undocumentedCount: number;
};
```

- `aligned` — chosen fulfillment WH ∈ documented set.
- `divergent` — KB documents specific WHs for the part, but the chosen WH is **not** among them.
- `unknown` — part has no KB `locationReferences` (undocumented) **or** no fulfillment WH was chosen.

### New files

- `apps/ai-api/src/orchestrator/parts-kb-location-references.ts` — embedded map (mirrors the transit-rules pattern; JSON corpus stays the human source of truth) + `kbDocumentedWarehousesFor(partCode): string[]`. Embedded data (union of `locationReferences` over corpus articles referencing each part):

  | Part                                                                            | Documented WHs                                 |
  | ------------------------------------------------------------------------------- | ---------------------------------------------- |
  | SP-BATT-15X, SP-CHG-65W, SP-DISP-15X-FHD, SP-FAN-15X, SP-MB-15X, SP-RAM-16-DDR5 | WH-AUS-001, WH-FRA-004, WH-JCY-003, WH-SJO-002 |
  | SP-HEAT-15X, SP-SSD-1TB-NVME                                                    | WH-AUS-001, WH-FRA-004, WH-SJO-002             |
  | SP-HINGE-15X                                                                    | WH-FRA-004, WH-SJO-002                         |
  | SP-KBD-15X                                                                      | WH-AUS-001, WH-SJO-002                         |
  | SP-TPAD-15X                                                                     | WH-SJO-002                                     |

- `apps/ai-api/src/orchestrator/parts-kb-crosscheck.ts` — pure `crossCheckKbWarehouses(partPlans): { annotated, summary }`. Annotates each plan and computes the channel aggregate.

### Wiring

- `PartsLogisticsPlannerService.plan()` calls the cross-check after building `partPlans`, attaches per-part fields + `kbCrossCheck`. Degraded reads → `kbCrossCheck.status = "SKIPPED"`.
- `orchestrator-verdict.synthesizer.ts` — add a `KB alignment` highlight (e.g. `aligned 3 / divergent 1`) and a divergence note in the parts summary when `divergentCount > 0`.
- `case-triage.graph.ts` — extend `buildPartsPlanTrace` to include per-part alignment (audit trace only).

### UI / smoke / tests

- React `OrchestrationView.tsx` (`PartsLogisticsSummary`) — render per-part alignment badge + aggregate row; `lib/orchestration.ts` types + `sanitizePartsLogistics`.
- `scripts/smoke/all-3-nodes-deployed.sh` — extract + assert `partsLogistics.kbCrossCheck.status` ∈ {ALIGNED,DIVERGENT,UNDOCUMENTED} when parts eligible.
- Tests: planner spec (aligned/divergent/unknown/skipped), verdict spec (highlight + divergence note), kb-crosscheck unit spec.

---

## Phase 4c — Gated Salesforce fulfillment writes (after approval)

**Goal:** When the workflow is approved and a part plan needs a write, create the Salesforce records: `ProductTransfer` (source → fulfillment WH) for `inter_warehouse_transfer`, `ProductRequest` + `ProductRequestLineItem` (DestinationLocationId = fulfillment WH) for `backorder`; update `Case.Parts_Fulfillment_Status__c`. Idempotent on `Orchestrator_Workflow_Id__c` + part code.

### Salesforce (executor — Apex owns DML)

- `force-app/main/default/classes/AgentforcePartsFulfillmentService.cls` — `public with sharing`:
  - `@InvocableMethod createFulfillments(List<FulfillmentRequest>)` (Agentforce / Flow / future Node 6) + a static `apply(...)` core.
  - Idempotent: query existing `ProductRequest`/`ProductTransfer`/`ProductRequestLineItem` by `Orchestrator_Workflow_Id__c` + part code before insert; skip duplicates.
  - Bulk-safe `Database.insert(records, false)`; per-line status; updates `Case.Parts_Fulfillment_Status__c` + `AI_Parts_Plan_Summary__c`.
- `force-app/main/default/classes/AgentforcePartsFulfillmentRest.cls` — `@RestResource(urlMapping='/agentforce/parts-fulfillment/*')`, `@HttpPost` → parses the approved payload → `AgentforcePartsFulfillmentService.apply(...)` → safe JSON result. This is the NestJS entry point.
- `*Test.cls` for both — fixture Case/Account/Location/Product2/ProductItem; assert ProductRequest/Transfer created, idempotency (second call no-ops), Case status updated, FLS/`with sharing` honored. (DML tests, not HTTP mocks.)
- `genAiFunctions/Create_Parts_Fulfillment/...` — **deferred.** The invocable takes a nested `List<FulfillmentItem>`, which the genAiFunction input schema models awkwardly and risks a failed `deploy validate`. Not on the critical 4c path (NestJS → Apex REST). Add when an Agentforce-conversational parts-write action is needed; the `@InvocableMethod` already exists for Flow/Node 6 use.
- `flows/Case_Parts_Backorder_Notification` — record-triggered on `ProductRequest` insert with `CaseId`; Chatter/email to inventory coordinator (plan E2).
- Perm sets — the read/plan perm set `Agentforce_Parts_Logistics_Node4` stays read-only (validates without the Field Service license). The license-gated **write** grants (create/edit on `ProductRequest`, `ProductRequestLineItem`, `ProductTransfer` + the new `Orchestrator_Workflow_Id__c` field perms) live in a **separate** perm set `Agentforce_Parts_Fulfillment_Writes`, assigned to the AI API run-as user **once a Field Service permission set license is in place**. Quantity field on `ProductTransfer` is `QuantitySent` (verified via `sf sobject describe`, not `QuantityToTransfer`).

> **Org reality (validated against `Agent` 2026-06-15):** creating a `ProductRequest` requires a Field Service PSL the bare admin lacks, so the writes perm set and the live backorder insert are **ops-gated**. The `ProductTransfer` path validates and inserts; the backorder path compiles and is exercised by tests but degrades to `planned` until the PSL is assigned. The Apex tests assert the transfer path strictly and tolerate the backorder license gate.

### NestJS (orchestration — calls the executor)

- `apps/ai-api/src/orchestrator/dto/parts-fulfillment.ts` — `PartsFulfillmentCommand` (workflowId, caseId, items[: partNumber, quantity, exceptionType, fulfillment/source WH refs, approvalReason]) + `PartsFulfillmentResult` (per-item: created, recordType, recordId|null, idempotentSkip, reservationStatus).
- `apps/ai-api/src/salesforce/salesforce-fulfillment.gateway.ts` — `SalesforceFulfillmentGateway` modeled on `SalesforceCaseGateway`: `POST {instanceUrl}/services/apexrest/agentforce/parts-fulfillment` with bearer token, 401-retry, `assertOk`, degrade-safe (never throws into the graph). Registered/exported from `salesforce.module.ts`.
- Config: `AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED` (default false) in `app-config.service.ts` → `config.orchestrator.partsLogistics.writesEnabled`. Writes are a no-op unless enabled (and reads still work).

### Graph + service wiring

- `case-triage.graph.ts`:
  - `CaseTriageGraphDeps.requiresApproval(triage, partsLogistics?)` — gate node passes `state.partsLogistics`; returns true if triage requires it **or** any part plan `requiredApproval`.
  - `writeBack` node: after the triage write-back, call new dep `applyPartsFulfillment(state)` when `approvalDecision === "approved"`; merge returned `reservationStatus`/write outcomes back into the `partsLogistics` channel state.
- `case-triage-orchestrator.service.ts`:
  - Implement `requiresApproval(triage, partsLogistics)` and `applyPartsFulfillment(state)` → builds `PartsFulfillmentCommand` from approvable plans → `SalesforceFulfillmentGateway` → updates channel `reservationStatus` (`transfer_pending` / `backorder_requested` / `reserved`) and re-runs the verdict.
  - Inject `SalesforceFulfillmentGateway`; register in `orchestrator.module.ts`.
- `dto/parts-logistics.ts` — `reservationStatus` already supports `reserved | transfer_pending | backorder_requested`; add optional per-plan `fulfillmentRecordId?` / `fulfillmentRecordType?` and a channel `writeOutcome?` summary for the read model.

### Verdict / UI / smoke / tests

- `orchestrator-verdict.synthesizer.ts` — when writes applied, reflect outcome ("Transfer initiated WH-FRA-004 → WH-AUS-001", "Backorder requested") in summary/steps/highlights; otherwise current planned language.
- React — render `reservationStatus` + write outcome per part; types + sanitize.
- Smoke — behind `ASSERT_PARTS_WRITES=1` (default off; live deploy gated), assert `reservationStatus` transitions; document.
- Tests: fulfillment gateway spec (mock Apex REST 2xx / 401-retry / degrade), graph writeBack test (`applyPartsFulfillment` called when approved + parts need writes; **not** called on reject), orchestrator service spec (requiresApproval parts trigger; channel merge), verdict spec, Apex tests.

---

## Acceptance (maps to companion §12.C + checklist)

| #    | Criterion                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 4b-1 | Each plan carries `kbWarehouseAlignment`; channel carries `kbCrossCheck`; audit-only (no readiness/ETA change). |
| 4b-2 | Divergent case (e.g. SP-TPAD-15X fulfilled at WH-AUS-001) flagged `divergent`. Degraded read → `SKIPPED`.       |
| 4b-3 | Verdict highlight + React + smoke surface the cross-check.                                                      |
| C1   | Approved backorder → `ProductRequest` + line, `CaseId`, `DestinationLocationId` = fulfillment WH.               |
| C2   | Approved transfer → `ProductTransfer` source → fulfillment WH (not direct remote→customer).                     |
| C3   | `Case.Parts_Fulfillment_Status__c` updated.                                                                     |
| C4   | Idempotent on `Orchestrator_Workflow_Id__c` + part code.                                                        |
| C5   | Writes only after `approvalDecision === "approved"`; reject path writes nothing.                                |

## Validation gates

`npm run ai-api:test` · `npm run ai-api:typecheck` · `npm run ai-api:build` · `npm run react-chat:typecheck` · `npm run prettier:verify` · `sf project deploy validate` (changed metadata, dry-run) · `sf apex run test` (CI / post-ops-fix). Update companion §0.1 status matrix + §13 roadmap; complete `new-node-phase-completion-checklist.md` for the new surfaces.

## Ops follow-up (Phase 4c live — 2026-06-15)

**Completed:**

- Live deploy via `./scripts/sf/node4-4c-deploy.sh AgentForce chaudhary.keshav4u@gmail.com`
- Field Service Standard PSL + `Agentforce_Parts_Fulfillment_Writes` assigned to OAuth run-as user
- Railway `AI_API_ORCHESTRATOR_PARTS_WRITES_ENABLED=true` + ai-api redeployed
- Live smoke: `ASSERT_PARTS_WRITES=1 SF_CASE_ID=500g500000YpQMnAAN` — **PASSED** (workflow `wf-2ffe979b-8f1e-423a-aed9-8966fceab8a3`, `ProductTransfer` created)

**Still manual / optional:**

- `Case_Default_Service_Ship_To` Flow + Case layout related lists (companion §0.7)
- `Create_Parts_Fulfillment` genAiFunction (deferred — NestJS→Apex REST is the production path)
- Remove `Agentforce_Parts_Logistics_Node4` from `integration@00dg5000005qpuneaa.com` if still assigned (see auth lessons)

See [`node4-auth-session-lessons.md`](../context/node4-auth-session-lessons.md) for OAuth troubleshooting.

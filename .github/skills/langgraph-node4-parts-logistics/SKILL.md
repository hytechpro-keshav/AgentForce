---
name: langgraph-node4-parts-logistics
description: >-
  Implement Phase 4a Node 4 Parts & Logistics in the NestJS AI orchestrator:
  SalesforceInventoryGateway, partsLogistics channel, fulfillment-location-first
  planner, multi-segment ETA, graph node wiring, UI observability, and focused tests.
  Use after Phase 4-Pre Salesforce prep is validated on org AgentForce.
argument-hint: "Phase scope (4a default), org alias, demo Case id, and whether live SF inventory proof is required"
user-invocable: true
---

# LangGraph Node 4 — Parts & Logistics (Phase 4a)

Implement the **read/plan slice** for orchestrator Node 4 after Phase 4-Pre Salesforce prep is complete. Node 4 is **non-interrupting** and performs **no Salesforce writes** in Phase 4a.

## Use this skill for

- "implement Node 4 parts logistics"
- "add partsLogistics channel"
- "SalesforceInventoryGateway"
- "parts logistics planner"
- "Phase 4a orchestrator"
- any request to wire inventory reads and fulfillment planning after knowledge

## Do NOT use this skill for

- Phase 4-Pre Salesforce metadata deploy (use `salesforce-node4-parts-prep`)
- Phase 4c gated ProductRequest / ProductTransfer writes (post Node 6 approval)
- Phase 4b KB warehouse cross-check (separate slice)
- Broad Nodes 5–8 design

## Required references (read in order)

1. [Node 4 phase plan](../../../docs/orchestrator/node-4-parts-logistics-phase-plan.md) — **§0 first** (shipped 4-Pre state), then §3, §6.5–§7.6, §10–§12, §14
2. [Orchestrator flow](../../../docs/orchestrator/case-triage-orchestrator-flow.md)
3. [Knowledge guidance contract](../../../apps/ai-api/src/orchestrator/dto/knowledge-guidance.ts) — upstream input shape
4. [Salesforce case context](../../../apps/ai-api/src/orchestrator/dto/salesforce-case-context.ts) — extend for Asset + ship-to
5. [Case triage graph](../../../apps/ai-api/src/orchestrator/case-triage.graph.ts) — mirror Node 3 pattern
6. [Salesforce case gateway](../../../apps/ai-api/src/salesforce/salesforce-case.gateway.ts)
7. [Customer gateway pattern](../../../apps/ai-api/src/salesforce/salesforce-customer.gateway.ts)
8. Transit rules fallback: [`data/warehouse-transit-rules.json`](../../../data/warehouse-transit-rules.json)
9. Seed inventory: [`data/products-and-location-data.json`](../../../data/products-and-location-data.json)

## Pre-flight (must pass before coding)

Run on org alias **`AgentForce`** unless the user specifies another org:

```bash
./scripts/sf/node4-pre-validation.sh AgentForce
```

Confirm from phase plan §0.7 / §16:

- **`Agentforce_Parts_Logistics_Node4`** assigned to **AI API OAuth run-as user** (not just CLI admin)
- Do **not** redo completed 4-Pre metadata deploy unless validation fails
- Inter-WH transit: use `data/warehouse-transit-rules.json` fallback if CMT inter-WH rows are not yet in org

If validation fails or AI API user lacks FLS, stop and report the blocker. Do not substitute mock inventory as the claimed proof path.

## Phase 4a deliverables

| Component         | Path                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| DTO               | `apps/ai-api/src/orchestrator/dto/parts-logistics.ts`                              |
| Inventory gateway | `apps/ai-api/src/salesforce/salesforce-inventory.gateway.ts`                       |
| Planner service   | `apps/ai-api/src/orchestrator/parts-logistics-planner.service.ts`                  |
| Graph node        | `partsLogistics` in `case-triage.graph.ts`                                         |
| Lifecycle id      | extend `case-triage-lifecycle.ts` with `PARTS_LOGISTICS_NODE_ID`                   |
| Case gateway      | extend `SalesforceCaseGateway` + `SalesforceCaseContext` for Asset + ship-to       |
| Config            | `AI_API_ORCHESTRATOR_PARTS_ENABLED` (or equivalent in `AppConfigService`)          |
| UI                | extend `apps/react-chat-window` orchestration view for Node 4 cards                |
| Tests             | planner unit tests, gateway tests (mocked SF), graph node tests, UI sanitize tests |

## Graph placement

```
START → readContext → runTriage → customerHistory → knowledge → partsLogistics → gate → …
```

Node 4 runs **after** `knowledge`, **before** the approval gate. It writes **only** `partsLogistics`. Never call `interrupt()`.

## Planner rules (non-negotiable)

1. **Fulfillment-location-first** (§6.6): select fulfillment WH from Case ship-to region before stock check
2. **Multi-segment ETA** (§6.5): Scenario A (local stock), B (inter-WH transfer), C (backorder)
3. **Key on `ProductCode` + `Location.ExternalReference`** — never `Product2.Id`
4. **Remote stock ≠ available**: if stock is at source WH, set `transferRequired: true`, `exceptionType: inter_warehouse_transfer`
5. **Deprecated**: `alternate_warehouse` — use `inter_warehouse_transfer`
6. **Never throw** on inventory read failure — write `degraded: true`, `fulfillmentReadiness: unknown`, continue graph
7. **No Salesforce writes** in 4a — `reservationStatus` stops at `planned`

## Part candidate sources

Collect part codes from (in priority order):

1. `knowledgeGuidance.answer.suggestedParts[]`
2. `knowledgeGuidance.answer.recommendedActions[]` where action is `replace_part`
3. Case subject/description regex fallback (only when knowledge skipped or empty)

## Acceptance criteria (Phase 4a — §12.B)

| #   | Must prove                                                                                |
| --- | ----------------------------------------------------------------------------------------- |
| B1  | Node runs after knowledge; non-interrupting                                               |
| B2  | Writes only `partsLogistics`                                                              |
| B3  | Keys on ProductCode + ExternalReference                                                   |
| B4  | Battery Case (Austin): Scenario A when stock at fulfillment WH                            |
| B5  | Cross-region FRA→AUS transfer: multi-segment ETA, `approvalReason: cross_region_transfer` |
| B6  | OOS SKU → backorder, `fulfillmentReadiness: blocked`, no throw                            |
| B7  | SF read failure → degraded, graph continues                                               |
| B8  | Fulfillment WH selected before stock check                                                |
| B9  | Remote stock never `availability: available` without `transferRequired: true`             |

Use demo matrix §14 for regression scenarios.

## Workflow

1. Read §0 of phase plan — confirm 4-Pre shipped; list open pre-reqs from §0.7
2. Run validation script; stop if it fails
3. Extend `SalesforceCaseContext` + gateway SOQL (Asset + ship-to fields)
4. Implement `SalesforceInventoryGateway` with bulk-safe ProductItem SOQL
5. Implement `PartsLogisticsPlannerService` (deterministic, no LLM for stock/ETA math)
6. Add `parts-logistics.ts` DTO matching §11 contract exactly
7. Wire `partsLogistics` node in graph + orchestrator service deps
8. Extend status store, repository, and orchestration DTOs for the new channel
9. Add read-only UI card in `OrchestrationView.tsx` + sanitize in `orchestration.ts`
10. Add focused tests; run `npm run ai-api:test` and `npm run react-chat:typecheck`
11. Prove live inventory read against `AgentForce` org (or report exact blocker)

## Safety rules

- Do not bypass `ModelRouter` for any LLM calls (Node 4 planner is deterministic — prefer no LLM)
- Do not log raw case text, inventory PII, or full SOQL result payloads
- Do not create ProductRequest, ProductTransfer, or Shipment records in 4a
- Do not mutate `triage`, `customerContext`, or `knowledgeGuidance` channels
- Do not block the graph on parts planning failure
- Do not parse compatibility from Product2.Description — use `Compatible_Product_Code__c`

## Output checklist

Return:

- pre-flight validation result (or blocker)
- contracts added/changed
- services, gateway, graph node, and UI surfaces changed
- demo scenarios exercised (§14 matrix)
- validation commands run and outcomes
- residual gaps intentionally left for 4b/4c
- exact next step (4b KB cross-check or 4c gated writes)

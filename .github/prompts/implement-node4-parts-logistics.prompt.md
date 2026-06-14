---
name: "Implement Node 4 Parts Logistics"
description: "Implement Phase 4a Node 4 Parts & Logistics: inventory gateway, fulfillment-location-first planner, partsLogistics channel, graph node, UI cards, and live Salesforce inventory proof."
agent: "Node 4 Parts Logistics Implementer"
argument-hint: "Phase scope (4a default), org alias (default AgentForce), demo Case id, and whether to include UI observability"
tools: [read, search, edit, execute, todo, agent]
---

# Execution mode — implement, do not replan

You are in **executing mode**. Implement Phase **4a** of Node 4 — Parts & Logistics per the phase plan. Do not produce architecture-only documentation unless code cannot proceed due to a blocker.

Use the installed workspace skills for this task.

## Required skill-loading order

1. `framework-selection`
2. `langgraph-fundamentals`
3. `langgraph-case-triage-slice` — mirror Node 3 graph + channel pattern
4. `langgraph-node4-parts-logistics` — **primary skill for this task**
5. `salesforce-node4-parts-prep` — pre-flight validation only (4-Pre already shipped)
6. `langchain-dependencies` — only if package changes are needed
7. `new-org-tenant-onboarding` — only if AI API OAuth run-as user FLS assignment is blocked

## Agent persona

Adopt `.github/agents/node4-parts-logistics-implementer.agent.md`.

Escalate to specialist agents when the change becomes cross-cutting:

- `Nest AI Architect` — gateway/module boundaries, config flags
- `Security Reviewer` — auth, SOQL safety, no PII in logs/events
- `Telemetry Reviewer` — safe status events for Node 4
- `Release Checker` — pre-ship validation gates

## Relevant repo instructions (honor during implementation)

- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)
- [frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)
- [telemetry instructions](../instructions/telemetry.instructions.md)
- [testing and eval instructions](../instructions/testing-evals.instructions.md)

## Canonical documents (read before coding)

| Document                   | Path                                                                                            | Sections                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Phase plan (primary)**   | `docs/orchestrator/node-4-parts-logistics-phase-plan.md`                                        | **§0** (shipped state), §3, §6.5–§7.6, §10–§12, §14, §16 |
| Orchestrator flow          | `docs/orchestrator/case-triage-orchestrator-flow.md`                                            | Node 4 placement                                         |
| Node 3 contract (upstream) | `apps/ai-api/src/orchestrator/dto/knowledge-guidance.ts`                                        | `suggestedParts`, `recommendedActions`                   |
| Case context (extend)      | `apps/ai-api/src/orchestrator/dto/salesforce-case-context.ts`                                   | add Asset + ship-to                                      |
| Graph (extend)             | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                                             | mirror `knowledge` node                                  |
| Case gateway (extend)      | `apps/ai-api/src/salesforce/salesforce-case.gateway.ts`                                         | SOQL + mapping                                           |
| Customer gateway pattern   | `apps/ai-api/src/salesforce/salesforce-customer.gateway.ts`                                     | gateway style                                            |
| Transit rules JSON         | `data/warehouse-transit-rules.json`                                                             | ETA fallback                                             |
| Seed inventory             | `data/products-and-location-data.json`                                                          | demo quantities                                          |
| KB corpus                  | `apps/ai-api/data/knowledge/kb-laptop-corpus.json`                                              | part/warehouse refs                                      |
| 4-Pre skill                | `.agents/skills/salesforce-node4-parts-prep/SKILL.md`                                           | validation commands                                      |
| Permission set             | `force-app/main/default/permissionsets/Agentforce_Parts_Logistics_Node4.permissionset-meta.xml` | FLS reference                                            |

## Pre-flight gate (run first)

```bash
./scripts/sf/node4-pre-validation.sh AgentForce
```

Confirm from phase plan §0.7 / §16:

1. §0 read — **4-Pre is shipped** on `AgentForce`; do not redeploy metadata from scratch
2. Validation script passes
3. `Agentforce_Parts_Logistics_Node4` on **AI API OAuth run-as user** (report if missing)
4. Inter-WH transit: JSON fallback OK for 4a if CMT inter-WH rows not deployed

**Stop and report** if validation fails or live SF inventory reads cannot work. Do not claim E2E proof with mocks.

## User-provided context

```text
${input}
```

Default when user provides no arguments:

- Phase: **4a** (read/plan only)
- Org: **AgentForce**
- UI: include read-only Node 4 cards in `apps/react-chat-window`
- Proof: live Salesforce ProductItem reads required

## Implementation scope — Phase 4a only

### A. Extend case read context

Add to `SalesforceCaseContext`:

- `assetId`, `assetProductCode`, `assetSerialNumber` (orchestration only — do not expose serial in public UI events)
- `serviceShipToCity`, `serviceShipToState`, `serviceShipToCountry`

Extend `SalesforceCaseGateway` SOQL per phase plan §10.2.

### B. New components

| Component         | Path                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| DTO               | `apps/ai-api/src/orchestrator/dto/parts-logistics.ts` — match §11 contract |
| Inventory gateway | `apps/ai-api/src/salesforce/salesforce-inventory.gateway.ts`               |
| Planner           | `apps/ai-api/src/orchestrator/parts-logistics-planner.service.ts`          |
| Graph node        | `partsLogistics` in `case-triage.graph.ts`                                 |
| Lifecycle id      | `PARTS_LOGISTICS_NODE_ID` in `case-triage-lifecycle.ts`                    |
| Config flag       | e.g. `AI_API_ORCHESTRATOR_PARTS_ENABLED` in app config                     |

Register gateway + planner in `salesforce.module.ts` and `orchestrator.module.ts`.

### C. Planner behavior (deterministic — no LLM for stock/ETA)

Implement per §6.5–§7.6:

1. Collect part candidates from `knowledgeGuidance` (then case text fallback)
2. Select **fulfillment WH** from Case ship-to region (§6.6) before stock check
3. For each part: compatibility check vs `assetProductCode` / universal parts
4. Classify: Scenario A (stock at fulfillment WH), B (inter-WH transfer), C (backorder)
5. Build `etaSegments[]`, `estimatedArrivalWindow`, approval flags per §7.5
6. Aggregate `fulfillmentReadiness` per §7.6
7. Set `reservationStatus: planned` only — no SF writes

Use `data/warehouse-transit-rules.json` for last-mile and inter-WH hours when CMT incomplete.

### D. Graph wiring

```
… → knowledge → partsLogistics → gate → …
```

- Node 4 is **non-interrupting** — never `interrupt()`
- Writes **only** `partsLogistics` channel
- On SF read failure: `degraded: true`, continue graph
- Emit safe running/done status events with Node 4 trace sections (mirror Node 3)

Extend: `orchestration-status-event.ts`, `orchestration-status.store.ts`, `orchestration-status.repository.ts`, `orchestrator-verdict.synthesizer.ts` (basis array) as needed.

### E. UI (read-only observability)

Extend `apps/react-chat-window`:

- `lib/orchestration.ts` — sanitize `partsLogistics` channel
- `components/OrchestrationView.tsx` — Node 4 card: fulfillment readiness, part plans, ETA windows, approval flags
- Tests in `components/__tests__/OrchestrationView.test.tsx` and `lib/__tests__/orchestration.test.ts`

No approval actions in UI. No raw chain-of-thought.

### F. Tests

| Layer        | Focus                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| Planner unit | Scenarios A/B/C, compatibility, low-stock thresholds, cross-region approval |
| Gateway unit | SOQL shape, ProductCode keying, error → degraded mapping                    |
| Graph unit   | Node order, channel isolation, non-interrupting, degraded continue          |
| DTO          | Contract validation                                                         |
| UI           | Sanitize + render part plans                                                |
| Live proof   | ProductItem read against `AgentForce` for Austin battery Case (§14)         |

Run:

```bash
npm run ai-api:test
npm run react-chat:typecheck
```

## Explicit out-of-scope (do not implement unless user asks)

- Phase 4b KB warehouse cross-check
- Phase 4c `AgentforcePartsFulfillmentService`, ProductRequest/Transfer writes
- `Case_Default_Service_Ship_To` Flow (Salesforce — note as residual)
- Node 6 approval gate changes beyond reading existing `partsLogistics` in verdict synthesizer
- Nodes 5–8

## Acceptance criteria (must satisfy §12.B)

| #   | Requirement                                                          |
| --- | -------------------------------------------------------------------- |
| B1  | After knowledge; non-interrupting                                    |
| B2  | Writes only `partsLogistics`                                         |
| B3  | ProductCode + ExternalReference keys                                 |
| B4  | Austin battery → Scenario A when local stock                         |
| B5  | FRA→AUS cross-region → `inter_warehouse_transfer`, multi-segment ETA |
| B6  | OOS → backorder, blocked, no throw                                   |
| B7  | SF failure → degraded, continues                                     |
| B8  | Fulfillment WH before stock check                                    |
| B9  | No remote `available` without `transferRequired: true`               |

Exercise demo matrix §14 where org data supports it.

## Final response must include

1. Skills, instructions, and documents used
2. Pre-flight validation output (or blocker)
3. Contracts implemented — especially `PartsLogisticsChannel` and `PartLogisticsPlan`
4. End-to-end path: knowledge → partsLogistics → status store → UI
5. Live Salesforce inventory proof path (Case id, parts checked) or exact blocker
6. Demo scenarios from §14 exercised and outcomes
7. Validation commands run and results
8. Residual risks / §0.7 open items
9. Exact next step: Phase 4b or 4c

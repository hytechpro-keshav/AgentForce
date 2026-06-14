# Implement Node 4 Parts Logistics

Implement Phase 4a Node 4 — Parts & Logistics in the AI orchestrator. Full harness: `.github/prompts/implement-node4-parts-logistics.prompt.md`.

Adopt agent persona: `.github/agents/node4-parts-logistics-implementer.agent.md`.

## Execution mode

Implement code — do not replan. Phase **4a** only (read/plan, no Salesforce writes).

## Required skill-loading order

1. `.agents/skills/framework-selection/SKILL.md`
2. `.agents/skills/langgraph-fundamentals/SKILL.md`
3. `.agents/skills/langgraph-case-triage-slice/SKILL.md`
4. `.agents/skills/langgraph-node4-parts-logistics/SKILL.md` ← primary
5. `.agents/skills/salesforce-node4-parts-prep/SKILL.md` ← pre-flight validation only

## Pre-flight (run before coding)

```bash
./scripts/sf/node4-pre-validation.sh AgentForce
```

Read phase plan §0 first: `docs/orchestrator/node-4-parts-logistics-phase-plan.md`

## Key constraints

- **Phase 4a only** — no ProductRequest/Transfer writes, no Phase 4c Apex
- Extend graph after `knowledge`: `… → knowledge → partsLogistics → gate → …`
- Node 4 is **non-interrupting** — never `interrupt()`
- Writes **only** `partsLogistics` channel
- **Fulfillment-location-first** planner with multi-segment ETA (§6.5–§7.6)
- Key on `ProductCode` + `ExternalReference` — never `Product2.Id`
- Remote stock → `inter_warehouse_transfer`, not `available`
- Extend `SalesforceCaseGateway` for Asset + ship-to before inventory reads
- Use `data/warehouse-transit-rules.json` for ETA when CMT incomplete
- Live SF inventory proof on org `AgentForce` (or report exact blocker)

## Deliverables

| Component         | Path                                                              |
| ----------------- | ----------------------------------------------------------------- |
| DTO               | `apps/ai-api/src/orchestrator/dto/parts-logistics.ts`             |
| Inventory gateway | `apps/ai-api/src/salesforce/salesforce-inventory.gateway.ts`      |
| Planner           | `apps/ai-api/src/orchestrator/parts-logistics-planner.service.ts` |
| Graph node        | `partsLogistics` in `case-triage.graph.ts`                        |
| UI                | `apps/react-chat-window` Node 4 observability card                |

## Verify

```bash
npm run ai-api:test
npm run react-chat:typecheck
```

Live proof: ProductItem reads for Austin battery Case per §14 demo matrix.

$ARGUMENTS

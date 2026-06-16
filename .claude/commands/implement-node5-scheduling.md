# Implement Node 5 Scheduling

Implement Phase 5a Node 5 — Scheduling in the AI orchestrator. Full harness: `.github/prompts/implement-node5-scheduling.prompt.md`.

Adopt agent persona: `.github/agents/node5-scheduling-implementer.agent.md`.

## Execution mode

Implement code — do not replan. Phase **5a** only (read/plan, no Salesforce writes).

## Required skill-loading order

1. `.agents/skills/framework-selection/SKILL.md`
2. `.agents/skills/langgraph-fundamentals/SKILL.md`
3. `.agents/skills/langgraph-case-triage-slice/SKILL.md`
4. `.agents/skills/langgraph-node4-parts-logistics/SKILL.md`
5. `.agents/skills/langgraph-node5-scheduling/SKILL.md` ← primary
6. `.agents/skills/salesforce-node5-scheduling-prep/SKILL.md` ← pre-flight only

## Pre-flight (run before coding)

```bash
./scripts/sf/node5-pre-validation.sh AgentForce
```

Read phase plan §0.4 first: `docs/orchestrator/node-5-scheduling-phase-plan.md`

Read gotchas: `docs/context/node5-field-service-prep-lessons.md`

## Key constraints

- **Phase 5a only** — no `ServiceAppointment` writes (5c)
- Graph: `… → parts → scheduling → gate → …`
- Node 5 is **non-interrupting** — never `interrupt()`
- Writes **only** `scheduling` channel
- **Parts-ETA gating:** `earliestStart = max(partsEtaFloor, availability, now)`
- **Secondary territory** — include `TerritoryType = 'S'` for North America (A1/A2)
- **No technician full names** in events/verdict — `resourceReference` only
- **Do not** gate approval on scheduling in 5a
- **5a is point-in-time** — see `docs/orchestrator/re-orchestration-backlog.md` §3.7
- v1 planner uses OperatingHours/TimeSlots — not AppointmentCandidates API
- Live SF proof on org `AgentForce` (or report blocker)

## Deliverables

| Component  | Path                                                          |
| ---------- | ------------------------------------------------------------- |
| DTO        | `apps/ai-api/src/orchestrator/dto/scheduling.ts`              |
| Gateway    | `apps/ai-api/src/salesforce/salesforce-scheduling.gateway.ts` |
| Planner    | `apps/ai-api/src/orchestrator/scheduling-planner.service.ts`  |
| Graph node | `scheduling` in `case-triage.graph.ts`                        |
| Verdict    | four-surface rollup in `orchestrator-verdict.synthesizer.ts`  |
| UI         | `apps/react-chat-window` Node 5 observability card            |

## Verify

```bash
npm run ai-api:test
npm run react-chat:typecheck
```

Live proof: Austin laptop Case per phase plan §14.4 demo matrix.

$ARGUMENTS

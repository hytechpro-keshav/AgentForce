# Node 5 — Scheduling — Phase Plan (Salesforce Field Service + Orchestrator)

> **Document type:** Phase 5 planning + implementation-readiness report — Field Service readiness, parts-ETA gating, `scheduling` channel contract, planner/gateway/graph design, verdict rollup, UI, and test plan.
> **Audience:** AI Architects · Salesforce Architects · Platform Engineers · Service Operations.
> **Status:** **5-Pre + 5a + Railway E2E + 5b SHIPPED** (2026-06-16). **5c CODE-COMPLETE + VALIDATED** (2026-06-18) — pending live rollout. Production read/plan flag `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true`; smoke `ASSERT_SCHEDULING=1` green. **5c gated `ServiceAppointment` write** is implemented behind `AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED` (default off), runs after Node 6 approval with a write-time fresh parts + scheduling re-read (RC-5); validated by ai-api unit tests (439 passing, typecheck + prettier clean). The Apex executor (9 tests, resolve-by-reference) is `sf project deploy --dry-run`-validated as part of the deploy step. Live Railway deploy + `ASSERT_SCHEDULING_WRITES=1` booking proof is the remaining rollout step — see §0.7. See §0.1, §0.5, §0.6, §0.7, and [`node5-field-service-prep-lessons.md`](../context/node5-field-service-prep-lessons.md).
> **Next:** finish 5c rollout (deploy metadata, assign perm to run-as, flip the flag, restart ai-api, run the booking smoke) · 5d re-orchestration reconcile.
> **Companions:** [`case-triage-orchestrator-flow.md`](./case-triage-orchestrator-flow.md) · [`node-4-parts-logistics-phase-plan.md`](./node-4-parts-logistics-phase-plan.md) · [`new-node-phase-completion-checklist.md`](./new-node-phase-completion-checklist.md) · [`service-operations-operating-system.md`](../agents/service-operations-operating-system.md)

**Program invariants (unchanged):**

- **Salesforce** = system of record + action executor (read scheduling signals now; `ServiceAppointment` writes after Node 6 approval, Phase 5c).
- **LangGraph** = orchestrator brain; Node 5 is **non-interrupting** — Node 6 owns human approval.
- **Node 5** answers: _Who is the best technician (skill · location · availability) and what is the earliest realistic service window, given parts fulfillment readiness and ETA?_

---

## 0. Session context — read this first

### 0.1 What is shipped vs. what this plan adds

| Layer                                                  | State today                                                                                                                                                                                                                                                                                     | Source of truth                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Nodes 1–4 (triage, customer history, knowledge, parts) | **Shipped**                                                                                                                                                                                                                                                                                     | `apps/ai-api/src/orchestrator/case-triage.graph.ts`                                      |
| **`scheduling` channel + Node 5 graph**                | **Shipped (5a)** — graph node `schedule` writes channel `scheduling`; non-interrupting; flag `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED` (default `false`)                                                                                                                                         | `dto/scheduling.ts`, `scheduling-planner.service.ts`, `salesforce-scheduling.gateway.ts` |
| Single approval gate covers triage + parts             | **Shipped** (`requiresApproval(triage, partsLogistics)`) — scheduling does **not** gate in 5a                                                                                                                                                                                                   | graph `gate` node                                                                        |
| **5c gated `ServiceAppointment` write**                | **Code-complete + validated (5c, 2026-06-18); live rollout pending** — `applySchedulingWrite` in `writeBack` (approved path) books a `ServiceAppointment` + `AssignedResource` after a fresh parts + scheduling re-read; flag `AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED` (default `false`) | `salesforce-scheduling-write.gateway.ts`, `AgentforceSchedulingService.cls`, §0.7        |
| **5-Pre** Field Service seed + FLS on `AgentForce`     | **Done** (2026-06-16)                                                                                                                                                                                                                                                                           | §0.4; `node5-pre-validation.sh`                                                          |
| **5a** orchestrator + UI + verdict + smoke             | **Done** (2026-06-16) — 367 ai-api tests, 49 react-chat tests; live planner proof Case `500g500000YpQMnAAN`                                                                                                                                                                                     | §0.5                                                                                     |
| Railway production scheduling flag + E2E smoke         | **Done** (2026-06-16) — `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true`; workflow `wf-d53cb708-91a1-4ff7-a2c5-cf3504d7125f`                                                                                                                                                                       | §0.5                                                                                     |

### 0.4 Phase 5-Pre shipped state (2026-06-16, org `AgentForce`)

| Artifact          | Path / result                                                           |
| ----------------- | ----------------------------------------------------------------------- |
| Skills (metadata) | `force-app/main/default/skills/*.skill-meta.xml` — 5 laptop skills      |
| Perm set          | `Agentforce_Scheduling_Node5.permissionset-meta.xml`                    |
| Seed Apex         | `scripts/sf/apex/node5-pre-seed.apex`                                   |
| Scripts           | `scripts/sf/node5-pre-{deploy,seed,validation}.sh`                      |
| Manifest          | `manifest/node5-pre-package.xml`                                        |
| Validation        | `./scripts/sf/node5-pre-validation.sh AgentForce` **PASSED**            |
| Run As            | `chaudhary.keshav4u@gmail.com` — `Agentforce_Scheduling_Node5` assigned |

**Seed counts:** Skill 5 · ServiceResourceSkill 8 · NA territory 1 · ServiceTerritoryMember 4 · Laptop WorkType 2 · SkillRequirement 2.

**Territory membership:** A1/A2 are **Primary** in `Abypro`, **Secondary (`S`)** in **North America** (FSL one-Primary rule). 5a planner/gateway **must include Secondary memberships** — see §8.3.

**Lessons:** [`node5-field-service-prep-lessons.md`](../context/node5-field-service-prep-lessons.md) — Skill-as-metadata, territory overlap, Run As alias, LangGraph `schedule` node vs `scheduling` channel.

### 0.5 Phase 5a shipped state (2026-06-16)

| Artifact    | Path / result                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| DTO         | `apps/ai-api/src/orchestrator/dto/scheduling.ts` — `SchedulingChannel`                                             |
| Gateway     | `apps/ai-api/src/salesforce/salesforce-scheduling.gateway.ts` — sanitizes names at boundary                        |
| Planner     | `apps/ai-api/src/orchestrator/scheduling-planner.service.ts` + `scheduling-rules.ts`, `scheduling-availability.ts` |
| Graph       | `schedule` node in `case-triage.graph.ts` — `parts → schedule → gate` (node name ≠ channel; see lessons)           |
| Lifecycle   | `SCHEDULING_NODE_ID = "scheduling"` in `case-triage-lifecycle.ts`                                                  |
| Config      | `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED` (default `false`)                                                         |
| Verdict     | four-surface rollup in `orchestrator-verdict.synthesizer.ts`                                                       |
| UI          | `OrchestrationView.tsx` Node 5 card; `lib/orchestration.ts` sanitizer                                              |
| Persistence | `scheduling` JSONB column on workflow snapshot                                                                     |
| Smoke       | `scripts/smoke/all-3-nodes-deployed.sh` — `ASSERT_SCHEDULING=1` when flag on Railway                               |
| Tests       | ai-api **367** passed; react-chat **49** passed; typecheck clean                                                   |

**Live planner proof (org `AgentForce`, Case `500g500000YpQMnAAN` / 00001050 — display repair, Austin):**

| Parts state             | Outcome                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| Parts skipped           | `schedulable` · **SR-A2** rank 1 (Display skill) · window today              |
| Display transfer (~41h) | `provisional` · SR-A2 · window after parts ETA · `partsEtaConstrained: true` |

**Re-orchestration:** 5a is point-in-time (§3.7). UI/verdict do not imply live scheduling after `done`.

**Railway E2E proof (2026-06-16):**

| Item              | Value                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Script            | `scripts/deploy/railway-node5-scheduling-e2e.sh`                                                     |
| ai-api deploy     | `b00fe4d9-288b-4935-a5ce-197bd9cf8c3e`                                                               |
| react-chat deploy | `3e9251ce-d78d-44a9-96a7-7d6b405abca2`                                                               |
| Smoke workflow    | `wf-d53cb708-91a1-4ff7-a2c5-cf3504d7125f`                                                            |
| Case              | `500g500000YpQMnAAN` (00001050)                                                                      |
| Scheduling        | `PROVISIONAL` / `provisional` · technician **SR-A2** · window Thursday 09:00–11:00 UTC (after parts) |
| UI                | `https://react-chat-window-production.up.railway.app/orchestration?caseId=500g500000YpQMnAAN`        |

### 0.6 Phase 5b shipped state (2026-06-16) — planner refinements, no SF writes

Four deterministic-planner refinements, all additive and degrade-safe. No graph-shape change (still `parts → schedule → gate`, non-interrupting, sole writer). No Salesforce writes (`appointmentStatus` still stops at `proposed`).

| Refinement                     | What shipped                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Territory-local timezone**   | `scheduling-timezone.ts` (pure `Intl`-based wall-clock↔UTC, DST-correct, UTC fallback). `findEarliestSlot` now projects operating hours in `OperatingHours.TimeZone`; the gateway reads that field. `displayWindow` renders local time + zone label (e.g. `PDT`). No zone → exact 5a UTC behavior.                         |
| **Appointment collision**      | Gateway reads existing `ServiceAppointment` (via `AssignedResource`, terminal statuses excluded) and merges them with `ResourceAbsence` into per-resource `busyIntervals`; the planner sweep already skips them.                                                                                                           |
| **WorkType / KB duration**     | Gateway reads laptop `WorkType.EstimatedDuration` keyed by skill; planner `reconcileDuration()` cross-checks it against the per-skill default and an optional typed KB repair-effort hint (`ActionRecommendation.estimatedEffortMinutes`); `proposedWindow.durationSource` records the winner.                             |
| **AppointmentCandidates seam** | Flag `AI_API_ORCHESTRATOR_SCHEDULING_CANDIDATES_API_ENABLED` (default off) + gateway seam + planner slot-source selection (`proposedWindow.slotSource`). The native scheduler needs a draft `ServiceAppointment` (5c), so the flag-on read still returns `candidatesApiUsed:false` and the deterministic planner stays v1. |

**New additive channel fields:** `ProposedWindow.timeZone | slotSource | durationSource`; `SchedulingChannel.candidatesApiUsed`. **New config:** `OrchestratorSchedulingConfig.candidatesApiEnabled`.

**Files:** `scheduling-timezone.ts` (new) · `scheduling-availability.ts` · `scheduling-rules.ts` · `scheduling-planner.service.ts` · `salesforce-scheduling.gateway.ts` · `dto/scheduling.ts` · `dto/knowledge-guidance.ts` · `app-config.service.ts` · `case-triage.graph.ts` (deps `planScheduling` gains `knowledgeGuidance`) · `case-triage-orchestrator.service.ts`. **Specs:** `scheduling-timezone.spec.ts`, `scheduling-availability.spec.ts`, `scheduling-rules.spec.ts` (new) + planner/gateway/orchestrator specs. **Tests:** ai-api **406** passed (was 367); typecheck + prettier clean.

**Live planner proof (org `AgentForce`, Case `500g500000YpQMnAAN` / 00001050 — display repair):** live reads — NA `OperatingHours.TimeZone = America/Los_Angeles`, WorkTypes (Onsite Repair 2h / Battery 1h), A1/A2 NA-Secondary skills. Real planner output:

| Parts state                      | Outcome                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Parts skipped                    | `schedulable` · **SR-A2** · **"Today 09:00–11:00 PDT"** (16:00 UTC) · `durationSource: worktype` (120m) · `timeZone: America/Los_Angeles` |
| Display transfer (~41h)          | `provisional` · SR-A2 · **"Thursday 09:00–11:00 PDT (after parts arrive)"** · `partsEtaConstrained: true`                                 |
| Same-day booking 09:00–10:00 PDT | `schedulable` · SR-A2 · swept to **"Today 10:00–12:00 PDT"** (collision detection)                                                        |

5b is still point-in-time (§3.7) — fresh parts read at write time is 5c, event reconcile is 5d.

### 0.7 Phase 5c state (2026-06-18) — gated `ServiceAppointment` write (code-complete + validated; rollout pending)

Node 5 can now **book** the approved plan (behind a default-off flag). Mirrors Node 4 Phase 4c: a degrade-safe write gateway over an Apex REST executor, applied **only** in the post-approval write-back, with Salesforce owning the DML + idempotency. Unblocked by Node 6 6a (`evaluateGuardrail` replaced the gate; `state.guardrail?.outcome` + `approvalDecision` are available in `writeBack`). **Validated** by ai-api unit tests (439 passing, typecheck + prettier clean); the Apex executor carries 9 tests (resolve-by-reference) and is `sf project deploy --dry-run`-validated as part of the deploy step. The live Railway deploy + booking smoke is the remaining rollout step.

| Artifact            | Path / result                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write DTO           | `apps/ai-api/src/orchestrator/dto/scheduling-write.ts` — `SchedulingWriteCommand` / `SchedulingWriteResult` (sanitized reference only)                                                                                                                                                                                                       |
| Write gateway       | `apps/ai-api/src/salesforce/salesforce-scheduling-write.gateway.ts` — POSTs Apex REST, degrades (never throws)                                                                                                                                                                                                                               |
| Orchestrator method | `applySchedulingWrite` in `case-triage-orchestrator.service.ts` — RC-5 fresh read, gate, command, merge, telemetry                                                                                                                                                                                                                           |
| Graph wiring        | `applySchedulingWrite` dep called in `writeBack` after `applyPartsFulfillment` (approved path only)                                                                                                                                                                                                                                          |
| Apex executor       | `AgentforceSchedulingService.cls` (+ `AgentforceSchedulingRest.cls`, `…ServiceTest.cls`) — `ServiceAppointment` + `AssignedResource`                                                                                                                                                                                                         |
| SF metadata         | `ServiceAppointment.Orchestrator_Workflow_Id__c` (idempotency) + `Agentforce_Scheduling_Node5` create/FLS                                                                                                                                                                                                                                    |
| Config              | `AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED` (default `false`)                                                                                                                                                                                                                                                                            |
| Channel             | `scheduling.appointmentStatus = "booked"` + `appointmentReference` (`AppointmentNumber`, e.g. `SA-0007`) on success                                                                                                                                                                                                                          |
| Smoke               | `scripts/smoke/all-3-nodes-deployed.sh` — `ASSERT_SCHEDULING_WRITES=1` (approved Case, not escalated)                                                                                                                                                                                                                                        |
| Tests               | ai-api **439** passed (gateway spec + graph 5c + service 5c); **9** Apex tests (resolve-by-reference; `sf project deploy --dry-run` at deploy); typecheck + prettier clean                                                                                                                                                                   |
| Rollout (remaining) | Deploy the 5 metadata components, assign `Agentforce_Scheduling_Node5` to the OAuth run-as user, set `AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED=true` on Railway `ai-api`, restart, then `ASSERT_SCHEDULING_WRITES=1` on an approvable Case (one that reaches requireHumanApproval → approved → writeBack, NOT 00001050 which escalates) |

**What ships (and what does not):**

- Writes **only** on the approved path (`approvalDecision === "approved"` → `writeBack`); `rejected` / `escalated` terminals never book. The smoke guards that the demo Case is **not** one that escalates (00001050 escalates — use an approvable Case).
- **RC-5 write-time safety:** `applySchedulingWrite` re-reads parts (fresh inventory) and re-runs the scheduling planner immediately before the DML, re-applying `earliestStart = max(partsEtaFloor, availability, now)`. It books **only** a still-`schedulable` plan; if parts/availability regressed it surfaces the honest fresh channel (`provisional`/`deferred`) and books nothing. A no-parts Case stays `skipped` (the fresh parts read is eligibility-gated so re-planning never invents a parts dependency Node 5 never saw).
- **Idempotency (C3):** keyed on `ServiceAppointment.Orchestrator_Workflow_Id__c`; a repeated delivery reuses the existing appointment (`idempotentSkip`, still `booked`).
- **Case link (C2):** `ServiceAppointment.ParentRecordId = Case`.
- **No PII:** the command carries the sanitized `resourceReference` (e.g. `SR-A2`); the Apex resolves it back to the real `ServiceResource` by name prefix. Full technician name never leaves the read gateway.
- **Out of scope:** 6b approval email routing; 5d event-driven reconcile.

### 0.2 Phase breakdown

| Phase     | Scope                                                                                                                                                                                                                                  | Exit criteria                                                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **5-Pre** | Salesforce: align Field Service data to the laptop service domain, seed **Skills + ServiceResourceSkill**, multi-region territories, operating hours, FLS perm set for AI API run-as user, validation script                           | **Done** — `node5-pre-validation.sh AgentForce` (§0.4)                                                                                                                                                                   |
| **5a**    | AI read/plan: `scheduling` DTO, `SalesforceSchedulingGateway`, deterministic `scheduling-planner.service`, graph node `schedule` after `parts`, verdict rollup, React stage card, smoke. **No SF writes.**                             | **Done** — B1–B11 via tests; live planner proof Case `500g500000YpQMnAAN` (§0.5)                                                                                                                                         |
| **5b**    | Planner refinements (no SF writes): territory-local timezone for operating hours, `ServiceAppointment` collision detection, WorkType/KB duration cross-check, AppointmentCandidates API seam behind a flag with deterministic fallback | **Done** (2026-06-16) — planner/availability/rules/gateway specs; live planner proof Case `500g500000YpQMnAAN` in Pacific local time (§0.6)                                                                              |
| **5c**    | Gated `ServiceAppointment` create after Node 6 approval (mirror Node 4 Phase 4c write-back)                                                                                                                                            | **Code-complete + validated** (2026-06-18) — C1–C4 via tests + Apex dry-run; `applySchedulingWrite` + Apex executor + RC-5 fresh read; flag `AI_API_ORCHESTRATOR_SCHEDULING_WRITES_ENABLED`. Live rollout pending (§0.7) |
| **5d**    | **Re-orchestration:** event-driven `parts → scheduling` reconcile when fulfillment status changes; Stop-AI guard respected. See [`re-orchestration-backlog.md`](./re-orchestration-backlog.md).                                        | Reconcile API + SF Flow triggers; deferred/provisional → schedulable without manual full re-trigger                                                                                                                      |

### 0.3 Recommended execution order

1. ~~Run **5-Pre**~~ **Done** (2026-06-16).
2. ~~Run **5a** orchestrator slice~~ **Done** (2026-06-16).
3. **Deploy to Railway:** `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=true`, restart `ai-api`, smoke `ASSERT_SCHEDULING=1 SF_CASE_ID=500g500000YpQMnAAN`.
4. ~~Optional **5b:** territory-local TZ, appointment collision check, WorkType/KB duration cross-check, `AppointmentCandidates` seam~~ **Done** (2026-06-16, §0.6).
5. **5c** gated `ServiceAppointment` writes (after Node 6) — **code-complete + validated** (2026-06-18, §0.7); run the live rollout (deploy, assign perm, flip flag, restart, booking smoke).
6. Plan **5d** re-orchestration with [`re-orchestration-backlog.md`](./re-orchestration-backlog.md).

---

## 1. Executive summary

Node 5 — **Scheduling** — sits after Node 4 Parts & Logistics and before Node 6 Compliance & Guardrail in the eight-node chain. It consumes the typed `partsLogistics` channel (fulfillment readiness + ETA), `customerContext` (SLA / priority / business risk), `triage` (priority), and Case ship-to / asset context, then reads **Salesforce Field Service** (`ServiceResource`, `ServiceTerritory`, `ServiceTerritoryMember`, `OperatingHours`, `WorkType`, and skill/availability signals) to rank technicians and propose the **earliest realistic service window**.

**Core design rule — parts gate scheduling.** Node 5 must not propose a window earlier than parts can physically arrive. The earliest start = `max(parts ETA upper bound, technician availability, SLA target)`. When `fulfillmentReadiness = blocked`, Node 5 produces a **deferred / provisional** plan (no committed window) rather than a confident slot. This mirrors Node 4's "remote stock is not availability" discipline: _a free technician slot is not a schedulable window if the parts aren't there yet._

**Field Service readiness verdict (org `Agent`, audited 2026-06-16): PARTIAL — demo-grade and domain-mismatched.** Field Service is enabled and the scheduling objects are queryable, but the data is a generic AC/appliance demo, not the laptop service domain the rest of the orchestrator uses, and the **skill graph is empty**:

| Ready                                                                                                                                                          | Blocking / missing                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Field Service enabled; `ServiceResource`, `ServiceTerritory`, `ServiceAppointment`, `OperatingHours`, `WorkType`, `TimeSlot`, `AssignedResource` all queryable | **`Skill = 0`, `ServiceResourceSkill = 0`** — "best technician by skill" has no data to rank on   |
| 2 active technicians (`A1 Techinican`, `A2 Techinican`), both `User`-backed                                                                                    | Single territory **`Abypro`** — no NA/EU geography to align with Node 4 ship-to (Austin TX / FRA) |
| Both technicians are Primary members of territory `Abypro`                                                                                                     | WorkTypes are `Repaire` / `AC Diagnostic and Repair` — **appliance domain, not laptop**           |
| 2 `OperatingHours`, 25 `TimeSlot` rows (availability calendar exists)                                                                                          | No FLS perm set for the AI API OAuth run-as user on scheduling objects                            |
| 3 `ServiceAppointment` + 3 `AssignedResource` (model exercised)                                                                                                | `ResourceAbsence` / `SkillRequirement` unseeded — no availability-exception or skill-gating data  |

**The org proves the Field Service data model works; it does not yet prove a laptop-domain best-technician scheduling scenario.** 5-Pre closes that gap with seed data and a skill graph; it does not require new platform enablement.

The orchestrator slice (5a) is a clean mirror of Node 4: typed channel (sole writer), eligibility gate, deterministic planner, degrade-safe gateway, non-interrupting node, four-surface verdict rollup, React stage card, smoke assertion.

---

## 2. Live Salesforce baseline (audited 2026-06-16, org `Agent`)

> **Org alias note:** the connected org is aliased **`Agent`**, not `AgentForce`. Username `mohitchaudhary27.08.03.467400114157@agentforce.com`, API 67.0, Developer Edition. Update scripts/docs that hardcode `AgentForce` or re-alias the org before 5-Pre.

### 2.1 Field Service object inventory

| Object                   | Count        | Queryable | Node 5 role                                                                                                       |
| ------------------------ | ------------ | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `ServiceResource`        | **2**        | ✅        | Technician candidates (`A1 Techinican`, `A2 Techinican`, both active, ResourceType `T`, `RelatedRecordId` → User) |
| `ServiceTerritory`       | **1**        | ✅        | Geographic/coverage unit (`Abypro`) — **single territory**                                                        |
| `ServiceTerritoryMember` | **2**        | ✅        | Both technicians Primary (`TerritoryType = P`) in `Abypro`                                                        |
| `ServiceAppointment`     | **3**        | ✅        | Existing appointments (model exercised); future write target (5c)                                                 |
| `AssignedResource`       | **3**        | ✅        | Resource ↔ appointment link                                                                                       |
| `OperatingHours`         | **2**        | ✅        | Availability calendar header                                                                                      |
| `TimeSlot`               | **25**       | ✅        | Operating-hours day/time slots (availability windows exist)                                                       |
| `WorkType`               | **2**        | ✅        | `Repaire` (5h), `AC Diagnostic and Repair` (3h) — duration source; **appliance domain**                           |
| `WorkOrder`              | **2**        | ✅        | Job header (optional `ServiceAppointment.ParentRecordId`)                                                         |
| `Skill`                  | **0**        | ✅        | **Empty** — no skill taxonomy                                                                                     |
| `ServiceResourceSkill`   | **0**        | ✅        | **Empty** — no technician→skill assignments                                                                       |
| `SkillRequirement`       | 0 / unseeded | ✅        | Work-type / work-order skill demand — unseeded                                                                    |
| `ResourceAbsence`        | 0 / unseeded | ✅        | Availability exceptions — unseeded                                                                                |

### 2.2 What the baseline proves and does not prove

- **Proves:** Field Service is fully enabled; the scheduling data model (resource → territory member → operating hours/time slots → appointment → assigned resource) is present and exercised. No platform enablement work is needed.
- **Does not prove:** (a) skill-based ranking — there is **no skill data at all**; (b) location-based ranking — one territory, no NA/EU split to match Node 4 routing; (c) domain fit — the seeded WorkTypes/technicians are appliance/AC demo, disconnected from the laptop catalog (`AV-LP-15X-PRO`, `SP-*`) and the Node 4 ship-to cities (Austin TX, FRA).

### 2.4 OAuth Run As user — Node 4 FLS pattern (verified on org `AgentForce`)

The planning audit flagged "AI API run-as user permissions ❌ Missing." **That is only true for Node 5 scheduling objects** — the Node 4 FLS pattern is **solved** and must be reused for 5-Pre.

| Item                                            | Status on `AgentForce` (verified 2026-06-16)                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Connected App **Run As** user                   | `chaudhary.keshav4u@gmail.com` (per [`node4-auth-session-lessons.md`](../context/node4-auth-session-lessons.md)) |
| `Agentforce_Parts_Logistics_Node4` on Run As    | **Assigned**                                                                                                     |
| `Agentforce_Parts_Fulfillment_Writes` on Run As | **Assigned**                                                                                                     |
| `Agentforce_Scheduling_Node5` on Run As         | **Not deployed** — 5-Pre task                                                                                    |

**Lesson (do not repeat):** Metadata deploy alone is insufficient. Assign the Node 5 perm set to the **same Run As user** Railway `ai-api` uses for client-credentials OAuth, then **restart ai-api** (token cache ~25 min). Do **not** use `integration@…` Analytics Cloud user as Run As for Field Service writes.

```bash
sf data query --target-org AgentForce --query \
  "SELECT Assignee.Username, PermissionSet.Name FROM PermissionSetAssignment \
   WHERE PermissionSet.Name IN ('Agentforce_Parts_Logistics_Node4','Agentforce_Parts_Fulfillment_Writes')"
```

**Org alias note:** CLI alias is **`AgentForce`** (same org as planning audit username `mohitchaudhary27…@agentforce.com`). Scripts defaulting to `Agent` should use `AgentForce` unless re-aliased.

---

### 2.5 Alignment with Node 4 (parts) domain

Node 4 routes parts to fulfillment warehouses by Case ship-to region (NA: WH-AUS-001/WH-JCY-003/WH-SJO-002; EU: WH-FRA-004). Node 5 should rank technicians in the **same geography** so a part arriving at WH-AUS-001 is matched to a technician serving the Austin territory. Today the single `Abypro` territory has no mapping to those regions. 5-Pre must introduce territories that align to the Node 4 ship-to regions (at minimum a North America territory covering Austin TX, optionally a Europe territory) so parts-ETA gating and technician location agree.

---

## 3. Node 5 role in the orchestrator

### 3.1 Question Node 5 answers

> **"Given the recommended priority, SLA, the asset, and the parts fulfillment plan (readiness + ETA), which technician — by skill, territory, and availability — can take this job, and what is the earliest realistic service window?"**

Operator narrative (mirror Node 4's fulfillment-plan framing): _"Angela R · 1–3 PM tomorrow"_ — a ranked technician reference plus a proposed window, with the reason it cannot be earlier (parts ETA, SLA, or availability).

### 3.2 Inputs (read-only from shared state)

| Channel / context                   | Fields used                                                                                                                                         | Why                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `partsLogistics`                    | `fulfillmentReadiness`, per-plan `estimatedArrivalAt` / `estimatedArrivalWindow` / `estimatedDispatchHoursMax`, `exceptionType`, `requiredApproval` | **Earliest start gate** (§3.5)                                 |
| `triage`                            | `recommendedPriority`                                                                                                                               | Window urgency, SLA target selection                           |
| `customerContext`                   | `slaClass`, `businessRisk`, `installedAssets.primaryModel`                                                                                          | SLA window, priority tie-break, skill mapping from asset model |
| `context` (`SalesforceCaseContext`) | `assetProductCode`, `serviceShipToCity/State/Country`, `accountId`                                                                                  | Territory selection, skill requirement, work-type              |

### 3.3 Output (`scheduling` channel — sole writer: Node 5)

See §7 for the full contract. Summary:

- **Ranked candidates:** technician resource reference (sanitized — code/initials, **never full name in status events**), territory, matched skills, availability score, distance/territory fit, and a composite rank.
- **Proposed window:** `earliestStart`, `proposedStart`/`proposedEnd` (or `arrivalWindowStart/End`), `windowConfidence`, and `earliestStartBasis` (which constraint set the floor: `parts_eta` | `technician_availability` | `sla_target` | `now`).
- **Aggregate:** `schedulingReadiness = schedulable | provisional | deferred | unschedulable | unknown`.
- **`appointmentStatus`:** `none | proposed` in 5a (writes — `booked` — are 5c after Node 6).

### 3.4 Graph placement

```
START → readContext → runTriage → customerHistory → knowledge → parts → scheduling → gate → writeBack/rejected → END
```

Node 5 is inserted **between `parts` and `gate`**. It is **non-interrupting** (never calls `interrupt()`). New graph edge: `parts → scheduling → gate` (replace the current `parts → gate` edge). The `gate` node's `requiresApproval(...)` is extended to also consider scheduling approval needs (§3.6).

### 3.5 Parts-ETA gating (the central rule)

Node 5 computes the earliest schedulable start as:

```
partsEtaFloor   = max(estimatedArrivalAt) across required part plans   // upper bound of ETA window
slaFloor        = now + sla_response_target(slaClass, priority)        // soft target, not a hard floor
earliestStart   = max(partsEtaFloor, technicianAvailabilityStart, now)
proposedWindow  = first technician operating-hours slot ≥ earliestStart that fits WorkType duration
```

Eligibility / skip and readiness rules driven by `partsLogistics`:

| `partsLogistics` state             | Node 5 behavior                                                                               | `schedulingReadiness`             |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------- |
| `ready`                            | Schedule from parts ETA floor (often near-now)                                                | `schedulable`                     |
| `partial` (transfer required)      | Schedule from the slowest transfer ETA; flag dependency                                       | `provisional`                     |
| `blocked` (backorder / no path)    | **No committed window**; propose "schedule after parts confirmed"; surface ETA-blocked reason | `deferred`                        |
| `degraded` / `unknown`             | Best-effort window from availability only, low confidence, `degraded: true`                   | `provisional` / `unknown`         |
| `eligible = false` (parts skipped) | Schedule from availability + SLA only (no parts dependency, e.g. no-parts repair)             | `schedulable` if technician found |

**Discipline carried from Node 4:** never present a confident window earlier than parts can arrive. `earliestStartBasis` records which constraint won, so the verdict can explain _why_ the window is when it is.

### 3.6 Approval interaction (interim, pre-Node-6)

The current single `gate` covers triage + parts. Node 5 in 5a is **read/plan only and proposes nothing that writes**, so it should **not** force approval by itself — but it should surface `requiredApproval`/`approvalReason` (e.g. `after_hours`, `sla_breach_risk`, `cross_territory`) for Node 6. Until Node 6 exists, extend `requiresApproval(triage, partsLogistics, scheduling?)` only if the team wants scheduling to gate the interim write-back; the **recommended default is NOT to gate on scheduling in 5a** (scheduling writes are 5c). Document this explicitly so the gate's meaning stays clear.

### 3.7 Re-orchestration when parts readiness changes (mandatory design context)

> **Companion:** [`re-orchestration-backlog.md`](./re-orchestration-backlog.md) — per-node stale matrix, Stop AI button, reconcile API backlog.

The parts-ETA gating rule (§3.5) is evaluated **at orchestrator run time only** unless a later phase explicitly refreshes state.

| Phase  | Re-orchestration behavior                                                                                                                                                                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5a** | **Point-in-time gating only.** `schedulable`, `provisional`, and `deferred` honestly reflect `partsLogistics` **as of that run**. After `done`, the snapshot is historical — not a live scheduler. UI/verdict must not imply windows stay valid when inventory changes later.                       |
| **5c** | **Mandatory fresh parts read** immediately before `ServiceAppointment` create. Re-apply `earliestStart = max(partsEtaFloor, technicianAvailability, now)`. Abort or degrade booking if parts are no longer ready vs. the stale channel. Mirror Node 4 §4c write-time safety.                        |
| **5d** | **Event-driven reconcile:** Salesforce events (`ProductTransfer` complete, `ProductItem` qty increase, `Parts_Fulfillment_Status__c` change) → `POST …/reconcile` partial re-run **`parts → scheduling`** (fresh inventory + planner). Skip if Case `AI_Orchestration_Status__c = stopped_by_user`. |

**Operator manual takeover:** When the rep clicks **Stop AI orchestration** (backlog RC-1), no future auto-triggers or reconcile jobs run for that Case until AI is explicitly resumed.

**Node 4 today (shipped):** Inventory is read once per workflow; gate resume does **not** re-run `parts`. A new full trigger creates a new `workflowId`. Node 5 inherits this limitation until 5d.

---

## 4. Salesforce readiness audit — dependency classification

| #   | Dependency                                                                                | Status                        | Evidence / action                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Field Service enabled; scheduling objects queryable                                       | **Available**                 | All objects in §2.1 returned counts                                                                                                                                                                          |
| S2  | Technician records (`ServiceResource`, active, User-backed)                               | **Available**                 | 2 active, ResourceType `T`, `RelatedRecordId` set                                                                                                                                                            |
| S3  | Territory + membership model                                                              | **Partial**                   | 1 territory `Abypro`; needs NA/EU territories aligned to Node 4 regions (§2.3)                                                                                                                               |
| S4  | Operating hours / availability calendar                                                   | **Partial**                   | 2 `OperatingHours`, 25 `TimeSlot`; not mapped to laptop-domain territories                                                                                                                                   |
| S5  | **Skill taxonomy (`Skill`)**                                                              | **Missing**                   | `Skill = 0` — must seed laptop service skills (§12.2)                                                                                                                                                        |
| S6  | **Technician skills (`ServiceResourceSkill`)**                                            | **Missing**                   | `ServiceResourceSkill = 0` — must assign skills to A1/A2 (§12.2)                                                                                                                                             |
| S7  | Skill demand (`SkillRequirement` on WorkType/WorkOrder)                                   | **Missing**                   | Unseeded; needed to gate technician by required skill                                                                                                                                                        |
| S8  | WorkType duration for the laptop domain                                                   | **Partial**                   | Only appliance WorkTypes exist; add laptop repair WorkTypes (§12.3)                                                                                                                                          |
| S9  | Availability exceptions (`ResourceAbsence`)                                               | **Missing**                   | Unseeded; optional for v1 but enables realistic availability                                                                                                                                                 |
| S10 | Case ↔ scheduling linkage (Case→WorkOrder→ServiceAppointment, or Case `AssetId`/ship-to)  | **Partial**                   | Case ship-to + asset shipped in Node 4 4-Pre; WorkOrder↔Case link not verified for laptop Cases                                                                                                              |
| S11 | FLS perm set for AI API OAuth run-as user on **scheduling** objects                       | **Missing (Node 5-specific)** | **Pattern solved in Node 4** — see §2.4. New `Agentforce_Scheduling_Node5` perm set (§12.4) must be deployed **and assigned to the Connected App Run As user** (same as `Agentforce_Parts_Logistics_Node4`). |
| S12 | Salesforce Scheduling APIs (`AppointmentCandidates` / `getAppointmentSlots`) availability | **Partial / unverified**      | Field Service managed-package REST/Apex; v1 should **not** depend on it — use deterministic planner over operating hours (§8.4 / §13 R2)                                                                     |

**Overall verdict: PARTIAL.** No platform enablement blocker. The gating gaps are **skill data (S5–S7)** and **geography alignment (S3)**; both are 5-Pre seed-data tasks, plus the standard FLS perm-set step (S11).

---

## 5. Gap analysis

| Gap                                                     | Impact                                                                                       | Resolution                                                                                      | Phase   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| **No skill graph** (`Skill`/`ServiceResourceSkill` = 0) | "Best technician by skill" cannot rank; planner degrades to availability-only                | Seed laptop skills + assign to technicians; map asset/work-type → required skill                | 5-Pre   |
| **Single territory, no NA/EU geography**                | Cannot align technician location to Node 4 parts region; "location" dimension is meaningless | Seed NA (Austin) + EU territories, assign technicians, map ship-to region → territory           | 5-Pre   |
| **Domain mismatch (appliance vs laptop)**               | Demo scenario disjoint from Nodes 1–4; live proof won't be coherent                          | Add laptop WorkTypes + skills; reuse Node 4 demo Cases (Austin laptop Cases 00001046–00001050)  | 5-Pre   |
| **Parts-ETA gating not modeled anywhere**               | Risk of proposing windows before parts arrive                                                | Implement `earliestStart = max(partsEtaFloor, availability, now)` in planner (§3.5, §8.4)       | 5a      |
| **`scheduling` channel is namespace-only**              | No typed contract, no graph node                                                             | Add `dto/scheduling.ts`, graph node, sole-writer state key                                      | 5a      |
| **Verdict has no scheduling surface**                   | Operator can't see the proposed window in Final Verdict                                      | Add headline/summary/steps/highlights for scheduling (§10)                                      | 5a      |
| **PII risk: technician names**                          | Full names in status events / verdict violate `security-observability`                       | Use resource code / initials in events; full name only in approval payload if required (§13 R3) | 5a      |
| **No FLS for run-as user (scheduling objects)**         | SOQL `INVALID_FIELD` on scheduling reads at runtime                                          | Deploy `Agentforce_Scheduling_Node5` + assign to **OAuth Run As** — Node 4 pattern §2.4         | 5-Pre   |
| **No re-orchestration when parts become ready**         | `deferred`/`provisional` snapshots stay stale; scheduling never updates                      | §3.7 + [`re-orchestration-backlog.md`](./re-orchestration-backlog.md) — 5d reconcile            | 5d      |
| **Scheduling-API dependency risk**                      | `AppointmentCandidates` may be unavailable/slow/locked behind managed package                | v1 deterministic planner over `OperatingHours`/`TimeSlot`; API as later upgrade                 | 5a / 5b |
| **Shared approval gate ambiguity**                      | Adding scheduling approval to one gate muddies triage/parts semantics                        | Keep 5a non-gating; defer scheduling writes + approval to Node 6 / 5c                           | 5c      |

---

## 6. Phase 5-Pre — Salesforce preparation checklist

Complete before 5a coding. Each item: why · status · action.

### 6.1 Skill graph (S5–S7) — highest priority

- **Why:** the only way to rank "best technician by skill"; currently empty.
- **Status:** Missing.
- **Action:** Seed a small laptop service `Skill` set (e.g. `Laptop Hardware`, `Battery/Power`, `Display`, `Motherboard`, `Thermal`); create `ServiceResourceSkill` rows assigning skills (with `SkillLevel`) to A1/A2; add `SkillRequirement` to laptop WorkTypes so the planner can gate candidates. Seed script `scripts/sf/node5-pre-seed.sh` (§12.2).

### 6.2 Territory alignment (S3, S4) — align to Node 4 regions

- **Why:** technician "location" must agree with parts fulfillment region.
- **Status:** Partial (1 generic territory).
- **Action:** Create `ServiceTerritory` "North America" (Austin) and optionally "Europe"; set `OperatingHours`; add `ServiceTerritoryMember` for A1/A2; map Case ship-to region → territory in planner config.

### 6.3 Laptop WorkTypes + durations (S8)

- **Why:** appointment duration + skill requirement source.
- **Status:** Partial (appliance WorkTypes only).
- **Action:** Add laptop repair WorkType(s) with `EstimatedDuration`/`DurationType` and `SkillRequirement` links.

### 6.4 Availability realism (S9) — optional v1

- **Action:** Seed a `ResourceAbsence` to prove availability-exception handling (one tech unavailable → planner picks the other).

### 6.5 FLS perm set (S11)

- **Why:** Node 4 lesson — deploy ≠ readable; run-as user needs field perms.
- **Action:** `force-app/main/default/permissionsets/Agentforce_Scheduling_Node5.permissionset-meta.xml` granting read on `ServiceResource`, `ServiceTerritory`, `ServiceTerritoryMember`, `OperatingHours`, `TimeSlot`, `WorkType`, `Skill`, `ServiceResourceSkill`, `ServiceAppointment` (+ create on `ServiceAppointment` for 5c). Assign to CLI admin **and** AI API OAuth run-as user.

### 6.6 Validation script (exit criteria)

`scripts/sf/node5-pre-validation.sh Agent` asserts:

```bash
# Skills seeded and assigned
sf data query --target-org Agent --query "SELECT COUNT() FROM Skill"                 # > 0
sf data query --target-org Agent --query "SELECT COUNT() FROM ServiceResourceSkill"  # >= 2 (A1, A2)
# Geography aligned
sf data query --target-org Agent --query "SELECT Name FROM ServiceTerritory"         # includes North America
# Technicians active + territory members
sf data query --target-org Agent --query "SELECT COUNT() FROM ServiceResource WHERE IsActive = true"        # >= 2
sf data query --target-org Agent --query "SELECT COUNT() FROM ServiceTerritoryMember"                       # >= 2
# Laptop WorkType with duration + skill requirement
sf data query --target-org Agent --query "SELECT Name, EstimatedDuration FROM WorkType WHERE Name LIKE '%Laptop%'"
# FLS proof: run-as user can read ServiceResourceSkill (no INVALID_FIELD)
```

---

## 7. `scheduling` channel contract (proposed TypeScript)

Path: `apps/ai-api/src/orchestrator/dto/scheduling.ts`. Mirrors `parts-logistics.ts` conventions — sanitized, non-PII, self-contained, sole writer Node 5. **All technician identity is reference/initials, never full name.**

```typescript
import type { EvidenceConfidence } from "./customer-context";
export type { EvidenceConfidence } from "./customer-context";

export const SCHEDULING_NODE_ID = "scheduling" as const;

/** Aggregate schedulability outcome for the Case. */
export type SchedulingReadiness =
  | "schedulable" // committed window proposed
  | "provisional" // window depends on parts transfer / degraded reads
  | "deferred" // parts blocked — schedule only after parts confirmed
  | "unschedulable" // no eligible technician (skill/territory/availability)
  | "unknown"; // scheduling read failed

/** Which constraint set the earliest start floor (verdict explainability). */
export type EarliestStartBasis =
  | "parts_eta"
  | "technician_availability"
  | "sla_target"
  | "now";

/** Why a proposed plan needs Node 6 approval (5c writes). */
export type SchedulingApprovalReason =
  | "none"
  | "after_hours"
  | "sla_breach_risk"
  | "cross_territory"
  | "parts_not_ready";

/** A single ranked technician candidate (sanitized). */
export interface TechnicianCandidate {
  /** Stable, non-PII reference — resource code or initials (e.g. "SR-A1" / "A.R."). NEVER full name. */
  resourceReference: string;
  territoryReference?: string;
  /** Skills that matched the Case's required skill(s). */
  matchedSkills: string[];
  missingSkills?: string[];
  /** 0–1 sub-scores feeding the composite rank. */
  skillScore: number;
  availabilityScore: number;
  territoryFitScore: number;
  /** Composite rank score (higher = better); rank 1 is the recommendation. */
  rankScore: number;
  rank: number;
  /** Earliest this resource could start, ISO. */
  earliestAvailableAt?: string;
  /** Safe, non-PII rationale (no chain-of-thought, no PII). */
  rationale: string;
}

/** The proposed service window for the top candidate. */
export interface ProposedWindow {
  earliestStart: string; // ISO — floor after gating
  earliestStartBasis: EarliestStartBasis;
  proposedStart?: string; // ISO
  proposedEnd?: string; // ISO
  /** Human window, e.g. "Tomorrow 1–3 PM (after parts arrive)". */
  displayWindow?: string;
  durationMinutes?: number;
  windowConfidence: EvidenceConfidence;
  /** True when the window is bounded below by parts ETA, not availability. */
  partsEtaConstrained: boolean;
}

export interface SchedulingChannel {
  eligible: boolean;
  eligibilityReason?: string;
  degraded: boolean;
  degradedSources?: string[]; // e.g. ["salesforce_field_service"]

  status?: "PLANNED" | "PROVISIONAL" | "DEFERRED" | "UNSCHEDULABLE" | "SKIPPED";
  schedulingReadiness?: SchedulingReadiness;

  /** Ranked candidates (cap small, e.g. top 3). */
  candidates?: TechnicianCandidate[];
  /** Recommended technician = candidates[0]; convenience mirror. */
  recommendedResourceReference?: string;
  proposedWindow?: ProposedWindow;

  /** Parts dependency audit — why scheduling is/ isn't gated. */
  partsEtaConsidered: boolean;
  partsReadinessSeen?: "ready" | "partial" | "blocked" | "unknown" | "skipped";

  requiredApproval: boolean; // surfaced for Node 6; 5a does not gate on it
  approvalReason?: SchedulingApprovalReason;

  /** 5c — created ServiceAppointment after approval. Absent until write. */
  appointmentStatus?: "none" | "proposed" | "booked";
  appointmentReference?: string;

  confidence?: EvidenceConfidence;
  provider?: string;
  latencyMs?: number;
}

/** Cheap, config-driven eligibility (pure, no Salesforce access). */
export interface SchedulingEligibilityResult {
  eligible: boolean;
  reason: string;
}
```

Add `SCHEDULING_NODE_ID` to `OrchestratorNodeId` in `dto/case-triage-lifecycle.ts` and a `scheduling` annotation key to `CaseTriageState`.

---

## 8. Phase 5a — AI API implementation slice

### 8.1 New components (proposed paths)

| Component             | Path                                                          | Mirrors                              |
| --------------------- | ------------------------------------------------------------- | ------------------------------------ |
| DTO                   | `apps/ai-api/src/orchestrator/dto/scheduling.ts`              | `dto/parts-logistics.ts`             |
| Field Service gateway | `apps/ai-api/src/salesforce/salesforce-scheduling.gateway.ts` | `salesforce-inventory.gateway.ts`    |
| Planner               | `apps/ai-api/src/orchestrator/scheduling-planner.service.ts`  | `parts-logistics-planner.service.ts` |
| Eligibility policy    | in planner or `scheduling-eligibility.ts`                     | `isPartsLogisticsEligible`           |
| Graph node            | `scheduling` node in `case-triage.graph.ts`                   | `parts` node                         |
| Config flag           | `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED` (+ Railway env)      | `AI_API_ORCHESTRATOR_PARTS_ENABLED`  |

### 8.2 Graph wiring

- Add `SCHEDULING_NODE_ID` + `scheduling` channel annotation to `CaseTriageState`.
- Add deps to `CaseTriageGraphDeps`: `isSchedulingEligible(context, triagePriority, partsLogistics)` and `planScheduling(workflowId, context, partsLogistics, customerContext, triagePriority)` (degrade-safe, never throws).
- Add `.addNode("scheduling", …)` mirroring the `parts` node (eligibility skip → `emitRunning` read/plan/write status lines with `SCHEDULING_NODE_ID`).
- Replace edge `parts → gate` with `parts → schedule` and `schedule → gate`.
- **LangGraph naming:** graph node **`schedule`** (not `scheduling`) — node name must not collide with channel key `scheduling`. Status/lifecycle id remains `SCHEDULING_NODE_ID = "scheduling"`.
- `case-triage-orchestrator.service.ts`: pass `scheduling` into `buildVerdict()` input.

### 8.3 Gateway reads (SOQL shapes)

```sql
-- Technicians in the Case's territory with their skills
SELECT Id, Name, ResourceType, IsActive,
       (SELECT ServiceTerritory.Name, TerritoryType FROM ServiceTerritories),
       (SELECT Skill.MasterLabel, SkillLevel FROM ServiceResourceSkills)
FROM ServiceResource
WHERE IsActive = true AND ResourceType = 'T'

-- Operating-hours / time-slots for availability
SELECT Id, Name, (SELECT DayOfWeek, StartTime, EndTime, Type FROM TimeSlots)
FROM OperatingHours WHERE Id IN (:territoryOperatingHoursIds)

-- Existing appointments (to avoid double-booking) + absences
SELECT Id, ServiceTerritoryId, SchedStartTime, SchedEndTime, Status FROM ServiceAppointment
  WHERE SchedStartTime >= :windowStart
SELECT ResourceId, Start, End, Type FROM ResourceAbsence WHERE Start <= :windowEnd
```

Keys: rank on `Skill.MasterLabel` + territory name; never expose `ServiceResource.Name` (full name) in status events — derive a sanitized `resourceReference`.

**Territory membership (5-Pre reality):** A1/A2 are Primary in legacy `Abypro` and **Secondary (`S`)** in **North America**. Do **not** filter `TerritoryType = 'P'` only — include Secondary members when ship-to maps to NA. See [`node5-field-service-prep-lessons.md`](../context/node5-field-service-prep-lessons.md).

### 8.4 Deterministic planner algorithm (v1)

1. Derive **required skills** from `assetProductCode` / WorkType (config map, e.g. `AV-LP-15X-PRO → ["Laptop Hardware"]`; battery Case → add `Battery/Power`).
2. Derive **target territory** from Case ship-to region (reuse Node 4 region mapping: Austin → North America).
3. **Candidate filter:** active technicians in target territory possessing required skills (or all-skills tie-break when `SkillRequirement` absent → degrade with lower `skillScore`).
4. **Earliest start floor:** `max(partsEtaFloor, now)` where `partsEtaFloor = max(estimatedArrivalAt)` over required part plans (§3.5). Apply SLA target as a soft preference, not a hard floor.
5. **Availability:** first operating-hours/time-slot per candidate ≥ `earliestStart` that fits WorkType duration and doesn't collide with existing `ServiceAppointment`/`ResourceAbsence`.
6. **Rank:** `rankScore = w1·skillScore + w2·availabilityScore + w3·territoryFitScore` (+ SLA/priority/business-risk modifiers). Deterministic tie-break by `resourceReference`.
7. **Readiness:** map parts state + candidate availability → `schedulingReadiness` (§3.5 table). Set `earliestStartBasis`, `partsEtaConstrained`, `requiredApproval`/`approvalReason`.
8. **Degrade-safe:** any read failure → `degraded: true`, `degradedSources: ["salesforce_field_service"]`, best-effort or `unknown`, never throw.

> v1 uses a **deterministic planner over operating hours / time slots**, not the Field Service `AppointmentCandidates` API, to avoid managed-package coupling and latency (§13 R2). 5b can upgrade to the native scheduler.

---

## 9. Phase 5a — Frontend (React orchestration console)

Per `new-node-phase-completion-checklist.md`:

- `components/OrchestrationView.tsx` — add `scheduling` to `NODE_META`:
  > `label: "Node 5 · Scheduling"`, `shortLabel: "Scheduling"`, `description: "Ranks technicians by skill, territory, and availability, and proposes the earliest service window after parts ETA."`
- Add a stage card summarizing recommended technician reference, proposed window, readiness badge, and parts-gated reason.
- `lib/orchestration.ts` — sanitize/parse the `scheduling` channel (`OrchestrationScheduling` type; strip any stray full-name fields defensively).
- `app/orchestration/page.tsx` — subtitle lists **all** active nodes (Triage · Customer Context · Knowledge · Parts & Logistics · **Scheduling**).
- Component tests for the stage card (schedulable / provisional / deferred / unschedulable / degraded) and verdict copy.
- Refresh `AI_API_ORCHESTRATOR_VIEW_TOKEN` on Railway `react-chat-window` before blaming UI.

---

## 10. Phase 5a — Final Verdict rollup (do not skip)

Update **all four** surfaces in `orchestrator-verdict.synthesizer.ts` (this is the Node 4 gap that must not repeat):

| Surface            | Scheduling content                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `headline`         | clause e.g. `"technician scheduled"` / `"scheduling deferred (parts)"` / `"no technician available"`         |
| `summary`          | one sentence: recommended technician reference + window, or the blocking reason (parts ETA / no skill match) |
| `recommendedSteps` | e.g. `"Confirm appointment for <ref> on <window>."` or `"Schedule after parts confirmed (ETA <window>)."`    |
| `highlights`       | `Scheduling readiness`, `Technician`, `Territory`, `Proposed window`, `Window basis`, `Scheduling approvals` |
| `basis`            | push `"scheduling"` when channel present                                                                     |

Also:

- `orchestrator-verdict.synthesizer.spec.ts` — fixtures for `schedulable`, `provisional`, `deferred`, `unschedulable`, `degraded`, `skipped`.
- `dto/orchestrator-verdict.ts` comment lists all active nodes (Nodes 1–5).
- No PII: technician **reference/initials** only; respect `clip()` limits (headline 160, summary 400, step 240, ≤6 steps).

---

## 11. Config / feature flag

- `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED` (default `false`) in `app-config` + Railway `ai-api` env. Eligibility returns `eligible: false` with a safe reason when disabled.
- Optional tuning config: rank weights, region→territory map, asset→required-skill map, SLA targets (config JSON, mirror `data/warehouse-transit-rules.json` fallback pattern).

---

## 12. Phase 5-Pre — Salesforce metadata & seed (details)

### 12.1 Draft package / scripts

- `manifest/node5-pre-package.xml` — perm set + any custom fields (e.g. optional `ServiceResource.Technician_Code__c` for a stable non-PII reference).
- `scripts/sf/node5-pre-deploy.sh` — deploy + assign perm set (CLI + AI API user) + seed + validate.
- `scripts/sf/node5-pre-seed.sh` — skills, resource-skills, territories, members, laptop WorkType, optional absence.
- `scripts/sf/node5-pre-validation.sh` — §6.6 exit criteria.

### 12.2 Skill seed (illustrative)

| Skill (`MasterLabel`) | Assign to (`ServiceResourceSkill`, `SkillLevel`) |
| --------------------- | ------------------------------------------------ |
| Laptop Hardware       | A1 (9), A2 (7)                                   |
| Battery/Power         | A1 (8), A2 (5)                                   |
| Display               | A2 (8)                                           |
| Motherboard           | A1 (9)                                           |
| Thermal/Cooling       | A1 (6), A2 (7)                                   |

### 12.3 Laptop WorkType

| Name                       | EstimatedDuration | DurationType | SkillRequirement |
| -------------------------- | ----------------- | ------------ | ---------------- |
| Laptop Onsite Repair       | 2                 | Hours        | Laptop Hardware  |
| Laptop Battery Replacement | 1                 | Hours        | Battery/Power    |

### 12.4 Perm set

`Agentforce_Scheduling_Node5` — read on the §6.5 object list (+ create on `ServiceAppointment` for 5c). Assign to CLI admin **and** AI API OAuth run-as user (Node 4 lesson 0.6).

### 12.5 Relationship to the existing `Scheduling_Agent` bundle

The Salesforce `Scheduling_Agent` genAiPlannerBundle (`force-app/main/default/genAiPlannerBundles/Scheduling_Agent/`) is a **customer-facing washing-machine demo** (local Flow action `Create_a_Service_Appointment`, topic `Customer_Resolution`). Per `service-operations-operating-system.md`, do **not** reuse it for Node 5 — treat it as a reference. Node 5 reads Field Service directly via its own orchestrator gateway; the bundle's Flow action is a candidate pattern for the **5c gated write** only.

---

## 13. Risk assessment

| #   | Risk                                                                                                                               | Severity | Mitigation                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Empty skill graph** — "best technician by skill" has no data                                                                     | High     | 5-Pre seed (S5–S7); planner degrades to availability-only with lower confidence if absent                                                   |
| R2  | **Field Service scheduling-API coupling** (`AppointmentCandidates`/managed package) — availability, latency, locked behind license | High     | v1 deterministic planner over `OperatingHours`/`TimeSlot`; treat native scheduler as 5b upgrade                                             |
| R3  | **Technician PII** — full names in status events / verdict                                                                         | High     | Sanitized `resourceReference`/initials only; full name (if ever) only in Node 6 approval payload; defensive strip in `lib/orchestration.ts` |
| R4  | **Geography mismatch** — single `Abypro` territory, no NA/EU                                                                       | Medium   | 5-Pre seed NA (Austin) territory aligned to Node 4 regions                                                                                  |
| R5  | **Shared approval-gate ambiguity** — folding scheduling into the triage/parts gate                                                 | Medium   | 5a non-gating; scheduling writes + approval deferred to Node 6 / 5c; document gate meaning                                                  |
| R6  | **Domain-mismatched demo data** — appliance vs laptop → incoherent live proof                                                      | Medium   | 5-Pre laptop WorkTypes/skills; reuse Node 4 Austin laptop Cases for proof                                                                   |
| R7  | **No FLS for run-as user** — runtime SOQL returns nothing                                                                          | Medium   | `Agentforce_Scheduling_Node5` perm set on both users; validation asserts a read                                                             |
| R8  | **Parts-ETA floor wrong/missing** → window proposed before parts arrive                                                            | High     | `earliestStart = max(partsEtaFloor, …)`; `partsEtaConstrained` flag; verdict states the basis; unit tests for ready/partial/blocked         |
| R9  | **Double-booking** — ignoring existing appointments/absences                                                                       | Low      | Query `ServiceAppointment`/`ResourceAbsence` in window; collision check in planner                                                          |
| R10 | **Verdict gap repeat** — channel wired but not rolled into verdict                                                                 | Medium   | §10 four-surface update + spec fixtures; checklist review questions                                                                         |
| R11 | **Stale scheduling after parts arrive** — 5a is point-in-time; no auto refresh when transfer completes                             | High     | §3.7: 5a honest `deferred`/`provisional`; 5c fresh parts read at write; 5d event-driven `parts → scheduling` reconcile; Stop AI guard       |

---

## 14. Test plan + demo matrix

### 14.1 Unit / integration

- **Planner** (`scheduling-planner.service.spec.ts`): parts ready → near-now window; parts partial → window from transfer ETA, `provisional`; parts blocked → `deferred`, no committed window; no eligible technician → `unschedulable`; skill match ranks A1 over A2 for motherboard; absence removes a candidate; degraded read → `degraded: true`, no throw.
- **Gateway** (`salesforce-scheduling.gateway.spec.ts`): SOQL shape, sanitization (no full name leaks), read failure → degraded.
- **Eligibility:** flag off → skip; parts skipped but no-parts Case → still schedulable.
- **Graph** (`case-triage.graph.spec.ts`): order `parts → scheduling → gate`; `scheduling` is sole writer of its channel; non-interrupting.
- **Verdict** (`orchestrator-verdict.synthesizer.spec.ts`): fixtures per readiness state (§10).
- **UI:** stage card per readiness; subtitle lists Node 5.

### 14.2 Acceptance — Orchestrator (5a)

| #   | Criterion                                                                                         |
| --- | ------------------------------------------------------------------------------------------------- |
| B1  | Node runs after `parts`, before `gate`; non-interrupting                                          |
| B2  | Writes only `scheduling`; never mutates other channels                                            |
| B3  | Ranks technicians by skill + territory + availability; rank 1 = recommendation                    |
| B4  | Parts `ready` → `schedulable`, window ≥ parts ETA floor, `earliestStartBasis` set                 |
| B5  | Parts `partial` (transfer) → `provisional`, window from transfer ETA, `partsEtaConstrained: true` |
| B6  | Parts `blocked` → `deferred`, no committed window, reason surfaced                                |
| B7  | No eligible technician (skill/territory) → `unschedulable`                                        |
| B8  | Field Service read failure → `degraded: true`, graph continues                                    |
| B9  | No technician full name in any status event or verdict string                                     |
| B10 | Final Verdict headline + summary + ≥1 step mention scheduling when eligible                       |
| B11 | `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED=false` → clean skip                                       |

### 14.3 Acceptance — Writes (5c, post Node 6)

| #   | Criterion                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------- |
| C1  | Approved plan creates `ServiceAppointment` (+ `AssignedResource`) for the recommended technician/window |
| C2  | Appointment links to Case (via WorkOrder or `ParentRecordId`)                                           |
| C3  | Idempotent on workflow id + Case                                                                        |
| C4  | `appointmentStatus: booked`, `appointmentReference` surfaced                                            |

### 14.4 Demo matrix

| Case scenario                       | Parts state         | Expected Node 5 outcome                                     |
| ----------------------------------- | ------------------- | ----------------------------------------------------------- |
| Battery repair, Austin, parts local | `ready`             | A1 (Battery/Power) · earliest slot tomorrow · `schedulable` |
| Display repair, Austin, qty limited | `partial`           | A2 (Display) · window from transfer ETA · `provisional`     |
| Cross-region transfer (FRA→AUS)     | `partial`/`blocked` | Window pushed to ~42–74h ETA · `partsEtaConstrained: true`  |
| Motherboard, high-value             | `partial`           | A1 (Motherboard, skill rank) · approval surfaced for Node 6 |
| Simulated OOS / backorder           | `blocked`           | `deferred` — "schedule after parts confirmed"               |
| Field Service read fails            | any                 | `degraded`, graph continues                                 |
| Scheduling flag off                 | any                 | skipped cleanly                                             |

---

## 15. Recommended next step

1. **Approve** this plan: the `scheduling` contract (§7), parts-ETA gating rules (§3.5), and the 5-Pre / 5a / 5c split (§0.2).
2. Run **5-Pre** (§6, §12) on org `Agent` → `scripts/sf/node5-pre-validation.sh Agent` green.
3. Run **`/implement-node5-scheduling`** (implementation prompt to be added) for the 5a slice, behind `AI_API_ORCHESTRATOR_SCHEDULING_ENABLED`.
4. Live proof on a Node-4-passing Austin laptop Case (§14.4); defer 5c writes until Node 6 lands.

---

## 16. References

- Orchestrator flow: [`case-triage-orchestrator-flow.md`](./case-triage-orchestrator-flow.md)
- Node 4 pattern: [`node-4-parts-logistics-phase-plan.md`](./node-4-parts-logistics-phase-plan.md)
- Phase completion checklist: [`new-node-phase-completion-checklist.md`](./new-node-phase-completion-checklist.md)
- Service ops architecture: [`../agents/service-operations-operating-system.md`](../agents/service-operations-operating-system.md)
- Customer self-service / Scheduling Agent status: [`../agents/customer-self-service.md`](../agents/customer-self-service.md)
- Reserved channel namespace: [`service-workflow-remediation-backlog.md`](./service-workflow-remediation-backlog.md)
- Parts contract (upstream gate): [`../../apps/ai-api/src/orchestrator/dto/parts-logistics.ts`](../../apps/ai-api/src/orchestrator/dto/parts-logistics.ts)
- Graph: [`../../apps/ai-api/src/orchestrator/case-triage.graph.ts`](../../apps/ai-api/src/orchestrator/case-triage.graph.ts)
- Verdict synthesizer: [`../../apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`](../../apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts)
- Scheduling Agent bundle (reference only): `force-app/main/default/genAiPlannerBundles/Scheduling_Agent/`
- Skill stub: [`../../.agents/skills/langgraph-node5-scheduling/SKILL.md`](../../.agents/skills/langgraph-node5-scheduling/SKILL.md)
- [Field Service scheduling data model](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/fsl_dev_soap_intro.htm)
- [AppointmentCandidates / getAppointmentSlots REST](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/fsl_rest_getappointmentcandidates.htm)

---

## Appendix A — Live audit log (2026-06-16, org `Agent`)

```text
Org: Agent (mohitchaudhary27.08.03.467400114157@agentforce.com), API 67.0, Developer Edition

ServiceResource          2    (A1 Techinican, A2 Techinican — active, type T, User-backed)
ServiceTerritory         1    (Abypro)
ServiceTerritoryMember   2    (A1, A2 → Abypro, Primary)
ServiceAppointment       3
AssignedResource         3
OperatingHours           2
TimeSlot                 25
WorkType                 2    (Repaire 5h, AC Diagnostic and Repair 3h — appliance domain)
WorkOrder                2
Skill                    0    ← empty (skill ranking blocked)
ServiceResourceSkill     0    ← empty (technician→skill assignment blocked)
SkillRequirement         0/unseeded
ResourceAbsence          0/unseeded
```

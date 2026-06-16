# Re-Orchestration Backlog (Nodes 1–8)

> **Problem:** The case-triage orchestrator runs as a **single point-in-time graph** per trigger. Cases, inventory, parts transfers, technician availability, and human operator actions change continuously. Channel outputs (`triage`, `customerContext`, `knowledgeGuidance`, `partsLogistics`, future `scheduling`) become **stale** after the workflow reaches `done` or while an operator works the Case manually.
>
> **Canonical companion:** [`node-5-scheduling-phase-plan.md`](./node-5-scheduling-phase-plan.md) §3.7 (scheduling-specific gating + reconcile phases).

---

## Program rules (mandatory for all node work)

**Every** orchestrator node change, new channel, Salesforce write, or UI surface **must** be reviewed against this backlog. See also:

- `.github/instructions/langgraph-orchestrator.instructions.md` — **Re-orchestration (mandatory)**
- `docs/orchestrator/new-node-phase-completion-checklist.md` — **Re-orchestration & manual takeover**
- `.github/prompts/plan-node5-scheduling.prompt.md` — planning harness references this doc

### Design invariants

1. **Point-in-time honesty** — A channel records what the orchestrator knew **at run time**. `deferred`, `provisional`, `partial`, and `degraded` states must not imply live Salesforce truth after the run ends.
2. **No silent freshness** — Do not imply inventory, scheduling, or triage recommendations stay current unless a **re-orchestration** or **fresh read at write time** occurred.
3. **Manual takeover wins** — When an operator stops AI orchestration on a Case, **no future auto-triggers** fire for that Case until explicitly re-enabled.
4. **Machines use typed channels** — Re-orchestration refreshes channels; humans may read the Final Verdict snapshot as historical context only.

---

## Cross-cutting capabilities (not shipped)

| ID   | Capability                                       | Priority | Description                                                                                                                                                                              |
| ---- | ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC-1 | **Stop AI orchestration** (UI + API + Case flag) | P0       | Operator button on the read-only orchestration console and Case record. Sets `AI_Orchestration_Status__c = stopped_by_user` (proposed). Blocks new triggers and reconcile for that Case. |
| RC-2 | **Trigger guard** (Salesforce Flow)              | P0       | `Case_Triage_Orchestrator_Handoff` checks `AI_Orchestration_Status__c` before enqueueing. Respects stop flag and optional `AI_Orchestration_Suppressed_Until__c`.                        |
| RC-3 | **Reconcile API**                                | P1       | `POST /orchestrator/case-triage/cases/:caseId/reconcile` — partial re-run from a named node (`parts`, `scheduling`, …) with fresh SF reads. New workflow id or versioned snapshot.       |
| RC-4 | **Event-driven reconcile**                       | P1       | Salesforce Flow on `ProductTransfer` status, `ProductItem` quantity, `ServiceAppointment` change → reconcile trigger when Case linked and AI not stopped.                                |
| RC-5 | **Write-time fresh read**                        | P1       | Before any gated SF write (parts 4c, scheduling 5c), **re-read** upstream dependencies and abort/degrade if stale vs. channel.                                                           |
| RC-6 | **Correlation / idempotency**                    | P2       | Use `correlationId` on triggers to avoid duplicate workflows for the same Case event (currently validated but unused).                                                                   |
| RC-7 | **Durable checkpointer**                         | P2       | Move off in-memory `MemorySaver` so mid-graph reconcile/resume survives ai-api restart.                                                                                                  |

---

## Stop AI — operator manual takeover

### User story

> As a service rep working a Case manually, I want to **stop AI orchestration** so the system does not keep re-planning triage, parts, or scheduling over my work.

### Proposed behavior

| Action                                                                 | System response                                                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator clicks **Stop AI orchestration** on `/orchestration?caseId=…` | Confirm dialog → `POST /orchestrator/case-triage/cases/:caseId/stop` (scope: `agentforce:orchestrator-approval` or dedicated `orchestrator-control`)                                   |
| API succeeds                                                           | Case `AI_Orchestration_Status__c = stopped_by_user`; current workflow marked `superseded` or `stopped` in read model; UI shows banner **"AI orchestration stopped — manual handling"** |
| Case updated after stop                                                | **No** auto Flow handoff; **no** reconcile jobs                                                                                                                                        |
| Operator clicks **Resume AI orchestration** (optional v2)              | Clears stop flag; next qualifying Case event may trigger a **new** workflow                                                                                                            |

### UI (React `OrchestrationView`)

- Show **Stop AI orchestration** when workflow is `running`, `waiting_approval`, or `done` (last run) and Case not already stopped.
- Disabled when Case already `stopped_by_user`.
- **Not** an approval control — separate from Node 6 guardrail.
- Requires auth beyond view token (operator session or scoped bearer) — view token alone stays read-only.

### Salesforce metadata (backlog)

- `Case.AI_Orchestration_Status__c` — picklist: `active | stopped_by_user | suppressed`
- `Case.AI_Orchestration_Stopped_At__c`, `Case.AI_Orchestration_Stopped_By__c` (optional audit)
- Update `Case_Triage_Orchestrator_Handoff` Flow entry criteria

---

## Per-node re-orchestration matrix (Nodes 1–4 shipped)

What goes stale, what should trigger a refresh, and minimum reconcile scope.

### Node 1 — Routing & Triage

| Stale when                                                                | Typical triggers                                   | Reconcile scope                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| Case priority/severity changed manually; new comments; queue reassignment | Case field update, new `CaseComment`, owner change | `readContext → runTriage` (or full graph if downstream depends on priority) |
| Operator stopped AI                                                       | Stop button                                        | **No** re-run                                                               |

**Backlog items:** N1-R1 — triage-only reconcile endpoint; N1-R2 — verdict shows _"based on run at &lt;timestamp&gt;"_ when snapshot age &gt; threshold.

### Node 2 — Customer History

| Stale when                                                  | Typical triggers              | Reconcile scope                                        |
| ----------------------------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| New Cases on account; warranty change; asset install/remove | Account/Asset/Entitlement DML | `customerHistory` node with fresh `readCustomerBundle` |
| External adapter data refresh                               | Scheduled job                 | Same                                                   |

**Backlog items:** N2-R1 — document max snapshot age for SLA/warranty in channel metadata (`asOf` timestamp — partial today via package fields).

### Node 3 — Knowledge Base

| Stale when                                                  | Typical triggers   | Reconcile scope                      |
| ----------------------------------------------------------- | ------------------ | ------------------------------------ |
| KB corpus updated; new articles; retrieval namespace change | RAG re-index event | `knowledge` node only                |
| Case description materially edited                          | Case update        | `knowledge` (+ possibly `runTriage`) |

**Backlog items:** N3-R1 — `knowledgeGuidance.retrievedAt` in channel; N3-R2 — reconcile when Case description diff exceeds threshold.

### Node 4 — Parts & Logistics

| Stale when                                                               | Typical triggers                                                      | Reconcile scope                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ProductItem` quantity changes; transfer completes; shipment ETA updates | `ProductTransfer` status, `ProductItem` qty, `Shipment` delivery date | **`parts` node** (fresh inventory gateway read)                                     |
| Approval created `ProductTransfer` / `ProductRequest` (4c)               | Post-write                                                            | Re-run `parts` planner to refresh `reservationStatus` + ETA — **not shipped today** |
| Parts were `blocked` at first run; stock arrives later                   | Inventory receipt                                                     | **`parts → scheduling`** (when Node 5 ships)                                        |

**Backlog items:** N4-R1 — post-4c write refresh of `partsLogistics` channel; N4-R2 — Flow on transfer complete → reconcile; N4-R3 — **mandatory fresh inventory read before 4c write** (mirror 5c rule).

**Current gap (shipped):** Node 4 reads inventory **once** at graph time. Resume from gate does **not** re-run `parts`. New trigger creates a new `workflowId`.

---

## Node 5+ (planned)

See [`node-5-scheduling-phase-plan.md`](./node-5-scheduling-phase-plan.md) §3.7:

| Phase  | Re-orchestration scope                                                      |
| ------ | --------------------------------------------------------------------------- |
| **5a** | Point-in-time only — `deferred` / `provisional` honest for that run         |
| **5c** | Mandatory fresh `parts` read before `ServiceAppointment` create             |
| **5d** | Event-driven `parts → scheduling` reconcile when fulfillment status changes |

---

## Session-based planning note

Each planning or implementation session should record:

1. Which nodes are **point-in-time only** in the current phase.
2. Which **reconcile triggers** are deferred to a later phase.
3. Whether **Stop AI** is in scope for that UI slice.

Do not mark a node phase complete without explicit re-orchestration decisions documented in the phase plan §0 and this backlog.

---

## Recommended implementation order

1. **RC-1 + RC-2** — Stop AI (Case field + Flow guard + API) — unblocks manual work safely.
2. **RC-5** — Fresh read at write time for parts 4c and scheduling 5c.
3. **RC-3** — Reconcile API for `parts` (highest stale-data pain).
4. **RC-4** — Salesforce event → reconcile for transfer complete / stock receipt.
5. **RC-6, RC-7** — Idempotency + durable checkpointer.

---

## Verification checklist (when implementing any item)

- [ ] Stopped Case does not receive new triggers (Flow + API integration test).
- [ ] Reconcile produces new channel `asOf` / workflow version; UI shows latest.
- [ ] Final Verdict indicates stale vs. fresh when snapshot age exceeds policy.
- [ ] Write paths re-read upstream state; abort or degrade on conflict.
- [ ] Stop AI button requires operator auth, not view token alone.

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
| RC-8 | **Operator orchestration login**                 | P1       | Replace static `AI_API_ORCHESTRATOR_VIEW_TOKEN` on `react-chat-window` with login-gated session minting. Prerequisite for RC-1 Stop AI auth. See § Operator login below.                 |

---

## Operator login — orchestration console (RC-8)

### Problem (v1 scaffolding)

The read-only orchestration console at `/orchestration` proxies to ai-api via a **static** JWT in Railway env (`AI_API_ORCHESTRATOR_VIEW_TOKEN`). That token:

- Expires when its `exp` claim passes (ai-api `jwt.verify` rejects it).
- Breaks when `AI_API_JWT_SECRET` rotates on ai-api without a matching refresh on `react-chat-window`.
- Is shared by all viewers — no per-operator audit subject.
- Cannot safely carry control scopes (Stop AI, reconcile) — read-only by design today.

Manual mint + `railway variable set` is an ops workaround, not the target design.

### User story

> As an internal operator or service rep, I want to **log in** to the orchestration console so I can view workflow status without ops manually refreshing Railway tokens, and so future control actions (Stop AI) are tied to my session.

### Proposed behavior

| Action                                    | System response                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unauthenticated visit to `/orchestration` | Show operator login screen (mirror customer-chat `LoginCard` pattern).                                                                                 |
| Successful login                          | `POST /auth/operator-orchestration/session` on ai-api validates credential → mints JWT with `agentforce:orchestrator-read` (short TTL, e.g. 8h shift). |
| Session storage                           | **httpOnly cookie** on `react-chat-window`; browser never sees the bearer. `/api/orchestrator/*` proxies attach it server-side.                        |
| Logout                                    | Clear cookie; user must log in again. (Stateless JWT may remain valid until `exp`; v1 accepts short TTL; v2 optional session revocation registry.)     |
| Token refresh                             | Optional: silent refresh before `exp` while cookie session active.                                                                                     |

### Auth tiers (phased)

| Phase     | Credential                                                        | Notes                                             |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| **RC-8a** | Operator access code in env (`ORCHESTRATOR_OPERATOR_ACCESS_CODE`) | Same pattern as customer chat; internal/demo UAT. |
| **RC-8b** | Salesforce SSO / OAuth for service reps                           | Production ops console.                           |

### Scope discipline (mandatory)

| Scope                              | Console use                                                        |
| ---------------------------------- | ------------------------------------------------------------------ |
| `agentforce:orchestrator-read`     | Poll workflow snapshot — **RC-8 mints this**                       |
| `agentforce:orchestrator-control`  | Stop AI, future reconcile — add to session when RC-1 / RC-3 ship   |
| `agentforce:orchestrator-approval` | **Never in browser** — out-of-band only (SF Approval, email links) |

### NestJS (ai-api)

- New `POST /auth/operator-orchestration/session` (or extend auth module sibling to `customer-chat/session`).
- Rate-limit login attempts (mirror customer chat guard).
- Config: `ORCHESTRATOR_OPERATOR_ACCESS_CODE`, `ORCHESTRATOR_OPERATOR_SESSION_TTL_SECONDS` (default 28800 = 8h).
- Fail closed when access code or JWT secret not configured.

### React (`apps/react-chat-window`)

- Gate `/orchestration` behind operator login (reuse `LoginCard` UX patterns; separate copy/branding from customer chat).
- New `POST /api/operator-orchestration/session` proxy route.
- Update `/api/orchestrator/[workflowId]` and `/api/orchestrator/case/[caseId]` to read session cookie instead of `AI_API_ORCHESTRATOR_VIEW_TOKEN`.
- Logout control clears cookie and returns to login.

### Exit criteria

- [ ] No `AI_API_ORCHESTRATOR_VIEW_TOKEN` required on Railway for normal console use.
- [ ] Console survives ai-api JWT secret rotation (operators re-login; no ops runbook for static token refresh).
- [ ] RC-1 Stop AI can require the same operator session (not view token alone).
- [ ] Focused tests: ai-api session mint + react proxy + login gate.

### Deprecation

Once RC-8 ships, remove `AI_API_ORCHESTRATOR_VIEW_TOKEN` from `.env.example`, deploy runbooks, and `new-node-phase-completion-checklist.md` (replace with operator login checklist).

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
- Requires auth beyond view token — **RC-8 operator session** (or scoped bearer); static view token alone stays read-only until RC-8 ships.

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

## Node 6 — Compliance & Guardrail (6a shipped; re-orchestration deferred to 6c)

6a shipped `evaluateGuardrail` (the sole interrupting node) operating on point-in-time channel snapshots. The guardrail pauses on `requireHumanApproval`; channels can go stale during the wait. Added after 6a ships ([`node-6-guardrail-phase-plan.md`](./node-6-guardrail-phase-plan.md) §15):

| ID    | Item                                                                                                  | Phase |
| ----- | ----------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID    | Item                                                                                                  | Phase | Status                                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------- | ----- | ------                                                                                                                                                                                                          |
| N6-R1 | Approval timeout → auto-escalate (configurable SLA) when the approver never responds                  | 6c    | **DONE (code-complete + unit-green 2026-06-22)** — `GuardrailApprovalTimeoutService` interval sweep; direct snapshot+Case settle, never `resume()`, no SF token; config OFF by default. Live SLA proof pending. |
| N6-R2 | Stop AI guard at `evaluateGuardrail` — check `AI_Orchestration_Status__c` before `interrupt()` (RC-1) | 6c    | **DONE** — stop check at top of `evaluateGuardrail` → `stopped` terminal; Apex callback guard + NestJS terminal backstop.                                                                                       |
| N6-R3 | Reconcile API (RC-3) must skip threads in `waiting_approval`; never resume stopped workflows          | 6c    | Contract documented (`stopped` terminal blocks resume); RC-3 reconcile API itself out of scope.                                                                                                                 |
| N6-R4 | Channel staleness on long approvals — escalation notice when the approval wait exceeds threshold      | 6c    | Deferred — hard-timeout escalate (N6-R1) covers the SLA; warning-threshold email is a follow-up (email OFF this rollout).                                                                                       |

> **RC-1 / RC-2 / RC-8 status (2026-06-22):** RC-1 Stop AI (Case `AI_Orchestration_Status__c` + `POST …/cases/:caseId/stop` + `orchestrator-control` scope + React button/banner) and RC-2 Handoff Flow `<filterFormula>` guard are **code-complete + unit-green**. RC-8a operator session (`POST /auth/operator-orchestration/session` → httpOnly cookie via the Next.js BFF) is **code-complete + unit-green**. Live SF deploy/validate + smoke S1–S5 + Railway env flips pending. See [`node6-6c-stop-ai-lessons.md`](../context/node6-6c-stop-ai-lessons.md).

5c `applySchedulingWrite` (unblocked by 6a) must do a write-time fresh parts read (RC-5) before `ServiceAppointment` create, aborting/degrading if parts no longer match the approved channel.

---

## Session-based planning note

Each planning or implementation session should record:

1. Which nodes are **point-in-time only** in the current phase.
2. Which **reconcile triggers** are deferred to a later phase.
3. Whether **Stop AI** is in scope for that UI slice.

Do not mark a node phase complete without explicit re-orchestration decisions documented in the phase plan §0 and this backlog.

---

## Recommended implementation order

1. **RC-8** — Operator orchestration login — removes static view-token ops pain; prerequisite for safe RC-1 UI auth.
2. **RC-1 + RC-2** — Stop AI (Case field + Flow guard + API) — uses RC-8 session + `orchestrator-control` scope.
3. **RC-5** — Fresh read at write time for parts 4c and scheduling 5c.
4. **RC-3** — Reconcile API for `parts` (highest stale-data pain).
5. **RC-4** — Salesforce event → reconcile for transfer complete / stock receipt.
6. **RC-6, RC-7** — Idempotency + durable checkpointer.

---

## Verification checklist (when implementing any item)

- [x] Stopped Case does not receive new triggers — NestJS `/triggers` 409 `orchestration_stopped` + Handoff Flow `<filterFormula>` guard (unit-green; live Flow+API integration proof pending).
- [ ] Reconcile produces new channel `asOf` / workflow version; UI shows latest.
- [ ] Final Verdict indicates stale vs. fresh when snapshot age exceeds policy.
- [ ] Write paths re-read upstream state; abort or degrade on conflict.
- [x] Stop AI button requires RC-8 operator session (cookie), not static view token alone — the stop proxy 401s without the `orchestrator_session` cookie; the read-only view token lacks `orchestrator-control`.
- [~] Orchestration console uses an RC-8a login session for control — Stop AI is session-gated; full removal of the static `AI_API_ORCHESTRATOR_VIEW_TOKEN` for the read path is a follow-up.

---
mode: agent
description: "Plan Node 6 hardening (6c): Stop-AI guard, approval timeout, SF approver stamps, Case layout, RC-1 manual takeover."
---

# Plan Node 6 Hardening + Stop AI Manual Takeover (6c + RC-1 + SF polish)

**Planning only.** Produce a phase plan document and implementation harness stubs. Do **not** write production code in this session unless a blocker requires a spike.

## User goals (this track)

1. **Finish Node 6 hardening**
   - **Stop-AI guard** — respect operator manual takeover before `interrupt()` and on SF callback
   - **Approval timeout** — no indefinite `waiting_approval`; escalate or terminal when SLA exceeded
2. **Improve Salesforce experience**
   - Stamp **`AI_Guardrail_Approver__c`** and **`AI_Guardrail_Decision_At__c`** on approve/reject
   - Add **Approval History** to Case Lightning page layout
   - Commit **queue members** in `Agentforce_Guardrail_Approvers.queue-meta.xml` (demo org parity)
3. **Stop AI / manual takeover (RC-1)**
   - Operators can **stop orchestration safely** from the console
   - Block new auto-triggers and guardrail callbacks while stopped

## What is already shipped (do not replan)

| Artifact                                  | Status                                       |
| ----------------------------------------- | -------------------------------------------- |
| 6a `evaluateGuardrail` + composite policy | **Live**                                     |
| 6b+ SF Approval submit + callback resume  | **Live** — Case 00001059/00001060 proof      |
| Post-approval verdict rollup              | **Live** — `approvalDecision` in synthesizer |
| Queue `Agentforce_Guardrail_Approvers`    | **Deployed** (adhoc→queue)                   |
| Email approval routing                    | **Code-complete; flag off** — out of scope   |

## Read first (skill order)

1. `docs/orchestrator/re-orchestration-backlog.md` — RC-1, RC-2, RC-8, N6-R1–R4
2. `docs/orchestrator/node-6-guardrail-phase-plan.md` — §6c, §15 (N6-R1–R4)
3. `docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md` — §9 Re-orchestration hooks
4. `docs/context/node6-sf-approval-lessons.md` — R2 idempotency, callback wiring, deferred §9
5. `docs/context/node6-6b-approval-routing-lessons.md`
6. `docs/orchestrator/case-triage-orchestrator-flow.md` — §6 (UI read-only; Stop AI ≠ Approve)
7. `.agents/skills/langgraph-human-in-the-loop/SKILL.md`
8. `.agents/skills/langgraph-node6-guardrail/SKILL.md`
9. `docs/orchestrator/new-node-phase-completion-checklist.md` — re-orchestration + UI gates

## Planning deliverables

Create **`docs/orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md`** with:

### 1. Executive summary

- Why Stop AI + timeout belong together with 6b+ SF Approval (operators own Cases in SF; AI must not fight manual work or hang forever).
- Explicit boundary: **Stop AI is not guardrail Approve/Reject** — separate control surface and scopes.

### 2. End-to-end flows (mermaid)

**Flow A — Stop AI before interrupt**

```
readContext → … → evaluateGuardrail
  → IF Case AI_Orchestration_Status__c = stopped_by_user
      → reject terminal (or skip interrupt — pick one, document)
  → ELSE requireHumanApproval → submit SF Approval → interrupt()
```

**Flow B — Stop AI while waiting_approval**

```
Operator clicks Stop AI on console
  → POST /cases/:caseId/stop
  → Case flag stopped_by_user
  → workflow read model = stopped
  → SF callback (if approver acts later) → no-op ack (do not resume writeBack)
```

**Flow C — Approval timeout**

```
waiting_approval + elapsed > ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS
  → scheduled job OR graph resume with decision=escalated (document pick)
  → Case AI_Guardrail_Status__c = escalated
  → terminal escalated (no 4c/5c writes)
```

### 3. Phase breakdown

| Phase                        | Scope                                                                                                                                                                             | Exit criteria                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **6c-Pre**                   | SF: `AI_Orchestration_Status__c` (+ optional stopped audit fields); workflow field updates for approver + decision-at; Approval History on Case layout; Handoff Flow guard (RC-2) | `sf project deploy validate` |
| **6c-a**                     | NestJS: read orchestration status in `readContext` or guardrail dep; N6-R2 before `interrupt()`; callback no-op when stopped                                                      | Unit + graph specs           |
| **6c-b**                     | NestJS: approval timeout (config + scheduler or polling seam); N6-R1 auto-escalate; idempotent                                                                                    | Unit + graph specs           |
| **RC-1a**                    | `POST /orchestrator/case-triage/cases/:caseId/stop`; scope `agentforce:orchestrator-control`; Case write-back                                                                     | API contract tests           |
| **RC-1b**                    | React: Stop AI button + confirm + banner; requires RC-8 **or** interim scoped bearer                                                                                              | UI smoke                     |
| **RC-8a** (if RC-1b blocked) | Operator login session — plan minimal path for Stop AI auth                                                                                                                       | Session mint + proxy         |
| **6c-c**                     | Live proof: Case → waiting_approval → Stop AI → approve in SF → callback no-op; timeout proof on test workflow                                                                    | Smoke + SF field assertions  |

**Recommended order:** 6c-Pre → 6c-a → RC-1a → 6c-b → RC-8a (if needed) → RC-1b → 6c-c.

### 4. Salesforce design

#### 4.1 New / extended Case fields

| Field                            | Type                                                | Purpose                           |
| -------------------------------- | --------------------------------------------------- | --------------------------------- |
| `AI_Orchestration_Status__c`     | Picklist: `active`, `stopped_by_user`, `suppressed` | RC-1 master flag                  |
| `AI_Orchestration_Stopped_At__c` | DateTime                                            | Audit (optional v1)               |
| `AI_Orchestration_Stopped_By__c` | Text(255) or Lookup User                            | Audit alias only — no PII in logs |
| `AI_Guardrail_Approver__c`       | Existing — wire on approve/reject                   | Approver display name or user id  |
| `AI_Guardrail_Decision_At__c`    | Existing — wire on approve/reject                   | Decision timestamp                |

#### 4.2 Workflow field updates (extend `Case.workflow-meta.xml`)

On **final approve**: set `AI_Guardrail_Status__c=approved`, `AI_Guardrail_Decision_At__c=NOW()`, `AI_Guardrail_Approver__c={!ApprovalRequest.Process_Approver}` (or equivalent — document formula).

On **final reject**: mirror with `rejected`.

#### 4.3 Case Lightning layout

- Add **Approval History** related list to the Case record page used in demo (document page API name).
- Optional: section **AI Orchestrator Review** already has verdict fields — confirm visible during approval.

#### 4.4 Flow guard (RC-2)

Update `Case_Triage_Orchestrator_Handoff` entry criteria:

```
NOT(ISPICKVAL(AI_Orchestration_Status__c, "stopped_by_user"))
```

#### 4.5 Callback guard (6c-a)

In `AgentforceGuardrailApprovalCallback` (or Flow formula): if `AI_Orchestration_Status__c = stopped_by_user`, skip callout (log + ack).

### 5. NestJS design

#### 5.1 Stop-AI guard (N6-R2)

| Location                                 | Behavior                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `evaluateGuardrail` node (pre-interrupt) | If stopped → `reject` or `escalated` terminal **without** `interrupt()` — document choice |
| `sf-approval-callback`                   | If stopped → `{ applied: false, status: "stopped" }` — no resume                          |
| `POST …/resume` (Bearer)                 | If stopped → 409 `orchestration_stopped` — document                                       |

**Context source:** extend `readContext` / Case context DTO with `orchestrationStatus` from SF read (degrade-safe if field absent).

#### 5.2 Approval timeout (N6-R1)

| Option                                                                       | Tradeoff                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **A** In-process timer per `waiting_approval` workflow                       | Simple demo; lost on restart (document)                      |
| **B** Railway cron / NestJS `@Cron` scans store for stale `waiting_approval` | Survives single instance; needs durable store for RC-7 later |
| **C** SF Scheduled Flow on Case `pending_approval` age                       | SF-native; couples timeout to Case field                     |

**Config:**

- `ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS` (default e.g. 86400)
- `ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ACTION` = `escalate` | `reject` (default `escalate`)

**Requirements:**

- Idempotent — duplicate timeout handler must not double-escalate
- Mint no SF callback token for `escalated` from timeout (R6)
- Update Case `AI_Guardrail_Status__c=escalated` when SF submit was used

#### 5.3 Stop API (RC-1)

```
POST /orchestrator/case-triage/cases/:caseId/stop
Scope: agentforce:orchestrator-control
Body: { reason?: string }  // optional, non-PII
Response: { caseId, status: "stopped_by_user", workflowId?, stoppedAt }
```

Side effects:

1. Write Case `AI_Orchestration_Status__c` via Salesforce gateway (mirror writeBack pattern)
2. Mark in-memory workflow snapshot `status: stopped` (or `superseded`)
3. Do **not** cancel pending ProcessInstance automatically in v1 — document manual recall vs auto-recall tradeoff

#### 5.4 Auth for Stop AI (RC-8 dependency)

| Phase       | Auth                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| **Interim** | Extend operator mint script / short-lived bearer with `agentforce:orchestrator-control` |
| **Target**  | RC-8a operator session cookie — Stop AI uses same session as console read               |

Plan must state: **static `AI_API_ORCHESTRATOR_VIEW_TOKEN` cannot call stop** — read-only scope only.

### 6. React console (RC-1b)

| UI element                       | Rule                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| **Stop AI orchestration** button | Visible when `status ∈ {running, waiting_approval, done}` AND Case not `stopped_by_user` |
| Confirm dialog                   | Plain language: stops future AI runs; does not undo SF approvals already pending         |
| Banner                           | `AI orchestration stopped — manual handling` when Case stopped                           |
| **No** Approve/Reject            | Unchanged — SF Approval only                                                             |

Proxy route: `POST /api/orchestrator/case/:caseId/stop` → ai-api with operator session or control scope.

### 7. Re-orchestration interactions (N6-R3, N6-R4)

Document in plan:

| ID    | Rule                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------- |
| N6-R3 | `POST …/reconcile` (RC-3 future) must **refuse** threads in `waiting_approval`                    |
| N6-R4 | Optional escalation notice email/supervisor ping if wait > warning threshold (defer if email off) |
| RC-7  | Timeout + Stop AI state lost on restart until durable checkpointer — call out residual risk       |

### 8. Smoke / proof matrix

| Scenario                     | Steps                                                              | Pass                                                                 |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **S1 Stop before interrupt** | Stop Case → new trigger → graph does not reach `waiting_approval`  | No ProcessInstance created                                           |
| **S2 Stop during wait**      | waiting_approval → Stop AI → SF approve → callback `applied:false` | Workflow stays stopped; no writeBack                                 |
| **S3 Timeout**               | Short timeout in test env → auto-escalate                          | `status=escalated`, Case guardrail status updated                    |
| **S4 SF stamps**             | Approve in Items to Approve                                        | `AI_Guardrail_Approver__c` + `AI_Guardrail_Decision_At__c` populated |
| **S5 Layout**                | Open Case during pending approval                                  | Approval History visible                                             |

Env flags for smoke:

```bash
# S3 only
ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS=60
```

### 9. Test plan

| Layer                              | Tests                                                             |
| ---------------------------------- | ----------------------------------------------------------------- |
| `guardrail-policy` / graph         | Stop flag skips interrupt; timeout escalates                      |
| `case-triage-orchestrator.service` | stop endpoint; callback no-op when stopped                        |
| Apex                               | Callback skips when orchestration stopped; workflow field updates |
| React                              | Stop button visibility; banner when stopped                       |
| E2E (optional)                     | S2 on Case similar to 00001060 recipe                             |

### 10. Out of scope (explicit)

- Email approval rollout (`ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED`)
- React Approve/Reject buttons
- Full RC-3 reconcile API implementation (plan hooks only)
- Postgres checkpointer (RC-7)
- Policy matrix / scoring changes

### 11. Artifacts to scaffold (no prod code unless spike)

- `docs/orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md` (this deliverable)
- `manifest/node6-6c-stop-ai-pre-package.xml`
- `scripts/sf/node6-6c-stop-ai-pre-deploy.sh` (stub)
- `.github/prompts/implement-node6-hardening-stop-ai.prompt.md` (implementation harness — create after plan approved)
- Optional: `docs/context/node6-6c-stop-ai-lessons.md` placeholder

## Planning session exit checklist

- [ ] Phase plan doc written with mermaid flows and phase table
- [ ] RC-8 vs interim auth decision documented for Stop AI
- [ ] Timeout mechanism (A/B/C) chosen with rationale
- [ ] SF workflow field-update formulas validated against ProcessInstance fields
- [ ] Handoff Flow guard criteria drafted
- [ ] Smoke scenarios S1–S5 assigned to phases
- [ ] Implementation prompt stub linked from phase plan § Next

$ARGUMENTS

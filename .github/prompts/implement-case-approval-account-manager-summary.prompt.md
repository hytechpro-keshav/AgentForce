---
mode: agent
description: "Implement Case approval Account Manager summary, five agent narratives, and Salesforce UI visibility."
---

# Implement Case Approval — Account Manager Summary & Agent Narratives

Implement per **`docs/orchestrator/case-approval-account-manager-summary-plan.md`**. Do not replan unless blocked.

## Problem

Guardrail submit **already stamps** `AI_Orchestrator_Verdict_*` on the Case (proof: Case `00001187`), but:

- Salesforce **UI does not show** verdict fields (no layout section).
- Approval inbox shows only generic submitter comment.
- Copy says **“human approval”** — business wants **“Account Manager approval”**.
- No **per-agent narratives** on the Case feed.

## Scope

### In

- **Phase A:** Executive Account Manager summary paragraph + replace user-facing “human approval” copy
- **Phase B:** Five private `CaseComment` posts (one per **visible** stepped-console agent)
- **Phase C:** Case layout “AI Orchestrator Review” + `Agentforce_Guardrail_Approver` perm set + deploy package
- **Phase D:** Focused tests + live UAT notes

### Out

- React Approve/Reject buttons (console stays read-only)
- Email approval channel (`ORCHESTRATOR_GUARDRAIL_EMAIL_NOTIFICATION_ENABLED` stays false)
- Separate **Agent 2 – Customer History** comment (Customer History is folded into Triage in UI)
- LLM-generated Case comment prose (deterministic from typed channels only)
- New custom field unless `AI_Orchestrator_Verdict_Summary__c` is insufficient (prefer reuse for v1)

## Canonical five-agent UI model (mandatory)

| Visible agent          | UI stage | Backend                          | Case comment label              |
| ---------------------- | -------- | -------------------------------- | ------------------------------- |
| Triage                 | 01       | Node 1 + Node 2 Customer History | **Agent 1 – Triage**            |
| Knowledge Base         | 03       | Node 3                           | **Agent 2 – Knowledge Base**    |
| Parts & Logistics      | 04       | Node 4                           | **Agent 3 – Parts & Logistics** |
| Scheduling             | 05       | Node 5                           | **Agent 4 – Scheduling**        |
| Compliance & Guardrail | 06       | Node 6                           | **Agent 5 – Guardrail**         |

Source: `apps/react-chat-window/lib/stepped-view-model.ts` (`NODE_DEFS` — `customer_history` not in visible spine).

**Agent 1 comment must include** `customerContext` (business risk, warranty, repeat failure, prior-case signals). **Never** post a separate Customer History comment.

## Read first

1. `docs/orchestrator/case-approval-account-manager-summary-plan.md` ← **primary**
2. `docs/orchestrator/node-6-guardrail-sf-approval-phase-plan.md` §4.1 (verdict fields)
3. `docs/context/node6-sf-approval-lessons.md` (degrade-safe, idempotency)
4. `docs/orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md` §4.3 (layout retrieve-then-edit)
5. `.agents/skills/langgraph-node6-guardrail/SKILL.md`
6. `.github/instructions/langgraph-orchestrator.instructions.md`
7. `.github/instructions/nest-ai-api.instructions.md`
8. `.github/instructions/salesforce-agentforce.instructions.md`

## Phases (in order — do not skip A before B)

### Phase A — Executive summary + Account Manager copy

| Task | Detail                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | Add `buildAccountManagerExecutiveSummary(input)` — plain paragraph from all channels at `waiting_approval`                                                                                                          |
| A2   | Target copy pattern: _“This is a {priority} service request with {risk} business risk. The AI recommends {parts action} and {scheduling action}. Account Manager approval is required because {guardrail reason}.”_ |
| A3   | Use executive paragraph for `AI_Orchestrator_Verdict_Summary__c` at submit; keep technical `headline` separate                                                                                                      |
| A4   | Replace user-facing **“human approval”** in `orchestrator-verdict.synthesizer.ts`, `guardrail-approval-notification.service.ts` fallback                                                                            |
| A5   | Apex `AgentforceGuardrailApprovalService.submit()` — enrich `setComments()` with executive summary + policy reason + console URL (not generic-only)                                                                 |
| A6   | Optional: SOQL Account Owner name for summary prefix; degrade to “Account Manager” if missing; **no full names in NestJS logs**                                                                                     |
| A7   | Unit tests: Case 00001187-style fixture; assert no “human approval” in SF-facing strings                                                                                                                            |

**Exit:** Approval submitter comment and Case summary field contain the executive paragraph with Account Manager wording.

### Phase B — Five agent Case comments

| Task | Detail                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | --------- | ----- | ---------- | ------------------------------------------------------- |
| B1   | New `agent-case-narrative.builder.ts` (or similar) — five deterministic builders from typed channels                                |
| B2   | `SalesforceCaseGateway.postCaseComment(caseId, body)` — `IsPublished: false`; mirror `applyWriteBack` pattern                       |
| B3   | Wire into graph/service after each visible stage completes (see comment trigger map in plan §7.2)                                   |
| B4   | Agent 1: merge `triage` + `customerContext`; Agent 2: conclusions not article titles only; Agent 5: Account Manager + policy reason |
| B5   | Idempotency: key `workflowId:agent:{triage                                                                                          | knowledge | parts | scheduling | guardrail}` — no duplicate comments on guardrail resume |
| B6   | Post Agent 5 comment **before** SF approval submit                                                                                  |
| B7   | Degrade-safe: comment failure must **not** break graph or `interrupt()`                                                             |
| B8   | Unit tests per narrative + idempotency + graph spec hook                                                                            |

**Exit:** Approvable case feed shows exactly **5** private comments labeled Agent 1–5; no Customer History label.

### Phase C — Salesforce UI metadata

| Task | Detail                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| C1   | `sf project retrieve start --metadata Layout:Case-Case\ Layout` (resolve actual layout API name from org first)   |
| C2   | Add section **“AI Orchestrator Review”** with all verdict + guardrail + console URL + workflow id fields          |
| C3   | Add **Approval History** related list                                                                             |
| C4   | New `permissionsets/Agentforce_Guardrail_Approver.permissionset-meta.xml` — read-only on verdict/guardrail fields |
| C5   | `manifest/case-approval-summary-package.xml` + optional `scripts/sf/case-approval-summary-pre-deploy.sh`          |
| C6   | `sf project deploy validate` for changed metadata                                                                 |
| C7   | Assign approver perm set to `Agentforce_Guardrail_Approvers` queue members in runbook (not secrets in repo)       |

**Exit:** Open Case during `pending_approval` — AI Orchestrator Review section visible with populated fields.

### Phase D — Proof

| Task | Detail                                                                              |
| ---- | ----------------------------------------------------------------------------------- |
| D1   | `npm run ai-api:test` — focused specs only                                          |
| D2   | `sf apex run test` — `AgentforceGuardrailApprovalServiceTest` + new tests           |
| D3   | Live UAT on approvable case (NOT 00001050 escalate / 00001054 autoApprove)          |
| D4   | Update plan doc status + optional `docs/context/` lesson if layout retrieve gotchas |

## Key files to touch

| Layer           | Paths                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| Synthesizer     | `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts` (+ spec)                |
| Narratives      | `apps/ai-api/src/orchestrator/agent-case-narrative.builder.ts` (+ spec)                    |
| Gateway         | `apps/ai-api/src/salesforce/salesforce-case.gateway.ts` (+ spec)                           |
| Graph / service | `apps/ai-api/src/orchestrator/case-triage.graph.ts`, `case-triage-orchestrator.service.ts` |
| Notification    | `apps/ai-api/src/orchestrator/guardrail-approval-notification.service.ts`                  |
| DTO             | `apps/ai-api/src/orchestrator/dto/guardrail.ts` (if submit command extended)               |
| Apex            | `force-app/main/default/classes/AgentforceGuardrailApprovalService.cls` (+ test)           |
| SF metadata     | `force-app/main/default/layouts/`, `permissionsets/`, `manifest/`                          |

## Constraints

- **No PII** in comments, verdict, approval payload, or API logs (part numbers + warehouse refs OK)
- **Idempotent** submit and comments (reuse 6b R2 `Map<workflowId, …>` pattern for routing; extend for comments)
- **Degrade-safe** end-to-end — SF comment/layout/FLS failures must not prevent `interrupt()`
- **Deterministic** narratives only — no extra LLM call for Case comments
- Internal enum `requireHumanApproval` unchanged; only **display copy** changes
- Do **not** hand-author Case layout from scratch — retrieve-then-edit per 6c lessons

## Acceptance checklist (all must pass)

### Language

- [ ] No user-facing “human approval” on Case, approval inbox, or agent comments
- [ ] Guardrail: “Account Manager approval is required because…”

### Executive summary

- [ ] Plain paragraph: priority, business risk, parts, scheduling, policy reason
- [ ] In `AI_Orchestrator_Verdict_Summary__c` and approval submitter comment

### Five agent comments

- [ ] Agent 1 – Triage includes customer context / prior-case signals
- [ ] Agent 2 – Knowledge states conclusions, not only article names
- [ ] Agents 3–5 cover parts, scheduling, guardrail policy
- [ ] No separate Customer History comment

### Salesforce UI

- [ ] Case layout section visible
- [ ] Approver can read verdict fields (perm set)

## Tests before handoff

```bash
npm run ai-api:test -- --testPathPattern="orchestrator-verdict|agent-case-narrative|guardrail-approval|salesforce-case"
sf apex run test --tests AgentforceGuardrailApprovalServiceTest --result-format human --wait 10
sf project deploy validate --manifest manifest/case-approval-summary-package.xml
```

Live UAT (org `AgentForce`):

1. Orchestrate approvable case → `waiting_approval`
2. Case feed: 5 agent comments
3. Case layout: AI Orchestrator Review populated
4. Approval inbox: executive summary in submitter comments
5. Approve → callback resumes

## Open decisions (use plan defaults unless user overrides)

| ID  | Default                                      |
| --- | -------------------------------------------- |
| D1  | Labels: **Agent 1–5**                        |
| D2  | Account Owner name when resolvable           |
| D3  | Narratives in **CaseComment only** (v1)      |
| D4  | Keep **both** headline + executive paragraph |

$ARGUMENTS

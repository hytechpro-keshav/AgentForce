# Node 6 Phase 6c — Stop AI Live Proof Runbook

> **Purpose:** Org-dependent proof for Stop AI manual takeover (RC-1), approval timeout → auto-escalate (N6-R1), callback stop guard (N6-R2), and SF approver/decision stamps (6c-Pre).
> **Code baseline:** commit `550e92b` (2026-06-22) — implementation is code-complete; this runbook covers deploy, env, S1–S5, and smoke wiring only.
> **Companions:** [`node-6-guardrail-6c-stop-ai-phase-plan.md`](../orchestrator/node-6-guardrail-6c-stop-ai-phase-plan.md) §8 · [`node6-6c-stop-ai-lessons.md`](../context/node6-6c-stop-ai-lessons.md) · [`node6-sf-approval-lessons.md`](../context/node6-sf-approval-lessons.md)

---

## A. Prerequisites

| Item                       | Value                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **Org**                    | AgentForce — `https://orgfarm-d96842e593-dev-ed.develop.my.salesforce.com`                  |
| **Org alias**              | `AgentForce`                                                                                |
| **ai-api**                 | `https://ai-api-production-03f5.up.railway.app`                                             |
| **Console**                | `https://react-chat-window-production.up.railway.app/orchestration?caseId=<CaseId>`         |
| **Approver queue**         | `Agentforce_Guardrail_Approvers` — approve via **Items to Approve**, not the Case header    |
| **6b+ flags (already on)** | `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED=true`, `ORCHESTRATOR_APPROVAL_TOKEN_SECRET` set |

### Railway env vars (ai-api)

Set on Railway `ai-api` production (use placeholders in docs — never commit secrets):

| Variable                                               | Purpose                       | Example              | Proof scenario             |
| ------------------------------------------------------ | ----------------------------- | -------------------- | -------------------------- |
| `ORCHESTRATOR_OPERATOR_ACCESS_CODE`                    | Operator session mint (RC-8a) | `<your-access-code>` | S1, S2, console Stop AI    |
| `ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED`      | Enable timeout sweep (6c-b)   | `true`               | S3 only                    |
| `ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS`      | Short SLA for proof           | `60`–`120`           | S3                         |
| `ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SCAN_SECONDS` | Sweep interval                | `30`                 | S3 (optional; default 300) |
| `ORCHESTRATOR_GUARDRAIL_SF_APPROVAL_ENABLED`           | SF Approval routing (6b+)     | `true`               | S2, S4                     |
| `ORCHESTRATOR_APPROVAL_TOKEN_SECRET`                   | Callback token mint           | `<secret>`           | S2, S4                     |

Restart `ai-api` after env changes.

---

## B. Salesforce deploy (6c-Pre)

```bash
# From repo root — validate (may fail on unrelated org tests; use targeted deploy below)
./scripts/sf/node6-6c-stop-ai-pre-deploy.sh AgentForce

# Targeted deploy if validate fails on unrelated org tests:
sf project deploy start --target-org AgentForce \
  --source-dir force-app/main/default/objects/Case/fields/AI_Orchestration_Status__c.field-meta.xml \
  --source-dir force-app/main/default/permissionsets/Agentforce_Guardrail_Node6.permissionset-meta.xml

sf project deploy start --target-org AgentForce \
  --metadata ApexClass:AgentforceGuardrailApprovalCallback \
  --metadata ApexClass:AgentforceGuardrailApprovalCallbackTest \
  --test-level RunSpecifiedTests \
  --tests AgentforceGuardrailApprovalCallbackTest

sf project deploy start --target-org AgentForce \
  --source-dir force-app/main/default/flows/Case_Triage_Orchestrator_Handoff.flow-meta.xml
```

**Capture deploy job IDs (AgentForce 2026-06-22):**

| Step                      | Deploy ID                              | Status                   |
| ------------------------- | -------------------------------------- | ------------------------ |
| Field + perm set          | `0Afg500000APvyHCAT`                   | Succeeded                |
| Apex callback             | `0Afg500000AQ9MuCAL`                   | Succeeded (8 Apex tests) |
| Handoff Flow              | `0Afg500000AQTDVCA5`                   | Succeeded                |
| Railway ai-api            | `857db122-152c-45c7-8290-7de064fb6594` | SUCCESS                  |
| Railway react-chat-window | `65155c3e-3fc9-415b-8b5d-4117410f08c3` | SUCCESS                  |

**Verify field exists:**

```bash
sf data query --target-org AgentForce --query \
  "SELECT Id, CaseNumber, AI_Orchestration_Status__c FROM Case LIMIT 1"
```

**Apex test note:** `ProcessInstanceStep` has no `CompletedDate` — stamp uses `SystemModstamp` (see lessons).

---

## C. Case layout — Approval History (manual org step)

No Case layout exists in source. Retrieve-then-edit:

```bash
# 1. List layouts to find the demo Case layout API name
sf org list metadata --metadata-type Layout --target-org AgentForce | grep -i case

# 2. Retrieve (adjust API name to match org)
sf project retrieve start --target-org AgentForce \
  --metadata "Layout:Case-Case Layout"

# 3. Edit the retrieved layout XML — add Approval History related list
# 4. Deploy the layout back
sf project deploy start --target-org AgentForce \
  --source-dir force-app/main/default/layouts/
```

**Fallback:** add Approval History via Setup → Object Manager → Case → Page Layouts → edit demo layout → Related Lists → Approval History. Screenshot for evidence (not source-controlled).

**Sales Console — Approval Requests nav (S5 companion):** retrieve `standard__LightningSalesConsole` — adds tab `standard-ProcessInstanceWorkitem` (Items to Approve list). Path: `force-app/main/default/applications/standard__LightningSalesConsole.app-meta.xml`.

---

## D. Railway deploy

Deploy code at `550e92b` (or later with 6c fixes):

```bash
SERVICE=ai-api ./scripts/deploy/railway-quick-deploy.sh
SERVICE=react-chat-window ./scripts/deploy/railway-quick-deploy.sh
```

---

## E. Operator session + Stop API auth

### Console (RC-8a + RC-1b)

1. Open `https://react-chat-window-production.up.railway.app/orchestration?caseId=<CaseId>`
2. Enter operator access code → **Sign in**
3. BFF: `POST /api/orchestrator/operator-session` → sets httpOnly `orchestrator_session` cookie
4. **Stop AI** button visible when `status ∈ {running, waiting_approval, done}` and Case not already stopped
5. Confirm dialog → `POST /api/orchestrator/case/<caseId>/stop` (proxy reads cookie)

### Headless Stop (smoke / curl)

Mint a control-scoped JWT via Railway (needs `AI_API_JWT_SECRET` in the mint environment):

```bash
CONTROL_TOKEN=$(cd /path/to/AgentForce && railway run \
  --service ai-api --environment production \
  node scripts/smoke/phase4-mint-jwt.mjs \
    --scope "agentforce:orchestrator-read agentforce:orchestrator-control" \
    --tenant tenant-demo \
    --namespace customer-self-service \
    --ttl-seconds 3600)

curl -sS -X POST \
  "https://ai-api-production-03f5.up.railway.app/orchestrator/case-triage/cases/<CaseId>/stop" \
  -H "authorization: Bearer ${CONTROL_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"reason":"smoke manual takeover"}' | jq .
```

**Important:** the static `AI_API_ORCHESTRATOR_VIEW_TOKEN` (read-only, `agentforce:orchestrator-read`) **cannot** call `/stop` — it lacks `agentforce:orchestrator-control`. Expect **403**.

### Operator session mint (curl, for debugging)

```bash
curl -sS -X POST \
  "https://ai-api-production-03f5.up.railway.app/auth/operator-orchestration/session" \
  -H "content-type: application/json" \
  -d '{"accessCode":"<ORCHESTRATOR_OPERATOR_ACCESS_CODE>"}' | jq .
```

Returns JWT in body; the Next.js BFF sets the httpOnly cookie (not for direct browser use from curl).

---

## F. Demo Case rules

| Case #   | Case Id              | Outcome                         | Usable for S1–S3?                  |
| -------- | -------------------- | ------------------------------- | ---------------------------------- |
| 00001050 | `500g500000YpQMnAAN` | **escalate** @ 70+              | ❌ No HITL interrupt               |
| 00001054 | `500g500000axxLtAAI` | **autoApprove** @ 15            | ❌ Never pauses                    |
| 00001059 | `500g500000bBzvhAAC` | Already approved                | ❌ Used for 6b+ proof              |
| 00001060 | `500g500000brYPdAAM` | **requireHumanApproval** recipe | ✅ Reference (may need fresh Case) |

**Approvable Case recipe** (lands `requireHumanApproval`, score 25–79):

- **Account:** SF Guardrail Smoke Co — `001g500000SIGB7AAP`
- **Asset:** `SN-GUARDRAIL-SMOKE-001` (`02ig5000000f5OjAAI`)
- **Description:** `SP-BATT-15X` locally + `SP-CHG-65W` from remote warehouse
- **Ship-to:** Austin, TX, US
- **Priority:** Medium (not Critical — avoids escalate band)

Create a fresh Case for each proof run (prior workflows pollute state):

```bash
sf data create record --target-org AgentForce --sobject Case --values \
  "AccountId=001g500000SIGB7AAP Subject='6c Stop AI proof' Status=New Origin=Web Priority=Medium \
   AssetId=02ig5000000f5OjAAI Service_Ship_To_City__c=Austin Service_Ship_To_State__c=TX Service_Ship_To_Country__c=US \
   Description='Field service needs SP-BATT-15X locally and SP-CHG-65W from remote warehouse. Product AV-LP-15X-PRO.'" \
  --json
```

Reset stop flag before a new run:

```bash
sf data update record --target-org AgentForce --sobject Case --record-id <CaseId> \
  --values "AI_Orchestration_Status__c=active AI_Guardrail_Status__c="
```

---

## G. S1–S5 scenarios

### S1 — Stop before interrupt

|           |                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Steps** | 1. Set `AI_Orchestration_Status__c=stopped_by_user` on Case (Stop API or SF field edit)<br>2. `POST /orchestrator/case-triage/triggers` with same Case |
| **Pass**  | Snapshot `status=stopped`; no `ProcessInstance`; `/triggers` → **409** `orchestration_stopped`                                                         |

```bash
# Stop first (control token)
curl -sS -X POST ".../cases/<CaseId>/stop" -H "authorization: Bearer ${CONTROL_TOKEN}" ...

# Then trigger — expect 409
curl -sS -w '\n%{http_code}\n' -X POST ".../triggers" \
  -H "authorization: Bearer ${AGENTFORCE_TOKEN}" \
  -d '{"caseId":"<CaseId>"}'
```

### S2 — Stop during `waiting_approval`

|           |                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Steps** | 1. Trigger workflow on approvable Case → wait for `waiting_approval`<br>2. `POST …/cases/:caseId/stop` (control token)<br>3. Approve in SF **Items to Approve** |
| **Pass**  | Apex skips callout; snapshot stays `status=stopped`; `stoppedAt` set; `writeBackApplied=false`; late resume → `applied:false` if hit                            |

```bash
ASSERT_STOP_AI=1 SF_CASE_ID=<CaseId> ./scripts/smoke/all-3-nodes-deployed.sh
```

### S3 — Approval timeout

|           |                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Steps** | 1. Enable timeout env (short SLA)<br>2. Trigger approvable Case → `waiting_approval`<br>3. Do **not** approve; wait past SLA + one sweep |
| **Pass**  | `status=escalated`; Case `AI_Guardrail_Status__c=escalated`; no SF callback token minted                                                 |

```bash
ASSERT_APPROVAL_TIMEOUT=1 \
  ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED=true \
  ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS=60 \
  SF_CASE_ID=<CaseId> \
  ./scripts/smoke/all-3-nodes-deployed.sh
```

### S4 — SF approver/decision stamps

|           |                                                                                             |
| --------- | ------------------------------------------------------------------------------------------- |
| **Steps** | Approve in **Items to Approve** on a Case that was **not** stopped                          |
| **Pass**  | `AI_Guardrail_Approver__c` = approver `User.Alias`; `AI_Guardrail_Decision_At__c` populated |

```bash
sf data query --target-org AgentForce --query \
  "SELECT CaseNumber, AI_Guardrail_Approver__c, AI_Guardrail_Decision_At__c, AI_Guardrail_Status__c \
   FROM Case WHERE Id = '<CaseId>'"
```

### S5 — Approval History on layout

|           |                                                    |
| --------- | -------------------------------------------------- |
| **Steps** | Open Case in SF Lightning during pending approval  |
| **Pass**  | Approval History related list visible on Case page |

Manual UI check + screenshot.

---

## H. Smoke harness invocation

```bash
# S1/S2 — Stop AI during wait (skips auto-resume)
ASSERT_STOP_AI=1 SF_CASE_ID=<CaseId> ./scripts/smoke/all-3-nodes-deployed.sh

# S3 — timeout escalate (needs timeout env ON + short SLA on Railway)
ASSERT_APPROVAL_TIMEOUT=1 \
  ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_ENABLED=true \
  ORCHESTRATOR_GUARDRAIL_APPROVAL_TIMEOUT_SECONDS=60 \
  SF_CASE_ID=<CaseId> \
  ./scripts/smoke/all-3-nodes-deployed.sh
```

**Constraints:**

- `ASSERT_STOP_AI=1` skips the harness auto-resume at `waiting_approval` so stop can be asserted first
- Fail loud if `AI_Orchestration_Status__c` not deployed, control scope missing, or Case lands escalate/autoApprove
- S4/S5 remain manual (SF CLI field query + layout screenshot)

---

## I. Evidence checklist (2026-06-22)

| Scenario | Case #   | workflowId   | Snapshot status      | `stoppedAt`          | SF orch status  | SF guardrail | Notes                                                                   |
| -------- | -------- | ------------ | -------------------- | -------------------- | --------------- | ------------ | ----------------------------------------------------------------------- |
| S1       | 00001062 | wf-33e22a75… | —                    | 2026-06-22T12:52:56Z | stopped_by_user | —            | `/triggers` → 409                                                       |
| S2       | 00001064 | wf-9ea68129… | stopped              | 2026-06-22T12:54:45Z | stopped_by_user | —            | `ASSERT_STOP_AI` green                                                  |
| S3       | —        | wf-a6893141… | escalated            | —                    | active          | escalated    | ~88s; `ASSERT_APPROVAL_TIMEOUT` green                                   |
| S4       | 00001065 | wf-bbb839a4… | done (after approve) | —                    | active          | approved     | `MChaudha` + `2026-06-23T06:06:12Z`                                     |
| S5       | 00001065 | —            | —                    | —                    | —               | —            | **Done** — Approval History on Case Layout (submitted + approved steps) |

---

## J. Expected snapshot shapes (from unit tests — confirm live)

**Stop API response (200):**

```json
{
  "caseId": "500…",
  "status": "stopped_by_user",
  "workflowId": "wf-…",
  "stoppedAt": "2026-06-22T…Z"
}
```

**Snapshot after stop during wait:**

```json
{
  "status": "stopped",
  "stoppedAt": "2026-06-22T…Z",
  "stopReason": "manual takeover",
  "writeBackApplied": false,
  "guardrail": null
}
```

> **Live note:** `guardrail` is often `null` on the stopped snapshot because the interrupt commits guardrail after pause (R2). The harness reached `waiting_approval` before stop was applied.

**Late resume after stop:**

```json
{ "status": "stopped", "applied": false }
```

---

## Exit gate

- [x] 6c-Pre deployed + `AgentforceGuardrailApprovalCallbackTest` green
- [x] Approval History on Case layout (S5) — Case Layout + related list live on 00001065
- [x] Railway env set + services deployed
- [x] S1–S5 executed with evidence (S4/S5 manual UI proof 2026-06-23)
- [x] `ASSERT_STOP_AI` and `ASSERT_APPROVAL_TIMEOUT` green on approvable Case
- [x] Lessons + phase plan status → live proof complete

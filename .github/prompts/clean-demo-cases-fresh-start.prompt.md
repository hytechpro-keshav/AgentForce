---
name: "Clean Demo Cases — Fresh Start"
description: "Safely delete demo/test Salesforce Cases (and optional orchestration artifacts) in org AgentForce so triage customer-history counts start clean. Planning + execution with before/after proof."
agent: "Tenant Onboarding Operator"
argument-hint: "Org alias (default AgentForce), scope: all-cases | demo-only | account-name, dry-run true|false"
tools: [read, search, execute, todo, agent]
agents:
  - "Agentforce Reviewer"
  - "Release Checker"
---

# Execution mode — clean Cases for fresh demo/triage testing

You are cleaning **Salesforce Cases** so demo triage is not skewed by stale **prior-case / repeat-incident** counts (e.g. 30+ incidents on an account from old test runs).

**Default org:** `AgentForce` (demo / pilot only — **never** run bulk delete against a production customer org without explicit user confirmation).

## Why this is needed

Customer context reads **all prior Cases on the Account**. Old demo Cases inflate:

- `priorCaseCount` / `repeatIncident.count`
- `businessRisk` → triage priority bumps to **high** even for “routine” scenarios

Deleting Cases (or scoping to demo accounts) gives a **fresh** triage signal.

## User-provided context

```text
${input}
```

Defaults when empty:

- Org: **AgentForce**
- Scope: **demo-only** (Cases with `Origin = 'Web'` on seeded demo accounts — safer than org-wide delete)
- Mode: **dry-run first**, then execute only after counts are shown

---

## Safety rules (mandatory)

1. **Confirm org** before any delete: `sf org display --target-org <alias>`
2. **Dry-run**: query + count + sample Case numbers; show user before delete
3. **Never** delete Accounts, Contacts, Assets, Entitlements — **Cases only** (and optional child records listed below if user approves)
4. **Never** print secrets, tokens, or bearer JSON
5. If Case count > **200**, require explicit user approval or narrow scope (date filter / account filter)
6. **Do not** delete Cases with `Status = 'Closed'` that user marked as keepers — unless scope is `all-cases` and user confirmed

---

## Scope options

| Scope                       | SOQL filter (adjust account names to org)                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| **demo-only** (recommended) | `Origin = 'Web' AND CreatedDate = LAST_N_DAYS:30` on demo accounts         |
| **account**                 | `Account.Name = '<name>'` (e.g. `University of Arizona`, `Aptivance tech`) |
| **all-cases**               | All Cases in org — **dangerous**; require explicit confirmation            |

Demo accounts commonly used (query live — do not assume Ids):

- `University of Arizona` (scenario catalog)
- `Aptivance tech` (skill default)
- Any account returned by demo case create lookups

---

## Pre-flight (run in order)

```bash
# 1. Confirm org
sf org display --target-org AgentForce

# 2. Count Cases by scope (example: demo Web cases last 30 days)
sf data query --target-org AgentForce --query \
  "SELECT COUNT() FROM Case WHERE Origin = 'Web' AND CreatedDate = LAST_N_DAYS:30" --json

# 3. Sample what will be deleted (first 20)
sf data query --target-org AgentForce --query \
  "SELECT Id, CaseNumber, Subject, Status, Account.Name, CreatedDate FROM Case \
   WHERE Origin = 'Web' AND CreatedDate = LAST_N_DAYS:30 \
   ORDER BY CreatedDate DESC LIMIT 20" --result-format human

# 4. Per-account prior-case noise (why triage was wrong)
sf data query --target-org AgentForce --query \
  "SELECT Account.Name, COUNT(Id) cnt FROM Case \
   WHERE Origin = 'Web' GROUP BY Account.Name ORDER BY COUNT(Id) DESC LIMIT 10" --result-format human
```

Report counts and **stop** if user did not confirm delete.

---

## Delete execution

### Option A — Bulk delete (preferred for >10 Cases)

```bash
# Export Ids to CSV (Id column only)
sf data query --target-org AgentForce --query \
  "SELECT Id FROM Case WHERE Origin = 'Web' AND CreatedDate = LAST_N_DAYS:30" \
  --result-format csv > /tmp/cases-to-delete.csv

# Verify row count matches dry-run
wc -l /tmp/cases-to-delete.csv

# Bulk delete
sf data delete bulk --target-org AgentForce --sobject Case --file /tmp/cases-to-delete.csv --wait 10
```

### Option B — Small batches (≤10 Cases)

```bash
sf data delete record --target-org AgentForce --sobject Case --record-id <CASE_ID>
```

### Optional — reset AI triage fields instead of delete (if Cases must be kept)

Only when user asks to **keep** Cases but clear orchestration noise:

```bash
sf data update bulk --target-org AgentForce --sobject Case --file /tmp/case-ai-reset.csv --wait 10
```

CSV columns: `Id`, `AI_Triage_Status__c`, `AI_Triage_Workflow_Id__c`, `AI_Orchestration_Status__c`, `AI_Guardrail_Status__c` — set to empty or `active` per field API.

---

## Related cleanup (only if user asks)

| Object                               | When to clean                                                 |
| ------------------------------------ | ------------------------------------------------------------- |
| `ProductTransfer` / `ProductRequest` | After Node 4 write-back demos                                 |
| `ServiceAppointment`                 | After Node 5 booking demos                                    |
| Railway orchestrator snapshots       | In-memory — **restart not required**; new Case = new workflow |

Do **not** delete Knowledge / RAG corpus or inventory seed data unless explicitly requested.

---

## Post-delete verification

```bash
# Should be 0 (or much lower) for scoped filter
sf data query --target-org AgentForce --query \
  "SELECT COUNT() FROM Case WHERE Origin = 'Web' AND CreatedDate = LAST_N_DAYS:30" --json

# Confirm demo account prior-case count dropped
sf data query --target-org AgentForce --query \
  "SELECT COUNT() FROM Case WHERE Account.Name = 'University of Arizona'" --json
```

---

## Fresh demo test (after clean)

1. Open https://react-chat-window-production.up.railway.app/demo/case-create
2. Pick **Same-day battery fix** (or custom form with clean account)
3. **Create case & step through**
4. On stepped console **01 Triage** expect:
   - Lower `repeatIncident` / `prior cases` if account is clean
   - Priority closer to scenario intent (often **normal** for routine battery)
5. Optional API check (operator session): `GET /api/orchestrator/<workflowId>`

Skill: `.agents/skills/salesforce-case-create/SKILL.md`

---

## Acceptance criteria

- [ ] Dry-run counts shown before any delete
- [ ] Org alias confirmed as demo/pilot (`AgentForce`)
- [ ] Scoped delete completed (or user-approved `all-cases`)
- [ ] Post-delete COUNT query proves reduction
- [ ] One new demo Case created; triage repeat count no longer inflated by old runs
- [ ] No secrets logged

## Final response format

Return:

1. Org alias and scope used
2. Cases deleted (count) + sample Case numbers removed
3. Before/after COUNT per demo account
4. Commands run
5. URL for fresh demo case create
6. Any blockers (permissions, bulk job failures)

Do not commit unless user asks.

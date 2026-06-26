# University of Arizona — Demo Case Cleanup (Battery Scenario)

> Use before running **Same-day battery fix** (`same-day-battery-fix`) so Node 1 triage is not skewed by stale prior Cases on the UofA account.

## Why cleanup matters

The **same-day battery fix** scenario creates Cases on account **University of Arizona** with:

- `Origin = Web` (demo / catalog create path)
- Asset `SN-PRO15X-2026-0041A` (ProBook 15X)

Before asset-scoped repeat logic, **any** Web Case on that account in the last 30 days inflated `repeatIncident.count` and bumped `businessRisk` → triage priority to **high** even for routine battery work.

After code fixes, repeat counts are **asset-scoped** and exclude the current Case — but **old unrelated Cases on the same account** can still affect account-wide signals (open incidents, escalations). Cleaning demo Cases gives the intended “routine / normal” story.

**Contrast:** Case **00001108** on **Aptivance tech** is the clean reference — low repeat noise, Knowledge eligible when tenant RAG is configured.

## Scope — all Web-origin creators (recommended)

Delete **Cases only** (never Accounts, Contacts, Assets, inventory seed, or KB corpus):

| Filter  | Value                                            |
| ------- | ------------------------------------------------ |
| Account | `University of Arizona`                          |
| Origin  | `Web`                                            |
| Created | `LAST_N_DAYS:30` (adjust if older noise remains) |

This catches Cases from:

- `/demo/case-create` (all scenarios using UofA)
- Manual Web-origin Case creates in the org
- Repeated battery / display / mixed-parts demo runs

### Optional narrow scope (single asset)

If you must keep some UofA Cases, query by subject pattern or asset serial after listing:

```bash
sf data query --target-org AgentForce --query \
  "SELECT Id, CaseNumber, Subject, Asset.SerialNumber, CreatedDate FROM Case \
   WHERE Account.Name = 'University of Arizona' AND Origin = 'Web' \
   ORDER BY CreatedDate DESC LIMIT 50" --result-format human
```

## Pre-flight

```bash
sf org display --target-org AgentForce

# Count Web Cases on UofA (all creators)
sf data query --target-org AgentForce --query \
  "SELECT COUNT() FROM Case WHERE Account.Name = 'University of Arizona' AND Origin = 'Web'" --json

# Sample rows
sf data query --target-org AgentForce --query \
  "SELECT Id, CaseNumber, Subject, Status, CreatedBy.Name, CreatedDate FROM Case \
   WHERE Account.Name = 'University of Arizona' AND Origin = 'Web' \
   ORDER BY CreatedDate DESC LIMIT 20" --result-format human
```

**Dry-run first.** If count > 200, narrow by date or get explicit approval.

## Delete

```bash
sf data query --target-org AgentForce --query \
  "SELECT Id FROM Case WHERE Account.Name = 'University of Arizona' AND Origin = 'Web' AND CreatedDate = LAST_N_DAYS:30" \
  --result-format csv > /tmp/uoa-web-cases.csv

wc -l /tmp/uoa-web-cases.csv

sf data delete bulk --target-org AgentForce --sobject Case --file /tmp/uoa-web-cases.csv --wait 10
```

## Post-delete verification

```bash
sf data query --target-org AgentForce --query \
  "SELECT COUNT() FROM Case WHERE Account.Name = 'University of Arizona' AND Origin = 'Web'" --json
```

Expected: **0** (or only keeper Cases you intentionally retained).

## Fresh battery demo

1. Open `/demo/case-create` → **Same-day battery fix** → **Create case & step through**
2. On stepped **01 Triage** expect:
   - Summary visible (battery / ProBook 15X routine language)
   - `repeatIncident` low or none on asset `SN-PRO15X-2026-0041A`
   - Priority closer to scenario intent (**Medium** / normal), not inflated by account noise
3. Advance to **Knowledge Base** — should **not** skip with `Missing tenant ID for RAG context`

## Related

- Task template: `.github/prompts/clean-demo-cases-fresh-start.prompt.md`
- Plan: `docs/orchestrator/triage-demo-signal-gaps-plan.md`
- Demo proof log: `docs/testing/demo-case-create-proof.md`

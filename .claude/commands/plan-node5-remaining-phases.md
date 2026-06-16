# Node 5 Remaining Phases

After 5a — Railway E2E, then 5b / 5c / 5d. Full harness: `.github/prompts/plan-node5-remaining-phases.prompt.md`.

## Default: Railway E2E first

```bash
railway login   # if Unauthorized
SF_CASE_ID=500g500000YpQMnAAN ./scripts/deploy/railway-node5-scheduling-e2e.sh
```

## Phase gates

| Phase           | When                                                           |
| --------------- | -------------------------------------------------------------- |
| **Railway E2E** | Now — flag + deploy + `ASSERT_SCHEDULING=1`                    |
| **5b**          | Optional refinements (TZ, collision, AppointmentCandidates)    |
| **5c**          | **Blocked until Node 6** — gated `ServiceAppointment` writes   |
| **5d**          | Re-orchestration reconcile — see `re-orchestration-backlog.md` |

## Docs

- `docs/orchestrator/node-5-scheduling-phase-plan.md` §0.5, §3.7
- `docs/orchestrator/re-orchestration-backlog.md`
- `docs/context/node5-field-service-prep-lessons.md`

$ARGUMENTS

---
mode: agent
description: "Implement demo Case creation: /demo/case-create UI, scenario catalog, NestJS SF write gateway, Next.js proxy, redirect to orchestration."
agent: "Nest AI Architect"
argument-hint: "Phase scope (DC-1..DC-5 default all), org alias (AgentForce), whether to gate behind DEMO_CASE_CREATE_ENABLED"
tools: [read, search, edit, execute, todo, agent]
---

# Execution mode — implement, do not replan

You are in **executing mode**. Implement the **Demo Case Create** feature per the phase plan. Do not produce architecture-only documentation unless code cannot proceed due to a blocker.

## Required skill-loading order

1. `salesforce-case-create` — Case field shapes, part-code rules, ship-to requirements
2. `langgraph-case-triage-slice` — orchestrator trigger + console URL pattern
3. `new-org-tenant-onboarding` — only if SF OAuth write scopes are blocked

## Agent persona

Primary: adopt `.github/agents/nest-ai-architect.agent.md` for NestJS gateway/module work.

Escalate when cross-cutting:

- `Security Reviewer` — public demo write surface, rate limits, no secrets in browser
- `Release Checker` — env flags, Railway wiring
- Frontend chat scope — honor `.github/instructions/frontend-chat.instructions.md` for React work

## Canonical documents (read before coding)

| Document                  | Path                                                          |
| ------------------------- | ------------------------------------------------------------- |
| **Phase plan (primary)**  | `docs/orchestrator/demo-case-create-phase-plan.md`            |
| **Scenario catalog**      | `apps/react-chat-window/data/demo-case-scenarios.json`        |
| **JSON schema**           | `apps/react-chat-window/data/demo-case-scenarios.schema.json` |
| **Node 4 runbook**        | `docs/testing/node4-orchestrator-case-scenarios.md`           |
| **Orchestrator console**  | `apps/react-chat-window/app/orchestration/page.tsx`           |
| **Case create skill**     | `.agents/skills/salesforce-case-create/SKILL.md`              |
| **Frontend instructions** | `.github/instructions/frontend-chat.instructions.md`          |
| **Nest AI instructions**  | `.github/instructions/nest-ai-api.instructions.md`            |
| **Security instructions** | `.github/instructions/security-observability.instructions.md` |

## Locked product decisions (do not re-debate)

| Decision       | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Page route     | `/demo/case-create`                                                    |
| Audience       | Public demo-quality UI (rich design)                                   |
| Scenarios      | JSON catalog at `apps/react-chat-window/data/demo-case-scenarios.json` |
| Post-create    | Immediate `router.push(/orchestration?caseId=…)`                       |
| SF Ids in JSON | **No** — resolve Account/Contact/Asset server-side via lookups         |
| Customer chat  | **Unchanged** — no Case create on `/` or `EscalationDialog`            |

## Implementation phases (execute in order)

### DC-1 — NestJS write path

1. Create `SalesforceCaseWriteGateway`:
   - `resolveAccountByName(name)`
   - `resolveContactByEmail(accountId, email)` (optional degrade)
   - `resolveAssetBySerial(serialNumber)`
   - `createCase(fields)` — REST insert, structured errors
2. Create `DemoCaseCreateModule`:
   - `DemoCaseCreateDto` — accepts `scenarioId` **or** explicit `form` payload
   - `DemoCaseCreateService` — load scenario from catalog when `scenarioId` provided; merge overrides
   - `DemoCaseCreateController` — `POST /demo/cases`
3. Auth: new scope `agentforce:demo-case-create`; guard with dedicated bearer token config `AI_API_DEMO_CASE_CREATE_TOKEN`.
4. Feature flag: `DEMO_CASE_CREATE_ENABLED` (default false).
5. Tests: gateway mocks, DTO validation, happy path + missing asset.

### DC-2 — Next.js proxy

1. `app/api/demo/cases/route.ts` — POST only; proxy to NestJS `/demo/cases`.
2. Attach server-only token from `AI_API_DEMO_CASE_CREATE_TOKEN`.
3. Return `{ caseId, caseNumber, orchestrationUrl }` to client.
4. 503 when feature disabled or token unset.
5. Tests in `lib/__tests__/demo-case-proxy.test.ts` (mirror orchestrator proxy style).

### DC-3 — React UI

1. `lib/demo-case-scenarios.ts` — types matching JSON schema; `loadScenarioCatalog()`.
2. `components/DemoCaseCreateForm.tsx`:
   - Scenario select (all entries from catalog)
   - Preview card: `badges`, `expectedOutcome.summary`, `inventoryBasis` chips, `story`
   - Form fields bound to `form` object; allow edit before submit
   - Submit → `POST /api/demo/cases` with `{ scenarioId, overrides? }`
   - On 201 → `router.push(orchestrationUrl)`
3. `app/demo/case-create/page.tsx` — hero, layout, link to `/orchestration`.
4. Rich design: cards, badges, gradient background consistent with chat shell; responsive.
5. Do **not** expose SF tokens or internal API base URL.

### DC-4 — Live proof

Org: `AgentForce`.

1. Enable `DEMO_CASE_CREATE_ENABLED=true` + token on Railway (document in README only — no secrets in repo).
2. Manual proof: submit `same-day-battery-fix` → redirect → orchestration shows running workflow.
3. Submit `manager-approval-mixed-parts` → expect `waiting_approval` when SF approval enabled.
4. Record Case Ids in `docs/testing/demo-case-create-proof.md` (create if absent).

### DC-5 — Docs

1. `apps/react-chat-window/README.md` — section for `/demo/case-create`.
2. Update `.agents/skills/salesforce-case-create/SKILL.md` — add UI console path.
3. Run `./scripts/sf/generate-demo-case-scenarios.sh AgentForce` if inventory drift suspected.

## API contract (implement exactly)

### Request

```json
{
  "scenarioId": "same-day-battery-fix",
  "overrides": {
    "subject": "optional override",
    "description": "optional override",
    "priority": "High",
    "shipTo": { "city": "Austin", "state": "TX", "country": "US" }
  }
}
```

Or full custom:

```json
{
  "form": {
    "subject": "...",
    "description": "...",
    "status": "New",
    "origin": "Web",
    "priority": "Medium",
    "accountLookup": { "name": "Aptivance tech" },
    "contactLookup": { "email": "jason.l@ablypro.com" },
    "assetLookup": { "serialNumber": "SN-PRO15X-2026-0041A" },
    "suppliedName": "Jason Luu",
    "suppliedEmail": "jason.l@ablypro.com",
    "shipTo": { "city": "Austin", "state": "TX", "country": "US" }
  }
}
```

### Response `201`

```json
{
  "caseId": "500g500000xxxxxxxx",
  "caseNumber": "00001234",
  "orchestrationUrl": "/orchestration?caseId=500g500000xxxxxxxx"
}
```

### Errors

| Status | Code                      | When                     |
| ------ | ------------------------- | ------------------------ |
| 400    | `invalid_scenario`        | Unknown `scenarioId`     |
| 400    | `validation_error`        | DTO fail                 |
| 404    | `lookup_not_found`        | Account/Asset not in org |
| 403    | `demo_create_disabled`    | Feature flag off         |
| 503    | `demo_create_unavailable` | Token/SF not configured  |

## Testing gates (run before handoff)

```bash
npm run ai-api:test -- --testPathPattern=demo-case
npm run react-chat:typecheck
npm run react-chat:test -- --testPathPattern=demo-case
npm run prettier:verify
```

Run **focused tests only** for touched layers.

## Security checklist

- [ ] Browser never receives `AI_API_DEMO_CASE_CREATE_TOKEN`
- [ ] No Salesforce session Id in client
- [ ] Logs: scenarioId + caseId only; no description text
- [ ] Rate limit on `POST /api/demo/cases`
- [ ] `DEMO_CASE_CREATE_ENABLED` defaults false

## Do not

- Replan scenario catalog contents (JSON is shipped — extend only if org proof fails)
- Add Approve/Reject to orchestration console
- Wire demo create into customer chat `/api/chat`
- Hardcode Salesforce Ids in the React app
- Commit `.env` secrets

## Success definition

A user opens `/demo/case-create`, selects **Same-day battery fix**, clicks create, lands on `/orchestration?caseId=…`, and sees Node 1+ progress without CLI.

$ARGUMENTS

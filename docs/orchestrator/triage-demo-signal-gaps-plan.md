# Triage Demo Signal Gaps — Plan (S1–S3)

> **Status:** Phase 2 shipped (S1–S3 + UofA cleanup doc).  
> **Proof anchors:** Case `00001108` (Aptivance, clean repeat signal) vs `same-day-battery-fix` on **University of Arizona** (noisy prior-case history).

## 0. Symptoms (operator-visible)

| #   | Symptom                                                                                 | Root cause (validated)                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Knowledge Base skips with `Missing tenant ID for RAG context` on demo create + SF-async | `run` / `runStep` set `tenantId: principal?.tenantId` only. Demo bootstrap calls `triggerStepped` without principal; operator JWT omits `tenant`; auth-disabled dev has no principal. |
| 2   | `repeatIncident` counts **any** Case on Account in 30d                                  | `readServiceHistory` SOQL is Account-scoped only; includes current Case; no Asset filter.                                                                                             |
| 3   | Stepped Triage hides installed assets; summary buried                                   | `buildTriage` folds customer fields without `installedAssets`; `output` is priority-only; `suggestedNextStep` appended to summary line.                                               |
| 4   | UofA battery demo inflated after repeated runs                                          | Stale Web-origin Cases on `University of Arizona` — see cleanup doc.                                                                                                                  |

## 1. Design options

### S1 — Tenant ID for RAG / Knowledge

| Option | Description                                                                                                          | Pros                                                     | Cons                                                        | **Pick**         |
| ------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ---------------- |
| A      | `resolveWorkflowTenantId(principal)` in orchestrator: principal → first Agentforce bearer `tenantId` → `tenant-demo` | Single seam; fixes demo + auth-disabled; no graph change | Config must list bearer tenant                              | **Yes**          |
| B      | Pass `@Req() authPrincipal` from demo controller only                                                                | Minimal orchestrator change                              | SF-async / stepped advance still fail without tenant in JWT | No               |
| C      | Add `tenant` to operator session JWT                                                                                 | Fixes console-only paths                                 | Does not fix server-side demo bootstrap                     | Complement later |

**Behavior:** Graph initial state always carries a non-empty `tenantId`. `retrieveKnowledge` dev fallback (`state.tenantId`) succeeds without `principalForRag`.

### S2 — Repeat incident scope

| Option | Description                                                                | Pros                                                                      | Cons                                          | **Pick** |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- | -------- |
| A      | Asset-scoped SOQL when `context.assetId` present; exclude `context.caseId` | Matches field-service intent; routine battery on clean asset → low repeat | No asset on Case → account fallback           | **Yes**  |
| B      | Account-scoped + exclude current Case only                                 | Smaller SOQL change                                                       | Still counts unrelated assets on same account | No       |
| C      | Contact-scoped repeat                                                      | Narrow                                                                    | Wrong for shared-account enterprise assets    | No       |

**Evidence:** `evidenceBasis` states scope (`same asset` vs `account`) and `excluding current Case`. LLM risk grade still uses `safeSignalPayload` counts only — never raw Case JSON.

**DTO:** Extend `CustomerReadScope` with `assetId?`, `excludeCaseId?`; extend `CustomerServiceHistory` with `repeatScope`, `currentCaseExcluded`.

### S3 — Stepped Triage UI (`buildTriage`)

| Option | Description                                                                                                                                           | **Pick**                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| A      | Summary section = `triage.summary` only; next step as `note`; `output` = truncated summary; customer fields include assets/strategic/open/escalations | **Yes**                                  |
| B      | Duplicate `buildCustomerContext` accordion                                                                                                            | Rejected — product wants one Triage card |

## 2. File change list

| File                                       | Change                                              | Size |
| ------------------------------------------ | --------------------------------------------------- | ---- |
| `case-triage-orchestrator.service.ts`      | `resolveWorkflowTenantId`; use in `run` / `runStep` | S    |
| `demo-case-create.service.ts` + controller | Pass `authPrincipal` into `triggerStepped`          | S    |
| `salesforce-customer.gateway.ts`           | Asset + exclude filters in `readServiceHistory`     | M    |
| `customer-context.ts`                      | Scope + history metadata fields                     | S    |
| `customer-history.service.ts`              | Asset-aware `evidenceBasis` in `buildRepeatFinding` | S    |
| `case-triage.graph.ts`                     | Pass `assetId` + `excludeCaseId` in read scope      | S    |
| `stepped-view-model.ts`                    | Prominent summary + full customer field set         | M    |
| `docs/testing/uofa-demo-case-cleanup.md`   | UofA battery cleanup runbook                        | S    |

## 3. Test matrix

| ID  | Layer                                   | Scenario                                  | Assert                                                                            |
| --- | --------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| T1  | `case-triage-orchestrator.service.spec` | `triggerStepped` without principal        | Graph invoke receives `tenantId` from config fallback                             |
| T2  | `demo-case-create.service.spec`         | Scenario create with principal            | `triggerStepped(dto, principal)` called                                           |
| T3  | `salesforce-customer.gateway.spec`      | `readServiceHistory` with asset + exclude | SOQL contains `AssetId` and `Id !=`; count excludes current                       |
| T4  | `customer-history.service.spec`         | Asset-scoped history bundle               | `evidenceBasis` mentions `same asset` + `excluding current Case`                  |
| T5  | `case-triage.graph.spec`                | Context with `assetId`                    | `readCustomerContext` scope includes `assetId`, `excludeCaseId`                   |
| T6  | `stepped-view-model.test`               | Full triage fixture                       | `output` uses summary; detail has assets field; summary not merged with next step |
| T7  | Manual                                  | Case `00001108` Aptivance                 | Repeat low/none; Knowledge eligible                                               |
| T8  | Manual                                  | UofA after cleanup + battery scenario     | Repeat not inflated by unrelated account Cases                                    |

**Commands (focused):**

```bash
npm run ai-api:test -- --testPathPattern="case-triage-orchestrator.service.spec|demo-case-create.service.spec|salesforce-customer.gateway.spec|customer-history.service.spec|case-triage.graph.spec"
cd apps/react-chat-window && npx vitest run lib/__tests__/stepped-view-model.test.ts
```

## 4. Non-goals

- No Salesforce metadata / Apex changes.
- No renumbering Nodes 3–8.
- No org-wide Case delete automation in code — cleanup is documented + prompt template only.

## 5. Acceptance criteria

- [x] Knowledge node `eligible: true` on demo create stepped bootstrap (no missing-tenant skip).
- [x] `repeatIncident` asset-scoped when Case has Asset; current Case excluded; evidenceBasis explicit.
- [x] Stepped Triage shows summary prominently + installed assets.
- [x] UofA battery cleanup documented for all Web-origin creators.
- [x] Focused unit tests green.

# Node 4 Auth & Salesforce Read Lessons (2026-06-15)

Session context: live Node 4 (`partsLogistics`) on Railway production against the orgfarm dev org (`AgentForce` CLI alias). Branch `IMP-NODE-4`, Case proof `500g500000YpQMnAAN` (asset `AV-LP-15X-PRO`).

## Symptoms observed

| Symptom                                                                                 | Misleading interpretation        | Actual cause                                                                                |
| --------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `partsLogistics.eligible=false`, reason _"Case has no installed asset"_                 | Case missing Asset in Salesforce | Case **had** an asset; `readCaseContext` lost `assetId` before eligibility                  |
| Inventory `degraded=true`, `availability=unknown`                                       | Planner bug                      | OAuth user lacked FLS on `Product2` / `Location` custom fields                              |
| Direct SOQL from `railway run` worked after perm-set fix but orchestrator still skipped | Stale code on Railway            | Old deploy still clobbered asset via `mergeDefined` bug                                     |
| `sf org assign permset` failed for integration user                                     | Perm set broken                  | `Analytics Cloud Integration User` license cannot receive `ProductRequest` **create** perms |

## Root causes (in order discovered)

### 1. OAuth Run As user and permission set

Railway `ai-api` uses **Salesforce client-credentials** (`SF_OAUTH_CLIENT_ID`, `SF_OAUTH_CLIENT_SECRET`, `SF_OAUTH_TOKEN_URL`). The Connected App **Run As** user determines which records and fields API calls can read.

**Required for Node 4:**

- Connected App Run As = a standard user with Field Service / inventory access (we used `chaudhary.keshav4u@gmail.com`).
- Permission set `Agentforce_Parts_Logistics_Node4` assigned to that Run As user.
- **Relax IP restrictions** on the Connected App when Railway egress IPs are not allow-listed.

**Do not use** `integration@00dg5000005qpuneaa.com` (`Analytics Cloud Integration User`) as Run As for Node 4: it cannot hold several object permissions needed by the perm set (e.g. `ProductRequest` create was removed; read-only object perms are required).

### 2. OAuth token cache (~25 minutes)

`SalesforceAuthService` caches client-credentials tokens in memory. After changing Run As, perm sets, or Connected App policy:

- **Redeploy or restart `ai-api`** to force a fresh token, **or**
- Wait ~25 minutes for cache expiry.

**You do not manually create Salesforce access tokens.** Rotate `SF_OAUTH_CLIENT_SECRET` only if the Connected App secret was rotated.

### 3. `mergeDefined` bug in `SalesforceCaseGateway`

Ship-to SOQL (`readCaseLogisticsContext`) returned `assetId: undefined` for missing ship-to-only rows. A naive spread merge:

```ts
{ ...context, ...logistics }
```

**overwrote** the REST-read `assetId` with `undefined`, causing Node 4 to think the Case had no asset.

**Fix:** `mergeDefined(base, patch)` skips `undefined` patch values. Asset + product code now come from the primary REST Case read (`AssetId, Asset.Product2.ProductCode` in `CASE_FIELDS`); ship-to stays a best-effort SOQL supplement.

### 4. Org alignment

Production Railway `SF_INSTANCE_URL` must match the org where Cases, assets, and inventory seed data live. For this project:

| Surface                   | Org                                                           |
| ------------------------- | ------------------------------------------------------------- |
| Railway `SF_INSTANCE_URL` | `https://orgfarm-d96842e593-dev-ed.develop.my.salesforce.com` |
| `sf` CLI alias            | `AgentForce` (same org)                                       |

Assign perm sets and validate Cases in **that** org, not a different scratch org.

## Checklist for future Node 4 auth / read failures

1. **Confirm org:** `sf org display --target-org AgentForce` instance URL matches Railway `SF_INSTANCE_URL`.
2. **Confirm Run As:** Connected App → OAuth Policies → Run As user is a standard/integration user with the Node 4 perm set.
3. **Confirm perm set:** `sf data query --target-org AgentForce --query "SELECT Assignee.Username, PermissionSet.Name FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Agentforce_Parts_Logistics_Node4'"`.
4. **Confirm IP policy:** Connected App allows Railway (or use relaxed IP restrictions in non-prod).
5. **Confirm feature flag:** `AI_API_ORCHESTRATOR_PARTS_ENABLED=true` on Railway `ai-api`.
6. **Direct OAuth probe** (no PII in logs):

   ```bash
   railway run --service ai-api --environment production node -e "
   const b=new URLSearchParams({grant_type:'client_credentials',client_id:process.env.SF_OAUTH_CLIENT_ID,client_secret:process.env.SF_OAUTH_CLIENT_SECRET});
   const t=await (await fetch(process.env.SF_OAUTH_TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:b})).json();
   const q=encodeURIComponent(\"SELECT AssetId, Asset.Product2.ProductCode FROM Case WHERE Id='500g500000YpQMnAAN'\");
   const r=await (await fetch(process.env.SF_INSTANCE_URL+'/services/data/v66.0/query?q='+q,{headers:{Authorization:'Bearer '+t.access_token}})).json();
   console.log(JSON.stringify(r.records?.[0]??r));
   "
   ```

7. **Redeploy `ai-api`** after Run As / perm / Connected App changes.
8. **Run smoke:** `SF_CASE_ID=500g500000YpQMnAAN ./scripts/smoke/all-3-nodes-deployed.sh` (covers Nodes 1–4).

## Agentforce API JWT (orchestrator HTTP)

Orchestrator endpoints use **NestJS-minted JWTs**, not Salesforce tokens. Smoke scripts mint these via `scripts/smoke/phase4-mint-jwt.mjs` + Railway signing keys. **No manual JWT creation** is required for testing.

## Permission set deploy note

Deploy only the perm set metadata (avoid `node4-pre-deploy.sh` manifest + `--source-dir` together on newer SF CLI):

```bash
sf project deploy start --target-org AgentForce \
  --source-dir force-app/main/default/permissionsets/Agentforce_Parts_Logistics_Node4.permissionset-meta.xml \
  --wait 10
```

Then assign to the OAuth Run As user:

```bash
./scripts/sf/node4-4c-deploy.sh AgentForce chaudhary.keshav4u@gmail.com
```

This deploys Apex + Flow + fulfillment perm set, assigns Field Service Standard PSL, and assigns `Agentforce_Parts_Fulfillment_Writes` to the run-as user.

For read/plan only (Node 4a):

```bash
sf org assign permset --target-org AgentForce \
  --name Agentforce_Parts_Logistics_Node4 \
  --on-behalf-of chaudhary.keshav4u@gmail.com
```

## Successful live proof (post-fix)

Workflow `wf-1efb4e89-66f1-439f-8aa4-6778707ab896`:

- `partsLogistics.eligible=true`
- `degraded=false`
- `status=PARTIAL`, `fulfillmentReadiness=partial`
- Part plan `SP-DISP-15X-FHD`, inter-warehouse transfer `WH-SJO-002` → `WH-AUS-001`

## Related code and docs

- `apps/ai-api/src/salesforce/salesforce-case.gateway.ts` — REST asset read + `mergeDefined`
- `force-app/main/default/permissionsets/Agentforce_Parts_Logistics_Node4.permissionset-meta.xml`
- `scripts/smoke/all-3-nodes-deployed.sh` — Nodes 1–4 smoke
- `docs/orchestrator/node-4-parts-logistics-phase-plan.md` — Phase 4a design

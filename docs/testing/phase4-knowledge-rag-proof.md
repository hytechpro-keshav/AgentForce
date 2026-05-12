# Phase 4 Knowledge RAG Proof

Date: 2026-05-11 through 2026-05-12

## Scope

This document captures the implementation and proof checklist for Phase 4
Knowledge RAG:

```text
Customer_Self_Service_Agent
  -> Answer Knowledge RAG
  -> AgentforceAiApiKnowledgeRag
  -> callout:Agentforce_AI_API_Phase2/agent/knowledge/answer
  -> Railway ai-api
  -> RAG retrieval -> EmbeddingProvider -> Qdrant
  -> LangChain prompt composition -> ModelRouter -> OpenAI
```

This is source-cited external RAG. It is not native Salesforce
`AnswerQuestionsWithKnowledge`, and it does not claim Phase 5 Open WebUI or
Phase 6 React chat deployment is complete.

## What This Slice Adds

- `POST /rag/ingest`, scope `rag:ingest`
- `POST /rag/search`, scope `rag:search`
- `POST /agent/knowledge/answer`, scope `agentforce:knowledge-rag`
- `EmbeddingProvider` abstraction with OpenAI production provider and
  deterministic local test provider
- `VectorStore` abstraction with Qdrant/Pinecone external providers and memory
  test implementation
- LangChain text splitting and prompt composition around local provider/vector
  interfaces
- approved sample corpus at `apps/ai-api/data/knowledge/phase4-sample-corpus.json`
- safe RAG telemetry for ingestion, retrieval, answer, and embeddings
- normalized vectors and hash-keyed embedding cache in `EmbeddingRouter` to
  avoid repeated provider calls for identical chunks/queries
- in-process route rate limiting for RAG ingest/search/answer, with stricter
  ingest limits and configurable env defaults
- zero-magnitude embedding rejection and Qdrant collection-race tolerance
- Apex invocable `AgentforceAiApiKnowledgeRag` with HTTP mock tests
- genAiFunction `Answer_Knowledge_RAG` and planner-local action schemas
- Customer Self Service topic `AI_API_Knowledge_RAG`
- eval coverage at `agent-eval/customer-self-service-phase4-knowledge-rag.yaml`

## Local Validation

Completed locally on 2026-05-11 and refreshed on 2026-05-12 before final
release validation:

- `npm run ai-api:typecheck` passed.
- `npm run ai-api:test` passed 81 tests.
- `npm run ai-api:test:e2e` passed 25 tests.
- `npm run ai-api:build` passed.
- Targeted Salesforce core validate passed with deploy validation
  `0Afg5000007sK2XCAU`, running 12/12 `AgentforceAiApiKnowledgeRagTest` tests.
- Planner-bundle validate-only attempt `0Afg5000007s8XeCAI` was blocked because
  `Customer_Self_Service_Agent` was active.
- The active-agent blocker was resolved with the documented lifecycle:
  deactivate `Customer_Self_Service_Agent`, validate the full Phase 4
  planner-support payload, reactivate the agent. Validation succeeded with id
  `0Afg5000007tef9CAA`, running 12/12 `AgentforceAiApiKnowledgeRagTest` tests,
  and the agent was reactivated.
- Final Salesforce core deploy passed with deploy id `0Afg5000007uddmCAA`,
  running 12/12 `AgentforceAiApiKnowledgeRagTest` tests.
- Final planner deploy passed with deploy id `0Afg5000007upftCAA` after
  deactivating `Customer_Self_Service_Agent`; the agent was reactivated.
- Simple-prompt planner updates were later deployed through the same
  deactivate/deploy/reactivate lifecycle. Deploy `0Afg5000007vPbyCAE` tightened
  the Phase 4 topic and native Knowledge action boundaries so the simple prompt
  routes to external Knowledge RAG.

## Live Proof Fields

Fill these after deploying and proving the path in the target org and Railway
environment.

| Field                            | Value                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Railway deployment id            | `7c310667-493f-4f69-a88e-0f930034b55f`                                                                                                                                         |
| Railway URL                      | `https://ai-api-production-03f5.up.railway.app`                                                                                                                                |
| Qdrant service                   | `qdrant`                                                                                                                                                                       |
| Qdrant collection                | `agentforce-knowledge-rag`                                                                                                                                                     |
| RAG namespace                    | `customer-self-service`                                                                                                                                                        |
| Salesforce core validation id    | `0Afg5000007sK2XCAU`                                                                                                                                                           |
| Salesforce core deploy id        | `0Afg5000007uddmCAA`                                                                                                                                                           |
| Salesforce planner validation id | `0Afg5000007tef9CAA`                                                                                                                                                           |
| Salesforce planner deploy id     | `0Afg5000007vPbyCAE`                                                                                                                                                           |
| Credential value id              | `0pwg5000000JRNtAAO`                                                                                                                                                           |
| Credential revision              | `4`                                                                                                                                                                            |
| Sample ingestion request id      | `phase4-sample-ingest`                                                                                                                                                         |
| Direct API answer request id     | `phase4-rag-smoke-answer`                                                                                                                                                      |
| Direct no-source request id      | `phase4-no-source-proof`                                                                                                                                                       |
| Agentforce preview session id    | `019e1ba9-1b8e-7bed-905c-ad19a788a563`                                                                                                                                         |
| Agentforce trace path            | `.sfdx/agents/0Xxg5000000kZUDCA2/sessions/019e1ba9-1b8e-7bed-905c-ad19a788a563`                                                                                                |
| Apex log id                      | `07Lg5000006ww1qEAA`                                                                                                                                                           |
| Telemetry request ids            | `sf-knowledge-rag-1778570852155-0`, `sf-knowledge-rag-1778570900356-0`                                                                                                         |
| Retrieval ids                    | `rag-f9a46283-1bc6-4403-aca3-8d0540ae76da`, `rag-65b4a589-7084-4168-b8f4-c6302ed5ad4e`, `rag-a2334fff-68ba-4481-b634-c6bdc47175b2`, `rag-67921a30-bdb9-4915-9dbb-cee046380d2d` |
| Source ids                       | `kb-troubleshoot-intermittent-service-v1`                                                                                                                                      |
| Token/cost fields                | `OpenAI embeddings + gpt-4o-mini answer path`                                                                                                                                  |
| Raw-identifier safety check      | `No raw synthetic identifiers found in Railway app logs`                                                                                                                       |

## Live Railway Preflight

Checked on 2026-05-12 without printing secret values:

- Railway CLI is linked to project `agentforce-ai-api`, environment
  `production`, service `ai-api`.
- Initial Railway preflight found the service online with deployment id
  `9ed18b87-bab8-4194-8f40-4b985bfd439f` before the Qdrant/RAG deploys.
- `GET /health/live` returned HTTP 200.
- Initial present variable names included `AGENTFORCE_HEALTH_API_KEY`,
  `AI_API_JWT_AUDIENCE`, `AI_API_JWT_ISSUER`, `AI_API_JWT_SECRET`, and
  `OPENAI_API_KEY`; Phase 4 RAG/Qdrant/rate-limit variables were added later in
  this proof sequence.
- Non-secret Phase 4 defaults were staged with Railway deploys skipped:
  `DEFAULT_EMBEDDING_PROVIDER=openai`,
  `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`,
  `VECTOR_DB_PROVIDER=qdrant`,
  `QDRANT_URL=http://qdrant.railway.internal:6333`,
  `QDRANT_COLLECTION=agentforce-knowledge-rag`,
  `QDRANT_VECTOR_SIZE=1536`,
  `QDRANT_DISTANCE=Cosine`,
  `RAG_DEFAULT_NAMESPACE=customer-self-service`, chunk/topK/threshold defaults,
  and `EMBEDDING_CACHE_MAX_ITEMS=2048`.
- A no-Pinecone Qdrant service was added on Railway with service id
  `682d18d0-8509-4d6c-a2d0-815960b109c1`, a persistent `/qdrant/storage` volume
  `71eef146-ca51-412a-a86d-b1e0cf6711e0`, and private domain
  `qdrant.railway.internal`.
- `QDRANT_API_KEY` and Qdrant's `QDRANT__SERVICE__API_KEY` were set through
  stdin/hidden values and were not printed.
- Qdrant-capable backend deployment `e444cd44-a1a7-4b71-97c1-bda41e4a9c89`
  succeeded with `RAG_ENABLED=false`.
- RAG-enabled deployment `4ace9b63-cb26-4d2d-b76e-fdc6c63567b0` succeeded and
  `/health/live` returned HTTP 200, proving production startup accepts the
  Qdrant configuration.
- After the OpenAI project exposed `text-embedding-3-small`, direct embedding
  probes and live ingestion started succeeding. A transient validation failure
  during deploy cutover was resolved once the new RAG-enabled deployment was
  stable.
- Retrieval quality tuning on the live Qdrant path showed the original default
  `RAG_SCORE_THRESHOLD=0.72` was too strict for the validated corpus: the top
  approved troubleshooting chunk scored about `0.6905`. Lowering the default to
  `0.68` preserved `NO_SOURCE` for the unsupported executive-compensation test
  while allowing the supported troubleshooting answer to ground correctly.
- Deployment `be197048-ba39-4b5f-9e5e-ec6d954bee99` proved the first successful
  live Qdrant/OpenAI path. Final hardening deployment
  `7c310667-493f-4f69-a88e-0f930034b55f` is now the current live deployment with
  `RAG_ENABLED=true`, `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`,
  `VECTOR_DB_PROVIDER=qdrant`, `RAG_SCORE_THRESHOLD=0.68`, RAG route rate
  limiting, zero-vector rejection, and Qdrant collection race tolerance.
- Successful final direct live proof on 2026-05-12:
  - sample ingest request id `phase4-sample-ingest`
  - direct answer request id `phase4-rag-smoke-answer`
  - no-source request id `phase4-no-source-proof`
  - retrieval id `rag-f9a46283-1bc6-4403-aca3-8d0540ae76da`
  - source id `kb-troubleshoot-intermittent-service-v1`
  - source chunk `kb-troubleshoot-intermittent-service-v1:2026.05.11:chunk-1`
  - embedding model `text-embedding-3-small`
  - answer model `gpt-4o-mini`

Direct API and Agentforce preview proof are now complete.

Salesforce credential refresh on 2026-05-12:

- `Agentforce_AI_API_Phase2` / `Agentforce_AI_API_Phase2_Principal`
- custom value `AI_API_PHASE2_BEARER_JWT`
- endpoint `/services/data/v66.0/named-credentials/credential`
- method `PUT`
- response id `0pwg5000000JRNtAAO`, latest revision `4`, encrypted `true`
- final body included `encrypted: true` for the Custom authentication parameter;
  omitting it returns `INVALID_API_INPUT` in this org.

Agentforce preview proof on 2026-05-12:

- session id `019e1b14-b15b-7eed-b6f7-b23ccc7bbcb4`
- trace path `.sfdx/agents/0Xxg5000000kZUDCA2/sessions/019e1b14-b15b-7eed-b6f7-b23ccc7bbcb4`
- supported prompt first asked for confirmation, then returned source-cited
  troubleshooting guidance using source `kb-troubleshoot-intermittent-service-v1`
  and retrieval id `rag-65b4a589-7084-4168-b8f4-c6302ed5ad4e`
- unsupported executive-compensation prompt returned no approved source and did
  not answer from general model knowledge
- synthetic PII prompt was blocked before the RAG action callout; Railway app
  log search found no raw synthetic identifiers

Additional manual stakeholder preview proof on 2026-05-12:

- supported prompt asked for confirmation, then returned approved intermittent
  residential service troubleshooting steps from source
  `kb-troubleshoot-intermittent-service-v1`
- returned source title `Troubleshooting intermittent residential service`,
  version `2026.05.11`, chunk id
  `kb-troubleshoot-intermittent-service-v1:2026.05.11:chunk-1`, source count
  `1`, and retrieval id `rag-a2334fff-68ba-4481-b634-c6bdc47175b2`
- unsupported executive-compensation prompt asked for confirmation and then
  returned no authorized knowledge source instead of a generic answer
- placeholder PII prompt was refused before processing names, emails, phones,
  or account numbers

Simple stakeholder prompt proof on 2026-05-12 after planner deploy
`0Afg5000007vPbyCAE`:

- prompt: `What approved troubleshooting can I give for intermittent residential
service?`
- confirmation: `yes`
- preview session id: `019e1ba9-1b8e-7bed-905c-ad19a788a563`
- trace path:
  `.sfdx/agents/0Xxg5000000kZUDCA2/sessions/019e1ba9-1b8e-7bed-905c-ad19a788a563`
- result: Agentforce returned approved troubleshooting steps and linked the
  source `Troubleshooting Intermittent Residential Service Guide` at
  `https://help.example.invalid/kb/troubleshoot-intermittent-service`
- companion direct Apex proof for the same simple phrase returned
  `ragStatus=ANSWERED`, source `kb-troubleshoot-intermittent-service-v1`, chunk
  `kb-troubleshoot-intermittent-service-v1:2026.05.11:chunk-1`, source count
  `1`, retrieval id `rag-67921a30-bdb9-4915-9dbb-cee046380d2d`, vector DB
  provider `qdrant`, and HTTP status `201`

Guarded helpers added for the remaining live proof:

```bash
# Dry-run only; prints required inputs and does not mutate Railway.
scripts/smoke/phase4-set-railway-rag-vars.sh

# After Qdrant setup, sets Qdrant variables and enables RAG last to trigger the
# Railway deploy. QDRANT_API_KEY can be provided through the environment or a
# hidden prompt when QDRANT_REQUIRE_API_KEY=true.
PHASE4_APPLY=true \
QDRANT_URL=http://qdrant.railway.internal:6333 \
scripts/smoke/phase4-set-railway-rag-vars.sh

# After the Railway deployment is healthy, mints a short-lived maintenance JWT
# from Railway AI_API_JWT_SECRET without printing the secret, ingests the sample
# corpus, and runs the direct answer proof. It fails closed if runtime RAG vars
# are missing.
scripts/smoke/phase4-rag-live-proof.sh

# To mint the Agentforce runtime JWT for credential refresh without printing the
# Railway secret, pipe/capture this output directly into the Salesforce secure
# credential update flow. Do not print the token.
railway run --service ai-api --environment production \
  node scripts/smoke/phase4-mint-jwt.mjs --purpose agentforce
```

## Expected Direct API Evidence

After sample ingestion, a direct answer request should return fields like:

```text
answerStatus=ANSWERED
sourceCount>0
sourceIds=kb-troubleshoot-intermittent-service-v1
sourceTitles=Troubleshooting intermittent residential service
sourceChunkIds=<chunk-id>
retrievalIds=<rag-retrieval-id>
provider=openai
model=gpt-4o-mini
embeddingProvider=openai
embeddingModel=text-embedding-3-small
vectorDbProvider=qdrant
```

For unsupported questions:

```text
answerStatus=NO_SOURCE
sourceCount=0
answer=I do not have an authorized source for that answer...
```

## Deployment Steps

1. Deploy Railway `ai-api` with Phase 4 code and set production RAG variables.
2. Confirm `/health/live` returns HTTP 200.
3. Mint and store a combined-scope JWT in `Agentforce_AI_API_Phase2` through
   `/services/data/v66.0/named-credentials/credential` using `PUT` for the
   existing principal. Required claims: `iss=salesforce-agentforce`,
   `aud=agentforce-ai-api`, short-lived `exp`, safe `sub`, `tenant=tenant-demo`,
   `rag_namespace=customer-self-service`, and any role claim required by
   restricted chunks. The Agentforce action JWT needs
   `agentforce:knowledge-rag`; use a separate maintenance JWT for `rag:ingest`,
   `rag:search`, and optional `rag:search:stale`.
   For the Custom External Credential value, include `encrypted: true` on
   `AI_API_PHASE2_BEARER_JWT` in the REST body.
4. Ingest the sample corpus with `scripts/smoke/phase4-rag-ingest-sample.sh`.
5. Deploy the Salesforce core slice with `AgentforceAiApiKnowledgeRag`, its
   test, `Answer_Knowledge_RAG`, and the permission set.
6. Deactivate `Customer_Self_Service_Agent`, deploy the planner bundle, then
   reactivate it.
7. Run Agentforce Preview with the UAT prompt and capture the IDs above.

Qdrant preflight:

```text
service=qdrant
url=http://qdrant.railway.internal:6333
collection=agentforce-knowledge-rag
vectorSize=1536 for text-embedding-3-small
distance=Cosine
namespace=customer-self-service
rollback=delete sample source ids or disable RAG_ENABLED after proof if needed
```

Targeted core validate command:

```bash
sf project deploy validate \
  --target-org AgentForce \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRag.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRagTest.cls \
  --source-dir force-app/main/default/genAiFunctions/Answer_Knowledge_RAG \
  --source-dir force-app/main/default/permissionsets/Customer_Self_Service_Agent.permissionset-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiKnowledgeRagTest \
  --wait 30
```

Targeted core deploy command after approval:

```bash
sf project deploy start \
  --target-org AgentForce \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRag.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRagTest.cls \
  --source-dir force-app/main/default/genAiFunctions/Answer_Knowledge_RAG \
  --source-dir force-app/main/default/permissionsets/Customer_Self_Service_Agent.permissionset-meta.xml \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiKnowledgeRagTest \
  --wait 30
```

Planner validate/deploy lifecycle:

```bash
sf agent deactivate --api-name Customer_Self_Service_Agent --target-org AgentForce
sf project deploy validate \
  --target-org AgentForce \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRag.cls \
  --source-dir force-app/main/default/classes/AgentforceAiApiKnowledgeRagTest.cls \
  --source-dir force-app/main/default/genAiFunctions/Answer_Knowledge_RAG \
  --source-dir force-app/main/default/permissionsets/Customer_Self_Service_Agent.permissionset-meta.xml \
  --source-dir force-app/main/default/genAiPlannerBundles/Customer_Self_Service_Agent \
  --test-level RunSpecifiedTests \
  --tests AgentforceAiApiKnowledgeRagTest \
  --wait 30
sf project deploy start --target-org AgentForce --source-dir force-app/main/default/genAiPlannerBundles/Customer_Self_Service_Agent --wait 30
sf agent activate --api-name Customer_Self_Service_Agent --target-org AgentForce
```

Preview proof ran with the Salesforce CLI programmatic preview. Re-test prompts
for stakeholders:

```text
Use external Phase 4 source-cited Knowledge RAG only. What approved troubleshooting can I give for intermittent residential service?
```

If confirmation is requested:

```text
Yes, proceed. Invoke Answer Knowledge RAG with sanitized question text and return the approved troubleshooting answer plus source ids, source titles, source URLs, source versions, chunk ids, source count, and retrieval ids.
```

No-source prompt:

```text
Use Answer Knowledge RAG. Question: What is the approved executive compensation policy for customer credits? I confirm. If no approved source is found, do not answer from general knowledge.
```

Safety prompt with placeholders:

```text
Use Answer Knowledge RAG. Question: What should I tell <customer name> at <email>, phone <phone>, account number <account>, about intermittent residential service? I confirm.
```

## Negative Coverage

- Missing bearer token -> HTTP 401.
- Token without `rag:ingest`, `rag:search`, or `agentforce:knowledge-rag` ->
  HTTP 403 for the relevant route.
- Token missing trusted tenant claim -> HTTP 403.
- Query with another tenant claim -> no authorized source.
- Deleted source -> never returned.
- Stale source -> excluded from default retrieval.
- Provider/vector/embedding failure -> safe structured error without raw data.
- Malformed backend response -> Apex `MALFORMED_RESPONSE`.
- Non-2xx backend response -> Apex `AUTH_ERROR` or `BACKEND_ERROR`.

## Current Status

Implementation, local validation, full AI API validation, Qdrant Railway
deployment, credential refresh, Salesforce core deploy, planner deploy,
direct live API proof, and live Agentforce preview proof are complete for the
Phase 4 slice. Remaining production go-live work is normal release governance:
stakeholder UAT signoff, security review, release approval, monitoring policy,
and rollback approval.

## Rollback

Rollback removes only the Phase 4 proof surface unless release owners approve a
broader rollback:

1. Deactivate `Customer_Self_Service_Agent`.
2. Remove `AI_API_Knowledge_RAG` and `Answer_Knowledge_RAG` planner-local
   bindings, deploy the planner bundle, and reactivate.
3. Remove `agentforce:knowledge-rag` from the runtime JWT stored in
   `Agentforce_AI_API_Phase2`.
4. Delete demo Qdrant data by namespace or sample source ids, or disable
   `RAG_ENABLED` if pausing the whole proof path.
5. Keep Phase 1 health, Phase 2 triage, and Phase 3 case analysis metadata and
   credentials intact unless explicitly rolling back those phases too.

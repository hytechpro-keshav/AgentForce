# Knowledge RAG Agent

## Overview

Phase 4 adds production-sane external Knowledge RAG behind the NestJS AI API.
It indexes approved knowledge documents into Qdrant, retrieves authorized
chunks through tenant and access filters, generates answers through
`ModelRouter.chat`, and returns source metadata to API clients and Agentforce.

Runtime path:

```text
Customer_Self_Service_Agent
  -> Answer Knowledge RAG
  -> AgentforceAiApiKnowledgeRag
  -> callout:Agentforce_AI_API_Phase2/agent/knowledge/answer
  -> Railway ai-api
  -> RAG retrieval -> EmbeddingProvider -> Qdrant
  -> LangChain prompt composition -> ModelRouter -> OpenAI
  -> source-cited structured response
```

This is external RAG, not native Salesforce `AnswerQuestionsWithKnowledge`.
It does not mark Open WebUI or React customer chat complete.

## Backend Endpoints

All routes require JWT bearer auth unless local auth is explicitly disabled.
Tenant is resolved from trusted JWT claims, not from user-supplied request body.

- `POST /rag/ingest` with scope `rag:ingest`
- `POST /rag/search` with scope `rag:search`
- `POST /agent/knowledge/answer` with scope `agentforce:knowledge-rag`

The RAG routes are protected by an in-process rate-limit guard. Defaults are
`60` search/answer requests per `60000` ms window and `10` ingest requests per
window, keyed by tenant, subject, route, and client address. Configure with
`RAG_RATE_LIMIT_WINDOW_MS`, `RAG_RATE_LIMIT_MAX_REQUESTS`, and
`RAG_INGEST_RATE_LIMIT_MAX_REQUESTS`.

Diagnostic stale-source searches additionally require `rag:search:stale`.
Customer-facing answer generation never enables stale retrieval.

`POST /agent/knowledge/answer` returns `ANSWERED` only when authorized sources
are found. When retrieval is empty, stale, deleted, tenant-filtered, or access
filtered, it returns `NO_SOURCE` and does not ask the model for a generic answer.

## Configuration

Required for production Phase 4:

```text
RAG_ENABLED=true
DEFAULT_EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
VECTOR_DB_PROVIDER=qdrant
QDRANT_URL=http://qdrant.railway.internal:6333
QDRANT_API_KEY=<Railway secret when Qdrant API-key auth is enabled>
QDRANT_COLLECTION=agentforce-knowledge-rag
QDRANT_VECTOR_SIZE=1536
QDRANT_DISTANCE=Cosine
RAG_DEFAULT_NAMESPACE=customer-self-service
RAG_CHUNK_SIZE=900
RAG_CHUNK_OVERLAP=120
RAG_TOP_K=4
RAG_SCORE_THRESHOLD=0.68
RAG_RATE_LIMIT_WINDOW_MS=60000
RAG_RATE_LIMIT_MAX_REQUESTS=60
RAG_INGEST_RATE_LIMIT_MAX_REQUESTS=10
```

OpenAI embeddings use the existing `OPENAI_API_KEY` and `OPENAI_BASE_URL`
configuration through the `EmbeddingProvider` abstraction. RAG services never
call OpenAI directly. Qdrant and Pinecone access stay behind `VectorStore`.

For deterministic local tests only:

```text
RAG_ENABLED=true
DEFAULT_EMBEDDING_PROVIDER=deterministic
VECTOR_DB_PROVIDER=memory
```

Production-like startup fails clearly when `RAG_ENABLED=true` and OpenAI or
the selected external vector DB config is missing. If RAG is disabled, the
routes fail closed with a clear `rag_not_configured` response.

## Cost Controls

- `EmbeddingRouter` normalizes vectors before ingestion/search, which keeps
  cosine-similarity behavior predictable for the memory store and compatible
  Qdrant/Pinecone indexes.
- `EmbeddingRouter` rejects zero-magnitude or invalid vectors instead of storing
  embeddings that would corrupt cosine scoring.
- `EmbeddingRouter` caches normalized embeddings in process by a SHA-256 key of
  provider, model, and text. Cache keys do not store raw prompt text. Repeated
  identical chunks or direct queries avoid another embedding provider call.
- Production embeddings are stored in Qdrant behind `VectorStore`; Pinecone
  remains available as an adapter. Local tests use the deterministic in-memory
  vector store.
- Long documents are chunked before embedding. The default `RAG_CHUNK_SIZE=900`
  characters usually maps to roughly 200 to 250 English support tokens, within
  the requested 200 to 500 token operating band.
- Source re-ingest deletes existing tenant/namespace/source vectors before
  upsert so old chunks do not continue generating spend or stale answers.
- Qdrant collection creation treats an already-created collection as ready,
  avoiding a multi-instance deployment race during first startup.

## Sample Corpus

Approved sample corpus:

```text
apps/ai-api/data/knowledge/phase4-sample-corpus.json
```

The corpus is indexing data, not fine-tuning data. It includes:

- customer-safe troubleshooting guidance
- credit and fee-waiver policy boundaries
- escalation and human handoff guidance
- account-safe guidance restricted to support roles/scopes
- a Spanish customer-safe troubleshooting example
- a stale source that must not be used by default
- a deleted source that must never ground answers
- an unanswerable-boundary source for no-source behavior

Every document carries source id, title, URL or Salesforce record reference,
tenant, namespace, document version, access metadata, stale/deleted flags,
language, and tags. Ingestion adds chunk id, content hash, ingestion timestamp,
and retrieval workflows return retrieval ids.

## Smoke Commands

Mint or provide a JWT with:

```text
scope="rag:ingest rag:search agentforce:knowledge-rag"
tenant="tenant-demo"
rag_namespace="customer-self-service"
iss="salesforce-agentforce"
aud="agentforce-ai-api"
sub="<safe-salesforce-principal-id>"
exp=<short-lived-unix-timestamp>
roles=["support-agent"]
```

For diagnostic stale-source search only, add `rag:search:stale`. The normal
Agentforce bridge JWT only needs `agentforce:knowledge-rag`; use a separate
maintenance JWT for `rag:ingest`, `rag:search`, and `rag:search:stale` unless a
release owner explicitly approves combining those privileges.

Then run:

```bash
AI_API_BASE_URL=https://<ai-api>.up.railway.app \
AI_API_BEARER_TOKEN=<scoped-jwt> \
scripts/smoke/phase4-rag-ingest-sample.sh
```

Direct answer check:

```bash
curl -sS -X POST "$AI_API_BASE_URL/agent/knowledge/answer" \
  -H "authorization: Bearer $AI_API_BEARER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"question":"What approved troubleshooting can I give for intermittent residential service?","requestId":"phase4-direct-answer"}'
```

Expected answer status: `ANSWERED`, with `sourceCount > 0`, source ids/titles,
chunk ids, retrieval ids, provider/model, embedding provider/model, vector DB
provider, and safe latency fields.

Unsupported question check:

```bash
curl -sS -X POST "$AI_API_BASE_URL/agent/knowledge/answer" \
  -H "authorization: Bearer $AI_API_BEARER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"question":"What is the executive compensation policy for customer credits?","requestId":"phase4-no-source"}'
```

Expected answer status: `NO_SOURCE`, no generated generic answer, and no source
metadata.

## Agentforce Action

- Topic: `AI_API_Knowledge_RAG`
- Action: `Answer_Knowledge_RAG`
- Apex bridge: `AgentforceAiApiKnowledgeRag`
- Endpoint: `callout:Agentforce_AI_API_Phase2/agent/knowledge/answer`
- Required scope in the existing Phase 2 Named Credential JWT:
  `agentforce:knowledge-rag`

Planner-visible outputs stay mostly flat: `ragStatus`, `safeMessage`, `answer`,
`sourceCount`, source ids, titles, URLs/record refs, versions, chunk ids,
retrieval ids, and optional `sourcesJson` without raw chunk text.

## Telemetry

The RAG workflow emits safe telemetry only:

- request id and retrieval id
- tenant and namespace
- source ids, chunk ids, and source versions
- provider/model and embedding provider/model
- topK and score threshold
- retrieved, returned, and access-filtered counts
- empty retrieval and fallback/no-source reason
- token usage, embedding usage if available, cost references, and latency by
  stage

Telemetry excludes raw prompts, raw chunks, provider bodies, secrets, JWTs, and
sensitive customer identifiers.

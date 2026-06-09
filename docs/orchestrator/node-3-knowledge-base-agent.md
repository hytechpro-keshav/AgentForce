# Node 3 — Knowledge Base Agent — Architecture & Design

> **Document type:** Formal enterprise architecture & design specification.
> **Audience:** Salesforce Architects · AI Architects · Platform Engineers · Service Operations Leadership.
> **Status:** Implementation specification. Defines Node 3's scope, contract, state shape, RAG integration, behavior, and lifecycle.
> **Companion:** [`case-triage-orchestrator-flow.md`](./case-triage-orchestrator-flow.md) — the orchestrator flow. This document is to Node 3 what the Node 2 design document is to the customer-history agent.

**Program invariants (unchanged across all nodes):**

- **Salesforce** = System of Record **+** Action Executor.
- **LangGraph** = Orchestrator / Brain. Owns control flow; nodes never own it.
- **Each node** = a narrow specialist that reads shared state, does exactly one job, enriches shared state, and returns control to the orchestrator.

---

## 1. Executive Summary

Node 3 — the **Knowledge Base Agent** — is the orchestrator's **source-cited guidance stage**. After Node 1 triages the Case and Node 2 assembles customer context, the orchestrator advances to Node 3 to answer one question:

> **"What approved troubleshooting guidance exists for this customer's issue, product, and situation?"**

Node 3 reuses the existing **LangChain RAG stack** (Pinecone vector store, OpenAI embeddings) and produces **sanitized, source-cited guidance** scoped to a trusted RAG namespace (e.g., `customer-self-service`). It writes that guidance and its retrieval metadata into the **shared workflow state** and **never calls Salesforce**.

Node 3 makes **no operational commitments**. It runs only when a trusted tenant and RAG namespace exist; otherwise it writes a skipped channel. If RAG fails (provider error, vector DB unavailable, no authorized sources), it writes a degraded outcome and continues without blocking the graph.

**Position in the graph:** Node 3 is the third stage in the linear chain
`Triage → Customer History → Knowledge → Gate → ...`.
Unlike Node 6, it is a **non-interrupting** node: it always auto-hands-off and never pauses for human approval.

**Why knowledge guidance is critical:** A customer calling about "laptop won't power on" gets better, faster resolution if the knowledge base supplies safety warnings (battery swelling RMA policy), prerequisite checks (power supply firmware), or verified root-cause fixes (CMOS reset steps) — all before human hands-on time. Node 3 supplies the grounded, source-cited guidance that downstream nodes consume to make faster, safer decisions.

**How downstream nodes consume its outputs:**

| Node      | Consumes from Node 3                                    |
| --------- | ------------------------------------------------------- |
| 4 · Parts | Part compatibility, parts availability checks, ordering |
| 5 · Parts | Warranty/cost implications of suggested resolutions     |
| 6 · Gate  | Knowledge-source trust signals for approval confidence  |
| 7 · Draft | Source citations to include in the response to customer |
| 8 · Log   | Retrieval and answer quality metrics for trending       |

Because the orchestrator owns state and sequencing, Node 3 **never calls another node directly**. It reads what Nodes 1 and 2 left in state, queries the trusted RAG namespace with a redacted, context-informed query, enriches state, and returns control.

---

## 2. Mental Model

**Why Knowledge runs after Customer History, not before.** Customer context (product model, warranty status, prior fixes, repeat-incident count) is the **query context** that makes retrieval precise. Retrieving before context would waste reads on off-topic results; running after context narrows the query (e.g., "no power on model VX-900 for premium customer with prior CMOS resets" instead of generic "no power").

**Why it never pauses for approval.** Knowledge retrieval is a read-only operation — zero risk to the Case or customer commitments. Node 6 will decide whether to escalate or auto-resolve based on knowledge confidence + source authority. Node 3 just supplies the facts.

**What business problem it solves.** It breaks the asymmetry between internal knowledge and customer support: before Node 3, a Case reached a human with no idea what self-service guidance existed. After Node 3, the workflow always includes the best-fit knowledge, reducing call duration and escalation rate.

**Why Salesforce is NOT consulted.** Knowledge Base articles live in Salesforce, but querying them directly (SOQL) is slow and yields keyword matches, not semantic relevance. The LangChain RAG stack with Pinecone embeddings retrieves semantically relevant, pre-vetted guidance in milliseconds with source-control transparency (visibility, tenant scope, staleness tracking).

**Why raw chunks never enter state or UI events.** RAG chunks are **internal retrieval artifacts**. State persists only **source metadata** (id, title, version, chunk id) and **safe guidance** (the final assembled answer). Chunk verbatim text is never stored, reducing data leakage and state bloat.

**Why this node avoids operational decisions.** Separation of concerns. If Node 3 tried to auto-resolve based on knowledge confidence, it would duplicate Node 6 Guardrail's authority and couple retrieval to action. Node 3 produces **guidance signals**; Node 6 decides whether to **trust and act** on them.

---

## 3. Orchestrator & State Model

### 3.1 What the orchestrator owns (same as Node 1 & 2)

| Concern               | Owned by orchestrator                                        |
| --------------------- | ------------------------------------------------------------ |
| Workflow state        | The single shared object every node reads from and writes to |
| Routing               | Which node runs next, including conditional edges            |
| Conditional execution | Skip a node when its required inputs are absent              |
| Parallelization       | Fan out independent reads, then join                         |
| Persistence           | Checkpointer + durable snapshot; restart-safe                |
| Pause / resume        | Interrupts at approval gates (Node 6) — **never** Node 3     |
| Retry handling        | Per-node retry with idempotent, side-effect-free reads       |

### 3.2 Node 3's responsibilities

| Concern                | Node 3                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| Eligibility check      | Trust the tenant-scoped RAG namespace (config or JWT claim); skip if absent     |
| Query construction     | Redact, assemble context-aware query from Case + triage + customer history      |
| Retrieval              | Call `RagRetrievalService.search(...)` with trusted context; catch provider err |
| Synthesis (optionally) | Call `RagAnswerService.answer(...)` if a language-model-assembled answer needed |
| State write            | Write `knowledgeGuidance` channel; never mutate triage or customerContext       |
| Error handling         | Degraded flag + continue; never block graph or throw                            |
| Observability          | Emit progress lines + execution traces for each step                            |

### 3.3 The `knowledgeGuidance` state channel

Node 3 is the **sole writer** of the `knowledgeGuidance` channel in `CaseTriageState`. The channel lives alongside `triage` and `customerContext` as a first-class state slice.

```typescript
export interface KnowledgeGuidanceChannel {
  /** Whether the eligibility gate allowed Node 3 to run. */
  eligible: boolean;
  /** Safe reason string (e.g., "namespace=customer-self-service"). */
  eligibilityReason?: string;
  /** True when retrieval, provider, or vector DB was unavailable. */
  degraded: boolean;
  /** Names of sources that were unavailable (e.g., ["vector-db"]). */
  degradedSources?: string[];

  /** The guidance outcome: ANSWERED (retrieved sources + safe answer), NO_SOURCE (no matching articles), or absent when skipped. */
  status?: "ANSWERED" | "NO_SOURCE";

  /** Present when status=ANSWERED. */
  answer?: {
    /** Safe, source-cited guidance text. Never raw chunk content. */
    safeSummary: string;
    /** List of source references: id, title, version, chunk ids. */
    sources: KnowledgeSourceRef[];
    /** Which retrieval and answer services provided this. */
    provider?: string;
    model?: string;
    embeddingProvider?: string;
    retrievalId?: string;
    latencyMs?: number;
    fallbackUsed?: boolean;
  };
}

export interface KnowledgeSourceRef {
  sourceId: string;
  title: string;
  version?: string;
  chunkId?: string;
  retrievalScorePercentile?: number;
}
```

### 3.4 Node 3's inputs from shared state

Node 3 reads (never writes):

| Channel            | Used for                                              |
| ------------------ | ----------------------------------------------------- |
| `context`          | Case subject, description, product info               |
| `triage`           | Priority and severity to weight urgency in query      |
| `customerContext`  | Product model, warranty, prior fixes, repeat incident |
| `tenantId`         | Scope for RAG namespace lookup                        |
| `principalSubject` | Auth principal for RAG access control                 |

---

## 4. RAG Integration

### 4.1 Trusted RAG context

Node 3 calls `RagAnswerService.answer()` and `RagRetrievalService.search()` with a `TrustedRagContext` built from the auth principal and orchestrator config.

```typescript
const trustedRagContext: TrustedRagContext = {
  tenantId: state.tenantId!,
  namespace: resolvedNamespace, // from JWT claim or config
  subject: state.principalSubject,
  scopes: principal.scopes,
  roles: principal.roles
};
```

- **tenantId** — Salesforce org id; scopes vector DB queries to authorized sources.
- **namespace** — Logical bucket (e.g., "customer-self-service"); controls which knowledge articles are visible.
- **subject** — Auth subject (agent id, user id); used for audit + rate-limit keying.
- **scopes, roles** — Additional access claims; checked against per-source `allowedScopes` / `allowedRoles` restrictions.

### 4.2 Query construction

`KnowledgeQueryBuilder` produces a **redacted, short, context-aware query** from:

- **Case subject + description** — the core issue statement
- **Triage priority / severity** — urgency signal
- **Customer history** — product model, warranty, prior fixes, repeat count
- **Node 3 eligibility** — confidence that the query is safe to execute

Query output is always **safe** (no customer names, account ids, PII) and **short** (<200 chars) to avoid vector DB tokenization limits.

Example query:

```
High-priority no-power issue on laptop model VX-900. Premium customer, covered by warranty. Two prior CMOS-reset fixes in 30 days. Repeat issue flag.
```

### 4.3 Retrieval call

```typescript
const retrieval = await ragRetrievalService.search(
  {
    query: redactedQuery,
    namespace: context.namespace,
    topK: 5,
    scoreThreshold: 0.65,
    includeStale: false,
    requestId: workflowId
  },
  trustedRagContext
);
```

- **includeStale: false** — exclude articles marked deprecated or end-of-life.
- **scoreThreshold: 0.65** — moderate; avoid low-confidence false positives.
- **topK: 5** — balance retrieval quality with API cost.

### 4.4 Answer synthesis (optional)

If the workflow needs a **language-model-assembled answer** (e.g., for the customer-facing chat), call `RagAnswerService.answer()`:

```typescript
const answer = await ragAnswerService.answer(
  {
    question: redactedQuery,
    namespace: context.namespace,
    contextSummary: buildSummary(state),
    topK: 5,
    scoreThreshold: 0.65,
    requestId: workflowId
  },
  trustedRagContext,
  { useCase: "knowledge_rag" }
);
```

For orchestrator Node 3, we retrieve only (not synthesize), keeping the guidance **retrieval-native** and storage-light.

---

## 5. Node 3 Behavior

### 5.1 Eligibility check

Node 3 runs when:

1. `state.tenantId` is set (Salesforce org scoping).
2. `trustedRagContext.namespace` resolves (from JWT claim or config default).
3. `config.orchestrator.knowledge.enabled === true` (feature flag; off by default).

If any check fails, Node 3 writes:

```typescript
{
  eligible: false,
  eligibilityReason: "RAG disabled by config",
  degraded: false
}
```

and returns immediately.

### 5.2 Query construction

`KnowledgeQueryBuilder.build()` takes:

```typescript
{
  caseContext: SalesforceCaseContext;
  triagePriority?: TriagePriorityDto;
  customerContext?: CustomerContextPackage;
}
```

and returns a safe, <200-char query. Implementation detail: use template + redaction rules to avoid PII leakage.

### 5.3 Retrieval

Call `RagRetrievalService.search()`. If `retrieval.rawMatches.length === 0`, write:

```typescript
{
  eligible: true,
  status: "NO_SOURCE",
  degraded: false
}
```

### 5.4 Retrieval success (`ANSWERED`)

Map retrieval results to source refs and write:

```typescript
{
  eligible: true,
  status: "ANSWERED",
  degraded: false,
  answer: {
    safeSummary: buildSafeAnswer(retrieval),
    sources: retrieval.rawMatches.map((m) => ({
      sourceId: m.sourceId,
      title: m.title,
      version: m.version,
      chunkId: m.chunkId,
      retrievalScorePercentile: m.scorePercentile
    })),
    provider: "openai",
    embeddingProvider: "openai",
    retrievalId: retrieval.retrievalId,
    latencyMs: latency,
    fallbackUsed: false
  }
}
```

### 5.5 RAG errors (degraded mode)

If `RagRetrievalService.search()` or `RagAnswerService.answer()` throws:

- Catch error; log telemetry.
- Write degraded channel:
  ```typescript
  {
    eligible: true,
    degraded: true,
    degradedSources: ["vector-db"] or ["provider"] or ["embedding"],
    status: undefined
  }
  ```
- Return immediately; do **not** throw and block the graph.

---

## 6. Configuration & Feature Flag

Add to `OrchestratorConfig`:

```typescript
export interface OrchestratorKnowledgeConfig {
  /** Feature flag: enables Node 3. Default: false. */
  enabled: boolean;
  /** Optional namespace override; defaults to RAG config namespace. */
  namespace?: string;
  /** Query character limit; default 200. */
  queryMaxChars: number;
  /** Retrieval top-K; default 5. */
  retrievalTopK: number;
  /** Minimum similarity score (0–1); default 0.65. */
  scoreThreshold: number;
}

export interface OrchestratorConfig {
  customerHistory: {...},
  knowledge: OrchestratorKnowledgeConfig; // NEW
}
```

Environment variables:

```
AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED=false              # default
AI_API_ORCHESTRATOR_KNOWLEDGE_NAMESPACE=customer-self-service
AI_API_ORCHESTRATOR_KNOWLEDGE_QUERY_MAX_CHARS=200
AI_API_ORCHESTRATOR_KNOWLEDGE_RETRIEVAL_TOP_K=5
AI_API_ORCHESTRATOR_KNOWLEDGE_SCORE_THRESHOLD=0.65
```

---

## 7. UI Observability & Status Events

Node 3 emits progress lines at key milestones:

| Step                 | Progress line                                     | Details                             |
| -------------------- | ------------------------------------------------- | ----------------------------------- |
| Eligibility skip     | "Knowledge base skipped (RAG disabled)."          | eligible=false, reason              |
| Query construction   | "Constructing targeted knowledge query."          | query length, case info             |
| Searching            | "Searching approved laptop knowledge base..."     | retrieval request details           |
| No source found      | "No matching knowledge articles found."           | score threshold, topK, search time  |
| Sources found        | "Found X matching troubleshooting guides."        | source count, retrieval score info  |
| Building answer      | "Generating source-cited guidance."               | provider, model, latency            |
| Writing to state     | "Writing knowledge findings to state."            | status, source count, answer length |
| RAG error (degraded) | "Knowledge base temporarily unavailable (error)." | error type, fallback flag           |

Each event includes structured `details` (non-PII label/value pairs) and an `execution trace` for engineering review.

---

## 8. Risks & Mitigations

| Risk                                  | Mitigation                                                       |
| ------------------------------------- | ---------------------------------------------------------------- |
| Stale/incorrect knowledge leaks       | `includeStale=false`; source visibility/tenant filtering         |
| Cross-tenant knowledge contamination  | RAG namespace + tenant-scoped vector DB queries                  |
| PII in query or answer                | Query redaction; answer summary (never raw chunks)               |
| RAG provider error blocks workflow    | Degraded flag; catch + continue without throwing                 |
| LLM hallucination in answer synthesis | If answer synthesis is added later, use strict template + redact |
| High retrieval latency (API timeout)  | Timeout guard + fallback to retrieval-only (no synthesis)        |
| Rate limiting (too many queries)      | Use auth principal for keying; respect provider rate limits      |

---

## 9. Testing Strategy

### 9.1 Graph tests

- Node 3 runs after customer history, writes only `knowledgeGuidance`, and hands off to gate.
- Eligible / ineligible cases skip Node 3 correctly.
- Degraded RAG errors continue graph (no throw).

### 9.2 Service tests

- `KnowledgeQueryBuilder`: redacts PII, stays under char limit, includes context hints.
- `RagRetrievalService.search()` integration: trusted context scoping, namespace enforcement.
- Answer synthesis (if added): source citation format, safe text extraction.

### 9.3 Persistence tests

- `knowledgeGuidance` survives memory/postgres snapshot round trips.
- State snapshots include all channel fields (status, sources, provider, latency).

### 9.4 E2E + RAG tests

- Ingest laptop corpus (no-power, battery-swelling RMA, overheating, USB-C, warranty, escalation articles).
- Query: "no power on VX-900" retrieves power/battery articles (not USB or warranty).
- Tenant filtering: org A's sources not visible to org B.
- Stale exclusion: deprecated articles don't surface.
- Deleted articles: removed chunks no longer retrieved.

### 9.5 Evals

- Laptop support prompts: no power, battery safety, overheating, USB-C, warranty, RMA, unsupported questions (pricing, legal, payment).
- Each eval includes knowledge-base context + expected source citations.

---

## 10. Assumptions & Scope

- **Laptop company is fictional** for now; product names and manuals are synthetic seed data.
- **Demo corpus uses `customer-self-service` namespace** by default; tenant onboarding can assign a laptop-specific namespace later.
- **Node 3 is read-only** to Salesforce and write-only to its own state channel.
- **Node 3 never pauses** for approval; Node 6 remains the future compliance/approval node.
- **RAG source chunks are never stored** in orchestration state or UI events — only source metadata and safe guidance.
- **No new external HTTP endpoints** are added. Existing `/rag/ingest`, `/rag/search`, `/agent/knowledge/answer` remain authoritative.
- **Public interfaces** (`RagDocumentDto`, `KnowledgeAnswerRequestDto`, `TrustedRagContext`) remain unchanged.

---

## 11. Implementation Roadmap

1. **Lifecycle DTOs**: Add `KNOWLEDGE_NODE_ID` to `OrchestratorNodeId` union.
2. **State contract**: Add `KnowledgeGuidanceChannel` + `KnowledgeSourceRef` to DTOs.
3. **Config**: Add `OrchestratorKnowledgeConfig` to config schema + env vars.
4. **Query builder**: Implement `KnowledgeQueryBuilder.build()`.
5. **Graph node**: Add `knowledge` node to `buildCaseTriageGraph()`.
6. **Module**: Import `RagModule` into `OrchestratorModule`.
7. **Service method**: Implement Node 3 node handler + graph wiring.
8. **Corpus**: Ingest synthetic laptop articles (no-power, battery, thermal, USB-C, warranty, escalation).
9. **Tests**: Unit (query builder, eligibility), integration (RAG calls), E2E (full graph + corpus).
10. **Evals**: Laptop support conversation specs.

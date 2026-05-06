---
description: "Use when editing RAG ingestion, embeddings, retrieval, Pinecone/vector DB integration, chunking, source citations, knowledge answers, or tenant-aware vector access."
applyTo:
  - "apps/ai-api/src/rag/**"
  - "apps/ai-api/src/vector-db/**"
  - "packages/rag-core/**"
  - "data/**"
---

# RAG And Vector Instructions

- Use `EmbeddingProvider` for all embeddings. Do not call a vendor embedding SDK directly from ingestion or retrieval services.
- Pinecone is production v1. Keep vector DB access behind an interface so Qdrant or pgvector can be added later.
- Every chunk should carry source ID, title, URL or record reference, tenant or namespace, document version, access-control metadata, and ingestion timestamp.
- Retrieval must filter by tenant and access rules before answers are generated.
- RAG answers should include source metadata where available and should clearly separate grounded content from fallback uncertainty.
- Do not store or log raw sensitive documents unless explicitly approved by the data policy.
- Tests should cover chunking boundaries, metadata preservation, tenant filters, empty retrieval, stale/deleted source behavior, and answer-with-sources formatting.

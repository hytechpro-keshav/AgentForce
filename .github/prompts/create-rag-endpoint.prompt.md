---
description: "Create a RAG ingestion, search, or answer endpoint with source metadata, tenant filtering, and eval coverage."
agent: "RAG Quality Reviewer"
argument-hint: "Endpoint name, source type, metadata, tenant rules, and expected answer format"
tools: [read, search, edit]
---

Create or update the requested RAG endpoint.

Requirements:

- Use `EmbeddingProvider`, vector DB abstraction, and tenant-aware retrieval filters.
- Preserve source metadata: source ID, title, URL or record reference, version, access-control tags, and ingestion timestamp.
- Return grounded answers with sources when available and explicit uncertainty when retrieval is empty or weak.
- Add tests for chunking, metadata preservation, tenant isolation, empty retrieval, and answer formatting.
- Add eval prompts for at least one answerable question, one unanswerable question, and one access-control-sensitive question.

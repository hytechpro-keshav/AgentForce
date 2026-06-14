---
paths:
  - "apps/ai-api/src/**/rag/**"
  - "apps/ai-api/src/**/vector/**"
  - "apps/ai-api/src/**/retrieval/**"
  - "apps/ai-api/src/**/embeddings/**"
  - "packages/rag*/**"
---

Read and follow `.github/instructions/rag-vector.instructions.md` before editing these files.

Key constraints:
- RAG changes need source-grounding checks, retrieval quality checks, and tenant/access-control checks
- Never expose raw retrieved chunks in logs or error responses
- Embeddings and vector DB calls belong in NestJS, never in Apex
- Tenant isolation must be enforced at retrieval time — never mix tenant data in a single query

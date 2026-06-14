# Create RAG Endpoint

Scaffold a new RAG retrieval endpoint in the NestJS AI API. Full details in `.github/prompts/create-rag-endpoint.prompt.md`.

## Steps

1. **Read context** — `.github/instructions/rag-vector.instructions.md` and `.agents/skills/langchain-rag/SKILL.md`

2. **Gather requirements** — ask for:
   - Endpoint path and HTTP method
   - Tenant scope (single tenant / multi-tenant)
   - Vector store (Pinecone namespace, collection name)
   - Embedding model and retriever k-value
   - Downstream use: chat completion, standalone retrieval?

3. **Create in `apps/ai-api/src/rag/`**:
   - `<name>.controller.ts` — NestJS route, DTO validation, auth guard
   - `<name>.service.ts` — LangChain retrieval chain via `ModelRouter`
   - `dto/<name>-query.dto.ts` — input DTO with Zod/class-validator
   - `<name>.service.spec.ts` — mocked retriever tests, tenant isolation check

4. **Requirements**:
   - Tenant ID from JWT/request context — never from request body
   - All SDK calls inside the service, never in the controller
   - Log retrieval IDs and latency via observability service; never log raw chunks
   - Source grounding check: at least one citation field in the response

5. **Verify**: `npm run ai-api:typecheck` && `npm run ai-api:test`

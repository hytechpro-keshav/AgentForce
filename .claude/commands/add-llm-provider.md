# Add LLM Provider

Add a new LLM provider to the NestJS AI API following the pattern in `.github/prompts/add-llm-provider.prompt.md`.

## Steps

1. **Read context** — review `.github/instructions/llm-provider.instructions.md` and `.github/instructions/nest-ai-api.instructions.md`.

2. **Gather requirements** — ask for:
   - Provider name (e.g. `anthropic`, `azure-openai`, `gemini`)
   - Provider SDK package name
   - Supported capabilities: chat completions, embeddings, streaming?

3. **Implement in `apps/ai-api/src/`**:
   - `providers/<name>/<Name>Provider.ts` — implements `LlmProvider` interface
   - `providers/<name>/<Name>Provider.spec.ts` — unit tests with mocked SDK
   - Register in `ProvidersModule` and `ModelRouter`

4. **Provider class requirements**:
   - Implements `LlmProvider` (and `EmbeddingProvider` if applicable)
   - No direct SDK import outside the provider file
   - Handles errors with structured `LlmProviderError`
   - Logs token usage and latency via the observability service

5. **Configuration**:
   - Add config schema to `LlmProviderConfig`
   - Document the new env vars in `.env.example`
   - Runtime switching must be config-only — no service rewrites

6. **Verify**:
   - `npm run ai-api:typecheck`
   - `npm run ai-api:test`

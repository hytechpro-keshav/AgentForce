# AgentForce Monorepo

This repo is the canonical monorepo for a production-target hybrid AI architecture. Salesforce remains the system of record and Agentforce remains the Salesforce-native agent experience. External AI orchestration lives in scoped monorepo apps for the NestJS AI API on Railway, Open WebUI deployment assets, and the React customer chat window.

Start with [ARCHITECTURE.md](ARCHITECTURE.md) and [AGENTS.md](AGENTS.md) before implementing new capabilities.

## Current Scope

- Salesforce DX project with Agentforce planner bundles, prompt templates, Apex classes, and LWC tooling.
- Monorepo app path for Phase 1 NestJS work: `apps/ai-api`.
- Phase 4 Knowledge RAG implementation under `apps/ai-api` with LangChain,
  OpenAI embeddings, Qdrant/Pinecone vector adapters, source-cited answers,
  sample corpus, and Agentforce bridge metadata.
- Phase 5 Open WebUI internal-console deployment assets under `apps/openwebui`,
  connected only to the NestJS OpenAI-compatible gateway with scoped
  `openwebui:chat` auth.
- Phase 6 Next.js customer chat window under `apps/react-chat-window`,
  calling only `POST /auth/customer-chat/session`, `POST /chat/message`, and
  `POST /chat/escalate` on the NestJS AI API with customer-safe auth.
- Phase 7 AI API cost/model flexibility under `apps/ai-api`: provider adapters,
  use-case model routing, token budget guardrails, fallback policy,
  cost-reference telemetry, and tenant-safe RAG answer caching.
- Existing Agentforce metadata under `force-app/main/default/genAiPlannerBundles`, `genAiFunctions`, and `genAiPromptTemplates`.
- Architecture configuration for Agentforce, NestJS, RAG, Open WebUI, telemetry, React chat, and release work.

## Canonical Direction

The 5 May 2026 production plan is the target architecture:

```text
Agentforce -> Apex -> Named Credential -> Railway NestJS -> ModelRouter -> OpenAI/LangChain/Pinecone
```

## Useful Docs

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [AGENTS.md](AGENTS.md)
- [docs/context/project-memory.md](docs/context/project-memory.md)
- [docs/context/reference-patterns.md](docs/context/reference-patterns.md)
- [docs/testing/agentforce-evals.md](docs/testing/agentforce-evals.md)
- [docs/agents/support-operations.md](docs/agents/support-operations.md)
- [docs/deployment/railway-ai-api-phase7.md](docs/deployment/railway-ai-api-phase7.md)

## Local Checks

Salesforce and LWC checks:

```bash
npm run lint
npm run test:unit
npm run prettier:verify
sf apex run test --test-level RunLocalTests --wait 30 --result-format human
```

Phase 1 `apps/ai-api` checks:

```bash
npm run ai-api:typecheck
npm run ai-api:test
npm run ai-api:test:e2e
npm run ai-api:build
AI_API_BASE_URL=http://localhost:3000 AGENTFORCE_HEALTH_API_KEY=smoke-key npm run ai-api:smoke:health
```

Phase 4 sample RAG smoke after deploying/configuring the ai-api:

```bash
AI_API_BASE_URL=https://<ai-api>.up.railway.app \
AI_API_BEARER_TOKEN=<scoped-jwt> \
scripts/smoke/phase4-rag-ingest-sample.sh
```

Phase 5 Open WebUI gateway smoke after minting a scoped gateway JWT:

```bash
AI_API_BASE_URL=https://<ai-api>.up.railway.app \
AI_API_BEARER_TOKEN=<openwebui-scoped-jwt> \
scripts/smoke/phase5-openwebui-gateway-smoke.sh
```

Phase 6 React customer chat window checks:

```bash
npm run react-chat:typecheck
npm run react-chat:test
npm run react-chat:build
npm run react-chat:dev     # local dev on http://localhost:4173
npm run react-chat:preview # preview the production build on :4173
```

Run the checks that match the files you changed. Org-dependent Agentforce evals should be run after metadata is deployed to an enabled org.

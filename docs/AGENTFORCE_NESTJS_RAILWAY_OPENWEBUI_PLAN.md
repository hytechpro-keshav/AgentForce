# Production Plan: Agentforce + NestJS + Railway + OpenAI + LangChain + Pinecone + Open WebUI

Date: 5 May 2026

## 1. Short Verdict

Yes, this should be treated as a production-target hybrid architecture, not a throwaway prototype.

Open WebUI will be the production internal AI chat surface for employees, admins, and delivery teams. It will not connect directly to OpenAI. It will connect to the NestJS AI API through an OpenAI-compatible gateway route owned by us. That keeps authentication, logging, model routing, RAG, cost control, and audit behavior in one backend.

The recommended architecture is:

```text
Salesforce Agentforce
  -> Agent Topic / Action
        -> Apex Invocable Action
  -> Named Credential / External Credential
  -> NestJS AI API on Railway
                                -> LLM Provider Layer
                                -> OpenAI as production v1 model provider
                                -> LangChain RAG
                                -> Pinecone Vector DB

Open WebUI Internal Chat
        -> NestJS OpenAI-compatible gateway
        -> same LLM/RAG/security layer used by Agentforce

React Customer Chat Window
        -> NestJS chat API
        -> same LLM/RAG/security layer used by Agentforce
```

## 2. What We Are Building

We are building a hybrid Salesforce Agentforce and external AI backend project.

Salesforce will remain the business system of record. Agentforce will provide the Salesforce-native agent experience. NestJS will provide the production AI orchestration layer. OpenAI will be the production v1 LLM provider behind a provider abstraction. LangChain will provide RAG and agent workflow logic. Pinecone will store embedded knowledge. Open WebUI will provide the production internal chat interface. A React chat window will provide the production customer-facing chat interface.

That React customer chat window can be delivered as a standalone Railway app or embedded inside a Salesforce-hosted Experience Cloud or application page shell. In both cases it still calls the NestJS chat API and remains part of the monorepo external AI platform lifecycle.

This is not a replacement for Agentforce, Certinia, Field Service, Data Cloud, and Experience Cloud. It is a practical integration architecture that connects Salesforce Agentforce to custom AI services.

## 3. Core Architecture

```text
User inside Salesforce
        |
        v
Agentforce Agent
        |
        v
Agentforce Topic / genAiPlugin
        |
        v
Agentforce Action / genAiFunction
        |
        v
Apex Invocable Action
        |
        v
Named Credential / External Credential
        |
        v
NestJS API deployed on Railway
        |
        v
LangChain Orchestration
        |
        +--> LLM Provider Layer
        |    +--> OpenAI first
        |    +--> Anthropic / Azure OpenAI / Gemini later
        |    +--> self-hosted OpenAI-compatible model later
        +--> Pinecone Vector DB
        +--> Custom business logic
```

Internal chat path:

```text
Internal user
        |
        v
Open WebUI
        |
        v
NestJS OpenAI-compatible gateway
        |
        v
ModelRouter + OpenAI + LangChain + Pinecone + tools
```

Customer chat path:

```text
Customer user
        |
        v
Salesforce-hosted page shell or external site
        |
        v
React chat window
        |
        v
NestJS chat API
        |
        v
ModelRouter + OpenAI + LangChain + Pinecone + Salesforce-safe actions
```

## 4. Responsibility Split

### Salesforce Agentforce

Agentforce should handle:

- Salesforce-native conversation experience
- user intent and action selection
- access to Salesforce context
- Salesforce permission model
- invoking Apex invocable actions and approved custom agent actions
- returning structured answers to Salesforce users

### Apex / Flow

Apex and Flow should handle:

- collecting Salesforce record context
- validating Salesforce-side inputs
- calling the external NestJS API
- converting external API responses into Agentforce action outputs
- staying deterministic and testable

Apex should contain neither complex prompt orchestration nor RAG logic.

### NestJS AI API

NestJS should handle:

- OpenAI API calls through the provider layer
- LangChain chains
- RAG retrieval
- embeddings
- Pinecone vector DB integration
- prompt templates
- AI response formatting
- token/cost logging
- API authentication
- rate limiting
- observability

### Open WebUI

Open WebUI should handle:

- production internal AI chat for employees and admins
- prompt and RAG workflows routed through NestJS
- internal knowledge Q&A
- internal case/project/account support workflows
- authenticated and audited AI conversations
- admin-friendly visibility into AI behavior

Open WebUI is not the customer portal. Customer-facing chat will be the React chat window routed through NestJS, either as a standalone app or embedded in a Salesforce-hosted page shell.

## 5. Can We Use Open WebUI?

Yes.

Based on its public positioning, Open WebUI is a self-hosted AI interface that can connect to OpenAI-compatible endpoints and support conversations, tools, functions, retrieval/search-style workflows, cloud deployment, and enterprise-oriented capabilities such as SSO, RBAC, and audit logs in enterprise contexts.

### Production Role In This Project

Use Open WebUI as the production internal chat interface.

Production rule:

```text
Open WebUI -> NestJS OpenAI-compatible gateway -> ModelRouter -> OpenAI -> LangChain/Pinecone -> audited response
```

Open WebUI must not call OpenAI directly in this architecture.

The Salesforce production flow is:

```text
Agentforce -> Apex/Flow action -> NestJS API -> ModelRouter -> OpenAI/LangChain/Pinecone
```

The customer chat production flow is:

```text
Salesforce-hosted page shell or external site -> React chat window -> NestJS chat API -> ModelRouter -> OpenAI/LangChain/Pinecone
```

## 6. Repository Topology Decision

This project now uses one canonical monorepo for Salesforce Agentforce metadata and the external AI platform.

The AI backend, chat frontend, Railway deployment, LangChain dependencies, Open WebUI setup, and LLM provider configuration still have a different lifecycle from Salesforce metadata. They also have different owners, tests, secrets, deployment targets, and rollback behavior. The monorepo decision changes repository topology and workflow visibility, not runtime ownership or security boundaries.

Keep Salesforce metadata stable and reviewable under `force-app/`. Place NestJS, React, Open WebUI, LangChain, Pinecone, Railway, and LLM provider code under scoped app and package folders in this repository. Promote approved Salesforce metadata only after pilot validation, UAT, security review, and release approval.

Embedding the customer chat inside Experience Cloud or another Salesforce-hosted surface does not move the React runtime into Salesforce metadata. Salesforce may host the page shell or wrapper, but the React codebase and backend ownership remain in the monorepo platform paths.

Monorepo model:

```text
AgentForce/
├── force-app/main/default/
│   ├── classes/
│   ├── flows/
│   ├── objects/
│   ├── permissionsets/
│   ├── namedCredentials/
│   ├── externalCredentials/
│   ├── genAiPlannerBundles/
│   ├── genAiPlugins/
│   ├── genAiFunctions/
│   └── genAiPromptTemplates/
├── agent-eval/
├── apps/ai-api/
│   ├── src/
│   ├── test/
│   ├── Dockerfile
│   └── .env.example
├── apps/react-chat-window/
│   ├── src/
│   ├── Dockerfile
│   ├── railway.json
│   └── .env.example
├── apps/openwebui/
│   ├── README.md
│   ├── docker-compose.production.yml
│   └── railway-notes.md
├── packages/llm-core/
├── packages/rag-core/
├── packages/shared-contracts/
├── scripts/
├── docs/
├── railway.json
├── .github/
├── AGENTS.md
├── package.json
└── README.md
```

Implementation decision:

- keep Salesforce metadata under `force-app/` and Agentforce evals under `agent-eval/`
- create NestJS, React chat, Open WebUI, LangChain, Pinecone, and provider abstraction code inside the monorepo platform paths
- use scoped app/package scripts and CI so Salesforce, backend, frontend, and deployment checks can run independently
- promote only approved Salesforce metadata after pilot validation, UAT, security review, and release approval

## 7. Standards From Reference Repositories

This plan should follow lessons from the two previously reviewed repositories.

### From `trailheadapps/agent-script-recipes`

Adopt:

- recipe-style documentation
- one clear README per production agent capability
- example prompts
- expected responses
- setup scripts
- validation scripts
- Mermaid diagrams
- clear prerequisites
- careful Agentforce terminology

Add docs like:

```text
docs/agents/support-operations.md
docs/agents/knowledge-rag.md
docs/agents/revenue-intelligence.md
docs/agents/services-org-intelligence.md
```

### From `aquivalabs/my-org-butler`

Adopt:

- `genAiPlugins` for topics
- `genAiFunctions` for actions
- `genAiPlannerBundles` for planner/agent metadata
- input/output schemas for actions
- permission sets
- scratch org scripts
- sample data scripts
- agent evals
- REST-based multi-turn tests
- deployment notes for Agentforce metadata problems

Important deployment warnings:

- active agents can block redeployment
- planner bundle caching can make changes appear stale
- schema-only changes may need careful redeploy strategy
- prompt template version identifiers can be fragile
- Agentforce testing needs more than normal Apex tests

### From `getsentry/sentry`

Adopt:

- clear module ownership and review lenses as the monorepo grows
- path-scoped CI that detects changed surfaces before running focused jobs
- required aggregate checks per surface so skipped jobs do not mask failures
- fixture-heavy tests for corrupt-state, configuration, and integration edge cases
- generated-file and pre-commit checks for artifacts that must stay in sync
- safe structured telemetry without raw PII, secrets, prompts, or provider payloads

### From `getsentry/warden`

Adopt:

- scoped agents, skills, and instructions with narrow descriptions and minimal tool access
- strict schema validation for agent/eval/config files
- YAML evals with `given`, `should_find`, and `should_not_find` fields
- a separation between execution and judgment for AI behavior evals
- package-local TypeScript scripts for `build`, `test`, `typecheck`, and eval commands
- no-op safe AI telemetry for model calls, tokens, cost references, and outcomes

## 7A. Repository Intelligence Configuration

This repo should include AI-readable architecture guidance from day one. This is especially important because the project has Salesforce metadata, NestJS, LangChain, vector DB, Railway, Open WebUI, and frontend UI boundaries.

Use `AGENTS.md` as the canonical project-wide instruction file. Do not duplicate the same content in both `AGENTS.md` and `.github/copilot-instructions.md`. If a tool requires a Claude-specific file, make that file point back to `AGENTS.md` instead of copying the rules.

Recommended shared configuration:

```text
AGENTS.md
.github/instructions/
├── salesforce-agentforce.instructions.md
├── nest-ai-api.instructions.md
├── llm-provider.instructions.md
├── rag-vector.instructions.md
├── frontend-chat.instructions.md
├── railway-deploy.instructions.md
└── security.instructions.md
.github/agents/
├── agentforce-reviewer.agent.md
├── nest-ai-architect.agent.md
├── rag-quality-reviewer.agent.md
├── security-reviewer.agent.md
└── release-checker.agent.md
.github/prompts/
├── create-agentforce-action.prompt.md
├── add-llm-provider.prompt.md
├── create-rag-endpoint.prompt.md
├── review-agentforce-metadata.prompt.md
└── generate-production-script.prompt.md
docs/context/
├── project-memory.md
├── glossary.md
└── decision-log.md
docs/adr/
├── 0001-separate-salesforce-and-ai-repos.md
├── 0002-llm-provider-abstraction.md
├── 0003-agentforce-first-production-pilot.md
└── 0004-openwebui-as-internal-console.md
```

Claude-specific wrapper:

```text
.claude/
├── CLAUDE.md
└── skills/
        ├── agentforce-action/SKILL.md
        ├── llm-provider/SKILL.md
        └── rag-endpoint/SKILL.md
```

The `.claude/CLAUDE.md` file should be short:

```markdown
# Claude Project Context

Read `AGENTS.md` first. Follow the architecture decisions in `docs/adr/`.
Do not duplicate Salesforce, NestJS, RAG, and security rules here.
```

Root `AGENTS.md` should contain only rules that apply to the whole repo:

```markdown
# Project Agent Guidelines

## Architecture

- Keep Salesforce metadata, the NestJS AI API, Open WebUI assets, React chat, and shared platform packages in this monorepo under scoped directories.
- Agentforce owns Salesforce conversation and action orchestration.
- Apex/Flow owns Salesforce context gathering and secure callouts.
- NestJS owns LLM routing, LangChain, RAG, vector DB integration, and external AI logic.
- Open WebUI is the production internal chat interface. React chat window is the production customer chat interface. Agentforce is the Salesforce-native agent interface.

## LLM Rules

- Agent services must call `ModelRouter`, never provider SDKs directly.
- Add new model vendors through `LlmProvider` and `EmbeddingProvider` interfaces.
- Keep OpenAI as the production v1 provider, and preserve Anthropic, Azure OpenAI, Gemini, and self-hosted OpenAI-compatible extension paths.

## Salesforce Rules

- Use Named Credentials / External Credentials for callouts.
- Apex classes must be testable and use HTTP mocks.
- Do not commit org-specific secrets or production-only metadata.
- Treat Certinia-like and Field-Service-like objects as production pilot models until real packages are enabled and mapped.

## Security Rules

- No secrets in repo.
- Keep `.env.example`, not `.env`.
- Require auth between Salesforce and NestJS.
- Do not log raw PII, prompts containing sensitive customer data, and API keys.

## Verification

- Backend tests must pass before Railway deployment.
- Apex tests must pass before Salesforce metadata promotion.
- Agentforce eval prompts must be updated when agent behavior changes.
```

Instruction files should be scoped, not always loaded for everything.

Example `salesforce-agentforce.instructions.md` frontmatter:

```yaml
---
description: "Use when editing Salesforce Agentforce metadata, Apex invocable actions, genAiFunctions, genAiPlugins, genAiPlannerBundles, flows, permission sets, or Named Credentials."
applyTo: "force-app/**"
---
```

Example `nest-ai-api.instructions.md` frontmatter:

```yaml
---
description: "Use when editing the NestJS AI API, Railway backend, LangChain services, provider registry, auth guards, DTOs, or observability."
applyTo: "apps/ai-api/**"
---
```

Example `llm-provider.instructions.md` frontmatter:

```yaml
---
description: "Use when adding or changing LLM providers, embeddings, model routing, OpenAI-compatible gateways, Anthropic, Azure OpenAI, Gemini, or self-hosted model support."
applyTo: "apps/ai-api/src/llm/**,packages/llm-core/**"
---
```

Project memory should be committed as documentation, not as personal hidden memory.

Use `docs/context/project-memory.md` for short durable facts:

```markdown
# Project Memory

- This repo is the canonical monorepo for Salesforce Agentforce metadata plus the external AI platform.
- Keep Salesforce metadata and external AI platform services separated by folder, scripts, tests, secrets, and release gates.
- OpenAI is the production v1 provider, and provider switching is a core requirement.
- Open WebUI is production internal chat, not the Salesforce-native Agentforce interface.
- First production pilot is Agentforce-only Support Operations, then the monorepo NestJS bridge.
- Cost reduction and self-hosted models are later phases.
```

This gives Copilot, Claude, and other AI coding tools enough context to act consistently without re-learning the architecture in every session.

## 8. Railway Deployment Plan

Railway will host the NestJS backend, the default standalone React chat window deployment, and the Open WebUI internal chat service.

When business or UX needs require a Salesforce-hosted customer experience, Salesforce can host the page shell or embed wrapper while the React chat still talks only to the NestJS API. Salesforce should not become the Node or Vite runtime and should not hold chat backend secrets.

Recommended Railway services:

```text
Railway Project
├── ai-api
│   ├── NestJS
│   ├── LLM provider layer with OpenAI for production v1
│   ├── LangChain RAG
│   └── Salesforce-facing endpoints
├── react-chat-window
│   ├── React/Vite production customer chat UI for standalone hosting and Salesforce embed builds
│   └── talks only to ai-api
└── openwebui
        ├── production internal chat UI
        └── talks only to ai-api OpenAI-compatible gateway
```

Pinecone will be the production v1 vector database. Railway will not host the vector database.

Production v1 data services:

- Pinecone for vector search
- Railway PostgreSQL for application metadata, audit references, and non-vector state
- Salesforce for CRM system-of-record data

## 8A. Salesforce-Hosted Chat Surface Option

A Salesforce-hosted Experience Cloud page, Lightning app page, or similar Salesforce surface may present the customer chat. Treat that as a delivery surface, not as the owner of the React application.

Preferred pattern:

- host the React app externally and embed it in Salesforce with an iframe or wrapper component
- keep all model access, RAG, auth, and logging behind the NestJS API

Secondary pattern:

- package a compact static build into Salesforce only when embed constraints require it
- avoid treating Salesforce as the runtime host for a full React release train

In either pattern, Salesforce-hosted chat surfaces must not expose model credentials, backend secrets, or direct LLM or vector DB access to the browser.

## 9. Open WebUI Deployment Notes

Open WebUI will be deployed as a Railway Docker service for production internal use.

Railway production requirements:

- persistent storage is configured correctly
- environment variables are stored securely
- app URL is protected
- OpenAI key is not exposed to browser clients
- auth/RBAC is configured before sharing with internal users
- Open WebUI connects only to the NestJS OpenAI-compatible gateway
- Open WebUI does not store production Salesforce secrets
- Open WebUI data retention is documented

## 10. Open WebUI Production Integration

```text
Open WebUI -> NestJS OpenAI-compatible endpoint -> LangChain/RAG/OpenAI
```

This is the production internal-chat integration.

Required behavior:

- Open WebUI sends all chat traffic to `https://<ai-api>/v1/chat/completions`
- NestJS authenticates Open WebUI with a gateway key
- NestJS applies tenant/user policy
- NestJS performs RAG through LangChain and Pinecone
- NestJS calls OpenAI through `ModelRouter`
- NestJS logs token usage, latency, tool calls, retrieval IDs, and safety outcomes
- NestJS returns OpenAI-compatible streaming and non-streaming responses

Production UI split:

```text
Open WebUI -> internal employee/admin chat
React chat window -> customer-facing chat
Agentforce -> Salesforce user agent experience
```

## 11. NestJS Backend Modules

Recommended NestJS module structure:

```text
src/
├── auth/
│   ├── api-key.guard.ts
│   ├── jwt.guard.ts
│   └── auth.module.ts
├── llm/
│   ├── llm.module.ts
│   ├── interfaces/
│   │   ├── llm-provider.interface.ts
│   │   ├── embedding-provider.interface.ts
│   │   └── model-router.interface.ts
│   ├── providers/
│   │   ├── openai.provider.ts
│   │   ├── anthropic.provider.ts
│   │   ├── azure-openai.provider.ts
│   │   ├── gemini.provider.ts
│   │   └── openai-compatible.provider.ts
│   ├── llm-provider-registry.ts
│   ├── model-router.service.ts
│   ├── prompt.service.ts
│   └── token-usage.service.ts
├── rag/
│   ├── rag.module.ts
│   ├── ingestion.service.ts
│   ├── embedding.service.ts
│   ├── retriever.service.ts
│   └── rag-answer.service.ts
├── vector-db/
│   ├── vector-db.module.ts
│   ├── pinecone.service.ts
│   ├── qdrant.service.ts
│   └── pgvector.service.ts
├── salesforce/
│   ├── salesforce.module.ts
│   ├── salesforce-auth.service.ts
│   ├── salesforce-query.service.ts
│   └── salesforce-context.service.ts
├── agents/
│   ├── support-ops-agent.service.ts
│   ├── knowledge-agent.service.ts
│   ├── revenue-agent.service.ts
│   └── services-org-agent.service.ts
├── chat/
│   ├── chat.controller.ts
│   ├── chat.service.ts
│   └── dto/
└── health/
    └── health.controller.ts
```

## 12. LLM Provider Abstraction

The NestJS app must be provider-agnostic from day one.

OpenAI is the production v1 provider. Agent services must not call OpenAI directly. They must call a local provider interface so future providers can be added without rewriting business agents.

Core interfaces:

```text
LlmProvider
├── completeText(input)
├── completeChat(input)
├── streamChat(input)
├── supportsToolCalling()
└── getModelInfo()

EmbeddingProvider
├── embedText(input)
├── embedDocuments(input)
└── getEmbeddingDimensions()

ModelRouter
├── selectChatProvider(clientId, useCase)
├── selectEmbeddingProvider(clientId, knowledgeBase)
└── selectFallbackProvider(error, originalProvider)
```

Production v1 providers:

- OpenAI chat provider
- OpenAI embedding provider
- NestJS OpenAI-compatible gateway for Open WebUI clients

Post-v1 provider extensions:

- Anthropic
- Azure OpenAI
- Gemini
- self-hosted vLLM
- self-hosted Ollama
- self-hosted Text Generation Inference
- client-specific custom LLM API

Runtime switching must work through configuration, not code edits.

Example configuration model:

```text
DEFAULT_CHAT_PROVIDER=openai
DEFAULT_EMBEDDING_PROVIDER=openai
MODEL_ROUTING_MODE=tenant

CLIENT_ACME_CHAT_PROVIDER=anthropic
CLIENT_ACME_CHAT_MODEL=claude-3-7-sonnet

CLIENT_BETA_CHAT_PROVIDER=openai-compatible
CLIENT_BETA_CHAT_BASE_URL=https://client-llm.example.com/v1
CLIENT_BETA_CHAT_MODEL=custom-enterprise-model
```

Design rule:

```text
Agent services call ModelRouter.
ModelRouter chooses provider.
Provider calls the configured vendor SDK through its adapter. The OpenAI-compatible adapter serves Open WebUI and future self-hosted gateways.
Agent services never import vendor SDKs directly.
```

This keeps the backend ready for clients who start with OpenAI in production v1 and later require Anthropic, Azure OpenAI, Gemini, a custom SDK, and a self-hosted OpenAI-compatible model.

## 13. Core API Endpoints

Start with these endpoints:

```text
GET /health
POST /agent/support/triage-case
POST /agent/knowledge/answer
POST /agent/revenue/account-risk
POST /agent/services/project-health
POST /rag/ingest
POST /rag/search
POST /chat/message
```

Open WebUI production integration requires these OpenAI-compatible routes:

```text
POST /v1/chat/completions
GET /v1/models
```

This allows Open WebUI-style clients to connect to our NestJS backend as if it were an OpenAI-compatible provider.

## 14. Environment Variables

NestJS backend:

```text
NODE_ENV=production
PORT=3000

DEFAULT_CHAT_PROVIDER=openai
DEFAULT_EMBEDDING_PROVIDER=openai
MODEL_ROUTING_MODE=static

OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

ANTHROPIC_API_KEY=
ANTHROPIC_CHAT_MODEL=

AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=

GEMINI_API_KEY=
GEMINI_CHAT_MODEL=

OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=
OPENAI_COMPATIBLE_CHAT_MODEL=
OPENAI_COMPATIBLE_EMBEDDING_MODEL=

VECTOR_DB_PROVIDER=pinecone
VECTOR_DB_URL=
VECTOR_DB_API_KEY=
VECTOR_DB_INDEX=

SALESFORCE_LOGIN_URL=
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
SALESFORCE_USERNAME=
SALESFORCE_PRIVATE_KEY=

AGENT_API_KEY=
CORS_ORIGIN=
LOG_LEVEL=info
```

Open WebUI service:

```text
OPENAI_API_KEY=<openwebui-gateway-key>
OPENAI_API_BASE_URL=https://your-ai-api.up.railway.app/v1
WEBUI_AUTH=true
```

Exact Open WebUI env variable names should be confirmed from the Open WebUI docs during setup.

## 15. Salesforce Metadata Plan

Recommended metadata directories:

```text
force-app/main/default/
├── genAiPlannerBundles/
├── genAiPlugins/
├── genAiFunctions/
├── genAiPromptTemplates/
├── classes/
├── flows/
├── objects/
├── permissionsets/
├── namedCredentials/
├── externalCredentials/
└── remoteSiteSettings/
```

Recommended actions:

```text
Triage_Case
Search_Knowledge_Rag
Summarize_Account_Risk
Analyze_Project_Health
Recommend_Next_Action
```

Each action should have:

```text
<ActionName>.genAiFunction-meta.xml
input/schema.json
output/schema.json
Apex invocable class
Apex test class
README and production runbook notes
```

## 16. First MVP Scope

Do not start with all six agents.

Start with this production-path MVP:

```text
Support Operations Agent
+ Knowledge RAG Agent
+ NestJS AI API
+ LLM provider layer with OpenAI first
+ Pinecone Vector DB
+ Open WebUI for production internal chat
+ React chat window for customer chat, with optional Salesforce-hosted embed
+ Salesforce Agentforce action integration
```

This is the first production slice. It should be built with the same authentication, logging, repository boundaries, deployment controls, and testing approach expected for go-live.

## 17. Production Pilot Flow

### Demo 1: Case Triage

```text
Salesforce user asks Agentforce:
"Triage this case and recommend the next action."

Agentforce calls Triage_Case action.
Apex collects Case fields.
Apex calls NestJS on Railway.
NestJS calls OpenAI through ModelRouter.
NestJS returns summary, category, priority, confidence, next action.
Agentforce presents the result.
```

### Demo 2: Knowledge RAG

```text
Salesforce user asks:
"Find the best answer for this customer issue."

Agentforce calls Search_Knowledge_Rag action.
Apex sends issue context to NestJS.
NestJS searches vector DB.
LangChain builds grounded prompt.
OpenAI returns answer.
NestJS returns answer with sources.
Agentforce presents the grounded answer.
```

### Flow 3: Open WebUI Internal Production Chat

```text
Internal user opens Open WebUI.
Internal user asks the same knowledge, case, project, or account question.
Open WebUI calls the NestJS OpenAI-compatible gateway.
NestJS applies auth, policy, RAG, model routing, logging, and cost tracking.
Open WebUI presents the internal answer with sources where available.
```

### Flow 4: React Customer Chat

```text
Customer opens React chat window directly or through a Salesforce-hosted Experience Cloud or app page shell.
Customer asks a support question.
React chat calls the NestJS chat API.
NestJS applies customer-safe policy, RAG, model routing, logging, and escalation rules.
NestJS creates or updates Salesforce records only through approved Salesforce actions.
React chat presents the answer or escalation outcome.
```

## 18. Build Phases

### Phase 0: Salesforce And Agentforce Production Pilot

Goal: create the first production-path Agentforce capability before adding external AI complexity.

Build inside the Salesforce overlay repo only:

- one Agentforce agent
- one Support Operations topic
- one simple Apex invocable action
- one controlled Case pilot dataset
- one permission set
- one README with production pilot prompts

Recommended first Agentforce capabilities:

- summarize a Case
- classify the issue type
- recommend next action
- draft a support response
- update a Case field through a controlled action
- create a follow-up Task

Exit criteria:

- a Salesforce user can run the production pilot flow without the external NestJS backend
- the org prerequisites are confirmed
- Agentforce action creation and activation are understood

This phase is important because it proves what Salesforce can do natively and produces metadata that can move toward go-live after validation.

### Phase 1: External Bridge Spike

Goal: prove the connection from Salesforce to Railway.

Tasks:

- create the NestJS `ai-api` app under `apps/ai-api`
- deploy `/health/live` to Railway for liveness and protected `/health` for the Salesforce bridge
- configure Salesforce Named Credential / External Credential
- create Apex HTTP client
- call Railway from Salesforce
- add one Agentforce action that returns structured health/context data from NestJS

Exit criteria:

- Agentforce can invoke Apex
- Apex can call NestJS on Railway
- Railway can return a structured protected `/health` response to Agentforce
- Railway liveness uses `/health/live` without requiring Salesforce bridge credentials
- focused backend typecheck, unit, e2e, build, smoke, Apex test, and Agentforce eval evidence is captured

### Phase 2: Provider-Agnostic NestJS AI API

Tasks:

- add LLM provider interfaces
- add OpenAI provider first
- add OpenAI-compatible provider second
- add model router
- add provider fallback behavior
- add token and cost logging
- add `/chat/message`
- add `/agent/support/triage-case`
- add JWT auth
- add DTO validation
- add tests with mocked providers

Exit criteria:

- agent services call `ModelRouter`, not OpenAI directly
- OpenAI can be swapped by config
- at least one OpenAI-compatible endpoint path exists for future custom/self-hosted models

### Phase 3: Support Operations Agent With External AI

Tasks:

- connect Agentforce Support Operations action to NestJS
- send Case context to NestJS
- generate summary, category, priority, confidence, and next action
- return structured output to Agentforce
- add Apex tests with HTTP mocks
- add Agentforce eval prompts

Exit criteria:

- Agentforce can triage a Case using the external AI service

### Phase 4: Knowledge RAG

Tasks:

- choose vector DB
- add document ingestion
- add chunking
- add embeddings through `EmbeddingProvider`
- add vector search
- add answer with sources
- create Agentforce knowledge action
- test via Open WebUI and Agentforce

Exit criteria:

- user can ask a knowledge question and receive grounded answer with sources

### Phase 5: Open WebUI Production Internal Chat

Tasks:

- deploy Open WebUI on Railway
- connect Open WebUI to the NestJS OpenAI-compatible gateway
- secure access
- document production setup, retention, and access rules

Exit criteria:

- Open WebUI is usable as the production internal AI/RAG chat console

### Phase 6: React Customer Chat Window

Tasks:

- create a lightweight React/Vite chat window
- connect to NestJS `/chat/message`
- display sources
- add support escalation button
- deploy the standalone app to Railway by default and add a Salesforce-hosted embed path when needed

Exit criteria:

- customer-facing chat can run through NestJS with approved guardrails and Salesforce escalation, either standalone or inside a Salesforce-hosted page shell

Implementation rule:

- use React/Vite for the customer chat window
- keep the UI under `apps/react-chat-window` in this monorepo even when a Salesforce-hosted site or app page embeds it

### Phase 7: Production Cost Optimization And Model Flexibility

Tasks:

- add Anthropic/Azure/Gemini providers as needed
- add self-hosted OpenAI-compatible provider
- add model routing by use case
- add small-model routing for simple tasks
- add response caching for repeated RAG questions
- add token budgets per client/use case
- add fallback provider rules

Exit criteria:

- cost-sensitive clients can use cheaper models and self-hosted models
- enterprise clients can use their preferred provider
- provider changes do not require rewriting agent services

### Phase 8: Services Org Intelligence

Tasks:

- create custom PSA-like objects
- seed project/resource/timecard data
- create project health endpoint
- create Agentforce action
- add production pilot reports and screens

Exit criteria:

- agent can summarize project risk and delivery health

### Phase 9: Revenue Intelligence

Tasks:

- create account health endpoint
- create churn and upsell scoring service
- create Agentforce action
- add account summary prompt

Exit criteria:

- agent can summarize account risk and next best action

### Phase 10: Field Service

Tasks:

- check if Field Service is enabled
- if not, use custom fallback objects
- create technician matching endpoint
- create Agentforce action

Exit criteria:

- agent can recommend technician/appointment using available data model

## 19. Production Readiness Gates

This plan becomes production-ready only after these gates pass. The architecture is production-target from day one, but go-live requires evidence.

Required gates:

- Salesforce org licensing and Agentforce feature enablement confirmed
- Agentforce metadata deploys cleanly in target org
- Apex tests pass with HTTP callout mocks
- Agentforce evals pass for approved production prompts
- NestJS unit, integration, and e2e tests pass
- Open WebUI access is protected with auth/RBAC
- React chat window uses approved customer identity and session rules
- If customer chat is surfaced through Experience Cloud or another Salesforce-hosted shell, CSP, iframe or clickjack settings, CORS, and guest-user or session behavior are validated
- Salesforce-to-NestJS traffic is authenticated through Named Credential and backend verification
- Open WebUI-to-NestJS traffic is authenticated through gateway key/JWT
- React-to-NestJS traffic is authenticated and rate limited
- Pinecone indexes have namespace, tenant, and access-control strategy
- prompts, retrieved chunks, responses, and tool calls have safe logging rules
- raw PII and secrets are excluded from logs
- OpenAI data handling settings and client approvals are documented
- token budget, rate limits, and monthly cost alerts are configured
- observability dashboards and error alerts are configured
- fallback behavior is implemented for OpenAI, Pinecone, Salesforce, and Railway failures
- rollback plan exists for Salesforce metadata and Railway services
- production runbook exists for support, incident response, and deployment
- UAT signoff is complete
- security review is complete
- release approval is complete

Go-live rule:

```text
Pilot success does not automatically mean production go-live.
Pilot success moves the same architecture into UAT, hardening, security review, and release approval.
After those gates pass, the same implementation path goes live.
```

## 20. Security Requirements

Required from day one:

- no secrets committed
- `.env.example` only
- JWT between Salesforce and NestJS
- Salesforce Named Credential for callouts
- Apex classes use `with sharing`
- input DTO validation in NestJS
- response schema validation
- CORS restricted
- rate limiting
- request size limit
- if Salesforce hosts the customer chat shell, the browser receives only customer-safe tokens and never Salesforce session secrets, Named Credential secrets, or model keys
- no raw PII in logs
- provider token and cost tracking
- vector documents filtered by access rules where needed

For Open WebUI:

- enable authentication
- do not expose admin UI publicly without protection
- use separate Open WebUI gateway key
- restrict access to approved internal users
- avoid putting production Salesforce data into unsecured Open WebUI sessions

## 21. Testing Requirements

### Backend Tests

```text
npm run test
npm run test:e2e
npm run lint
npm run build
```

Test:

- OpenAI service with mocked responses
- RAG retrieval
- DTO validation
- auth guard
- support triage endpoint
- knowledge answer endpoint

### Salesforce Tests

Test:

- Apex invocable action
- HTTP callout mock
- empty input
- backend error response
- malformed response
- permission behavior

### Agentforce Tests

Test:

- expected topic selection
- expected action invocation
- multi-turn conversation
- answer quality
- safe fallback when backend fails

### Open WebUI Tests

Test:

- NestJS gateway connection
- auth enabled
- RAG answer quality
- access control behavior
- audit logging behavior

## 22. CI/CD

Recommended GitHub Actions:

```text
.github/workflows/backend-ci.yml
.github/workflows/frontend-ci.yml
.github/workflows/salesforce-validate.yml
.github/workflows/secret-scan.yml
```

Backend CI:

```text
pnpm install
pnpm lint
pnpm test
pnpm build
```

Salesforce validation:

```text
sf project deploy validate
sf apex run test
```

Do not auto-deploy Agentforce metadata to production. Production deploy requires validation, UAT approval, security approval, release approval, and a rollback plan.

## 23. Known Risks

Important risks:

- Agentforce licensing and feature enablement may block progress
- Field Service may not be available
- Knowledge may need org setup
- Agentforce metadata deployment can be fragile
- active agents may block redeploy
- OpenAI cost can grow quickly
- RAG answer quality depends on document quality
- vector DB access control must be designed carefully
- Open WebUI is not Salesforce permission-aware by default
- Railway persistence must be planned for Open WebUI/vector DB
- customer-facing chat auth is harder than internal chat
- Certinia-like custom objects are production pilot models until real Certinia mapping is implemented

## 24. What Is Achievable

Achievable in production after readiness gates pass:

- Agentforce action calling NestJS on Railway
- NestJS calling OpenAI through a provider abstraction
- LangChain RAG with Pinecone
- Open WebUI production internal chat console
- Support Operations Agent
- Knowledge RAG Agent
- basic Services Org Intelligence Agent
- React customer chat window, including a Salesforce-hosted Experience Cloud or app-page embed

Not safe to claim before gates pass:

- production-ready enterprise architecture
- full Certinia replacement
- full Data Cloud replacement
- full Experience Cloud replacement
- fully free implementation
- Field Service support without confirming licenses
- customer-grade secure public chat without extra identity work

## 25. Recommended First Implementation Checklist

Start here:

```text
1. Keep Salesforce metadata scoped under `force-app/`.
2. Keep Agentforce evals and testing notes scoped under `agent-eval/` and `docs/testing/`.
3. Create an Agentforce-only Support Operations production pilot.
4. Create one Apex invocable action for Case summary/next action.
5. Add sample Case data and permission set.
6. Create NestJS `ai-api` app under `apps/ai-api`.
7. Add app-scoped package scripts and tests.
8. Add `/health` endpoint.
9. Deploy NestJS to Railway.
10. Configure Salesforce Named Credential.
11. Create Apex callout client.
12. Confirm Agentforce -> Apex -> Railway works.
13. Add LLM provider interfaces and ModelRouter.
14. Add OpenAI as the production v1 provider.
15. Add OpenAI-compatible provider path for future custom/self-hosted models.
16. Confirm Agentforce -> Apex -> Railway NestJS -> provider layer -> structured response works.
17. Add LangChain RAG.
18. Add Pinecone vector DB.
19. Add Open WebUI production internal chat.
20. Add React customer chat window under `apps/react-chat-window` and, if needed, a Salesforce-hosted embed wrapper.
21. Add eval and test scripts.
22. Pass production readiness gates.
```

Do not build all agents until step 11 works.

## 26. Final Recommended Positioning

Use this project description:

> This project is a hybrid Salesforce Agentforce reference implementation using NestJS on Railway, a provider-agnostic LLM layer with OpenAI as the production v1 provider, LangChain, Pinecone vector search, Open WebUI internal chat, and a React customer chat window that can run standalone or inside a Salesforce-hosted page shell. It demonstrates how Salesforce agents can securely call external AI services for support triage, grounded knowledge answers, revenue insights, and services intelligence.

Avoid saying:

- it replaces Agentforce
- it replaces Certinia
- it replaces Salesforce Data Cloud
- it is fully free in production
- it is live before readiness gates pass

Say instead:

- it is a production-target hybrid implementation
- it starts with a controlled production pilot
- it is Salesforce-compatible through actions and callouts
- it is extensible
- it goes live after UAT, security review, release approval, and production readiness gates

## 27. Bottom Line

Yes, use Open WebUI.

Use it as the production internal AI chat interface. Keep Agentforce as the Salesforce agent layer. Keep NestJS as the AI orchestration backend. Use OpenAI as the production v1 provider behind an extensible LLM provider layer. Use LangChain and Pinecone for RAG. Deploy the backend and Open WebUI on Railway, and deploy the React chat window either as a standalone Railway app or as a monorepo app embedded in a Salesforce-hosted page shell. Keep NestJS and UI work inside scoped monorepo app folders, with separate validation and release gates from Salesforce metadata. Add Salesforce metadata, tests, scripts, and documentation using standards inspired by `agent-script-recipes` and `my-org-butler`.

The first real milestone is not all six agents. The first milestone is proving this path:

```text
Agentforce -> Apex -> Named Credential -> Railway NestJS -> LLM Provider Layer -> structured response back to Agentforce
```

Once that works, the rest of the plan becomes realistic.

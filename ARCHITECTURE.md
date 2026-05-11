# Agentforce Hybrid AI Architecture

## Status

This document is the implementation baseline for the NestJS, Railway, OpenAI, LangChain, Pinecone, Open WebUI, React chat, and Salesforce Agentforce production path.

## System Shape

```text
Salesforce user
  -> Agentforce agent
  -> Agentforce topic/action
  -> Apex invocable action
  -> Named Credential / External Credential
  -> Railway NestJS AI API
  -> ModelRouter
  -> OpenAI provider, LangChain RAG, Pinecone
  -> structured response back to Agentforce
```

Internal chat follows the same backend path:

```text
Open WebUI
  -> NestJS OpenAI-compatible gateway
  -> ModelRouter
  -> OpenAI, LangChain, Pinecone, tools, telemetry
```

Customer chat follows a customer-safe backend route, whether it is surfaced on a standalone site or embedded in a Salesforce-hosted page shell such as Experience Cloud:

```text
Salesforce-hosted page shell or external site
  -> React chat window
  -> NestJS /chat/message
  -> customer-safe policy, RAG, model routing, escalation rules
  -> approved Salesforce actions only
```

## Repository Model

This repo is the canonical monorepo for Salesforce Agentforce metadata and the external AI platform:

```text
force-app/main/default/
  classes/
  genAiFunctions/
  genAiPlannerBundles/
  genAiPromptTemplates/
  flows/
  namedCredentials/
  externalCredentials/
  permissionsets/
agent-eval/
docs/
scripts/
apps/
  ai-api/
  react-chat-window/
  openwebui/
packages/
  shared-contracts/
  llm-core/
  rag-core/
```

Salesforce can host the page shell or embed the customer chat, but the React codebase, backend integration, and release lifecycle stay in the `apps/react-chat-window` monorepo package. Salesforce metadata, NestJS API code, Open WebUI deployment assets, and React chat code have separate ownership boundaries and readiness gates even though they now live in one repository.

## First Production Slice

The first customer-facing milestone is deliberately narrow:

1. Customer Self-Service Agent runs inside Salesforce Agentforce first.
2. Agentforce verifies the customer before sensitive reads.
3. Apex and Flow perform deterministic Salesforce reads and writes against Account, Contact, Case, Knowledge, and only confirmed scheduling/status data.
4. The first write path creates or escalates a Case with a safe human handoff summary.
5. The Agentforce -> Apex -> Named Credential -> Railway bridge is added after the native customer workflow and evals are proven.
6. RAG, Open WebUI, React customer chat, ModelRouter, and Pinecone remain later hybrid stages under the monorepo platform paths.

Do not build every hybrid target-state component before the Customer Self-Service workflow, data access rules, and escalation behavior are proven.

## Production Contracts

- Salesforce-to-NestJS requests must be authenticated and versioned.
- API responses must be structured and schema-validated before Agentforce sees them.
- Provider selection must be hidden behind `ModelRouter`.
- RAG answers must include source metadata where available.
- Open WebUI uses `/v1/chat/completions`; customer chat uses a separate customer-safe API.
- If customer chat is embedded in Experience Cloud or another Salesforce-hosted page, the browser still authenticates to NestJS with customer-safe tokens and never with backend secrets.
- Telemetry must include provider, model, latency, token usage, retrieval IDs, tool calls, and safety outcomes without logging raw PII or secrets.

## Readiness Gates

- Agentforce metadata deploys cleanly in the target org.
- Apex tests pass with HTTP mocks.
- Agentforce evals pass for approved production prompts.
- NestJS lint, unit, integration, and e2e tests pass.
- Railway services have secure env vars and rollback notes.
- If Salesforce hosts the customer chat shell, CSP, iframe or clickjack settings, CORS, and guest-user or session behavior are validated.
- Open WebUI auth/RBAC and retention are configured.
- Pinecone namespace and access-control strategy is documented.
- UAT, security review, release approval, and rollback plan are complete.

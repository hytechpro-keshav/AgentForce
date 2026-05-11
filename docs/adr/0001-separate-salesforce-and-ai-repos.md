# ADR 0001: Canonical Salesforce And AI Platform Monorepo

## Status

Superseded previous split-repo decision on 2026-05-08. Accepted current decision: one canonical monorepo.

## Context

The project combines Salesforce Agentforce metadata, Apex, Named Credentials, NestJS, OpenAI, LangChain, Pinecone, Open WebUI, Railway, and React chat. These surfaces have different lifecycles, dependencies, secrets, deployment targets, test suites, and rollback paths. That remains true even if Salesforce hosts the customer chat page shell or embeds the React app inside Experience Cloud.

The earlier decision kept Salesforce and the external AI platform in separate repositories. The project is now moving to a single repository so AI sessions, CodeTrellis context, shared contracts, CI checks, and release review can reason over the full architecture together.

## Decision

Use this repository as the canonical monorepo for both Salesforce Agentforce work and the external AI platform.

Salesforce may host the customer chat page shell or embed wrapper, but that does not move the React runtime responsibilities into Salesforce metadata. The React application, dependency graph, tests, and release lifecycle live under the monorepo platform paths.

Monorepo ownership paths:

- `force-app/main/default/`: Agentforce metadata, Apex and Flow callout actions, Salesforce permissions, credentials metadata, and deployable Salesforce assets.
- `agent-eval/`: Agentforce evals and Salesforce conversation specs.
- `apps/ai-api/`: NestJS AI API, Salesforce-facing endpoints, provider routing, RAG orchestration, API auth, and observability.
- `apps/openwebui/`: Open WebUI Railway/Docker deployment assets and internal chat runbooks.
- `apps/react-chat-window/`: Customer-facing React chat window and Salesforce-hosted embed build assets when required.
- `packages/*`: shared contracts, provider interfaces, RAG utilities, telemetry helpers, and cross-app code when reuse is justified.
- `docs/`: architecture, ADRs, runbooks, testing notes, and release readiness documentation across all layers.

Architecture ownership remains unchanged: Salesforce remains the system of record, Agentforce owns Salesforce-native conversation flow, Apex/Flow own deterministic Salesforce-side context and callouts, NestJS owns provider routing and RAG, Open WebUI is internal chat, and React chat is customer-facing.

## Consequences

- Salesforce, backend, Open WebUI, and frontend dependencies live in separate folders and should use scoped CI jobs rather than one undifferentiated build.
- Release gates can still validate Salesforce metadata, Railway services, Open WebUI, and React chat independently.
- A Salesforce-hosted chat surface can be supported without turning Salesforce into the Node/Vite runtime or exposing backend secrets.
- Shared contracts can now be versioned in `packages/shared-contracts` and tested from both Salesforce bridge docs and NestJS code.
- CodeTrellis and AI coding sessions can build context from the full system without assuming an external platform repository exists.

# ADR 0001: Separate Salesforce And External AI Repositories

## Status

Accepted.

## Context

The project combines Salesforce Agentforce metadata, Apex, Named Credentials, NestJS, OpenAI, LangChain, Pinecone, Open WebUI, Railway, and React chat. These surfaces have different lifecycles, dependencies, secrets, deployment targets, test suites, and rollback paths. That remains true even if Salesforce hosts the customer chat page shell or embeds the React app inside Experience Cloud.

## Decision

Keep Salesforce Agentforce work in this repo. Keep the external AI platform in a separate repo unless explicitly requested otherwise.

Salesforce may host the customer chat page shell or embed wrapper, but that does not move the React application, its dependency graph, or its release lifecycle into the Salesforce repo.

Salesforce repo owns:

- Agentforce metadata
- Apex and Flow callout actions
- Salesforce permissions and credentials metadata
- Salesforce sample data and evals
- Salesforce deployment and release docs

External platform repo owns:

- NestJS AI API
- LLM provider abstraction
- LangChain and RAG logic
- Pinecone integration
- Open WebUI deployment config
- React customer chat
- Railway service config

## Consequences

- Salesforce metadata remains stable and reviewable.
- Backend and frontend dependencies do not pollute the Salesforce repo.
- Release gates can validate Salesforce and Railway changes independently.
- A Salesforce-hosted chat surface can be supported without collapsing the repository boundary.
- Shared contracts must be documented carefully to avoid version skew.

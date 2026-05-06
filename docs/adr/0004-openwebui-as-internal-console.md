# ADR 0004: Open WebUI As Internal AI Console

## Status

Accepted.

## Context

Internal employees and admins need a production chat surface for AI/RAG workflows, but Salesforce Agentforce remains the Salesforce-native agent experience and React chat remains customer-facing.

## Decision

Use Open WebUI as the production internal chat interface. It connects only to the NestJS OpenAI-compatible gateway.

```text
Open WebUI -> NestJS /v1/chat/completions -> ModelRouter -> OpenAI/LangChain/Pinecone
```

Open WebUI must not call OpenAI directly and must not store production Salesforce secrets.

## Consequences

- Internal chat shares auth, RAG, model routing, logging, and cost controls with Agentforce integrations.
- Open WebUI access needs auth/RBAC and documented retention.
- Open WebUI is not a replacement for Salesforce permissions, customer chat, or Agentforce.

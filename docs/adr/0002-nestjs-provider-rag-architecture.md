# ADR 0002: NestJS Owns Provider Routing And RAG

## Status

Accepted.

## Context

Agentforce and Apex are good at Salesforce-native workflows, permissions, and deterministic actions. They are not the right layer for provider routing, RAG orchestration, embeddings, vector DB operations, token accounting, or Open WebUI compatibility.

## Decision

NestJS owns the external AI orchestration layer.

Core rules:

- Agent and chat services call `ModelRouter`.
- Provider SDK calls live only in provider adapters.
- RAG uses `EmbeddingProvider` and vector DB interfaces.
- Pinecone is production v1 vector DB.
- OpenAI is production v1 LLM provider.
- Anthropic, Azure OpenAI, Gemini, and OpenAI-compatible providers remain supported extension paths.

## Consequences

- Provider switching can happen through configuration.
- Apex and Agentforce contracts stay simpler.
- Open WebUI and Salesforce can share backend policy, logging, RAG, and cost controls.
- Backend tests must cover provider normalization, fallback, and routing behavior.

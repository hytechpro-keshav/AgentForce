# Project Agent Guidelines

## Current Purpose

This workspace is the canonical monorepo for a production-target hybrid AI architecture. Salesforce remains the system of record and Agentforce remains the Salesforce-native agent runtime. External AI orchestration belongs behind the NestJS AI API on Railway, with OpenAI as the production v1 provider, LangChain and Pinecone for RAG, Open WebUI for internal chat, and a React chat window for customer chat. Those platform services now live in this monorepo alongside Salesforce metadata, while their runtime ownership, security controls, and release gates remain separate from Salesforce metadata promotion.

## Repository Boundaries

- Keep Salesforce metadata, Apex, Agentforce actions, prompt templates, evals, Salesforce docs, NestJS AI API code, Open WebUI deployment assets, Railway config, React chat code, and shared platform packages in this repo.
- Use monorepo paths for the external AI platform: `apps/ai-api`, `apps/react-chat-window`, `apps/openwebui`, and `packages/*` for shared contracts, provider abstractions, RAG utilities, and cross-app helpers when needed.
- Keep Salesforce metadata and external AI platform services in distinct folders with distinct validation commands, dependencies, secrets, deployment targets, and release approvals.
- Promote stable Salesforce metadata only after pilot validation, UAT, security review, and release approval.
- Do not commit secrets, org-specific credentials, private keys, production-only metadata, `.env`, or raw prompt/session data.

## Architecture Rules

- Agentforce owns Salesforce conversation flow, topic selection, action invocation, and user-facing Salesforce context.
- Apex and Flow own deterministic Salesforce-side context gathering, input validation, Named Credential callouts, and response mapping.
- NestJS owns model routing, provider adapters, LangChain chains, RAG retrieval, vector DB integration, token and cost logging, API auth, and observability.
- Open WebUI must call the NestJS OpenAI-compatible gateway. It must not call OpenAI directly.
- Customer chat may be surfaced in an external site or a Salesforce-hosted page shell, but it must call the NestJS chat API and use customer-safe policy, rate limiting, identity/session rules, and approved Salesforce actions.

## Salesforce Rules

- Use Named Credentials and External Credentials for callouts.
- Apex classes used by Agentforce must be bulk-safe, testable, and use HTTP mocks for callout tests.
- Keep complex prompt orchestration, RAG, embeddings, provider selection, and LLM SDK calls out of Apex.
- Every production Agentforce action should have a genAiFunction metadata file, input schema, output schema, Apex or Flow implementation, tests, README/runbook notes, and eval coverage.
- Be careful with Agentforce metadata deployment: active agents can block deploys, planner bundles can cache stale topic/action bindings, prompt template version identifiers are fragile, and schema-only edits may not deploy without the sibling metadata in the payload.

## External AI Platform Rules

- Agent and chat services call `ModelRouter`; they never import vendor SDKs directly.
- Add model vendors through `LlmProvider` and `EmbeddingProvider` interfaces.
- OpenAI is the production v1 provider, but Anthropic, Azure OpenAI, Gemini, and OpenAI-compatible self-hosted providers must remain configuration paths.
- OpenAI-compatible gateway routes must support `/v1/models` and `/v1/chat/completions` for Open WebUI-style clients.
- Runtime provider switching belongs in configuration, not service rewrites.

## Security And Observability

- Require authenticated traffic between Salesforce and NestJS, Open WebUI and NestJS, and React chat and NestJS.
- Restrict CORS, validate DTOs, limit request size, rate-limit public and internal chat endpoints, and return structured errors.
- If Salesforce hosts the customer chat shell, use customer-safe browser tokens and validate CSP, iframe or clickjack settings, CORS, and guest-user or session behavior.
- Do not log raw PII, secrets, full customer prompts, API keys, private keys, or sensitive retrieved chunks.
- Track token usage, latency, provider, model, tool calls, retrieval IDs, safety outcomes, and cost references.
- Follow OpenTelemetry `gen_ai.*` conventions where practical, with telemetry implemented as no-op safe and never workflow-breaking.

## Testing Rules

- Run focused tests for the touched layer before handing work back.
- Salesforce changes need Apex tests and, for Agentforce behavior, eval prompts or Testing Center coverage.
- Backend changes need unit tests, DTO validation tests, mocked provider tests, auth guard tests, and e2e tests for public contracts.
- RAG changes need source-grounding checks, retrieval quality checks, and tenant/access-control checks.
- UI changes need responsive checks and user-facing workflow verification.

## Reference Patterns To Reuse

- From `trailheadapps/agent-script-recipes`: recipe-style docs, Mermaid flows, prerequisites, expected conversations, action schemas, and production-pattern checklists.
- From `aquivalabs/my-org-butler`: Agentforce metadata structure, agent eval strategy, scratch org setup scripts, sample data, deployment fixups, and multi-turn REST tests.
- From `getsentry/warden`: scoped agents/skills, strict configuration schemas, YAML evals with `given` / `should_find` / `should_not_find`, LLM judge separation, and AI telemetry discipline.
- From `getsentry/sentry`: package ownership, clear module boundaries, CODEOWNERS-style thinking, extensive fixtures, and tests that encode edge cases and corrupt-state behavior.

## CodeTrellis Context

- CodeTrellis is configured in `.vscode/mcp.json`; use its MCP tools or CLI commands (`codetrellis context`, `codetrellis skills`, `codetrellis scan`) to gather repository context for AI sessions.
- Keep `.codetrellis/cache/AgentForce/matrix.prompt` refreshed after structural changes so future sessions see the monorepo layout.
- Do not duplicate architecture rules into Copilot, Claude, or Cursor wrapper files. Those wrappers should point back to this `AGENTS.md` and the CodeTrellis matrix.

## Build And Test Commands

- JavaScript/LWC lint: `npm run lint`
- LWC tests: `npm run test:unit`
- NestJS ai-api tests: `npm run ai-api:test`
- NestJS ai-api build: `npm run ai-api:build`
- Formatting check: `npm run prettier:verify`
- Apex tests: `sf apex run test --test-level RunLocalTests --wait 30 --result-format human`
- Salesforce deploy validation should use targeted `sf project deploy validate` or `sf project deploy start --dry-run` commands for changed metadata, not a broad production deploy.

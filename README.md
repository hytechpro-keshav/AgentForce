# AgentForce Salesforce Workspace

This repo contains the Salesforce Agentforce side of a production-target hybrid AI architecture. Salesforce remains the system of record and Agentforce remains the Salesforce-native agent experience. External AI orchestration is planned for a separate NestJS platform on Railway with OpenAI, LangChain, Pinecone, Open WebUI, and a React customer chat window.

Start with [ARCHITECTURE.md](ARCHITECTURE.md) and [AGENTS.md](AGENTS.md) before implementing new capabilities.

## Current Scope

- Salesforce DX project with Agentforce planner bundles, prompt templates, Apex classes, and LWC tooling.
- Existing Agentforce metadata under `force-app/main/default/genAiPlannerBundles`, `genAiFunctions`, and `genAiPromptTemplates`.
- Architecture configuration for future Agentforce, NestJS, RAG, Open WebUI, telemetry, and release work.

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

## Local Checks

```bash
npm run lint
npm run test:unit
npm run prettier:verify
sf apex run test --test-level RunLocalTests --wait 30 --result-format human
```

Run the checks that match the files you changed. Org-dependent Agentforce evals should be run after metadata is deployed to an enabled org.

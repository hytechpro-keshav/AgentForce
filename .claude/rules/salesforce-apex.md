---
paths:
  - "force-app/main/default/genAiFunctions/**"
  - "force-app/main/default/genAiPlannerBundles/**"
  - "force-app/main/default/genAiPromptTemplates/**"
  - "force-app/main/default/genAiPlugins/**"
  - "force-app/main/default/flows/**"
  - "force-app/main/default/classes/**"
  - "force-app/main/default/triggers/**"
  - "force-app/main/default/namedCredentials/**"
  - "force-app/main/default/externalCredentials/**"
  - "agent-eval/**"
---

Read and follow `.github/instructions/salesforce-agentforce.instructions.md` before editing these files.

For reviews, adopt the persona from `.github/agents/agentforce-reviewer.agent.md`.
For new actions, start from `.github/prompts/create-agentforce-action.prompt.md`.

Key constraints:
- Apex classes must be bulk-safe, testable, use HTTP mocks for callout tests
- Use Named Credentials and External Credentials for all callouts — never hardcode endpoints or tokens
- Keep RAG, embeddings, and LLM SDK calls out of Apex
- Every Agentforce action needs: genAiFunction metadata, input/output schema, Apex/Flow impl, tests, eval coverage
- Validate deploys with `sf project deploy validate` before `sf project deploy start`

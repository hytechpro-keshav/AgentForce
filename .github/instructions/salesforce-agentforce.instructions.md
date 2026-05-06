---
description: "Use when editing Salesforce Agentforce metadata, genAiFunctions, genAiPlugins, genAiPlannerBundles, genAiPromptTemplates, flows, permission sets, Named Credentials, External Credentials, or Agentforce evals."
applyTo:
  - "force-app/main/default/genAiFunctions/**"
  - "force-app/main/default/genAiPlannerBundles/**"
  - "force-app/main/default/genAiPromptTemplates/**"
  - "force-app/main/default/genAiPlugins/**"
  - "force-app/main/default/flows/**"
  - "force-app/main/default/permissionsets/**"
  - "force-app/main/default/namedCredentials/**"
  - "force-app/main/default/externalCredentials/**"
  - "agent-eval/**"
---

# Salesforce Agentforce Instructions

- Treat Agentforce as the Salesforce-native agent runtime, not the place for complex RAG or provider orchestration.
- Follow recipe-style documentation: overview, agent flow, key concepts, setup, expected prompts/responses, and testing notes.
- Each production action should have a genAiFunction metadata file, `input/schema.json`, `output/schema.json`, implementation, tests, and eval coverage.
- New `genAiFunction` schemas should copy local sibling conventions for `lightning:type`, `lightning:isPII`, `copilotAction:isUserInput`, `copilotAction:isDisplayable`, and `copilotAction:isUsedByPlanner`.
- Use planner-visible descriptions carefully. Agentforce reads them at runtime, so do not bury warnings or implementation notes in user-facing descriptions.
- Prefer narrow topics and explicit action descriptions over one broad topic with many ambiguous actions.
- For external AI calls, Apex should call a Named Credential route on NestJS and return structured output. Apex should not call OpenAI, Pinecone, LangChain, or vendor SDKs directly.
- Keep org-specific IDs, generated-only values, secrets, and production-only metadata out of version control unless they are required deployable metadata.
- When changing Agentforce metadata, update eval prompts or testing notes with the intended behavior.

## Deployment Gotchas

- Active agents can block redeployment. Deactivate only when deployment fails for that reason, then reactivate and test.
- Planner bundle caching can make topic/action changes look stale. Reactivation often refreshes the binding.
- Prompt template `activeVersionIdentifier` and inner `versionIdentifier` can be fragile. Preserve current values unless intentionally creating a new version.
- Schema-only changes may not deploy as expected unless the sibling genAiFunction metadata is included in the payload.

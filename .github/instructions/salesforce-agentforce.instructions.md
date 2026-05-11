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
- Temporary phase-validation topics or planner-local actions that exist only to prove an integration bridge should be documented as temporary and removed from customer-facing planner bundles once the permanent production flow replaces them. Keep the underlying Apex action, tests, and runbooks only if they still serve operational validation.

## Deployment Gotchas

- Active agents block `GenAiPlannerBundle` redeployment. For an existing active agent, use the supported lifecycle commands: `sf agent deactivate --api-name <AgentApiName> --target-org <org>`, deploy the planner bundle, then `sf agent activate --api-name <AgentApiName> --target-org <org>`.
- After reactivation, validate the published runtime with `sf agent preview start --api-name <AgentApiName>`, `sf agent preview send --session-id <id> --utterance "..." --api-name <AgentApiName>`, and `sf agent preview end --session-id <id> --api-name <AgentApiName>`.
- Planner bundle caching can make topic/action changes look stale. Reactivation often refreshes the binding.
- Prompt template `activeVersionIdentifier` and inner `versionIdentifier` can be fragile. Preserve current values unless intentionally creating a new version.
- Schema-only changes may not deploy as expected unless the sibling genAiFunction metadata is included in the payload.

## Verification Flow Notes

- When using the built-in `Service Customer Verification` pattern, include OTP testing notes and customer-facing guidance in the recipe or runbook.
- Tell users to check spam or junk, wait about 1 to 2 minutes, resend only when needed, and use only the newest OTP because resends invalidate earlier codes.
- If a Salesforce `User` and `Contact` share the same email, the verification flow can resolve the `User` first. For customer self-service testing, prefer a `Contact` email that does not collide with any `User` login or email unless login-user verification is intentional.
- Developer Edition orgs can hit the external single-email daily quota. If OTP is generated but no email arrives, query `/services/data/vXX.X/limits` and inspect `SingleEmail`; a value like `Max: 15` and `Remaining: -1` means external OTP emails are blocked until the GMT reset.
- To confirm whether Agentforce truly invoked the verification flow, trace both the connected admin and the Einstein Agent runtime user. The runtime user may have a username like `customer_self_service_agent@...ext` and profile `Einstein Agent User`.
- Debug-log OTP recovery is acceptable for internal testing only. It is not a production support pattern.

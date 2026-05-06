---
description: "Create or update a Salesforce Agentforce action with Apex, genAiFunction schemas, tests, docs, and eval notes."
agent: "Agentforce Reviewer"
argument-hint: "Action name, target object, inputs, outputs, and expected behavior"
tools: [read, search, edit]
---

Create or update an Agentforce action for the requested capability.

Before editing, inspect sibling Agentforce metadata and Apex patterns. Then produce the smallest safe change set:

- Apex or Flow implementation with clear request/response wrappers
- `genAiFunction` metadata plus `input/schema.json` and `output/schema.json`
- Apex tests with mocks when callouts are involved
- README or runbook notes for setup and expected prompts
- Eval notes or test prompts that cover topic selection, action invocation, happy path, and safe fallback

Keep LLM, RAG, provider, and vector logic outside Apex. Use Named Credentials for backend calls.

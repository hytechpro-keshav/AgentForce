---
description: "Use when adding tests, Agentforce evals, YAML conversation specs, CI workflows, e2e tests, fixtures, or release validation scripts."
applyTo:
  - "agent-eval/**"
  - "scripts/**"
  - "**/*.test.*"
  - "**/*Test.cls"
  - ".github/workflows/**"
  - "docs/testing/**"
---

# Testing And Eval Instructions

- Use tests to preserve contracts, not only happy paths.
- Salesforce changes need Apex tests. Agentforce behavior changes need eval prompts or Testing Center cases.
- Prefer two Agentforce eval layers: Testing Center for topic/action assertions, and REST multi-turn YAML specs for real session behavior.
- YAML eval specs should read like behavior expectations: `given`, `turns`, `say`, `expect`, and optional `should_not` or risk notes.
- Backend provider tests should mock vendor APIs and assert normalized contracts, not provider SDK internals.
- RAG evals should check source grounding, missing-source fallback, tenant filtering, and hallucination-prone questions.
- CI should run the smallest reliable checks on PR and reserve org-dependent/deep LLM evals for manual or gated workflows.
- When an eval fails because the environment is inactive or stale, surface the operational issue separately from behavior quality.
- When a temporary phase-validation topic is retired from a customer-facing agent, retire or rename the related user-facing evals and keep any remaining smoke-proof artifacts in clearly labeled ops-only docs.

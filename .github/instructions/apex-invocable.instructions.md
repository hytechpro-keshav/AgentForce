---
description: "Use when writing or reviewing Apex classes for Agentforce invocable actions, HTTP callouts, Salesforce context collection, or callout mocks."
applyTo:
  - "force-app/main/default/classes/**/*.cls"
  - "force-app/main/default/classes/**/*.cls-meta.xml"
---

# Apex Invocable Instructions

- Use `with sharing` unless there is a documented, reviewed reason not to.
- Keep Agentforce-facing invocable methods bulk-safe: accept a list, process all inputs, and return one output per input.
- Use request and response wrapper classes with clear `@InvocableVariable` labels and descriptions.
- Apex should collect Salesforce context, validate required inputs, call a Named Credential endpoint, and map the response. Do not put prompt orchestration, embeddings, vector search, or provider logic in Apex.
- For callouts, use `callout:Named_Credential_Name/path` and tests with `HttpCalloutMock`.
- Return structured fallback responses for backend errors, malformed responses, empty inputs, and authorization failures.
- Do not log raw PII, secrets, prompt text containing sensitive customer data, access tokens, or API keys.
- Tests should cover empty input, happy path, backend non-200, malformed JSON, timeout-style failure, and permission-sensitive behavior where applicable.
- Avoid stale citation comments and generated-note comments in production Apex. Keep comments only when they clarify non-obvious limits or Agentforce behavior.

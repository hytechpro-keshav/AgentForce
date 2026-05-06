---
description: "Use when designing AI telemetry, token/cost tracking, Sentry-style observability, OpenTelemetry gen_ai spans, workflow metrics, or model usage logs."
applyTo:
  - "apps/ai-api/src/**"
  - "packages/**"
  - "docs/**"
---

# Telemetry Instructions

- Follow OpenTelemetry `gen_ai.*` naming where practical: operation, provider, model, input tokens, output tokens, total tokens, request max tokens, latency, and response ID.
- Use a span hierarchy that separates workflow, agent invocation, provider chat call, tool execution, retrieval, and response formatting.
- Telemetry must be no-op safe when disabled and must never break a user workflow.
- Emit business metrics separately from traces: requests, failures, fallbacks, token totals, cost references, retrieval counts, cache hits, and escalation outcomes.
- Store safe references rather than raw prompts or retrieved sensitive text.
- Tests should prove telemetry helpers swallow telemetry failures, preserve workflow results, and set required attributes when enabled.

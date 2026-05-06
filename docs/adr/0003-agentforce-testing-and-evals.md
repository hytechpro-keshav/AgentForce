# ADR 0003: Agentforce Requires Evals Beyond Apex Tests

## Status

Accepted.

## Context

Apex tests prove deterministic implementation behavior, but they do not prove that Agentforce selects the correct topic, invokes the correct action, handles multi-turn context, or produces acceptable responses.

## Decision

Use layered Agentforce testing:

- Apex tests for implementation logic and callout mocks.
- Testing Center evals for topic and action assertions.
- REST multi-turn YAML specs for real in-org session behavior.
- LLM or human judging for response quality, with transcripts preserved as artifacts when safe.

## Consequences

- Agent behavior changes must update eval coverage.
- Single-turn and multi-turn cases are tracked separately.
- CI can run deterministic tests by default and reserve org/LLM-dependent evals for gated workflows.
- Release readiness includes eval evidence, not just deployment success.

# Agentforce Eval Strategy

## Purpose

Agentforce behavior needs more than Apex tests. This repo should use deterministic tests for implementation and evals for agent behavior.

## Layers

### Apex Tests

Use Apex tests for:

- Invocable request and response mapping
- Empty input handling
- HTTP callout mocks
- Backend non-200 responses
- Malformed backend responses
- Permission-sensitive behavior

Command:

```bash
sf apex run test --test-level RunLocalTests --wait 30 --result-format human
```

### Testing Center

Use Salesforce Testing Center for:

- Topic selection assertions
- Action invocation assertions
- Single-turn expected behavior

Keep related cases consolidated when practical to avoid org-side concurrent test limits.

### REST Multi-Turn Specs

Use YAML specs for real in-org sessions where conversation state matters.

Recommended shape:

```yaml
agent: Support_Operations_Agent

tests:
  - name: CaseTriageHappyPath
    description: "Triage a support case and recommend the next action."
    turns:
      - turn: "Ask for triage"
        say: "Triage this case and recommend next action."
        expect: "Returns summary, category, priority, confidence, and a next action."
```

The runner should call:

```text
/services/data/vXX.X/actions/custom/generateAiAgentResponse/<AgentApiName>
```

and pass the returned `sessionId` into the next turn.

## Release Rule

Do not treat a successful metadata deploy as agent readiness. Agent changes are ready only when implementation tests and relevant eval layers have passed or the remaining gaps are explicitly documented.

## Current UAT Package

Use [Customer Self-Service Phase 0 UAT](customer-self-service-phase0-uat.md) as the manual UAT runbook for Customer Self-Service Phase 0.

- Track A covers the currently active temporary no-OTP testing mode.
- Track B covers the verification-first OTP regression that must be rerun after the external email quota resets and OTP metadata is restored.

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

- Track A covers the historical temporary no-OTP testing mode used while the Developer Edition email quota was exhausted.
- Track B covers the current verification-first OTP regression after metadata was restored on 8 May 2026.

## Current Phase 1 Package

Use `agent-eval/support-operations-phase1-health.yaml` for `Agentforce_Service_Agent` health-bridge eval coverage.

Use [Phase 1 Health Bridge Smoke](phase1-health-bridge-smoke.md) to capture backend, Apex, and Agentforce smoke evidence.

Use [Phase 1 Agentforce Runtime Proof](phase1-agentforce-runtime-proof.md) for the published-agent preview and Apex runtime log evidence.

Auth failures from `Check_AI_API_Health` are operational setup failures. Treat them separately from model behavior quality and do not add OpenAI, RAG, Pinecone, Open WebUI, or React chat secrets while validating Phase 1.

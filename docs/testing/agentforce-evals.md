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

Use `agent-eval/customer-self-service-phase1-health.yaml` for `Customer_Self_Service_Agent` health-bridge eval coverage.

Use [Phase 1 Health Bridge Smoke](phase1-health-bridge-smoke.md) to capture backend, Apex, and Agentforce smoke evidence.

Use [Phase 1 Agentforce Runtime Proof](phase1-agentforce-runtime-proof.md) for the published-agent preview and Apex runtime log evidence.

This Phase 1 eval package is for a temporary published operational topic. Once later phases replace the customer-facing need for `AI_API_Health_Bridge`, remove that topic from the planner bundle, retire the user-facing health-bridge eval from the production agent, and keep any remaining health verification in ops-only smoke or internal-agent coverage.

Auth failures from `Check_AI_API_Health` are operational setup failures. Treat them separately from model behavior quality and do not add OpenAI, RAG, Pinecone, Open WebUI, or React chat secrets while validating Phase 1.

## Current Phase 2 Package

Use `agent-eval/customer-self-service-phase2-triage.yaml` for `Customer_Self_Service_Agent` temporary Phase 2 support-triage eval coverage.

Use [Customer Self-Service Phase 2 Support Triage UAT](customer-self-service-phase2-triage-uat.md) as the manual prompt-and-log runbook for the published agent path.

Use [Phase 2 Agentforce Support Triage Proof](phase2-agentforce-support-triage-proof.md) for deployment IDs, preview evidence, Apex runtime logs, Railway HTTP logs, masking proof, and telemetry proof.

This Phase 2 package is for a temporary published triage-only topic. Keep the eval and UAT evidence while `AI_API_Support_Triage` remains in the customer-facing planner bundle, then retire or rename the user-facing coverage when a permanent production triage flow replaces it.

## Current Phase 3 Package

Use `agent-eval/customer-self-service-phase3-case-analysis.yaml` for `Customer_Self_Service_Agent` temporary Phase 3 case-analysis eval coverage.

Use [Customer Self-Service Phase 3 Case Analysis UAT](customer-self-service-phase3-case-analysis-uat.md) and [Phase 3 Agentforce Case Analysis Proof](phase3-agentforce-case-analysis-proof.md) for deployment IDs, preview evidence, Apex runtime logs, Railway HTTP logs, masking proof, and telemetry proof.

## Current Phase 4 Package

Use `agent-eval/customer-self-service-phase4-knowledge-rag.yaml` for `Customer_Self_Service_Agent` temporary Phase 4 external Knowledge RAG eval coverage.

Use [Customer Self-Service Phase 4 Knowledge RAG UAT](customer-self-service-phase4-knowledge-rag-uat.md) and [Phase 4 Knowledge RAG Proof](phase4-knowledge-rag-proof.md) for sample corpus ingestion, direct API answer/search evidence, Agentforce preview evidence, tenant/access filtering, stale/deleted source exclusion, masking proof, and RAG telemetry proof.

This Phase 4 package is for external LangChain/Pinecone source-cited RAG. It must not be used to claim Phase 5 Open WebUI deployment or Phase 6 React customer chat completion.

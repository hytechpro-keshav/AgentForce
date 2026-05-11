# Phase 3 Agentforce Support Operations Case Analysis Proof

Date: 2026-05-11

## Scope

This document is the implementation and UAT runbook for the first Phase 3
Support Operations external-AI path:

`Customer_Self_Service_Agent -> Analyze Support Case -> AgentforceAiApiCaseAnalysis -> callout:Agentforce_AI_API_Phase2/agent/support/analyze-case -> Railway ai-api -> ModelRouter -> OpenAI`

It is analysis-only. The action does not create, update, escalate, or close
Salesforce Cases. RAG, LangChain, Pinecone, Open WebUI, and React customer
chat remain deferred to later phases.

## What This Slice Adds

- `POST /agent/support/analyze-case` on the Railway NestJS AI API
- `CaseAnalysisService` calling `ModelRouter` only, with sensitive-data
  redaction on both inbound prompt construction and the parsed response
- New scope `agentforce:case-analysis` enforced through `RequireScopes`
- Apex `AgentforceAiApiCaseAnalysis` invocable that reuses the Phase 2
  `Agentforce_AI_API_Phase2` Named Credential, masks common identifiers
  before callout, and maps a safe structured response into planner-visible
  fields
- New `Analyze_Support_Case` genAiFunction with `input`/`output` schemas
- New planner-local action under `Customer_Self_Service_Agent` planner
  bundle: `AI_API_Case_Analysis` topic + `Analyze_Support_Case_*` action
  with planner-local `input`/`output` schemas (required at runtime per the
  Phase 2 lesson)
- New eval coverage at `agent-eval/customer-self-service-phase3-case-analysis.yaml`
- New permission set entry for the `AgentforceAiApiCaseAnalysis` class

## Structured Output

`Analyze Support Case` returns:

- `summary` (<=200 chars, masked)
- `category` (`billing`, `outage`, `technical`, `account`, or `other`)
- `recommendedPriority` (`low`, `normal`, `high`, `critical`)
- `confidence` (`low`, `medium`, `high`)
- `nextAction` (<=200 chars, masked)
- Plus provider, model, fallback, latency, status, requestId metadata

Status meanings:

- `ANALYZED`: Apex reached Railway and the response matched the expected
  contract
- `VALIDATION_ERROR`: Apex received empty `caseSubject` or `caseDescription`
- `AUTH_ERROR`: Railway rejected the bridge credentials with 401 or 403
- `BACKEND_ERROR`: Railway returned a non-success status other than auth
- `CALLOUT_FAILED`: Apex could not reach the analyze-case endpoint
- `MALFORMED_RESPONSE`: Railway returned unreadable or unexpected JSON
- `UNEXPECTED_ERROR`: Apex could not complete the analysis safely
- `NOT_ANALYZED`: Apex initialized a response before the call completed

## Local Validation

- `npm run ai-api:typecheck` succeeded
- `npm run ai-api:test` passed 43 tests (5 new for `CaseAnalysisService`)
- `npm run ai-api:test:e2e` passed 17 tests (3 new for `/agent/support/analyze-case`)
- `npm run ai-api:build` succeeded
- `sf project deploy validate` (validate-only) for the new Apex class and
  test ran 9 Apex tests with 0 failures: deploy id `0Afg5000007rgY9CAI`

## Live Deployment And Proof

Phase 3 is deployed and proved in the production-like `AgentForce` org and
Railway production environment.

- Railway deployment: `9ed18b87-bab8-4194-8f40-4b985bfd439f`
- Railway service: `ai-api`
- Railway URL: `https://ai-api-production-03f5.up.railway.app`
- Salesforce core deploy: `0Afg5000007rwzVCAQ`
- Salesforce planner deploy: `0Afg5000007rrxVCAQ`
- Agent deactivation/reactivation: `Customer_Self_Service_Agent v1` was
  deactivated before planner deploy and reactivated after deploy
- External Credential refresh: `Agentforce_AI_API_Phase2` custom credential
  `AI_API_PHASE2_BEARER_JWT` overwritten with a combined-scope JWT
  (`agentforce:support-triage agentforce:case-analysis`), credential value id
  `0pwg5000000JRNtAAO`, revision `2`
- TraceFlag for runtime proof: `7tfg5000003njBxAAI` (deleted after capture)

Direct Apex smoke after credential refresh:

- Request id: `sf-case-analysis-direct-smoke-20260511-r2`
- Result: `ANALYZED`, HTTP `201`
- Category: `outage`
- Recommended priority: `high`
- Confidence: `medium`
- Provider/model: `openai` / `gpt-4o-mini`
- Railway HTTP request id: `5muLI_4HR7G597P2AXC71g`
- Telemetry tokens: input `175`, output `40`, total `215`
- Estimated total cost: `0.00005025` USD from
  `static_openai_reference_2026_05`

Published-agent preview proof:

- Preview session id: `019e17f5-da92-7985-a175-dcda32fd71ee`
- Runtime user: `customer_self_service_agent@00dg5000005qpun1460074599.ext`
- Apex log id: `07Lg5000006ww1qEAA`
- Apex operation: `/services/data/v66.0/support/functions/172g50000069odK`
- Apex log evidence: `AgentforceAiApiCaseAnalysis.analyzeCases`,
  `CALLOUT_REQUEST`, `NAMED_CREDENTIAL_REQUEST`, `NAMED_CREDENTIAL_RESPONSE`,
  and `CALLOUT_RESPONSE` with HTTP `201`
- Railway HTTP request id: `ps5HMH7PRgOXaVCG-8Y8hA`
- Railway telemetry request id: `sf-case-analysis-1778518466738-0`
- Railway HTTP status: `201`
- Railway HTTP total duration: `3433` ms
- Provider/model: `openai` / `gpt-4o-mini`
- Fallback used: `false`
- Telemetry tokens: input `169`, output `47`, total `216`
- Provider latency: `2955` ms
- Estimated total cost: `0.00005355` USD from
  `static_openai_reference_2026_05`

The preview prompt required confirmation and returned these structured fields:

- Summary: customer reports slow speeds below the contracted plan during peak
  hours for three evenings
- Category: `Technical`
- Recommended Priority: `Normal`
- Confidence: `Medium`
- Next Action: investigate network performance during peak hours and check for
  ongoing issues

## Repeat Deployment Steps

These steps mirror the Phase 2 lifecycle. They are destructive in the sense
that the agent is briefly deactivated while planner-bundle metadata is
deployed, so coordinate with stakeholders before rerunning.

1. Deploy Railway NestJS with the Phase 3 endpoint. Confirm
   `AI_API_JWT_SECRET`, `OPENAI_API_KEY`, and `OPENAI_DEFAULT_MODEL` env
   vars are still set, and capture the new Railway deployment id.

2. Mint a scoped JWT with the Phase 3 scope and store it in the existing
   `Agentforce_AI_API_Phase2` external credential. The same Named
   Credential can carry both Phase 2 and Phase 3 scopes; either reuse the
   existing token if it already carries `agentforce:case-analysis`, or
   mint a new one with combined scopes `agentforce:support-triage
agentforce:case-analysis`. Save through
   `PUT /services/data/v66.0/named-credentials/credential` when the
   principal already exists. `POST` returns `409 CONFLICT` for an existing
   principal. The `/connect/named-credentials/credential` path is 404 in
   this org.

3. Deploy the Apex slice with tests first (planner bundle stays untouched):

   ```bash
   sf project deploy start \
     --source-dir force-app/main/default/classes/AgentforceAiApiCaseAnalysis.cls \
     --source-dir force-app/main/default/classes/AgentforceAiApiCaseAnalysisTest.cls \
     --source-dir force-app/main/default/genAiFunctions/Analyze_Support_Case \
     --source-dir force-app/main/default/permissionsets/Customer_Self_Service_Agent.permissionset-meta.xml \
     --test-level RunSpecifiedTests \
     --tests AgentforceAiApiCaseAnalysisTest \
     --wait 30
   ```

4. Deactivate the agent before deploying the planner bundle:

   ```bash
   sf agent deactivate --api-name Customer_Self_Service_Agent --target-org AgentForce
   ```

5. Deploy the planner bundle (this includes the new `AI_API_Case_Analysis`
   topic and its planner-local action schemas):

   ```bash
   sf project deploy start \
     --source-dir force-app/main/default/genAiPlannerBundles/Customer_Self_Service_Agent \
     --wait 30
   ```

6. Reactivate the agent:

   ```bash
   sf agent activate --api-name Customer_Self_Service_Agent --target-org AgentForce
   ```

7. Assign or re-assign the `Customer_Self_Service_Agent` permission set to
   the Einstein Agent runtime user so the new class access is honored.

## Runtime Proof Checklist

For repeat UAT, run a published or preview conversation that exercises the
path and record:

- Railway deployment id (from the Railway dashboard)
- Salesforce Apex deploy id for the core slice
- Salesforce Apex deploy id for the planner bundle
- Agent preview session id (`sf agent preview start`)
- Apex log id for `AgentforceAiApiCaseAnalysis.analyzeCases`
- Railway request id / telemetry request id (look for the safe
  `requestId` field in NestJS logs; matches `sf-case-analysis-...`)
- Token counts (input/output/total) from telemetry
- Estimated cost-reference USD value from telemetry

## Suggested Preview Prompts

The agent preview should not echo raw identifiers in any of these turns.

- "Run Phase 3 Support Operations case analysis. Subject: Recurring slow speed.
  Description: Customer reports speeds below contracted plan for three
  consecutive evenings during peak hours. Status: Working. Type: Technical.
  Origin: Web. Reported priority: normal."
- "Use Analyze Support Case. Subject: Masking proof for Jane Doe.
  Description: Customer name is Jane Doe. Email jane@example.com, phone
  415-555-1212, account number ACCT-123456. The customer reports no
  service. Status: Working. Type: Outage. Origin: Phone. Reported
  priority: high."

## Negative Coverage

- Unauthenticated `POST /agent/support/analyze-case` -> HTTP 401.
- Token without `agentforce:case-analysis` scope -> HTTP 403.
- Provider validation failure -> HTTP 503 with `provider_unavailable` body.
- Malformed JSON from provider -> Apex returns `MALFORMED_RESPONSE` with
  a safe message and no leaked content.

## Phase Status Update

Phase 3 is deployed and proved for the smallest production-sane slice. Later
phases still own RAG, Open WebUI, React customer chat, richer Support
Operations workflows, and any durable case mutation flows.

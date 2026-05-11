# 2026-05-11 Phase 1 Session Summary

## What Was Completed

- Confirmed the Railway `ai-api` deployment, service URL, protected `/health` endpoint, and public `/health/live` endpoint.
- Deployed and validated the Salesforce Named Credential, External Credential, and permission set for the Phase 1 health bridge.
- Confirmed the Apex invocable `AgentforceAiApiHealthCheck` maps the protected health response into safe Agentforce-facing fields.
- Bound `Check_AI_API_Health` into the published `Customer_Self_Service_Agent` planner bundle under the temporary `AI_API_Health_Bridge` topic.
- Removed the temporary `AI_API_Health_Bridge` topic from `Agentforce_Service_Agent` so Phase 1 proof is aligned to the Customer Self Service product target.
- Assigned `Agentforce_AI_API_Health_Bridge` to the Customer Self Service Einstein Agent runtime user and removed it from the Service Agent runtime user.
- Deployed the planner-bundle correction with deploy ID `0Afg5000007q1aJCAQ`.
- Captured published runtime proof with `sf agent preview start`, `sf agent preview send`, and `sf agent preview end`.
- Captured Apex runtime proof showing `AgentforceAiApiHealthCheck.checkHealth` executed and called `callout:Agentforce_AI_API/health` with HTTP `200`.
- Confirmed a real manual Builder hit too: the first Builder action returned `CONNECTED` at `2026-05-11T09:54:01Z`, and a traced rerun afterward produced Apex log `07Lg5000006w7ldEAA` with the same Railway `/health` call and HTTP `200`.
- Re-ran focused health bridge Apex tests after the Customer Self Service move: `AgentforceAiApiHealthCheckTest` passed `11/11`, test run ID `707g500000NpEJt`.
- Fixed the unrelated `AccountMapSelector` org test failure by treating null, zero, and negative radii as no-search input and by using the Salesforce-supported geolocation operator.
- Added focused Apex coverage tests for `LightningLoginFormController` and `LightningForgotPasswordController` so local org coverage returned above the deployment threshold.
- Re-ran local Apex tests with coverage: `55` tests passed and org-wide coverage returned to `76%`.

## Runtime Proof Evidence

- Published agent: `Customer_Self_Service_Agent`
- Runtime user: `customer_self_service_agent@00dg5000005qpun1460074599.ext`
- Preview session used for Customer Self Service proof: `019e166e-8af0-79fc-87a7-119523d3f032`
- Preview feedback ID: `b8a7b61b-b33e-426f-a73b-fb082e33aedc`
- Apex log ID: `07Lg5000006voXnEAI`
- Builder rerun Apex log ID: `07Lg5000006w7ldEAA`

See [Phase 1 Agentforce Runtime Proof](../testing/phase1-agentforce-runtime-proof.md) for the full transcript and filtered Apex-log evidence.

## Temporary Topic Guidance

`AI_API_Health_Bridge` is useful now because Phase 1 needed a user-reachable published-agent path to prove the Salesforce Agentforce -> Apex -> Named Credential -> Railway bridge in the real runtime.

That does not make it a permanent customer-facing production topic. After the later production phases are complete, remove this topic and its planner-local action from `Customer_Self_Service_Agent`.

Do not remove the underlying health endpoint, Apex bridge, tests, or operational runbooks until replacement monitoring exists or the health check is moved to an internal-only ops agent.

## Questions To Ask The Agent

Use either of these prompts:

- `Check the AI API health bridge.`
- `Invoke Check AI API Health and tell me the bridgeStatus, healthStatus, and httpStatusCode for the AI API health bridge.`

The second prompt is the better choice when you want explicit status fields in the user-visible reply.

## How To Verify Logs During A Manual Prompt

1. Create a short-lived `TraceFlag` for the assigned Einstein Agent runtime user.
2. Ask one of the prompts above in Agentforce preview or the published surface.
3. Query `ApexLog` for the runtime user and inspect the newest log.
4. Confirm the log shows `AgentforceAiApiHealthCheck.checkHealth` and the `callout:Agentforce_AI_API/health` request.
5. Confirm the response status matches the user-visible message.

## Repo-Owned Guidance Updated

- Canonical agent guidance: `AGENTS.md`
- Salesforce Agentforce instruction guidance: `.github/instructions/salesforce-agentforce.instructions.md`
- Testing and eval instruction guidance: `.github/instructions/testing-evals.instructions.md`
- Agent doc: `docs/agents/support-operations.md`
- Deployment runbook: `docs/deployment/railway-ai-api-phase1.md`
- Testing docs: `docs/testing/agentforce-evals.md`, `docs/testing/phase1-health-bridge-smoke.md`, and `docs/testing/phase1-agentforce-runtime-proof.md`

There are no repo-owned custom `SKILL.md` files in this workspace, so there were no local skill-definition files to update.

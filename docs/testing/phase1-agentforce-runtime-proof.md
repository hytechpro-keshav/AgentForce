# Phase 1 Agentforce Runtime Proof

Date: 2026-05-11

## Scope

This proof covers the Phase 1 health bridge only: `Customer_Self_Service_Agent` invoking `Check AI API Health`, which calls `AgentforceAiApiHealthCheck`, which calls the Railway NestJS `ai-api` health endpoint through the configured Salesforce Named Credential.

An earlier proof was captured through `Agentforce_Service_Agent` while validating the narrow runtime bridge. That proof is now superseded because the product target for Phase 1 is Customer Self Service. The temporary health topic has been removed from `Agentforce_Service_Agent` and moved to `Customer_Self_Service_Agent`.

This does not validate OpenAI, ModelRouter, LangChain, Pinecone, Open WebUI, or React customer chat behavior. The first through-Agentforce Phase 2 support triage proof is documented separately in `docs/testing/phase2-agentforce-support-triage-proof.md`.

## Phase 2 Manual Agentforce Follow-Up

Completed on 2026-05-11. `Customer_Self_Service_Agent` now has a temporary `AI_API_Support_Triage` topic that invokes `Triage Support Case`, calls the JWT-protected `/agent/support/triage-case` endpoint, and returns a triage-only recommendation without creating a Case. See `docs/testing/phase2-agentforce-support-triage-proof.md` for deployment IDs, prompt flow, Apex log ID, and Railway telemetry.

## Environment

- Salesforce org alias: `AgentForce`
- Agent API name: `Customer_Self_Service_Agent`
- Agent version: `1`
- Runtime user: `customer_self_service_agent@00dg5000005qpun1460074599.ext`
- Railway service URL: `https://ai-api-production-03f5.up.railway.app`
- Railway deployment: `b2a59fc4-cdc8-4b6c-9162-541933dc8f79`

## Runtime Setup

- Assigned `Agentforce_AI_API_Health_Bridge` to the Customer Self Service runtime user so the published agent can invoke `AgentforceAiApiHealthCheck` and use the External Credential principal.
- Removed `Agentforce_AI_API_Health_Bridge` from the `Agentforce_Service_Agent` runtime user after moving the proof target.
- Deployed the Customer Self Service planner binding and Service Agent removal with deploy ID `0Afg5000007q1aJCAQ`.
- Activated `Customer_Self_Service_Agent` version `1` successfully after deploying the planner bundle.

## Preview Evidence

Command flow:

```bash
sf agent preview start --api-name Customer_Self_Service_Agent --target-org AgentForce --json
sf agent preview send --api-name Customer_Self_Service_Agent --target-org AgentForce --session-id <session-id> --utterance "Check the AI API health bridge." --json
sf agent preview end --api-name Customer_Self_Service_Agent --target-org AgentForce --session-id <session-id> --json
```

Result:

- Session ID: `019e166e-8af0-79fc-87a7-119523d3f032`
- Feedback ID / plan ID: `b8a7b61b-b33e-426f-a73b-fb082e33aedc`
- Content safety: `true`
- Agent response: `The AI API health bridge is connected, and the health endpoint is reachable. Everything seems to be working fine!`

## Apex Runtime Evidence

A short-lived TraceFlag was enabled for the Einstein Agent runtime user before the preview turn.

- Apex log ID: `07Lg5000006voXnEAI`
- Log user: `customer_self_service_agent@00dg5000005qpun1460074599.ext`
- Operation: `/services/data/v66.0/support/functions/172g50000068emX`
- Status: `Success`
- Duration: `1665ms`

Filtered log evidence:

```text
CODE_UNIT_STARTED|[EXTERNAL]|AgentforceAiApiHealthCheck.checkHealth(List<AgentforceAiApiHealthCheck.HealthRequest>)
METHOD_ENTRY|AgentforceAiApiHealthCheck.callHealthEndpoint()
CALLOUT_REQUEST|System.HttpRequest[Endpoint=callout:Agentforce_AI_API/health, Method=GET]
CALLOUT_RESPONSE|System.HttpResponse[Status=OK, StatusCode=200]
METHOD_ENTRY|AgentforceAiApiHealthCheck.parseHealthResponse(String, AgentforceAiApiHealthCheck.HealthResponse)
METHOD_ENTRY|AgentforceAiApiHealthCheck.isExpectedHealthContract(AgentforceAiApiHealthCheck.HealthResponse, String, List<ANY>)
CODE_UNIT_FINISHED|AgentforceAiApiHealthCheck.checkHealth(List<AgentforceAiApiHealthCheck.HealthRequest>)
```

## Builder Confirmation

The manual Agentforce Builder run also hit the real bridge path.

- A Builder action result showed `checkedAt: 2026-05-11T09:54:01Z`, `bridgeStatus: CONNECTED`, `healthStatus: OK`, and `httpStatusCode: 200`.
- That first Builder hit did not have an Apex debug log because the TraceFlag began later at `2026-05-11T09:55:58Z`.
- After enabling tracing and rerunning the same Builder prompt, Salesforce captured Apex log `07Lg5000006w7ldEAA` for runtime user `customer_self_service_agent@00dg5000005qpun1460074599.ext` at `2026-05-11T09:59:36Z`.
- The traced rerun log again showed `AgentforceAiApiHealthCheck.checkHealth`, `CALLOUT_REQUEST|System.HttpRequest[Endpoint=callout:Agentforce_AI_API/health, Method=GET]`, and `CALLOUT_RESPONSE|System.HttpResponse[Status=OK, StatusCode=200]`.

## Result

Phase 1 Agentforce runtime invocation proof passed through the product target agent. The published `Customer_Self_Service_Agent` invoked the Apex health bridge, the Apex bridge called the configured Named Credential endpoint, Railway returned HTTP `200`, and Agentforce reported the health bridge as connected and reachable to the user.

Focused Apex validation also passed after the move: `AgentforceAiApiHealthCheckTest` ran `11` tests with `100%` pass rate, test run ID `707g500000NpEJt`.

## Manual Questions To Ask The Agent

You can ask the published agent either of these prompts when you want to verify the Phase 1 bridge manually:

- `Check the AI API health bridge.`
- `Invoke Check AI API Health and tell me the bridgeStatus, healthStatus, and httpStatusCode for the AI API health bridge.`

The first prompt checks the user-facing operational response. The second is better when you want the agent to surface the returned Phase 1 status fields explicitly.

## Live Log Verification

Yes, the agent can be asked this question and the runtime can be verified through logs at the same time. The recommended flow is:

1. Create a short-lived `TraceFlag` for the Einstein Agent runtime user assigned to `Customer_Self_Service_Agent`.
2. Ask one of the prompts above in Agentforce preview or the published surface.
3. Query `ApexLog` for the runtime user and fetch the newest log.
4. Confirm the log contains `AgentforceAiApiHealthCheck.checkHealth` and `CALLOUT_REQUEST|System.HttpRequest[Endpoint=callout:Agentforce_AI_API/health, Method=GET]` followed by HTTP `200` or the expected failure status.

## Future Retirement

`AI_API_Health_Bridge` is a temporary published topic used to prove the narrow Phase 1 bridge in the real customer-facing runtime. When the later production phases are complete, remove this topic and its planner-local action from the customer-facing planner bundle.

Do not remove the underlying health endpoint, Apex bridge, tests, or runbooks until replacement operational monitoring exists or the health check has been moved to an internal-only ops agent.

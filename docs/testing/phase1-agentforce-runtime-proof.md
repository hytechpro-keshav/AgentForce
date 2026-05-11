# Phase 1 Agentforce Runtime Proof

Date: 2026-05-11

## Scope

This proof covers the Phase 1 health bridge only: `Agentforce_Service_Agent` invoking `Check AI API Health`, which calls `AgentforceAiApiHealthCheck`, which calls the Railway NestJS `ai-api` health endpoint through the configured Salesforce Named Credential.

This does not validate OpenAI, ModelRouter, LangChain, Pinecone, Open WebUI, or React customer chat behavior. Those capabilities remain deferred to later phases.

## Environment

- Salesforce org alias: `AgentForce`
- Agent API name: `Agentforce_Service_Agent`
- Agent version: `1`
- Runtime user: `agentforce_service_agent@00dg5000005qpun977214756.ext`
- Railway service URL: `https://ai-api-production-03f5.up.railway.app`
- Railway deployment: `b2a59fc4-cdc8-4b6c-9162-541933dc8f79`

## Runtime Setup

- Reactivated the assigned Einstein Agent runtime user because activation was blocked by an inactive `BotUserId`.
- Assigned `Agentforce_AI_API_Health_Bridge` to the runtime user so the published agent can invoke `AgentforceAiApiHealthCheck` and use the External Credential principal.
- Activated `Agentforce_Service_Agent` version `1` successfully.

## Preview Evidence

Command flow:

```bash
sf agent preview start --api-name Agentforce_Service_Agent --target-org AgentForce --json
sf agent preview send --api-name Agentforce_Service_Agent --target-org AgentForce --session-id <session-id> --utterance "Invoke Check AI API Health and tell me the bridgeStatus, healthStatus, and httpStatusCode for the AI API health bridge." --json
sf agent preview end --api-name Agentforce_Service_Agent --target-org AgentForce --session-id <session-id> --json
```

Result:

- Session ID: `019e1641-c414-7585-a31e-76b89aae44d6`
- Feedback ID / plan ID: `48418681-f61f-432d-9740-0f967b93f871`
- Content safety: `true`
- Agent response: `Bridge Status: CONNECTED`, `Health Status: OK`, and the health endpoint was reachable.

## Apex Runtime Evidence

A short-lived TraceFlag was enabled for the Einstein Agent runtime user before the preview turn.

- Apex log ID: `07Lg5000006vwTdEAI`
- Log user: `agentforce_service_agent@00dg5000005qpun977214756.ext`
- Operation: `/services/data/v66.0/support/functions/172g50000068Ugd`
- Status: `Success`
- Duration: `1112ms`

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

## Result

Phase 1 Agentforce runtime invocation proof passed. The published `Agentforce_Service_Agent` invoked the Apex health bridge, the Apex bridge called the configured Named Credential endpoint, Railway returned HTTP `200`, and Agentforce reported `CONNECTED` / `OK` to the user.

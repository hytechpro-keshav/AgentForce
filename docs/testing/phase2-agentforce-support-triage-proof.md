# Phase 2 Agentforce Support Triage Proof

Date: 2026-05-11

## Scope

This proof covers the first real Phase 2 Agentforce runtime path:

`Customer_Self_Service_Agent -> Triage Support Case -> AgentforceAiApiSupportTriage -> callout:Agentforce_AI_API_Phase2/agent/support/triage-case -> Railway ai-api -> ModelRouter -> OpenAI`.

The proof is temporary and triage-only. It does not create, update, escalate, or close Salesforce Cases. It does not validate LangChain, Pinecone, Open WebUI, or React customer chat.

## Environment

- Salesforce org alias: `AgentForce`
- Agent API name: `Customer_Self_Service_Agent`
- Runtime user: `customer_self_service_agent@00dg5000005qpun1460074599.ext`
- Railway URL: `https://ai-api-production-03f5.up.railway.app`
- Railway deployment: `6522fb47-ad6c-48b4-a541-3bcb1f795226`
- OpenAI model: `gpt-4o-mini`

`OPENAI_DEFAULT_MODEL` was changed from `gpt-4.1-mini` to `gpt-4o-mini` because the configured OpenAI project returned `model_not_found` for `gpt-4.1-mini`. A direct `/v1/models` check confirmed the API key was valid.

## Deployments

- Backend validation: `npm run ai-api:test` passed 38 tests, `npm run ai-api:test:e2e` passed 14 tests, `npm run ai-api:typecheck` succeeded, and `npm run ai-api:build` succeeded.
- Railway masking deploy: `83c45bdb-161c-4441-8d78-9f4c27a66e2c` succeeded with pre-provider masking in `ModelRouter` and `OPENAI_DEFAULT_MODEL=gpt-4o-mini`.
- Railway cost-telemetry deploy: `6522fb47-ad6c-48b4-a541-3bcb1f795226` succeeded with estimated USD cost-reference fields for known models such as `gpt-4o-mini`.
- Salesforce core deploy: `0Afg5000007rC5RCAU` deployed `AgentforceAiApiSupportTriage`, its test, the Phase 2 Named/External Credential metadata, permission-set access, and `Triage_Support_Case`; 9/9 Apex tests passed.
- Final planner deploy: `0Afg5000007rD6NCAU` deployed the `AI_API_Support_Triage` topic, local action, and required planner-local input/output schemas, then `Customer_Self_Service_Agent` was reactivated.
- Masking hardening deploy: `0Afg5000007rFplCAE` deployed Apex callout masking, planner instructions that avoid echoing raw identifiers, and function schema descriptions; 9/9 Apex tests passed.

## Credential Setup

Phase 2 uses a separate secure credential from Phase 1:

- Named Credential: `Agentforce_AI_API_Phase2`
- External Credential: `Agentforce_AI_API_Phase2`
- Principal: `Agentforce_AI_API_Phase2_Principal`
- Encrypted custom credential value: `AI_API_PHASE2_BEARER_JWT`
- Header formula: `Authorization: Bearer {!$Credential.Agentforce_AI_API_Phase2.AI_API_PHASE2_BEARER_JWT}`

The scoped JWT was minted from Railway `AI_API_JWT_SECRET` with scope `agentforce:support-triage` and stored through Salesforce REST resource `/services/data/v66.0/named-credentials/credential`. The `/connect/named-credentials/credential` path returned 404 and must not be used.

## Direct Backend Smoke

Live Railway checks after deployment:

- `GET /health/live`: HTTP 200
- Unauthenticated `POST /agent/support/triage-case`: HTTP 401
- Authenticated `POST /agent/support/triage-case`: HTTP 201

Authenticated smoke output included:

```text
recommendedPriority=high
provider=openai
model=gpt-4o-mini
fallbackUsed=false
latencyMs=3202
summary=Customer reports no service after local outage and seeks follow-up prioritization.
suggestedNextStep=Confirm service restoration timeline and prioritize follow-up with the customer.
```

Masking smoke after deployment `83c45bdb-161c-4441-8d78-9f4c27a66e2c` used a request containing a sample name, email, phone number, account number, payment-card shaped value, SSN, and street address. The live route returned HTTP `201` with no raw identifiers in the safe response.

```text
requestId=mask-smoke-1778510930
recommendedPriority=high
provider=openai
model=gpt-4o-mini
fallbackUsed=false
summary=Customer reports no service after an outage.
suggestedNextStep=Investigate outage status and restore service.
```

## Direct Apex Smoke

A direct anonymous Apex invocation of `AgentforceAiApiSupportTriage.triageCases` proved the Salesforce credential path before planner validation.

Result:

```text
triageStatus=TRIAGED
recommendedPriority=high
provider=openai
model=gpt-4o-mini
httpStatusCode=201
endpoint=/agent/support/triage-case
requestId=phase2-apex-proof-success
```

## Agentforce Preview Evidence

Successful traced preview session:

- Session ID: `019e175b-e804-7651-839c-22b8a8f809e6`
- Trace path: `.sfdx/agents/0Xxg5000000kZUDCA2/sessions/019e175b-e804-7651-839c-22b8a8f809e6`

Prompt flow:

```text
Run triage-only prioritization, not health check and not case creation. Use Triage Support Case. Subject: Warranty question routing. Description: A warranty question needs a safe priority recommendation for whether follow-up should happen today or next business day. Reported priority: medium. I confirm.
```

Agent confirmation:

```text
Just to confirm, would you like me to proceed with determining a safe priority recommendation for the warranty question?
```

Confirmation turn:

```text
Yes, confirm. Proceed with the triage-only priority recommendation.
```

Agent result:

```text
The AI support triage is complete.
Recommended Priority: Normal
Suggested Next Step: Follow up on the next business day.
Summary: Customer inquires about warranty follow-up timing.
```

A prior proof-record follow-up also surfaced `triageStatus=TRIAGED`, `provider=openai`, and `model=gpt-4o-mini`; `httpStatusCode` was not displayed by the agent because that output field is planner/internal rather than displayable.

## Masking Preview Evidence

After the masking hardening deploy, the published agent was retested with a prompt containing a sample name, email, phone number, account number, payment-card shaped value, SSN, and street address.

- Session ID: `019e1788-a7c4-7d57-9012-a7eb1984c9c2`
- TraceFlag ID: `7tfg5000003nSz7AAE`
- Apex log ID: `07Lg5000006wxkDEAQ`
- Railway request ID: `sf-triage-1778511330722-0`

Prompt for manual testing:

```text
Run triage-only prioritization, not health check and not case creation. Use Triage Support Case. Subject: Masking proof for Jane Doe. Description: Customer name is Jane Doe. Email jane@example.com, phone 415-555-1212, account number ACCT-123456, card 4111 1111 1111 1111, SSN 123-45-6789, and service address 123 Main St Apt 4B. The customer reports no service after an outage. Reported priority: high. I confirm.
```

The first agent response did not echo the raw identifiers:

```text
Can I proceed with prioritizing the support case based on the provided details?
```

Confirmation turn:

```text
Yes, confirm. Proceed with the triage-only priority recommendation using the sanitized support issue. Do not create a case and do not repeat any raw identifiers.
```

Final agent result:

```text
The support triage is complete. Here's the recommendation:

- Recommended Priority: High
- Summary: Customer reports no service after an outage and needs assistance with masking proof.
- Suggested Next Step: Investigate the outage and provide updates to the customer regarding service restoration.
```

Searches of the Salesforce Apex log and Railway app logs for the raw sample values returned no matches.

## Exact User-Run Verification

The exact masking conversation supplied by the user was also verified against live Salesforce and Railway logs after the planner hardening.

- Apex log ID: `07Lg5000006wzFlEAI`
- Railway telemetry request ID: `sf-triage-1778511959312-0`
- Railway HTTP timestamp: `2026-05-11T15:06:02Z`

That verification confirmed the real published agent path was executed, not just planner reasoning in the UI, and that searches of Apex and Railway logs for the raw sample values returned no matches.

## Cost-Enabled Preview Evidence

After Railway deployment `6522fb47-ad6c-48b4-a541-3bcb1f795226`, the published agent was rerun with the masking prompt so the latest proof would include the deployed cost-reference telemetry fields.

- Session ID: `019e179d-90ed-74a4-b598-5b03887373ec`
- TraceFlag ID: `7tfg5000003nWufAAE`
- Apex log ID: `07Lg5000006x1xWEAQ`
- Railway HTTP request ID: `X2iB2swyTKm70MfSvEOTxA`
- Railway telemetry request ID: `sf-triage-1778512685428-0`

The prompt and confirmation were the same as the masking proof above.

Final agent result:

```text
The support triage is complete. Here's the recommendation:

- Recommended Priority: High
- Summary: Customer reports no service after an outage and needs assistance with masking proof.
- Suggested Next Step: Investigate the outage and provide updates on service restoration.

Let me know if you need further assistance!
```

Searches of the latest Salesforce Apex log and Railway app logs for `Jane Doe`, `jane@example.com`, `415-555-1212`, `ACCT-123456`, `4111 1111`, `123-45-6789`, and `123 Main` returned no matches.

## Apex Runtime Evidence

A short-lived TraceFlag was enabled for runtime user `customer_self_service_agent@00dg5000005qpun1460074599.ext`.

- Apex log ID: `07Lg5000006x1xWEAQ`
- Operation: `/services/data/v66.0/support/functions/172g50000069UWT`
- Status: `Success`

Filtered log evidence:

```text
CODE_UNIT_STARTED|[EXTERNAL]|AgentforceAiApiSupportTriage.triageCases(List<AgentforceAiApiSupportTriage.TriageRequest>)
METHOD_ENTRY|AgentforceAiApiSupportTriage.maskSensitiveText(String)
METHOD_ENTRY|AgentforceAiApiSupportTriage.maskSensitiveText(String)
CALLOUT_REQUEST|[53]|System.HttpRequest[Endpoint=callout:Agentforce_AI_API_Phase2/agent/support/triage-case, Method=POST]
CALLOUT_RESPONSE|[53]|System.HttpResponse[Status=Created, StatusCode=201]
VARIABLE_ASSIGNMENT|[54]|this.httpStatusCode|201
METHOD_ENTRY|AgentforceAiApiSupportTriage.parseTriageResponse(String, AgentforceAiApiSupportTriage.TriageResponse)
```

## Railway Telemetry Evidence

Initial Railway telemetry for the first traced Agentforce request:

```text
request_id=sf-triage-1778508387444-0
event=gen_ai.client.operation
gen_ai.operation.name=chat
gen_ai.system=openai
gen_ai.request.model=gpt-4o-mini
gen_ai.usage.input_tokens=133
gen_ai.usage.output_tokens=38
gen_ai.usage.total_tokens=171
gen_ai.client.latency_ms=1424
gen_ai.response.outcome=success
gen_ai.router.fallback_used=false
gen_ai.router.attempted_providers=[openai]
```

Railway telemetry for the masking proof also showed a successful OpenAI call without raw prompt content in logs:

```text
request_id=sf-triage-1778511330722-0
gen_ai.system=openai
gen_ai.request.model=gpt-4o-mini
gen_ai.usage.total_tokens=225
gen_ai.client.latency_ms=1617
gen_ai.response.outcome=success
gen_ai.router.fallback_used=false
gen_ai.router.attempted_providers=[openai]
```

Railway telemetry for the latest cost-enabled proof included the new pricing and cost-reference fields:

```text
request_id=sf-triage-1778512685428-0
event=gen_ai.client.operation
gen_ai.operation.name=chat
gen_ai.system=openai
gen_ai.request.model=gpt-4o-mini
gen_ai.usage.input_tokens=177
gen_ai.usage.output_tokens=45
gen_ai.usage.total_tokens=222
gen_ai.client.latency_ms=994
gen_ai.response.outcome=success
gen_ai.router.fallback_used=false
gen_ai.router.attempted_providers=[openai]
gen_ai.pricing.source=static_openai_reference_2026_05
gen_ai.pricing.input_usd_per_1m_tokens=0.15
gen_ai.pricing.output_usd_per_1m_tokens=0.6
gen_ai.usage.input_cost_usd_estimate=0.00002655
gen_ai.usage.output_cost_usd_estimate=0.000027
gen_ai.usage.total_cost_usd_estimate=0.00005355
```

No raw prompt text, secrets, authorization headers, or full provider response bodies were present in the telemetry record.

## Result

Phase 2 Agentforce runtime proof passed for the first provider-backed path. The published `Customer_Self_Service_Agent` invoked the deployed Apex action after confirmation, Salesforce authenticated through the separate Phase 2 Named Credential, Railway called OpenAI through `ModelRouter`, the agent returned a safe triage recommendation without creating a Salesforce Case, masking remained intact across Salesforce and Railway logs, and the deployed backend emitted token plus cost-reference telemetry for the live `gpt-4o-mini` request.

## Follow-Up

`AI_API_Support_Triage` is a temporary proof topic. Keep it only until a permanent production support triage workflow replaces it, then remove the customer-facing temporary topic and retain operational smoke coverage in internal runbooks or ops-only agents.

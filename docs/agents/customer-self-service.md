# Customer Self-Service Agent

## Overview

Customer Self-Service is the first production-path customer agent. Phase 0 stays inside Salesforce Agentforce and uses deterministic Salesforce actions over live Salesforce data before external RAG, provider routing, Open WebUI, or the React customer chat window are added.

The Phase 0 goal is to prove a safe customer workflow:

```text
Customer
  -> Agentforce Customer Self-Service Agent
  -> narrow topic/action selection
  -> Apex or Flow action
  -> Account, Contact, Case, Knowledge, and approved scheduling data
  -> service request or escalation outcome
```

## Phase 0 Rule

Start native in Agentforce. Do not call OpenAI, Pinecone, LangChain, or provider SDKs from Apex. Do not add the NestJS bridge until the Salesforce-native customer workflow, data access rules, and escalation behavior are tested.

## Agent Purpose

Help verified utility or field-service customers get account, service request, appointment, outage, billing, and troubleshooting help. Resolve only low-risk requests with approved Salesforce data and route uncertain, sensitive, or unsupported requests to human support with context.

## Topics

### Customer Verification

Verify the customer before reading account, billing, appointment, case, or service history. Reuse the existing Service Customer Verification pattern where possible.

### Account And Case Status

Read customer-safe account context and open support cases after verification.

Supported Phase 0 action:

- `Get_Customer_Account_Summary`

### Issue Reporting

Collect issue type, symptoms, severity, language, service address notes, and contact preference. Create a Case as the primary write path.

Supported Phase 0 action:

- `Create_Service_Request`

### Escalation And Handoff

Escalate when the customer asks for a human, the agent cannot verify the customer, the request is sensitive, the issue is unresolved, or the agent lacks authoritative data.

Supported Phase 0 action:

- `Escalate_Service_Request`

### Billing

Phase 0 may answer only from approved Salesforce billing data if those objects are confirmed. Until then, create a billing support Case and escalate disputes, refunds, credits, collections, payment failures, and identity mismatch.

### Service Status And Outage

Phase 0 may read outage data only if an authoritative Salesforce object or integration already exists. Until then, collect the issue and create or escalate a Case.

### Appointments

Phase 0 may look up or request appointments only when Field Service, Service Appointment, or an approved scheduling Flow is confirmed in the org. Until then, collect preferred windows and create a Case.

### Knowledge Troubleshooting

Use approved Salesforce Knowledge for simple troubleshooting and policy answers. Keep broad unstructured RAG outside Phase 0.

## Escalation Triggers

- Verification failure or customer/account mismatch
- Customer asks for a human
- Billing dispute, payment, refund, credit, collection, or fee waiver request
- Emergency, safety, regulatory, medical, or legal risk
- Outage not found but customer reports critical service loss
- Appointment cannot be confirmed from authoritative Salesforce data
- Attachment requires inspection or document/photo understanding
- Repeated fallback or low confidence
- Spanish support is requested but approved Spanish content or staffing is unavailable
- Any request outside approved Salesforce actions

## Fallback Behavior

Ask one focused clarifying question when required inputs are missing. If the answer still cannot be resolved safely, create or escalate a Case. Never invent billing, outage, appointment, account, or policy facts.

## Salesforce Reads

- `Account`: verified account context and service address summary
- `Contact`: verified customer-to-account relationship
- `Case`: open support cases and escalation state
- `Knowledge`: approved customer-safe troubleshooting content where enabled
- Appointment, billing, outage, and asset objects only after the org data model is confirmed

## Salesforce Writes

- `Case`: service request creation and escalation priority
- `CaseComment`: private escalation summary for human handoff
- `ContentDocumentLink`: later, only after attachment handling rules are approved
- Appointment records later, only through approved scheduling objects or Flow

## Later Hybrid Move

Move these capabilities to the monorepo NestJS platform after Phase 0 passes evals:

- RAG over large knowledge sets with Pinecone and source citations
- ModelRouter and OpenAI provider calls
- multilingual response generation beyond curated Salesforce content
- attachment understanding and safe file processing
- customer-safe React chat API, rate limiting, CORS, and browser session policy
- Open WebUI internal chat through the OpenAI-compatible gateway
- token, cost, retrieval, and provider telemetry

## Phase 0 Exit Criteria

- Agentforce can verify a customer before sensitive reads
- Agentforce can retrieve a customer-safe account/case summary
- Agentforce can create a Case for issue reporting
- Agentforce can escalate a Case with a private handoff summary
- Apex tests pass for action contracts and fallback behavior
- Testing Center or REST evals cover topic selection, action use, Spanish intake, and escalation

## Stakeholder Coverage Snapshot

Source use case: https://ablypro.com/customer-self-service

Current phase: Phase 0 Salesforce-native action layer.

Current deploy status: The Phase 0 action layer was deployed to the connected Salesforce org on 6 May 2026 with deploy job `0Afg5000007aZfHCAU`. A follow-up hardening deploy on 7 May 2026 with deploy job `0Afg5000007dTW0CAM` tightened escalation safety and passed 8/8 `CustomerSelfServiceActionsTest` tests. Verification-first OTP metadata was restored on 8 May 2026 with deploy job `0Afg5000007gZgZCAU`.

Current verification mode: The published planner bundle is back in verification-first OTP mode. On 8 May 2026, a traced Agent Preview run sent OTP email to the clean Contact identity, resolved the customer as `Contact`, and accepted the generated code for the verified `Hytechpro University` account summary. Tester mailbox confirmation with the normal received OTP remains the final manual check.

| AblyPro customer self-service capability       | What the use case expects                                                    | What is implemented now                                                                                                                                                                     | Coverage status                      | Next step                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 24/7 intelligent support, zero wait time       | Customer can start support outside business hours across supported channels. | The Customer Self-Service planner bundle is active in Salesforce with working preview/runtime topics and configured customer surfaces. OTP now sends from Salesforce after the quota reset. | Partial                              | Confirm normal mailbox receipt and the pilot surface.                                                                   |
| Natural language conversation                  | Agent understands customer phrasing and routes to the right action.          | Agentforce topics/subagents, function contracts, and planner instructions are live in the current planner bundle and working in preview.                                                    | Implemented in preview               | Run Testing Center or manual eval evidence against the published planner bundle.                                        |
| Customer authentication / account lookup       | Customer is verified before account-specific data is shown.                  | Reuses the existing Service Customer Verification pattern; a traced 8 May 2026 preview run sent OTP and returned account summary only after the code was accepted.                          | Implemented in preview               | Confirm normal mailbox receipt and the final customer identity path.                                                    |
| Live account and case status                   | Agent reads live Salesforce account data, open cases, and service requests.  | `Get_Customer_Account_Summary` reads `Account`, `Contact`, and open `Case` records and returns a customer-safe summary.                                                                     | Implemented for Account/Contact/Case | Add service asset, entitlement, billing, and appointment objects after the org data model is confirmed.                 |
| Billing inquiry support                        | Agent answers billing status and routes disputes.                            | No billing object is wired yet. Billing disputes are documented as escalation-only in Phase 0.                                                                                              | Fallback only                        | Identify authoritative billing objects or integration; add read-only billing summary action later.                      |
| Outage or service status lookup                | Agent returns outage/service status in real time.                            | No authoritative outage/status object is wired yet. Outage reports create or escalate a Case.                                                                                               | Fallback only                        | Confirm outage/status source in Salesforce or external system; add deterministic status lookup action.                  |
| Service request creation                       | Agent creates a support/service request without human intake.                | `Create_Service_Request` creates a Salesforce `Case` for a verified Account and optional Contact.                                                                                           | Implemented                          | Bind action to Issue Reporting topic and test Case creation from Agentforce.                                            |
| Appointment lookup and scheduling              | Agent can schedule or manage appointments.                                   | Appointment scheduling is documented but not wired because Field Service or scheduling Flow mapping is not confirmed.                                                                       | Pending                              | Confirm Field Service/Service Appointment model or approved scheduling Flow.                                            |
| Issue reporting with photo/doc attachments     | Customer can report a problem and attach files.                              | Issue reporting creates a `Case`; attachments are explicitly out of scope until file handling rules are approved.                                                                           | Partial                              | Define upload channel, file types, size limits, scanning, retention, and whether files are linked to `Case`.            |
| Intelligent escalation with full context       | Agent hands off to a human with conversation/account context.                | `Escalate_Service_Request` sets the Case priority to High, writes a private `CaseComment`, and now requires verified account context when a user provides only a case number.               | Implemented                          | Confirm queue/Omni-Channel routing ownership and pilot handoff ownership.                                               |
| Multi-language support                         | English and Spanish are supported.                                           | `language` is captured on service request and escalation actions; Spanish eval coverage exists. No translation/RAG is implemented.                                                          | Partial                              | Confirm approved Spanish content, staffing, and whether Agentforce-native Spanish responses are sufficient for Phase 0. |
| Knowledge / RAG response generation            | Agent returns contextual answers grounded in knowledge.                      | Phase 0 allows approved Salesforce Knowledge only. External RAG is intentionally deferred.                                                                                                  | Pending for RAG                      | Add NestJS/LangChain/Pinecone under monorepo platform paths after native Agentforce workflow is proven.                 |
| Intent classification and escalation threshold | Agent distinguishes resolvable vs escalated issues.                          | Agentforce topic/action design plus action status fields support this; no separate custom classifier exists.                                                                                | Partial                              | Encode topic instructions in Agentforce Builder and validate with Testing Center evals.                                 |
| Language detection and sentiment monitoring    | Agent detects language and sentiment for routing/escalation.                 | Language is captured as an action input. Sentiment monitoring is not implemented in Phase 0.                                                                                                | Partial                              | Add language/sentiment policy in Agentforce instructions first; move richer detection to NestJS later.                  |
| Human handoff transcript/context               | Conversation, account context, and resolution attempts follow the Case.      | Escalation action accepts `conversationSummary` and stores it privately on the Case. Automatic transcript capture is not wired.                                                             | Partial                              | Confirm channel transcript object and map transcript or summary into Case handoff fields.                               |

## Phase 0 Completion Summary

| Area                             | Status   | Evidence                                                                                                                                                                                           |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture decision            | Complete | `ARCHITECTURE.md` now makes Customer Self-Service the first customer-facing production slice.                                                                                                      |
| Agent recipe                     | Complete | This document defines Phase 0 scope, topics, actions, escalation, fallback, reads, writes, and later hybrid scope.                                                                                 |
| Account/case summary action      | Complete | `Get_Customer_Account_Summary` genAiFunction and `CustomerSelfServiceAccountSummary` Apex class.                                                                                                   |
| Service request creation action  | Complete | `Create_Service_Request` genAiFunction and `CustomerSelfServiceCreateRequest` Apex class.                                                                                                          |
| Escalation action                | Complete | `Escalate_Service_Request` genAiFunction and `CustomerSelfServiceEscalateRequest` Apex class.                                                                                                      |
| Runtime permission set           | Complete | `Customer_Self_Service_Agent` permission set grants Apex access and Account/Contact/Case object permissions.                                                                                       |
| Apex tests                       | Complete | `CustomerSelfServiceActionsTest` now passes 8/8 tests, covering account summary, Case creation, escalation, validation fallback, account mismatch, and safe case-number escalation.                |
| Agentforce eval scaffold         | Complete | `agent-eval/customer-self-service-phase0.yaml` covers verification, summary, issue creation, billing escalation, Spanish intake, and attachments.                                                  |
| Salesforce deployment            | Complete | Deploy job `0Afg5000007aZfHCAU` deployed the initial Phase 0 action layer, and follow-up deploy `0Afg5000007dTW0CAM` deployed the escalation safety hardening with 8/8 focused Apex tests passing. |
| Permission assignment for tester | Complete | `Customer_Self_Service_Agent` was assigned to the connected default org user for immediate testing.                                                                                                |
| Agentforce topic/planner binding | Complete | The active `Customer_Self_Service_Agent` planner bundle in source and org contains the verification, account summary, issue reporting, and escalation topics/subagents.                            |
| Phase 1 AI API health proof      | Complete | The active `Customer_Self_Service_Agent` planner bundle temporarily contains `AI_API_Health_Bridge`, which invokes `Check_AI_API_Health` and proves the Salesforce to Railway bridge.              |
| Customer channel activation      | Partial  | Agent Preview is working and the planner bundle contains customer surfaces. Pilot/UAT still needs the final selected customer channel and business approval.                                       |

## Phase 0 Closeout Remaining

These are the remaining Phase 0 closeout items that do not require new feature development:

| Item                                   | Status         | Notes                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTP mailbox retest after GMT reset     | Partial        | After the 8 May 2026 quota reset, Salesforce logged `WF_EMAIL_SENT` to the clean Contact email and the agent accepted the generated code. The tester still needs to confirm normal mailbox receipt using the email they receive, without debug-log fallback.                                                                                                                                                      |
| Testing Center or manual eval evidence | Partial        | Manual Track A prompt testing was completed on 7 May 2026 and matched expected user-visible behavior for account summary, service request creation, escalation, attachment boundary, and Spanish intake. After a follow-up Spanish routing cue deploy, the Spanish prompt returned clear issue-reporting behavior in preview. A Testing Center topic-selection check is now optional confirmation, not a blocker. |
| Pilot channel and handoff ownership    | Pending manual | Preview is working, but the final customer-facing surface and escalation ownership still need business confirmation.                                                                                                                                                                                                                                                                                              |

Use the dedicated UAT runbook here: [Customer Self-Service Phase 0 UAT](../testing/customer-self-service-phase0-uat.md)

## Phase 1 AI API Health Bridge

The Customer Self Service Agent is the Phase 1 proof target for the Agentforce -> Apex -> Named Credential -> Railway bridge.

- Temporary topic: `AI_API_Health_Bridge`
- Action: `Check_AI_API_Health`
- Runtime user: `customer_self_service_agent@00dg5000005qpun1460074599.ext`
- Fresh proof session: `019e166e-8af0-79fc-87a7-119523d3f032`
- Fresh Apex log: `07Lg5000006voXnEAI`
- Traced Builder rerun Apex log: `07Lg5000006w7ldEAA`

Manual prompt:

```text
Check the AI API health bridge.
```

The traced Builder rerun confirms the customer-facing agent actually executed `AgentforceAiApiHealthCheck` and called `callout:Agentforce_AI_API/health` with HTTP `200`, not just planner reasoning in the UI.

This topic should be removed from the customer-facing planner bundle after later production phases replace the temporary proof surface. Keep the underlying health endpoint, Apex bridge, and smoke docs until replacement monitoring exists or the check is moved to an internal-only ops surface.

## Phase 2 AI API Support Triage

The Customer Self Service Agent also carries a temporary Phase 2 proof topic for provider-backed triage-only recommendations.

- Temporary topic: `AI_API_Support_Triage`
- Action: `Triage_Support_Case`
- Apex bridge: `AgentforceAiApiSupportTriage`
- Endpoint: `callout:Agentforce_AI_API_Phase2/agent/support/triage-case`
- Current proof model: `gpt-4o-mini`

Current proof behavior:

- The topic is triage-only and must not create, update, escalate, or close a Salesforce Case.
- Apex masks common identifiers before the callout.
- NestJS masks provider requests again before dispatch and logs token plus cost-reference telemetry without raw prompt text.
- The published agent was manually validated with both a non-sensitive triage prompt and a masking prompt that contained sample identifiers.

Use the dedicated runbook here: [Customer Self-Service Phase 2 Support Triage UAT](../testing/customer-self-service-phase2-triage-uat.md)

Use the proof doc here: [Phase 2 Agentforce Support Triage Proof](../testing/phase2-agentforce-support-triage-proof.md)

## OTP Restore Status

The current published planner bundle is no longer in temporary manual-testing mode.

- OTP verification is restored.
- Deploy job `0Afg5000007gZgZCAU` restored verification-first planner and genAiFunction metadata on 8 May 2026.
- A traced preview run confirmed `WF_EMAIL_SENT` to `mohitchaudhary27.08.03+agentforce@gmail.com` and post-code account summary for `Hytechpro University`.
- Do not run additional automated OTP sends unless needed, because the Developer Edition external email quota is only 15 single emails per day.

Historical no-OTP validation from 7 May 2026 remains useful as Track A evidence:

- Direct account summary by customer email succeeded without OTP during temporary mode.
- Service request creation succeeded and created cases `00001028` and `00001029` during manual testing.
- Escalation of manually tested cases succeeded and private `CaseComment` handoff records persisted in Salesforce.
- Attachment handling stayed within the boundary and refused image analysis.
- Spanish intake responded safely in Spanish. After a follow-up routing cue deploy, the same Spanish prompt returned clear issue-reporting behavior in preview, so a Testing Center topic-selection assertion is now optional confirmation only.

If verification-first behavior must be restored again after future manual testing:

1. Restore the verification-first planner bundle and genAiFunction input metadata from source control.
2. Redeploy with the supported lifecycle:

```bash
sf agent deactivate --api-name Customer_Self_Service_Agent --target-org AgentForce
sf project deploy start --target-org AgentForce \
  --metadata GenAiPlannerBundle:Customer_Self_Service_Agent \
  --metadata GenAiFunction:Get_Customer_Account_Summary \
  --metadata GenAiFunction:Create_Service_Request \
  --metadata GenAiFunction:Escalate_Service_Request
sf agent activate --api-name Customer_Self_Service_Agent --target-org AgentForce
```

3. Validate the re-enabled OTP flow in Agent Preview after the external email quota resets, using as few sends as possible.

## Agent User And Verification Comparison

This comparison was captured on 8 May 2026 without sending additional OTP emails.

| Agent                    | Runtime user                                                | Active | OTP verification topic in local planner bundle                                                                    | Relevant permission assignments                                                                                                                          | Notes                                                                                                                        |
| ------------------------ | ----------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Customer Self Service    | `customer_self_service_agent@00dg5000005qpun1460074599.ext` | Yes    | Yes, `Service Customer Verification` with `SvcCopilotTmpl__SendVerificationCode` and `SvcCopilotTmpl__VerifyCode` | `AgentforceServiceAgentUserPsg`, `Customer_Self_Service_Agent`, generated `Customer_Self_Service_Agent...Permissions`, and baseline agent permission set | The agent user exists and is active. It is not missing.                                                                      |
| Scheduling Agent         | `scheduling_agent@00dg5000005qpun1231020336.ext`            | Yes    | No built-in OTP topic found in the local `Scheduling_Agent` planner bundle                                        | `AgentforceServiceAgentUserPsg`, appointment creation permission set, generated scheduling permissions, and scheduling permission set                    | This agent asks for email for scheduling/address lookup, but local metadata does not show the same OTP verification pattern. |
| Agentforce Service Agent | `agentforce_service_agent@00dg5000005qpun977214756.ext`     | Yes    | Yes, standard `Service Customer Verification` template topic                                                      | No longer has the temporary Phase 1 health bridge permission set after the proof target was moved to Customer Self Service                               | Useful as a verification-template reference, not as the Phase 1 health proof target.                                         |

Key comparison findings:

- Customer Self Service has its own active Einstein Agent runtime user.
- Customer Self Service and Agentforce Service Agent both use the same built-in verification flows: `SvcCopilotTmpl__SendVerificationCode` and `SvcCopilotTmpl__VerifyCode`.
- Scheduling Agent is not the best OTP comparison point from local metadata because it does not include the built-in `Service Customer Verification` topic/action pair.
- The confirmed 7 May blocker was the Developer Edition `SingleEmail` limit, not the absence of a Customer Self Service agent user.
- The closest configuration improvement area is keeping Customer Self Service verification instructions aligned with the standard Service Agent template while preserving customer-safe delivery guidance.

## Salesforce Push Plan

Phase 0 deploy payload:

- `CustomerSelfServiceAccountSummary`
- `CustomerSelfServiceCreateRequest`
- `CustomerSelfServiceEscalateRequest`
- `CustomerSelfServiceActionsTest`
- `Get_Customer_Account_Summary`
- `Create_Service_Request`
- `Escalate_Service_Request`
- `Customer_Self_Service_Agent` permission set

Post-deployment Agentforce Builder steps:

1. Confirm `Customer_Self_Service_Agent` is assigned to the actual agent runtime user or customer-channel execution user, not only the default tester.
2. In Agentforce Builder, create or update a Customer Self-Service Agent.
3. Add a Customer Verification topic using the existing Service Customer Verification pattern.
4. Add an Account And Case Status topic and bind `Get_Customer_Account_Summary`.
5. Add an Issue Reporting topic and bind `Create_Service_Request`.
6. Add an Escalation And Handoff topic and bind `Escalate_Service_Request`.
7. Keep Billing, Outage, Appointments, Attachments, and RAG scoped to fallback or escalation until the data source is confirmed.
8. Activate the agent in a test surface first.
9. Retrieve the generated Agentforce planner bundle after the Builder configuration is stable.

### Updating An Active Agent

Salesforce blocks planner bundle updates while the agent is active. Use the supported CLI lifecycle instead of trying to edit Tooling API records directly.

```bash
sf agent deactivate --api-name Customer_Self_Service_Agent --target-org AgentForce
sf project deploy start --target-org AgentForce --metadata GenAiPlannerBundle:Customer_Self_Service_Agent
sf agent activate --api-name Customer_Self_Service_Agent --target-org AgentForce
```

After activation, validate the published runtime with Agent Preview:

```bash
SESSION_ID=$(sf agent preview start --api-name Customer_Self_Service_Agent --target-org AgentForce --json | jq -r '.result.sessionId')
sf agent preview send --session-id "$SESSION_ID" --utterance "Can you show me my account summary and open service requests?" --api-name Customer_Self_Service_Agent --target-org AgentForce
sf agent preview end --session-id "$SESSION_ID" --api-name Customer_Self_Service_Agent --target-org AgentForce
```

## Simple Builder Setup Guide

Use this section if you are new to Agentforce Builder and want the shortest path from deployed metadata to a real test.

### What is already done from the local machine

- The three Phase 0 actions are already deployed in Salesforce.
- The `Customer_Self_Service_Agent` permission set is already assigned to the connected test user.
- There is already usable test data in the org:
  - Account: `Hytechpro University`
  - Contact: `Mohit Chaudhary`
  - Open Case: `00001026`

### What still must be done in Salesforce UI

- Topic binding in Agentforce Builder
- Agent activation in a test surface

This remaining step is best done in Builder first because Salesforce stores topic and action bindings with generated planner identifiers. After the Builder setup is stable, retrieve that planner bundle back into source control.

### Click-by-click path

1. Log in to Salesforce with the same user that already has the `Customer_Self_Service_Agent` permission set.
2. Open the App Launcher.
3. Search for `Agentforce`, `Agents`, or `Agentforce Builder`.
4. Open the existing service agent if you want the fastest path and already have customer verification there. If you want a cleaner setup, create a new agent called `Customer Self-Service Agent`.
5. Open the Topics area inside the agent.
6. Confirm there is a customer verification topic. If you already have `Service Customer Verification`, keep it and reuse it.
7. Add a new topic called `Account And Case Status`.
8. In that topic, add the action `Get_Customer_Account_Summary`.
9. Add a new topic called `Issue Reporting`.
10. In that topic, add the action `Create_Service_Request`.
11. Add a new topic called `Escalation And Handoff`.
12. In that topic, add the action `Escalate_Service_Request`.
13. In every topic that reads or writes customer-specific data, add an instruction that the user must be verified before the action runs.
14. Save the agent.
15. Activate the agent in a test surface such as Agentforce preview, the customer web client test surface, or Messaging test if that surface is already enabled in your org.

### What to type in each topic

Use short, direct instructions. Do not try to write a long prompt.

`Account And Case Status` topic instructions:

1. Use this topic when the customer asks for account details, open requests, or service status already stored on their account.
2. Do not show account or case details until the customer is verified.
3. Use `Get_Customer_Account_Summary` after verification.

`Issue Reporting` topic instructions:

1. Use this topic when the customer reports a service issue or asks to create a request.
2. Confirm the issue description and contact preference if missing.
3. Do not create a request until the customer is verified.
4. Use `Create_Service_Request`.

`Escalation And Handoff` topic instructions:

1. Use this topic when the customer asks for a supervisor, billing adjustment, urgent review, or human support.
2. Do not promise refunds, credits, appointments, or outages that are not backed by data.
3. Use `Escalate_Service_Request` after verification.

### First live test

After activation, run these in order:

1. `Can you show me what services and open requests are on my account?`
2. Complete the verification flow.
3. `I have verified my identity. Please show me my account summary and any open service requests.`
4. `My water pressure has been very low since this morning. Please create a service request. The issue is high priority and email is the best way to reach me.`
5. `This bill is wrong and I want the charge removed.`

### What success looks like

1. The agent asks for verification before showing account data.
2. The account summary response matches the `Hytechpro University` account and existing open Case `00001026`.
3. A new Case is created after the service request prompt.
4. The escalation prompt updates the Case priority and creates a private Case comment for handoff context.

## Agent Test Prompts

Use these after the deployment is complete and the Agentforce Builder topic/action bindings are active.

### Preconditions

- A test `Account` exists with a related `Contact`.
- The test user can verify as that customer through the selected identity flow.
- At least one open `Case` exists for the Account if testing account summary with existing requests.
- The agent has access to the three Phase 0 actions.

### Verification UX And OTP Operations

Use these rules for both preview testing and production-ready customer guidance.

#### Customer-facing behavior

- After the customer provides an email address or username, the agent should say that a verification code has been sent if the identifier is valid and ask the customer to enter the code.
- The agent should never confirm whether the email address or username exists in Salesforce.
- The agent should tell the customer to check inbox and spam or junk folders.
- The agent should tell the customer to wait about 1 to 2 minutes before assuming the code did not arrive.
- If the customer still has not received the code after that wait, the agent should offer to resend it.
- If the customer enters the wrong code three times, the agent should restart verification by asking for the email address or username again and sending a new code.

#### Operational behavior observed in this org

- The built-in `Service Customer Verification` flow resolves a matching Salesforce `User` before a matching `Contact` when both share the same email address.
- For customer self-service OTP testing, use a `Contact` email address that does not collide with any Salesforce `User` email or username unless you intentionally want login-user verification.
- Resending the code creates a newer valid code. Testers should always use the newest code and ignore older OTP emails.
- OTP emails from this org can arrive in spam or junk even when Salesforce reports successful send.
- Earlier direct Salesforce email tests and verification-flow runs showed successful send events in debug logs for this org, which proves the Agentforce OTP path can work when org email limits are available.
- Manual Flow/API sends and Agentforce Preview sends must be compared by timestamp, recipient, and execution user. In this org, a manual `SvcCopilotTmpl__SendVerificationCode` call succeeded at 06:40 UTC for `keshavchaudhary131@gmail.com`, while a later Agentforce runtime send failed at 08:03 UTC for `mohitchaudhary27.08.03+agentforce@gmail.com` after the `SingleEmail` quota was exhausted.
- This Developer Edition org can hit the external `SingleEmail` quota. On 2026-05-07, `/services/data/v66.0/limits` showed `SingleEmail` `Max: 15` and `Remaining: -1`; the verification flow generated an OTP but logged that Salesforce could not send because the org can send only 15 single emails per day to external email addresses. The quota resets at midnight GMT.
- Email administration settings retrieved from the org showed SPF compliance enabled, bounced-email handling enabled, TLS-to-domain restriction disabled, DKIM domain verification disabled, and HTML email disabled. There were no configured `EmailRelay` records and no `EmailDomainFilter` records.
- The org has a verified org-wide email address `mohitchaudhary27.08.03@gmail.com` labeled `University Email`. It is profile-restricted (`IsAllowAllProfiles=false`), but the OTP flow uses the standard email action and the runtime log showed the external-email quota as the active blocker.
- Use `mohitchaudhary27.08.03+agentforce@gmail.com` as the current non-colliding Contact test identity. The base address `mohitchaudhary27.08.03@gmail.com` exists on both a Salesforce `User` and a `Contact`, so it is not a clean customer OTP test identity.
- Follow-up mailbox debugging on 8 May 2026 showed Salesforce was no longer blocked by quota: `SingleEmail` had dropped to `Remaining=8`, meaning several external sends were consumed. Recent runtime logs included `WF_EMAIL_SENT` to `mohitchaudhary27.08.03+agentforce@gmail.com`, `keshavchaudhary131@gmail.com`, and `keshav.chaudhary@hytectpro.com`.
- The `keshavchaudhary131@gmail.com` attempt resolved to Contact `003g500000FXl7ZAAT`; the `keshav.chaudhary@hytectpro.com` attempt resolved to User `005g5000006PiUlAAK`. If the tester expects a Gmail inbox but the verification flow resolves a Salesforce `User`, the OTP can be sent to the User record's email instead of the customer Contact email.
- Making a tested Salesforce `User` a System Administrator does not fix mailbox receipt. Once the runtime log has `WF_EMAIL_SENT` and the external email limit decreases, the next checks are recipient spam/quarantine, Email Log Files in Salesforce Setup, sender authentication such as DKIM/SPF, and whether the identifier resolved to the intended Contact or a User.

#### Dev and admin fallback for testing

- If email delivery is slow or filtered, an admin can read the newest OTP from the debug log for the `SvcCopilotTmpl__SendVerificationCode` flow.
- This debug-log fallback is only for internal testing and should not be part of a production support process.
- The latest debug log will show the generated code near the `GenerateVerificationCode` flow action.
- When debugging Agentforce preview, trace both the connected admin user and the active Einstein Agent runtime user. In this org, the Customer Self Service runtime user is `customer_self_service_agent@00dg5000005qpun1460074599.ext` with profile `Einstein Agent User`.
- If the flow log contains `WF_EMAIL_SENT|An email wasn't sent because this limit was reached`, the OTP may still be generated in the log but no customer email was sent.

Admin-only OTP retrieval pattern:

```bash
TOKEN=$(sf org display --target-org AgentForce --json | jq -r '.result.accessToken')
URL=$(sf org display --target-org AgentForce --json | jq -r '.result.instanceUrl')
LOG_ID=$(curl -sS --get "$URL/services/data/v66.0/tooling/query/" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=SELECT Id FROM ApexLog WHERE Operation LIKE '/services/data/v66.0/support/functions/%' OR Operation='/services/data/v66.0/actions/custom/flow/SvcCopilotTmpl__SendVerificationCode' ORDER BY StartTime DESC LIMIT 1" \
  | jq -r '.records[0].Id')
curl -sS "$URL/services/data/v66.0/tooling/sobjects/ApexLog/$LOG_ID/Body" \
  -H "Authorization: Bearer $TOKEN" \
  | grep -E 'GenerateVerificationCode|verificationCode|WF_EMAIL_SENT|customerId|customerType'
```

If no fresh log appears, enable a short trace flag for the connected admin and the Einstein Agent runtime user, then resend from a new preview session:

```bash
START=$(date -u +"%Y-%m-%dT%H:%M:%S.000+0000")
EXP=$(date -u -v+30M +"%Y-%m-%dT%H:%M:%S.000+0000")
sf data create record -t --sobject TraceFlag \
  --values "TracedEntityId='005g5000006Ppa9AAC' DebugLevelId='7dlg5000001BoSLAA0' LogType='USER_DEBUG' StartDate='$START' ExpirationDate='$EXP'" \
  --target-org AgentForce
```

Email-limit check:

```bash
TOKEN=$(sf org display --target-org AgentForce --json | jq -r '.result.accessToken')
URL=$(sf org display --target-org AgentForce --json | jq -r '.result.instanceUrl')
curl -sS "$URL/services/data/v66.0/limits" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{SingleEmail, DailyWorkflowEmails, DailyServiceEmailAgentforceCalls}'
```

#### Recommended support wording

- `I sent a verification code. Please check your inbox and spam folder. It can take 1 to 2 minutes to arrive.`
- `If you do not receive the code, let me know and I can resend it.`
- `For security, please use the newest verification code only. Older codes stop working after a resend.`
- `After three incorrect attempts, I will restart the verification process and send a new code.`

### Prompt 1: Verification Gate

```text
Can you show me what services and open requests are on my account?
```

Expected result: the agent asks for verification first and does not reveal account data.

### Prompt 2: Account And Case Summary

```text
I have verified my identity. Please show me my account summary and any open service requests.
```

Expected result: the agent invokes `Get_Customer_Account_Summary` and summarizes live Account and open Case data from Salesforce.

### Prompt 3: Service Request Creation

```text
My water pressure has been very low since this morning. Please create a service request. The issue is high priority and email is the best way to reach me.
```

Expected result: the agent confirms required details, invokes `Create_Service_Request`, and returns the new Case number/status.

### Prompt 4: Billing Escalation

```text
This bill is wrong and I want the charge removed.
```

Expected result: the agent does not promise a refund, credit, or adjustment. It creates or identifies a Case and invokes `Escalate_Service_Request` for human billing review.

### Prompt 5: Spanish Intake

```text
Necesito ayuda. No tengo servicio desde esta manana.
```

Expected result: the agent captures Spanish language context, creates a service request or escalates if service status is not authoritative, and does not invent outage data.

### Prompt 6: Attachment Boundary

```text
I have a photo of the damaged equipment. Can you inspect it and tell me what is wrong?
```

Expected result: the agent does not analyze the photo in Phase 0. It creates or escalates a Case and explains that document/photo handling requires approved upload and review handling.

### Prompt 7: Appointment Boundary

```text
Can you schedule someone to come out this Friday afternoon?
```

Expected result: until scheduling is wired, the agent collects preferred timing and creates or escalates a Case. It must not invent an appointment slot.

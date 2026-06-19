/**
 * Node 6 — Phase 6b+ Salesforce → NestJS approval callback.
 *
 * Invoked by the record-triggered Flow `Agentforce_Guardrail_Approval_Callback`
 * when an approver approves/rejects a Case in the native Salesforce Approval
 * UI (the Approval Process's final actions set `AI_Guardrail_Status__c`). This
 * invocable reads the workflow id + resume token off the Case and POSTs the
 * decision to the NestJS resume callback so the paused LangGraph workflow
 * resumes.
 *
 * Mirrors {@link AgentforceCaseTriageOrchestratorTrigger}: the callout runs in
 * a Queueable (off the trigger/Flow transaction) and is fire-and-forget — a
 * non-2xx or transport failure is logged, never thrown, because the NestJS
 * endpoint is idempotent (it keys on the token `jti`) and the operator can
 * always resume manually.
 *
 * The decision comes from the Case status field, constrained to the
 * approver-submittable set — `escalated` is a policy outcome, never an
 * approver decision, and is dropped here (R6).
 */
public with sharing class AgentforceGuardrailApprovalCallback {
  @TestVisible
  private static final String CALLBACK_BASE = 'callout:Agentforce_AI_API_Phase2/orchestrator/case-triage/';
  private static final Integer TIMEOUT_MS = 20000;
  private static final Set<String> ALLOWED_DECISIONS = new Set<String>{
    'approved',
    'rejected'
  };

  @InvocableMethod(
    label='Resume AI Workflow After Guardrail Approval'
    description='Calls the NestJS orchestrator to resume a paused case-triage workflow after a Salesforce approval/rejection. Fire-and-forget, idempotent.'
  )
  public static List<CallbackResult> dispatch(List<CallbackRequest> requests) {
    List<CallbackResult> results = new List<CallbackResult>();
    if (requests == null || requests.isEmpty()) {
      return results;
    }

    Set<Id> caseIds = new Set<Id>();
    for (CallbackRequest input : requests) {
      if (input != null && String.isNotBlank(input.caseId)) {
        try {
          caseIds.add((Id) input.caseId);
        } catch (Exception ignored) {
          // skip malformed id
        }
      }
    }

    List<CalloutPayload> payloads = new List<CalloutPayload>();
    if (!caseIds.isEmpty()) {
      for (Case caseRow : [
        SELECT
          Id,
          AI_Guardrail_Status__c,
          AI_Triage_Workflow_Id__c,
          AI_Guardrail_Resume_Token__c
        FROM Case
        WHERE Id IN :caseIds
      ]) {
        CalloutPayload payload = buildPayload(caseRow);
        if (payload != null) {
          payloads.add(payload);
        }
      }
    }

    if (!payloads.isEmpty()) {
      if (!System.isBatch() && !System.isFuture()) {
        System.enqueueJob(new CallbackJob(payloads));
      } else {
        dispatchCallouts(payloads);
      }
    }

    for (Integer i = 0; i < requests.size(); i++) {
      CallbackResult result = new CallbackResult();
      result.enqueued = !payloads.isEmpty();
      results.add(result);
    }
    return results;
  }

  private static CalloutPayload buildPayload(Case caseRow) {
    String decision = caseRow.AI_Guardrail_Status__c;
    if (
      String.isBlank(decision) ||
      !ALLOWED_DECISIONS.contains(decision) ||
      String.isBlank(caseRow.AI_Triage_Workflow_Id__c) ||
      String.isBlank(caseRow.AI_Guardrail_Resume_Token__c)
    ) {
      return null;
    }
    CalloutPayload payload = new CalloutPayload();
    payload.workflowId = caseRow.AI_Triage_Workflow_Id__c;
    payload.decision = decision;
    payload.token = caseRow.AI_Guardrail_Resume_Token__c;
    return payload;
  }

  @TestVisible
  private static void dispatchCallouts(List<CalloutPayload> payloads) {
    for (CalloutPayload payload : payloads) {
      postOne(payload);
    }
  }

  private static void postOne(CalloutPayload payload) {
    HttpRequest request = new HttpRequest();
    request.setEndpoint(
      CALLBACK_BASE +
        EncodingUtil.urlEncode(payload.workflowId, 'UTF-8') +
        '/sf-approval-callback'
    );
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'guardrail-approval-callback');
    // Body carries the decision + token only — never Case text or PII.
    Map<String, String> body = new Map<String, String>{
      'decision' => payload.decision,
      'token' => payload.token
    };
    request.setBody(JSON.serialize(body));

    try {
      HttpResponse response = new Http().send(request);
      Integer code = response.getStatusCode();
      if (code < 200 || code > 299) {
        System.debug(
          LoggingLevel.WARN,
          'Guardrail approval callback non-2xx for workflow ' +
            payload.workflowId +
            ' status=' +
            code
        );
      }
    } catch (Exception calloutError) {
      System.debug(
        LoggingLevel.WARN,
        'Guardrail approval callback failed for workflow ' +
          payload.workflowId +
          ': ' +
          calloutError.getTypeName()
      );
    }
  }

  /** Queueable callout worker — one HTTP POST per Case, off the Flow txn. */
  public class CallbackJob implements Queueable, Database.AllowsCallouts {
    private final List<CalloutPayload> payloads;

    public CallbackJob(List<CalloutPayload> payloads) {
      this.payloads = payloads;
    }

    public void execute(QueueableContext context) {
      AgentforceGuardrailApprovalCallback.dispatchCallouts(payloads);
    }
  }

  /** Flow-facing input. */
  public class CallbackRequest {
    @InvocableVariable(label='Case Id' required=true)
    public String caseId;
  }

  /** Flow-facing result. */
  public class CallbackResult {
    @InvocableVariable(label='Enqueued')
    public Boolean enqueued;
  }

  /** Internal callout payload (never includes Case text). */
  public class CalloutPayload {
    public String workflowId;
    public String decision;
    public String token;
  }
}

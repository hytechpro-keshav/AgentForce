/**
 * Async, fire-and-forget handoff from a Case record-triggered Flow to
 * the NestJS orchestrator's Node 1 trigger endpoint.
 *
 * The invocable returns immediately after enqueuing a Queueable; the
 * Flow never waits for the callout (let alone for model work). The
 * orchestrator reads the real Case context and writes back later, so
 * this payload carries identifiers only — never Case text.
 */
public with sharing class AgentforceCaseTriageOrchestratorTrigger {
  @TestVisible
  private static final String TRIGGER_ENDPOINT = 'callout:Agentforce_AI_API_Phase2/orchestrator/case-triage/triggers';
  private static final Integer TIMEOUT_MS = 20000;
  private static final Pattern CASE_ID_PATTERN = Pattern.compile(
    '[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18}'
  );

  @InvocableMethod(
    label='Hand off Case to AI Triage Orchestrator'
    description='Fire-and-forget: enqueues an async callout to the NestJS Node 1 case-triage orchestrator. Returns immediately.'
  )
  public static List<HandoffResult> enqueueTriage(
    List<TriggerRequest> requests
  ) {
    List<HandoffResult> results = new List<HandoffResult>();
    List<TriagePayload> payloads = new List<TriagePayload>();

    if (requests == null || requests.isEmpty()) {
      return results;
    }

    for (TriggerRequest input : requests) {
      HandoffResult result = new HandoffResult();
      if (
        input == null ||
        String.isBlank(input.caseId) ||
        !isValidCaseId(input.caseId)
      ) {
        result.enqueued = false;
        result.safeMessage = 'A valid Case Id is required to start AI triage.';
        results.add(result);
        continue;
      }
      payloads.add(buildPayload(input));
      result.enqueued = true;
      result.safeMessage = 'Case handed off to AI triage orchestrator.';
      results.add(result);
    }

    if (!payloads.isEmpty() && !System.isBatch() && !System.isFuture()) {
      System.enqueueJob(new TriageHandoffJob(payloads));
    } else if (!payloads.isEmpty()) {
      // Already in an async context that cannot chain a Queueable
      // safely; perform the callouts inline (still off the Flow's
      // synchronous path).
      dispatch(payloads);
    }
    return results;
  }

  private static Boolean isValidCaseId(String caseId) {
    return CASE_ID_PATTERN.matcher(caseId.trim()).matches();
  }

  private static TriagePayload buildPayload(TriggerRequest input) {
    TriagePayload payload = new TriagePayload();
    payload.caseId = input.caseId.trim();
    if (String.isNotBlank(input.caseNumber)) {
      payload.caseNumber = input.caseNumber.trim();
    }
    payload.correlationId = String.isNotBlank(input.correlationId)
      ? sanitizeCorrelationId(input.correlationId.trim())
      : ('sf-triage-' + payload.caseId);
    return payload;
  }

  private static String sanitizeCorrelationId(String raw) {
    if (Pattern.matches('[A-Za-z0-9_.:-]{1,64}', raw)) {
      return raw;
    }
    return 'sf-triage-' + String.valueOf(Datetime.now().getTime());
  }

  private static void dispatch(List<TriagePayload> payloads) {
    for (TriagePayload payload : payloads) {
      postOne(payload);
    }
  }

  private static void postOne(TriagePayload payload) {
    HttpRequest request = new HttpRequest();
    request.setEndpoint(TRIGGER_ENDPOINT);
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'orchestrator-case-triage');
    request.setBody(JSON.serialize(payload));

    try {
      HttpResponse response = new Http().send(request);
      Integer code = response.getStatusCode();
      if (code < 200 || code > 299) {
        System.debug(
          LoggingLevel.WARN,
          'AI triage handoff non-2xx for case ' +
            payload.caseId +
            ' status=' +
            code
        );
      }
    } catch (Exception handoffException) {
      System.debug(
        LoggingLevel.WARN,
        'AI triage handoff failed for case ' +
          payload.caseId +
          ': ' +
          handoffException.getTypeName()
      );
    }
  }

  /**
   * Queueable callout worker. One HTTP POST per Case, off the Flow's
   * synchronous transaction.
   */
  public class TriageHandoffJob implements Queueable, Database.AllowsCallouts {
    private final List<TriagePayload> payloads;

    public TriageHandoffJob(List<TriagePayload> payloads) {
      this.payloads = payloads;
    }

    public void execute(QueueableContext context) {
      AgentforceCaseTriageOrchestratorTrigger.dispatch(payloads);
    }
  }

  /** Flow-facing input. */
  public class TriggerRequest {
    @InvocableVariable(label='Case Id' required=true)
    public String caseId;

    @InvocableVariable(label='Case Number')
    public String caseNumber;

    @InvocableVariable(label='Correlation Id')
    public String correlationId;
  }

  /** Flow-facing result. */
  public class HandoffResult {
    @InvocableVariable(label='Enqueued')
    public Boolean enqueued;

    @InvocableVariable(label='Safe Message')
    public String safeMessage;
  }

  /** Serialized request body matching the orchestrator trigger DTO. */
  public class TriagePayload {
    public String caseId;
    public String caseNumber;
    public String correlationId;
  }
}

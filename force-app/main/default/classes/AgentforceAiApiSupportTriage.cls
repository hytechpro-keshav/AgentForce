public with sharing class AgentforceAiApiSupportTriage {
  private static final String TRIAGE_ENDPOINT = 'callout:Agentforce_AI_API_Phase2/agent/support/triage-case';
  private static final String SAFE_ENDPOINT = '/agent/support/triage-case';
  private static final Integer TIMEOUT_MS = 20000;
  private static final Set<String> VALID_PRIORITIES = new Set<String>{
    'low',
    'normal',
    'high',
    'critical'
  };

  @InvocableMethod(
    label='Triage Support Case with AI API'
    description='Calls the NestJS AI API support triage endpoint through the Agentforce_AI_API Named Credential and returns a safe structured triage recommendation.'
  )
  public static List<TriageResponse> triageCases(List<TriageRequest> requests) {
    List<TriageResponse> responses = new List<TriageResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    for (Integer index = 0; index < requests.size(); index++) {
      responses.add(triageOne(requests[index], index));
    }
    return responses;
  }

  private static TriageResponse triageOne(
    TriageRequest input,
    Integer requestIndex
  ) {
    TriageResponse response = baseResponse(input, requestIndex);
    if (
      input == null ||
      String.isBlank(input.subject) ||
      String.isBlank(input.description)
    ) {
      response.triageStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'I need a support subject and issue description before running AI triage.';
      return response;
    }

    HttpRequest request = new HttpRequest();
    request.setEndpoint(TRIAGE_ENDPOINT);
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'phase-2-support-triage');
    request.setBody(JSON.serialize(buildPayload(input, response.requestId)));

    try {
      HttpResponse httpResponse = new Http().send(request);
      response.httpStatusCode = httpResponse.getStatusCode();

      if (
        httpResponse.getStatusCode() == 401 ||
        httpResponse.getStatusCode() == 403
      ) {
        response.triageStatus = 'AUTH_ERROR';
        response.safeMessage = 'The AI API support triage credentials were rejected.';
        return response;
      }

      if (
        httpResponse.getStatusCode() < 200 ||
        httpResponse.getStatusCode() > 299
      ) {
        response.triageStatus = 'BACKEND_ERROR';
        response.safeMessage = 'The AI API support triage endpoint returned an error.';
        return response;
      }

      return parseTriageResponse(httpResponse.getBody(), response);
    } catch (CalloutException calloutException) {
      response.triageStatus = 'CALLOUT_FAILED';
      response.safeMessage = 'The AI API support triage endpoint could not be reached.';
      return response;
    } catch (Exception unexpectedException) {
      response.triageStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'AI support triage could not be completed safely.';
      return response;
    }
  }

  private static Map<String, Object> buildPayload(
    TriageRequest input,
    String requestId
  ) {
    Map<String, Object> payload = new Map<String, Object>();
    payload.put('subject', maskSensitiveText(input.subject.trim()));
    payload.put('description', maskSensitiveText(input.description.trim()));
    payload.put('requestId', requestId);
    String priority = normalizePriority(input.reportedPriority);
    if (priority != null) {
      payload.put('reportedPriority', priority);
    }
    return payload;
  }

  private static TriageResponse parseTriageResponse(
    String body,
    TriageResponse response
  ) {
    try {
      Map<String, Object> payload = asMap(JSON.deserializeUntyped(body));
      String priority = normalizePriority(
        getString(payload, 'recommendedPriority')
      );
      String summary = getString(payload, 'summary');
      String nextStep = getString(payload, 'suggestedNextStep');
      String provider = getString(payload, 'provider');
      String model = getString(payload, 'model');

      if (
        priority == null ||
        String.isBlank(summary) ||
        String.isBlank(nextStep) ||
        String.isBlank(provider) ||
        String.isBlank(model)
      ) {
        response.triageStatus = 'MALFORMED_RESPONSE';
        response.safeMessage = 'The AI API support triage endpoint returned an unexpected response.';
        return response;
      }

      response.triageStatus = 'TRIAGED';
      response.safeMessage = 'AI support triage completed.';
      response.recommendedPriority = priority;
      response.summary = limitText(summary, 160);
      response.suggestedNextStep = limitText(nextStep, 160);
      response.provider = provider;
      response.model = model;
      response.fallbackUsed = getBoolean(payload, 'fallbackUsed');
      response.latencyMs = getInteger(payload, 'latencyMs');
      return response;
    } catch (Exception parseException) {
      response.triageStatus = 'MALFORMED_RESPONSE';
      response.safeMessage = 'The AI API support triage endpoint returned an unreadable response.';
      return response;
    }
  }

  private static TriageResponse baseResponse(
    TriageRequest input,
    Integer requestIndex
  ) {
    TriageResponse response = new TriageResponse();
    response.triageStatus = 'NOT_TRIAGED';
    response.safeMessage = 'AI support triage has not completed.';
    response.endpoint = SAFE_ENDPOINT;
    response.requestId = buildRequestId(input, requestIndex);
    response.triagedAt = Datetime.now()
      .formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
    return response;
  }

  private static String buildRequestId(TriageRequest input, Integer index) {
    if (input != null && String.isNotBlank(input.requestId)) {
      String providedRequestId = input.requestId.trim();
      if (Pattern.matches('[A-Za-z0-9_.:-]{1,64}', providedRequestId)) {
        return providedRequestId;
      }
    }
    return 'sf-triage-' +
      String.valueOf(Datetime.now().getTime()) +
      '-' +
      String.valueOf(index);
  }

  private static String normalizePriority(String priority) {
    if (String.isBlank(priority)) {
      return null;
    }
    String normalized = priority.trim().toLowerCase();
    if (normalized == 'medium') {
      normalized = 'normal';
    }
    if (!VALID_PRIORITIES.contains(normalized)) {
      return null;
    }
    return normalized;
  }

  private static Map<String, Object> asMap(Object value) {
    if (value == null) {
      return new Map<String, Object>();
    }
    try {
      return (Map<String, Object>) value;
    } catch (Exception mapException) {
      return new Map<String, Object>();
    }
  }

  private static String getString(Map<String, Object> source, String key) {
    if (source == null || !source.containsKey(key) || source.get(key) == null) {
      return null;
    }
    return String.valueOf(source.get(key));
  }

  private static Boolean getBoolean(Map<String, Object> source, String key) {
    if (source == null || !source.containsKey(key) || source.get(key) == null) {
      return false;
    }
    Object value = source.get(key);
    if (value instanceof Boolean) {
      return (Boolean) value;
    }
    return String.valueOf(value).toLowerCase() == 'true';
  }

  private static Integer getInteger(Map<String, Object> source, String key) {
    if (source == null || !source.containsKey(key) || source.get(key) == null) {
      return null;
    }
    try {
      return Integer.valueOf(String.valueOf(source.get(key)));
    } catch (Exception parseException) {
      return null;
    }
  }

  private static String limitText(String value, Integer maxLength) {
    if (String.isBlank(value) || value.length() <= maxLength) {
      return value;
    }
    return value.substring(0, maxLength);
  }

  private static String maskSensitiveText(String value) {
    if (String.isBlank(value)) {
      return value;
    }
    String masked = value;
    masked = masked.replaceAll(
      '(?i)[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}',
      '[redacted-email]'
    );
    masked = masked.replaceAll(
      '\\b(?:\\d[ -]?){13,19}\\b',
      '[redacted-payment]'
    );
    masked = masked.replaceAll('\\b\\d{3}-\\d{2}-\\d{4}\\b', '[redacted-ssn]');
    masked = masked.replaceAll(
      '(?i)\\b\\d{1,6}\\s+[A-Z0-9.\'\\-]+(?:\\s+[A-Z0-9.\'\\-]+){0,5}\\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|circle|cir|way|place|pl)\\b(?:[.,]?\\s*(?:apt|apartment|unit|suite|ste|#)\\s*[A-Z0-9-]+)?',
      '[redacted-address]'
    );
    masked = masked.replaceAll(
      '\\b(?:\\+?1[-.\\s]?)?(?:\\(?\\d{3}\\)?[-.\\s]?){2}\\d{4}\\b',
      '[redacted-phone]'
    );
    masked = masked.replaceAll(
      '(?i)\\b(?:account|customer|contact|case|order|invoice|policy|subscription|member)\\s*(?:id|number|no|#|:|-)\\s*[A-Z0-9][A-Z0-9_.-]{4,}\\b',
      '[redacted-identifier]'
    );
    masked = masked.replaceAll(
      '(?i)\\b[A-Z0-9]{15}(?:[A-Z0-9]{3})?\\b',
      '[redacted-salesforce-id]'
    );
    masked = masked.replaceAll('\\b\\d{6,}\\b', '[redacted-number]');
    masked = masked.replaceAll(
      '\\b((?:(?:my|My|customer|Customer|contact|Contact|caller|Caller|account holder|Account holder|policyholder|Policyholder)\\s+name\\s*(?:is|:)?|(?:name|Name)\\s*:)\\s+)[A-Z][A-Za-z\'\\-]+(?:\\s+[A-Z][A-Za-z\'\\-]+){0,2}\\b',
      '$1[redacted-name]'
    );
    masked = masked.replaceAll(
      '\\b((?:for|For|from|From|by|By|customer|Customer|contact|Contact|caller|Caller)\\s+)[A-Z][A-Za-z\'\\-]+(?:\\s+[A-Z][A-Za-z\'\\-]+){1,2}\\b',
      '$1[redacted-name]'
    );
    return masked;
  }

  public class TriageRequest {
    @InvocableVariable(
      label='Subject'
      description='Short issue subject for AI support triage. Common identifiers are masked before callout.'
    )
    public String subject;

    @InvocableVariable(
      label='Description'
      description='Issue description to triage through the AI API. Common identifiers are masked before callout.'
    )
    public String description;

    @InvocableVariable(
      label='Reported Priority'
      description='Optional customer-reported priority: low, normal, high, or critical.'
    )
    public String reportedPriority;

    @InvocableVariable(
      label='Request Id'
      description='Optional safe correlation id for backend telemetry.'
    )
    public String requestId;
  }

  public class TriageResponse {
    @InvocableVariable(
      label='Triage Status'
      description='TRIAGED, VALIDATION_ERROR, AUTH_ERROR, BACKEND_ERROR, CALLOUT_FAILED, MALFORMED_RESPONSE, UNEXPECTED_ERROR, or NOT_TRIAGED.'
    )
    public String triageStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Customer-safe message that Agentforce can display.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Recommended Priority'
      description='AI API recommended support priority: low, normal, high, or critical.'
    )
    public String recommendedPriority;

    @InvocableVariable(
      label='Summary'
      description='Short safe summary returned by the AI API support triage endpoint.'
    )
    public String summary;

    @InvocableVariable(
      label='Suggested Next Step'
      description='Short safe next step returned by the AI API support triage endpoint.'
    )
    public String suggestedNextStep;

    @InvocableVariable(
      label='Provider'
      description='LLM provider used by the AI API ModelRouter.'
    )
    public String provider;

    @InvocableVariable(
      label='Model'
      description='LLM model used by the AI API ModelRouter.'
    )
    public String model;

    @InvocableVariable(
      label='Fallback Used'
      description='True when the AI API ModelRouter used a fallback provider.'
    )
    public Boolean fallbackUsed;

    @InvocableVariable(
      label='Latency Ms'
      description='AI API provider call latency in milliseconds.'
    )
    public Integer latencyMs;

    @InvocableVariable(
      label='HTTP Status Code'
      description='HTTP status code returned by the AI API support triage endpoint.'
    )
    public Integer httpStatusCode;

    @InvocableVariable(
      label='Endpoint'
      description='AI API endpoint called by Apex.'
    )
    public String endpoint;

    @InvocableVariable(
      label='Request Id'
      description='Safe correlation id sent to backend telemetry.'
    )
    public String requestId;

    @InvocableVariable(
      label='Triaged At'
      description='Timestamp when Apex ran support triage.'
    )
    public String triagedAt;
  }
}

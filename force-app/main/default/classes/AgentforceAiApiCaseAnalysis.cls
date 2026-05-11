public with sharing class AgentforceAiApiCaseAnalysis {
  private static final String ANALYZE_ENDPOINT = 'callout:Agentforce_AI_API_Phase2/agent/support/analyze-case';
  private static final String SAFE_ENDPOINT = '/agent/support/analyze-case';
  private static final Integer TIMEOUT_MS = 20000;
  private static final Set<String> VALID_PRIORITIES = new Set<String>{
    'low',
    'normal',
    'high',
    'critical'
  };
  private static final Set<String> VALID_CATEGORIES = new Set<String>{
    'billing',
    'outage',
    'technical',
    'account',
    'other'
  };
  private static final Set<String> VALID_CONFIDENCES = new Set<String>{
    'low',
    'medium',
    'high'
  };

  @InvocableMethod(
    label='Analyze Support Case with AI API'
    description='Calls the NestJS AI API case-analysis endpoint through the Agentforce_AI_API_Phase2 Named Credential and returns a safe structured Phase 3 Support Operations case analysis.'
  )
  public static List<AnalysisResponse> analyzeCases(
    List<AnalysisRequest> requests
  ) {
    List<AnalysisResponse> responses = new List<AnalysisResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    for (Integer index = 0; index < requests.size(); index++) {
      responses.add(analyzeOne(requests[index], index));
    }
    return responses;
  }

  private static AnalysisResponse analyzeOne(
    AnalysisRequest input,
    Integer requestIndex
  ) {
    AnalysisResponse response = baseResponse(input, requestIndex);
    if (
      input == null ||
      String.isBlank(input.caseSubject) ||
      String.isBlank(input.caseDescription)
    ) {
      response.analysisStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'I need a Case subject and description before running AI case analysis.';
      return response;
    }

    HttpRequest request = new HttpRequest();
    request.setEndpoint(ANALYZE_ENDPOINT);
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'phase-3-case-analysis');
    request.setBody(JSON.serialize(buildPayload(input, response.requestId)));

    try {
      HttpResponse httpResponse = new Http().send(request);
      response.httpStatusCode = httpResponse.getStatusCode();

      if (
        httpResponse.getStatusCode() == 401 ||
        httpResponse.getStatusCode() == 403
      ) {
        response.analysisStatus = 'AUTH_ERROR';
        response.safeMessage = 'The AI API case-analysis credentials were rejected.';
        return response;
      }

      if (
        httpResponse.getStatusCode() < 200 ||
        httpResponse.getStatusCode() > 299
      ) {
        response.analysisStatus = 'BACKEND_ERROR';
        response.safeMessage = 'The AI API case-analysis endpoint returned an error.';
        return response;
      }

      return parseAnalysisResponse(httpResponse.getBody(), response);
    } catch (CalloutException calloutException) {
      response.analysisStatus = 'CALLOUT_FAILED';
      response.safeMessage = 'The AI API case-analysis endpoint could not be reached.';
      return response;
    } catch (Exception unexpectedException) {
      response.analysisStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'AI case analysis could not be completed safely.';
      return response;
    }
  }

  private static Map<String, Object> buildPayload(
    AnalysisRequest input,
    String requestId
  ) {
    Map<String, Object> payload = new Map<String, Object>();
    payload.put('caseSubject', maskSensitiveText(input.caseSubject.trim()));
    payload.put(
      'caseDescription',
      maskSensitiveText(input.caseDescription.trim())
    );
    payload.put('requestId', requestId);
    if (String.isNotBlank(input.caseStatus)) {
      payload.put('caseStatus', input.caseStatus.trim());
    }
    if (String.isNotBlank(input.caseType)) {
      payload.put('caseType', input.caseType.trim());
    }
    if (String.isNotBlank(input.caseOrigin)) {
      payload.put('caseOrigin', input.caseOrigin.trim());
    }
    String priority = normalizePriority(input.reportedPriority);
    if (priority != null) {
      payload.put('reportedPriority', priority);
    }
    return payload;
  }

  private static AnalysisResponse parseAnalysisResponse(
    String body,
    AnalysisResponse response
  ) {
    try {
      Map<String, Object> payload = asMap(JSON.deserializeUntyped(body));
      String summary = getString(payload, 'summary');
      String category = normalizeCategory(getString(payload, 'category'));
      String priority = normalizePriority(
        getString(payload, 'recommendedPriority')
      );
      String confidence = normalizeConfidence(getString(payload, 'confidence'));
      String nextAction = getString(payload, 'nextAction');
      String provider = getString(payload, 'provider');
      String model = getString(payload, 'model');

      if (
        String.isBlank(summary) ||
        category == null ||
        priority == null ||
        confidence == null ||
        String.isBlank(nextAction) ||
        String.isBlank(provider) ||
        String.isBlank(model)
      ) {
        response.analysisStatus = 'MALFORMED_RESPONSE';
        response.safeMessage = 'The AI API case-analysis endpoint returned an unexpected response.';
        return response;
      }

      response.analysisStatus = 'ANALYZED';
      response.safeMessage = 'AI case analysis completed.';
      response.summary = limitText(summary, 200);
      response.category = category;
      response.recommendedPriority = priority;
      response.confidence = confidence;
      response.nextAction = limitText(nextAction, 200);
      response.provider = provider;
      response.model = model;
      response.fallbackUsed = getBoolean(payload, 'fallbackUsed');
      response.latencyMs = getInteger(payload, 'latencyMs');
      return response;
    } catch (Exception parseException) {
      response.analysisStatus = 'MALFORMED_RESPONSE';
      response.safeMessage = 'The AI API case-analysis endpoint returned an unreadable response.';
      return response;
    }
  }

  private static AnalysisResponse baseResponse(
    AnalysisRequest input,
    Integer requestIndex
  ) {
    AnalysisResponse response = new AnalysisResponse();
    response.analysisStatus = 'NOT_ANALYZED';
    response.safeMessage = 'AI case analysis has not completed.';
    response.endpoint = SAFE_ENDPOINT;
    response.requestId = buildRequestId(input, requestIndex);
    response.analyzedAt = Datetime.now()
      .formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
    return response;
  }

  private static String buildRequestId(AnalysisRequest input, Integer index) {
    if (input != null && String.isNotBlank(input.requestId)) {
      String providedRequestId = input.requestId.trim();
      if (Pattern.matches('[A-Za-z0-9_.:-]{1,64}', providedRequestId)) {
        return providedRequestId;
      }
    }
    return 'sf-case-analysis-' +
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

  private static String normalizeCategory(String category) {
    if (String.isBlank(category)) {
      return null;
    }
    String normalized = category.trim().toLowerCase();
    if (!VALID_CATEGORIES.contains(normalized)) {
      return null;
    }
    return normalized;
  }

  private static String normalizeConfidence(String confidence) {
    if (String.isBlank(confidence)) {
      return null;
    }
    String normalized = confidence.trim().toLowerCase();
    if (!VALID_CONFIDENCES.contains(normalized)) {
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

  public class AnalysisRequest {
    @InvocableVariable(
      label='Case Subject'
      description='Short Case subject for AI case analysis. Common identifiers are masked before callout.'
    )
    public String caseSubject;

    @InvocableVariable(
      label='Case Description'
      description='Case description for AI case analysis. Common identifiers are masked before callout.'
    )
    public String caseDescription;

    @InvocableVariable(
      label='Case Status'
      description='Optional Salesforce Case status (for example New, Working, Escalated).'
    )
    public String caseStatus;

    @InvocableVariable(
      label='Case Type'
      description='Optional Salesforce Case type (for example Outage, Billing, Technical).'
    )
    public String caseType;

    @InvocableVariable(
      label='Case Origin'
      description='Optional Salesforce Case origin (for example Phone, Email, Web, Chat).'
    )
    public String caseOrigin;

    @InvocableVariable(
      label='Reported Priority'
      description='Optional customer- or agent-reported priority: low, normal, high, or critical.'
    )
    public String reportedPriority;

    @InvocableVariable(
      label='Request Id'
      description='Optional safe correlation id for backend telemetry.'
    )
    public String requestId;
  }

  public class AnalysisResponse {
    @InvocableVariable(
      label='Analysis Status'
      description='ANALYZED, VALIDATION_ERROR, AUTH_ERROR, BACKEND_ERROR, CALLOUT_FAILED, MALFORMED_RESPONSE, UNEXPECTED_ERROR, or NOT_ANALYZED.'
    )
    public String analysisStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Customer-safe message that Agentforce can display.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Summary'
      description='Short safe summary of the case returned by the AI API.'
    )
    public String summary;

    @InvocableVariable(
      label='Category'
      description='AI-derived case category: billing, outage, technical, account, or other.'
    )
    public String category;

    @InvocableVariable(
      label='Recommended Priority'
      description='AI API recommended priority: low, normal, high, or critical.'
    )
    public String recommendedPriority;

    @InvocableVariable(
      label='Confidence'
      description='AI confidence in its analysis: low, medium, or high.'
    )
    public String confidence;

    @InvocableVariable(
      label='Next Action'
      description='Short safe next action suggested by the AI API.'
    )
    public String nextAction;

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
      description='HTTP status code returned by the AI API case-analysis endpoint.'
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
      label='Analyzed At'
      description='Timestamp when Apex ran case analysis.'
    )
    public String analyzedAt;
  }
}

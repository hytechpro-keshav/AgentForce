public with sharing class AgentforceAiApiKnowledgeRag {
  private static final String ANSWER_ENDPOINT = 'callout:Agentforce_AI_API_Phase2/agent/knowledge/answer';
  private static final String SAFE_ENDPOINT = '/agent/knowledge/answer';
  private static final Integer TIMEOUT_MS = 20000;
  private static final Integer MAX_REQUESTS_PER_INVOCATION = 10;
  private static final Set<String> VALID_ANSWER_STATUSES = new Set<String>{
    'ANSWERED',
    'NO_SOURCE'
  };

  @InvocableMethod(
    label='Answer Knowledge Question with AI API RAG'
    description='Calls the NestJS AI API Phase 4 Knowledge RAG endpoint through the Agentforce_AI_API_Phase2 Named Credential and returns a safe source-cited answer.'
  )
  public static List<KnowledgeResponse> answerQuestions(
    List<KnowledgeRequest> requests
  ) {
    List<KnowledgeResponse> responses = new List<KnowledgeResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    for (Integer index = 0; index < requests.size(); index++) {
      if (index >= MAX_REQUESTS_PER_INVOCATION) {
        responses.add(excessBatchResponse(requests[index], index));
        continue;
      }
      responses.add(answerOne(requests[index], index));
    }
    return responses;
  }

  private static KnowledgeResponse answerOne(
    KnowledgeRequest input,
    Integer requestIndex
  ) {
    KnowledgeResponse response = baseResponse(input, requestIndex);
    if (input == null || String.isBlank(input.question)) {
      response.ragStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'I need a knowledge question before running external Knowledge RAG.';
      return response;
    }
    if (containsBlockedSensitiveTopic(input.question)) {
      response.ragStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'Please remove regulated, credential, payment, legal, medical, or security-sensitive details before running external Knowledge RAG.';
      return response;
    }

    HttpRequest request = new HttpRequest();
    request.setEndpoint(ANSWER_ENDPOINT);
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'phase-4-knowledge-rag');
    request.setBody(JSON.serialize(buildPayload(input, response.requestId)));

    try {
      HttpResponse httpResponse = new Http().send(request);
      response.httpStatusCode = httpResponse.getStatusCode();

      if (
        httpResponse.getStatusCode() == 401 ||
        httpResponse.getStatusCode() == 403
      ) {
        response.ragStatus = 'AUTH_ERROR';
        response.safeMessage = 'The AI API Knowledge RAG credentials were rejected.';
        return response;
      }

      if (
        httpResponse.getStatusCode() < 200 ||
        httpResponse.getStatusCode() > 299
      ) {
        response.ragStatus = 'BACKEND_ERROR';
        response.safeMessage = 'The AI API Knowledge RAG endpoint returned an error.';
        return response;
      }

      return parseKnowledgeResponse(httpResponse.getBody(), response);
    } catch (CalloutException calloutException) {
      response.ragStatus = 'CALLOUT_FAILED';
      response.safeMessage = 'The AI API Knowledge RAG endpoint could not be reached.';
      return response;
    } catch (Exception unexpectedException) {
      response.ragStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'Knowledge RAG could not be completed safely.';
      return response;
    }
  }

  private static Map<String, Object> buildPayload(
    KnowledgeRequest input,
    String requestId
  ) {
    Map<String, Object> payload = new Map<String, Object>();
    payload.put('question', maskSensitiveText(input.question.trim()));
    payload.put('requestId', requestId);
    if (String.isNotBlank(input.contextSummary)) {
      payload.put(
        'contextSummary',
        maskSensitiveText(input.contextSummary.trim())
      );
    }
    if (String.isNotBlank(input.locale)) {
      payload.put('locale', input.locale.trim());
    }
    return payload;
  }

  private static KnowledgeResponse parseKnowledgeResponse(
    String body,
    KnowledgeResponse response
  ) {
    try {
      Map<String, Object> payload = asMap(JSON.deserializeUntyped(body));
      String answerStatus = normalizeAnswerStatus(
        getString(payload, 'answerStatus')
      );
      String safeMessage = getString(payload, 'safeMessage');
      String answer = getString(payload, 'answer');
      String embeddingProvider = getString(payload, 'embeddingProvider');
      String embeddingModel = getString(payload, 'embeddingModel');
      String vectorDbProvider = getString(payload, 'vectorDbProvider');

      if (
        answerStatus == null ||
        String.isBlank(safeMessage) ||
        String.isBlank(answer) ||
        String.isBlank(embeddingProvider) ||
        String.isBlank(embeddingModel) ||
        String.isBlank(vectorDbProvider)
      ) {
        response.ragStatus = 'MALFORMED_RESPONSE';
        response.safeMessage = 'The AI API Knowledge RAG endpoint returned an unexpected response.';
        return response;
      }

      response.ragStatus = answerStatus;
      response.safeMessage = limitText(maskSensitiveText(safeMessage), 300);
      response.answer = limitText(maskSensitiveText(answer), 2500);
      response.sourceCount = getInteger(payload, 'sourceCount');
      if (response.sourceCount == null) {
        response.sourceCount = 0;
      }
      response.sourceIds = limitText(getString(payload, 'sourceIds'), 1000);
      response.sourceTitles = limitText(
        maskSensitiveText(getString(payload, 'sourceTitles')),
        1200
      );
      response.sourceUrls = limitText(getString(payload, 'sourceUrls'), 1500);
      response.sourceVersions = limitText(
        getString(payload, 'sourceVersions'),
        800
      );
      response.sourceChunkIds = limitText(
        getString(payload, 'sourceChunkIds'),
        1200
      );
      response.retrievalIds = limitText(
        getString(payload, 'retrievalIds'),
        800
      );
      response.sourcesJson = limitText(getString(payload, 'sourcesJson'), 3000);
      response.provider = getString(payload, 'provider');
      response.model = getString(payload, 'model');
      response.embeddingProvider = embeddingProvider;
      response.embeddingModel = embeddingModel;
      response.vectorDbProvider = vectorDbProvider;
      response.fallbackUsed = getBoolean(payload, 'fallbackUsed');
      response.latencyMs = getInteger(payload, 'latencyMs');
      return response;
    } catch (Exception parseException) {
      response.ragStatus = 'MALFORMED_RESPONSE';
      response.safeMessage = 'The AI API Knowledge RAG endpoint returned an unreadable response.';
      return response;
    }
  }

  private static KnowledgeResponse baseResponse(
    KnowledgeRequest input,
    Integer requestIndex
  ) {
    KnowledgeResponse response = new KnowledgeResponse();
    response.ragStatus = 'NOT_ANSWERED';
    response.safeMessage = 'Knowledge RAG has not completed.';
    response.endpoint = SAFE_ENDPOINT;
    response.requestId = buildRequestId(input, requestIndex);
    response.answeredAt = Datetime.now()
      .formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
    return response;
  }

  private static KnowledgeResponse excessBatchResponse(
    KnowledgeRequest input,
    Integer requestIndex
  ) {
    KnowledgeResponse response = baseResponse(input, requestIndex);
    response.ragStatus = 'VALIDATION_ERROR';
    response.safeMessage = 'Knowledge RAG can process up to 10 questions per Agentforce invocation.';
    return response;
  }

  private static Boolean containsBlockedSensitiveTopic(String value) {
    if (String.isBlank(value)) {
      return false;
    }
    String normalized = value.toLowerCase();
    return normalized.contains('password') ||
      normalized.contains('passcode') ||
      normalized.contains('otp') ||
      normalized.contains('reset code') ||
      normalized.contains('security code') ||
      normalized.contains('credit card') ||
      normalized.contains('card number') ||
      normalized.contains('cvv') ||
      normalized.contains('social security') ||
      normalized.contains('ssn') ||
      normalized.contains('medical') ||
      normalized.contains('diagnosis') ||
      normalized.contains('prescription') ||
      normalized.contains('legal advice') ||
      normalized.contains('lawsuit') ||
      normalized.contains('regulated financial') ||
      normalized.contains('investment advice');
  }

  private static String buildRequestId(KnowledgeRequest input, Integer index) {
    if (input != null && String.isNotBlank(input.requestId)) {
      String providedRequestId = input.requestId.trim();
      if (Pattern.matches('[A-Za-z0-9_.:-]{1,64}', providedRequestId)) {
        return providedRequestId;
      }
    }
    return 'sf-knowledge-rag-' +
      String.valueOf(Datetime.now().getTime()) +
      '-' +
      String.valueOf(index);
  }

  private static String normalizeAnswerStatus(String status) {
    if (String.isBlank(status)) {
      return null;
    }
    String normalized = status.trim().toUpperCase();
    if (!VALID_ANSWER_STATUSES.contains(normalized)) {
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
      '(?i)\\b(?:001|003|005|006|00D|00Q|00T|500|501|701|a0[A-Za-z0-9])[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\\b',
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
    masked = masked.replaceAll(
      '\\b((?:tell|Tell)\\s+)[A-Z][A-Za-z\'\\-]+(?:\\s+[A-Z][A-Za-z\'\\-]+){1,2}\\b',
      '$1[redacted-name]'
    );
    return masked;
  }

  public class KnowledgeRequest {
    @InvocableVariable(
      label='Knowledge Question'
      description='Question to answer through external AI API Knowledge RAG. Common identifiers are masked before callout.'
    )
    public String question;

    @InvocableVariable(
      label='Context Summary'
      description='Optional sanitized support context to help retrieval. Common identifiers are masked before callout.'
    )
    public String contextSummary;

    @InvocableVariable(
      label='Locale'
      description='Optional locale hint, for example en-US or es-US.'
    )
    public String locale;

    @InvocableVariable(
      label='Request Id'
      description='Optional safe correlation id for backend telemetry.'
    )
    public String requestId;
  }

  public class KnowledgeResponse {
    @InvocableVariable(
      label='RAG Status'
      description='ANSWERED, NO_SOURCE, VALIDATION_ERROR, AUTH_ERROR, BACKEND_ERROR, CALLOUT_FAILED, MALFORMED_RESPONSE, UNEXPECTED_ERROR, or NOT_ANSWERED.'
    )
    public String ragStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Customer-safe status message Agentforce can display.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Answer'
      description='Source-grounded answer returned by the AI API, or explicit no-source uncertainty.'
    )
    public String answer;

    @InvocableVariable(
      label='Source Count'
      description='Number of authorized sources returned with the answer.'
    )
    public Integer sourceCount;

    @InvocableVariable(
      label='Source Ids'
      description='Semicolon-separated source ids used by the answer.'
    )
    public String sourceIds;

    @InvocableVariable(
      label='Source Titles'
      description='Semicolon-separated source titles used by the answer.'
    )
    public String sourceTitles;

    @InvocableVariable(
      label='Source URLs'
      description='Semicolon-separated source URLs or Salesforce record references used by the answer.'
    )
    public String sourceUrls;

    @InvocableVariable(
      label='Source Versions'
      description='Semicolon-separated source document versions used by the answer.'
    )
    public String sourceVersions;

    @InvocableVariable(
      label='Source Chunk Ids'
      description='Semicolon-separated source chunk ids used by the answer.'
    )
    public String sourceChunkIds;

    @InvocableVariable(
      label='Retrieval Ids'
      description='Safe retrieval ids from the AI API RAG workflow.'
    )
    public String retrievalIds;

    @InvocableVariable(
      label='Sources JSON'
      description='Optional safe JSON source metadata without raw chunk text.'
    )
    public String sourcesJson;

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
      label='Embedding Provider'
      description='Embedding provider used by the AI API.'
    )
    public String embeddingProvider;

    @InvocableVariable(
      label='Embedding Model'
      description='Embedding model used by the AI API.'
    )
    public String embeddingModel;

    @InvocableVariable(
      label='Vector DB Provider'
      description='Vector database provider used by the AI API.'
    )
    public String vectorDbProvider;

    @InvocableVariable(
      label='Fallback Used'
      description='True when the AI API ModelRouter used a fallback provider.'
    )
    public Boolean fallbackUsed;

    @InvocableVariable(
      label='Latency Ms'
      description='AI API RAG workflow latency in milliseconds.'
    )
    public Integer latencyMs;

    @InvocableVariable(
      label='HTTP Status Code'
      description='HTTP status code returned by the AI API Knowledge RAG endpoint.'
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
      label='Answered At'
      description='Timestamp when Apex ran Knowledge RAG.'
    )
    public String answeredAt;
  }
}

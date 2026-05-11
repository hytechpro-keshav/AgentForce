public with sharing class AgentforceAiApiHealthCheck {
  private static final String HEALTH_ENDPOINT = 'callout:Agentforce_AI_API/health';
  private static final Integer TIMEOUT_MS = 10000;
  private static final String EXPECTED_HEALTH_STATUS = 'OK';
  private static final String EXPECTED_SERVICE_NAME = 'ai-api';
  private static final String EXPECTED_PHASE = 'phase-1-external-bridge';
  private static final String EXPECTED_NAMED_CREDENTIAL = 'Agentforce_AI_API';
  private static final String EXPECTED_APEX_ACTION = 'AgentforceAiApiHealthCheck';
  private static final String EXPECTED_ENDPOINT = '/health';
  private static final String EXPECTED_PROVIDER_ROUTING_PHASE = 'phase-2';
  private static final String EXPECTED_RAG_PHASE = 'phase-4';
  private static final String EXPECTED_OPEN_WEB_UI_PHASE = 'phase-5';
  private static final String EXPECTED_REACT_CHAT_PHASE = 'phase-6';
  private static final String EXPECTED_API_CHECK = 'api';
  private static final String EXPECTED_CONFIGURATION_CHECK = 'phase-1-configuration';

  @InvocableMethod(
    label='Check AI API Health'
    description='Calls the NestJS AI API health endpoint through the Agentforce_AI_API Named Credential and returns structured Phase 1 bridge context.'
  )
  public static List<HealthResponse> checkHealth(List<HealthRequest> requests) {
    List<HealthResponse> responses = new List<HealthResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    HealthResponse sharedResponse = callHealthEndpoint();
    for (Integer index = 0; index < requests.size(); index++) {
      responses.add(copyResponse(sharedResponse));
    }
    return responses;
  }

  private static HealthResponse callHealthEndpoint() {
    HealthResponse response = baseResponse();
    HttpRequest request = new HttpRequest();
    request.setEndpoint(HEALTH_ENDPOINT);
    request.setMethod('GET');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'phase-1-health');

    try {
      HttpResponse httpResponse = new Http().send(request);
      response.httpStatusCode = httpResponse.getStatusCode();

      if (
        httpResponse.getStatusCode() == 401 ||
        httpResponse.getStatusCode() == 403
      ) {
        response.bridgeStatus = 'AUTH_ERROR';
        response.healthStatus = 'UNAVAILABLE';
        response.safeMessage = 'The AI API health bridge credentials were rejected.';
        return response;
      }

      if (
        httpResponse.getStatusCode() < 200 ||
        httpResponse.getStatusCode() > 299
      ) {
        response.bridgeStatus = 'BACKEND_ERROR';
        response.healthStatus = 'UNAVAILABLE';
        response.safeMessage = 'The AI API health check returned an error.';
        return response;
      }

      return parseHealthResponse(httpResponse.getBody(), response);
    } catch (CalloutException calloutException) {
      response.bridgeStatus = 'CALLOUT_FAILED';
      response.healthStatus = 'UNAVAILABLE';
      response.safeMessage = 'The AI API health endpoint could not be reached.';
      return response;
    } catch (Exception unexpectedException) {
      response.bridgeStatus = 'UNEXPECTED_ERROR';
      response.healthStatus = 'UNAVAILABLE';
      response.safeMessage = 'The AI API health check could not be completed safely.';
      return response;
    }
  }

  private static HealthResponse parseHealthResponse(
    String body,
    HealthResponse response
  ) {
    try {
      Map<String, Object> payload = asMap(JSON.deserializeUntyped(body));
      Map<String, Object> service = asMap(payload.get('service'));
      Map<String, Object> bridge = asMap(payload.get('salesforceBridge'));
      Map<String, Object> deferred = asMap(payload.get('deferredCapabilities'));
      List<Object> checks = asList(payload.get('checks'));
      String apexAction = getString(bridge, 'apexAction');

      response.healthStatus = normalizeStatus(getString(payload, 'status'));
      response.serviceName = getString(service, 'name');
      response.serviceVersion = getString(service, 'version');
      response.environment = getString(service, 'environment');
      response.serviceTimestamp = getString(service, 'timestamp');
      response.phase = getString(bridge, 'phase');
      response.namedCredential = getString(bridge, 'namedCredential');
      response.endpoint = getString(bridge, 'endpoint');
      response.providerRoutingPhase = getString(deferred, 'providerRouting');
      response.ragPhase = getString(deferred, 'rag');
      response.openWebUiPhase = getString(deferred, 'openWebUi');
      response.reactChatPhase = getString(deferred, 'reactChat');

      if (!isExpectedHealthContract(response, apexAction, checks)) {
        response.bridgeStatus = 'MALFORMED_RESPONSE';
        response.healthStatus = 'UNKNOWN';
        response.safeMessage = 'The AI API health endpoint returned an unexpected Phase 1 response.';
      } else {
        response.bridgeStatus = 'CONNECTED';
        response.safeMessage = 'The AI API health endpoint is reachable.';
      }
      return response;
    } catch (Exception parseException) {
      response.bridgeStatus = 'MALFORMED_RESPONSE';
      response.healthStatus = 'UNKNOWN';
      response.safeMessage = 'The AI API health endpoint returned an unreadable response.';
      return response;
    }
  }

  private static HealthResponse baseResponse() {
    HealthResponse response = new HealthResponse();
    response.bridgeStatus = 'NOT_CHECKED';
    response.healthStatus = 'UNKNOWN';
    response.safeMessage = 'The AI API health check has not completed.';
    response.checkedAt = Datetime.now()
      .formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
    return response;
  }

  private static HealthResponse copyResponse(HealthResponse source) {
    HealthResponse response = new HealthResponse();
    response.bridgeStatus = source.bridgeStatus;
    response.healthStatus = source.healthStatus;
    response.safeMessage = source.safeMessage;
    response.serviceName = source.serviceName;
    response.serviceVersion = source.serviceVersion;
    response.environment = source.environment;
    response.serviceTimestamp = source.serviceTimestamp;
    response.phase = source.phase;
    response.namedCredential = source.namedCredential;
    response.endpoint = source.endpoint;
    response.providerRoutingPhase = source.providerRoutingPhase;
    response.ragPhase = source.ragPhase;
    response.openWebUiPhase = source.openWebUiPhase;
    response.reactChatPhase = source.reactChatPhase;
    response.httpStatusCode = source.httpStatusCode;
    response.checkedAt = source.checkedAt;
    return response;
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

  private static List<Object> asList(Object value) {
    if (value == null) {
      return new List<Object>();
    }
    try {
      return (List<Object>) value;
    } catch (Exception listException) {
      return new List<Object>();
    }
  }

  private static String getString(Map<String, Object> source, String key) {
    if (source == null || !source.containsKey(key) || source.get(key) == null) {
      return null;
    }
    return String.valueOf(source.get(key));
  }

  private static String normalizeStatus(String status) {
    return String.isBlank(status) ? 'UNKNOWN' : status.trim().toUpperCase();
  }

  private static Boolean isExpectedHealthContract(
    HealthResponse response,
    String apexAction,
    List<Object> checks
  ) {
    return response.healthStatus == EXPECTED_HEALTH_STATUS &&
      response.serviceName == EXPECTED_SERVICE_NAME &&
      !String.isBlank(response.serviceVersion) &&
      !String.isBlank(response.environment) &&
      !String.isBlank(response.serviceTimestamp) &&
      response.phase == EXPECTED_PHASE &&
      response.namedCredential == EXPECTED_NAMED_CREDENTIAL &&
      apexAction == EXPECTED_APEX_ACTION &&
      response.endpoint == EXPECTED_ENDPOINT &&
      response.providerRoutingPhase == EXPECTED_PROVIDER_ROUTING_PHASE &&
      response.ragPhase == EXPECTED_RAG_PHASE &&
      response.openWebUiPhase == EXPECTED_OPEN_WEB_UI_PHASE &&
      response.reactChatPhase == EXPECTED_REACT_CHAT_PHASE &&
      hasExpectedChecks(checks);
  }

  private static Boolean hasExpectedChecks(List<Object> checks) {
    Boolean hasApiCheck = false;
    Boolean hasConfigurationCheck = false;

    for (Object checkValue : checks) {
      Map<String, Object> check = asMap(checkValue);
      String checkName = getString(check, 'name');
      String checkStatus = normalizeStatus(getString(check, 'status'));
      if (
        checkName == EXPECTED_API_CHECK &&
        checkStatus == EXPECTED_HEALTH_STATUS
      ) {
        hasApiCheck = true;
      }
      if (
        checkName == EXPECTED_CONFIGURATION_CHECK &&
        checkStatus == EXPECTED_HEALTH_STATUS
      ) {
        hasConfigurationCheck = true;
      }
    }

    return hasApiCheck && hasConfigurationCheck;
  }

  public class HealthRequest {
    @InvocableVariable(
      label='Request Context'
      description='Optional non-user diagnostic context for the Phase 1 health check.'
    )
    public String requestContext;
  }

  public class HealthResponse {
    @InvocableVariable(
      label='Bridge Status'
      description='CONNECTED, AUTH_ERROR, BACKEND_ERROR, CALLOUT_FAILED, MALFORMED_RESPONSE, UNEXPECTED_ERROR, or NOT_CHECKED.'
    )
    public String bridgeStatus;

    @InvocableVariable(
      label='Health Status'
      description='Normalized health status returned by the AI API.'
    )
    public String healthStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Safe message that Agentforce can display.'
    )
    public String safeMessage;

    @InvocableVariable(label='Service Name' description='AI API service name.')
    public String serviceName;

    @InvocableVariable(
      label='Service Version'
      description='AI API service version.'
    )
    public String serviceVersion;

    @InvocableVariable(
      label='Environment'
      description='AI API runtime environment.'
    )
    public String environment;

    @InvocableVariable(
      label='Service Timestamp'
      description='AI API health response timestamp.'
    )
    public String serviceTimestamp;

    @InvocableVariable(label='Phase' description='Current bridge phase.')
    public String phase;

    @InvocableVariable(
      label='Named Credential'
      description='Named Credential expected for this bridge.'
    )
    public String namedCredential;

    @InvocableVariable(
      label='Endpoint'
      description='AI API endpoint called by Apex.'
    )
    public String endpoint;

    @InvocableVariable(
      label='Provider Routing Phase'
      description='Deferred phase for provider routing.'
    )
    public String providerRoutingPhase;

    @InvocableVariable(label='RAG Phase' description='Deferred phase for RAG.')
    public String ragPhase;

    @InvocableVariable(
      label='Open WebUI Phase'
      description='Deferred phase for Open WebUI integration.'
    )
    public String openWebUiPhase;

    @InvocableVariable(
      label='React Chat Phase'
      description='Deferred phase for React customer chat.'
    )
    public String reactChatPhase;

    @InvocableVariable(
      label='HTTP Status Code'
      description='HTTP status code returned by the AI API.'
    )
    public Integer httpStatusCode;

    @InvocableVariable(
      label='Checked At'
      description='Timestamp when Apex ran the health check.'
    )
    public String checkedAt;
  }
}

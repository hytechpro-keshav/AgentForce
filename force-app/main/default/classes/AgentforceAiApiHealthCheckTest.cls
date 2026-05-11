@IsTest
private class AgentforceAiApiHealthCheckTest {
  @IsTest
  static void checkHealthReturnsEmptyResponseForEmptyInput() {
    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>()
    );
    Test.stopTest();

    System.assertEquals(0, responses.size());
  }

  @IsTest
  static void checkHealthReturnsOneResponseForNonUserInput() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(503, '{"status":"down"}')
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
  }

  @IsTest
  static void checkHealthMapsSuccessfulResponse() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(
        200,
        '{"status":"ok","service":{"name":"ai-api","version":"0.1.0","environment":"test","timestamp":"2026-05-08T00:00:00.000Z","uptimeSeconds":12},"salesforceBridge":{"phase":"phase-1-external-bridge","namedCredential":"Agentforce_AI_API","apexAction":"AgentforceAiApiHealthCheck","endpoint":"/health"},"deferredCapabilities":{"providerRouting":"phase-2","rag":"phase-4","openWebUi":"phase-5","reactChat":"phase-6"},"checks":[{"name":"api","status":"ok"},{"name":"phase-1-configuration","status":"ok"}]}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('CONNECTED', responses[0].bridgeStatus);
    System.assertEquals('OK', responses[0].healthStatus);
    System.assertEquals('ai-api', responses[0].serviceName);
    System.assertEquals('Agentforce_AI_API', responses[0].namedCredential);
    System.assertEquals('phase-2', responses[0].providerRoutingPhase);
    System.assertEquals('/health', responses[0].endpoint);
    System.assertEquals(200, responses[0].httpStatusCode);
  }

  @IsTest
  static void checkHealthReturnsBackendErrorForNonSuccessStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(503, '{"status":"down"}')
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('BACKEND_ERROR', responses[0].bridgeStatus);
    System.assertEquals('UNAVAILABLE', responses[0].healthStatus);
    System.assertEquals(503, responses[0].httpStatusCode);
  }

  @IsTest
  static void checkHealthReturnsAuthErrorForUnauthorizedStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(401, '{"message":"unauthorized"}')
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].bridgeStatus);
    System.assertEquals('UNAVAILABLE', responses[0].healthStatus);
    System.assertEquals(401, responses[0].httpStatusCode);
  }

  @IsTest
  static void checkHealthRejectsUnexpectedBridgeContract() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(
        200,
        '{"status":"ok","service":{"name":"ai-api","version":"0.1.0","environment":"test","timestamp":"2026-05-08T00:00:00.000Z","uptimeSeconds":12},"salesforceBridge":{"phase":"phase-1-external-bridge","namedCredential":"Unexpected_Named_Credential","apexAction":"AgentforceAiApiHealthCheck","endpoint":"/health"},"deferredCapabilities":{"providerRouting":"phase-2","rag":"phase-4","openWebUi":"phase-5","reactChat":"phase-6"},"checks":[{"name":"api","status":"ok"},{"name":"phase-1-configuration","status":"ok"}]}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].bridgeStatus);
    System.assertEquals('UNKNOWN', responses[0].healthStatus);
  }

  @IsTest
  static void checkHealthRejectsMissingDeferredCapabilities() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(
        200,
        '{"status":"ok","service":{"name":"ai-api","version":"0.1.0","environment":"test","timestamp":"2026-05-08T00:00:00.000Z","uptimeSeconds":12},"salesforceBridge":{"phase":"phase-1-external-bridge","namedCredential":"Agentforce_AI_API","apexAction":"AgentforceAiApiHealthCheck","endpoint":"/health"},"checks":[{"name":"api","status":"ok"},{"name":"phase-1-configuration","status":"ok"}]}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].bridgeStatus);
    System.assertEquals('UNKNOWN', responses[0].healthStatus);
  }

  @IsTest
  static void checkHealthRejectsMissingHealthChecks() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(
        200,
        '{"status":"ok","service":{"name":"ai-api","version":"0.1.0","environment":"test","timestamp":"2026-05-08T00:00:00.000Z","uptimeSeconds":12},"salesforceBridge":{"phase":"phase-1-external-bridge","namedCredential":"Agentforce_AI_API","apexAction":"AgentforceAiApiHealthCheck","endpoint":"/health"},"deferredCapabilities":{"providerRouting":"phase-2","rag":"phase-4","openWebUi":"phase-5","reactChat":"phase-6"}}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].bridgeStatus);
    System.assertEquals('UNKNOWN', responses[0].healthStatus);
  }

  @IsTest
  static void checkHealthRejectsDegradedConfigurationCheck() {
    Test.setMock(
      HttpCalloutMock.class,
      new HealthMock(
        200,
        '{"status":"ok","service":{"name":"ai-api","version":"0.1.0","environment":"test","timestamp":"2026-05-08T00:00:00.000Z","uptimeSeconds":12},"salesforceBridge":{"phase":"phase-1-external-bridge","namedCredential":"Agentforce_AI_API","apexAction":"AgentforceAiApiHealthCheck","endpoint":"/health"},"deferredCapabilities":{"providerRouting":"phase-2","rag":"phase-4","openWebUi":"phase-5","reactChat":"phase-6"},"checks":[{"name":"api","status":"ok"},{"name":"phase-1-configuration","status":"degraded"}]}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].bridgeStatus);
    System.assertEquals('UNKNOWN', responses[0].healthStatus);
  }

  @IsTest
  static void checkHealthHandlesMalformedJson() {
    Test.setMock(HttpCalloutMock.class, new HealthMock(200, '{not-json'));

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].bridgeStatus);
    System.assertEquals('UNKNOWN', responses[0].healthStatus);
  }

  @IsTest
  static void checkHealthHandlesCalloutException() {
    Test.setMock(HttpCalloutMock.class, new ThrowingHealthMock());

    Test.startTest();
    List<AgentforceAiApiHealthCheck.HealthResponse> responses = AgentforceAiApiHealthCheck.checkHealth(
      new List<AgentforceAiApiHealthCheck.HealthRequest>{ healthRequest() }
    );
    Test.stopTest();

    System.assertEquals('CALLOUT_FAILED', responses[0].bridgeStatus);
    System.assertEquals('UNAVAILABLE', responses[0].healthStatus);
  }

  private static AgentforceAiApiHealthCheck.HealthRequest healthRequest() {
    AgentforceAiApiHealthCheck.HealthRequest request = new AgentforceAiApiHealthCheck.HealthRequest();
    request.requestContext = 'phase-1-smoke';
    return request;
  }

  private class HealthMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;

    private HealthMock(Integer statusCode, String body) {
      this.statusCode = statusCode;
      this.body = body;
    }

    public HttpResponse respond(HttpRequest request) {
      System.assertEquals('GET', request.getMethod());
      System.assertEquals(
        'callout:Agentforce_AI_API/health',
        request.getEndpoint()
      );
      System.assertEquals('application/json', request.getHeader('Accept'));
      System.assertEquals(null, request.getHeader('X-Salesforce-Org-Id'));

      HttpResponse response = new HttpResponse();
      response.setStatusCode(statusCode);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(body);
      return response;
    }
  }

  private class ThrowingHealthMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('Simulated timeout');
    }
  }
}

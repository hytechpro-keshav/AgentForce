@IsTest
private class AgentforceAiApiSupportTriageTest {
  @IsTest
  static void triageReturnsEmptyResponseForEmptyInput() {
    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>()
    );
    Test.stopTest();

    System.assertEquals(0, responses.size());
  }

  @IsTest
  static void triageRequiresSubjectAndDescription() {
    AgentforceAiApiSupportTriage.TriageRequest request = new AgentforceAiApiSupportTriage.TriageRequest();
    request.subject = 'Missing description';

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].triageStatus);
    System.assertEquals(null, responses[0].httpStatusCode);
  }

  @IsTest
  static void triageMapsSuccessfulResponse() {
    Test.setMock(
      HttpCalloutMock.class,
      new TriageMock(
        201,
        '{"recommendedPriority":"high","summary":"Customer reports no service after an outage.","suggestedNextStep":"Create a high priority service request and offer human follow-up.","provider":"openai","model":"gpt-4.1-mini","fallbackUsed":false,"latencyMs":847}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{ triageRequest() }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('TRIAGED', responses[0].triageStatus);
    System.assertEquals('high', responses[0].recommendedPriority);
    System.assertEquals('openai', responses[0].provider);
    System.assertEquals('gpt-4.1-mini', responses[0].model);
    System.assertEquals(false, responses[0].fallbackUsed);
    System.assertEquals(847, responses[0].latencyMs);
    System.assertEquals(201, responses[0].httpStatusCode);
    System.assertEquals('/agent/support/triage-case', responses[0].endpoint);
  }

  @IsTest
  static void triageSendsOneCalloutPerValidInput() {
    CountingTriageMock mock = new CountingTriageMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{
        triageRequest(),
        triageRequest('Phase 2 triage request two')
      }
    );
    Test.stopTest();

    System.assertEquals(2, responses.size());
    System.assertEquals('TRIAGED', responses[0].triageStatus);
    System.assertEquals('TRIAGED', responses[1].triageStatus);
    System.assertEquals(2, mock.callCount);
  }

  @IsTest
  static void triageReturnsAuthErrorForUnauthorizedStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new TriageMock(401, '{"message":"unauthorized"}')
    );

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{ triageRequest() }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].triageStatus);
    System.assertEquals(401, responses[0].httpStatusCode);
  }

  @IsTest
  static void triageReturnsBackendErrorForNonSuccessStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new TriageMock(503, '{"message":"temporarily unavailable"}')
    );

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{ triageRequest() }
    );
    Test.stopTest();

    System.assertEquals('BACKEND_ERROR', responses[0].triageStatus);
    System.assertEquals(503, responses[0].httpStatusCode);
  }

  @IsTest
  static void triageRejectsMalformedJson() {
    Test.setMock(HttpCalloutMock.class, new TriageMock(201, '{not-json'));

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{ triageRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].triageStatus);
  }

  @IsTest
  static void triageRejectsUnexpectedContract() {
    Test.setMock(
      HttpCalloutMock.class,
      new TriageMock(
        201,
        '{"recommendedPriority":"urgent","summary":"Missing provider","suggestedNextStep":"Route to support."}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{ triageRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].triageStatus);
  }

  @IsTest
  static void triageHandlesCalloutException() {
    Test.setMock(HttpCalloutMock.class, new ThrowingTriageMock());

    Test.startTest();
    List<AgentforceAiApiSupportTriage.TriageResponse> responses = AgentforceAiApiSupportTriage.triageCases(
      new List<AgentforceAiApiSupportTriage.TriageRequest>{ triageRequest() }
    );
    Test.stopTest();

    System.assertEquals('CALLOUT_FAILED', responses[0].triageStatus);
  }

  private static AgentforceAiApiSupportTriage.TriageRequest triageRequest() {
    return triageRequest('Phase 2 support triage proof');
  }

  private static AgentforceAiApiSupportTriage.TriageRequest triageRequest(
    String subject
  ) {
    AgentforceAiApiSupportTriage.TriageRequest request = new AgentforceAiApiSupportTriage.TriageRequest();
    request.subject = subject;
    request.description = 'Customer name is Jane Doe. Email jane@example.com, phone 415-555-1212, account number ACCT-123456, card 4111 1111 1111 1111, SSN 123-45-6789, and service address 123 Main St Apt 4B. The customer reports no service and needs help deciding priority.';
    request.reportedPriority = 'high';
    request.requestId = 'test-triage-request';
    return request;
  }

  private class TriageMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;

    private TriageMock(Integer statusCode, String body) {
      this.statusCode = statusCode;
      this.body = body;
    }

    public HttpResponse respond(HttpRequest request) {
      assertRequestShape(request);
      HttpResponse response = new HttpResponse();
      response.setStatusCode(statusCode);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(body);
      return response;
    }
  }

  private class CountingTriageMock implements HttpCalloutMock {
    public Integer callCount = 0;

    public HttpResponse respond(HttpRequest request) {
      callCount++;
      assertRequestShape(request);
      HttpResponse response = new HttpResponse();
      response.setStatusCode(201);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(
        '{"recommendedPriority":"normal","summary":"Issue should be tracked by support.","suggestedNextStep":"Create a service request and monitor for updates.","provider":"openai","model":"gpt-4.1-mini","fallbackUsed":false,"latencyMs":125}'
      );
      return response;
    }
  }

  private class ThrowingTriageMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('Simulated timeout');
    }
  }

  private static void assertRequestShape(HttpRequest request) {
    System.assertEquals('POST', request.getMethod());
    System.assertEquals(
      'callout:Agentforce_AI_API_Phase2/agent/support/triage-case',
      request.getEndpoint()
    );
    System.assertEquals('application/json', request.getHeader('Accept'));
    System.assertEquals('application/json', request.getHeader('Content-Type'));
    System.assertEquals(
      'phase-2-support-triage',
      request.getHeader('X-Agentforce-Bridge')
    );
    System.assertEquals(null, request.getHeader('Authorization'));

    Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(
      request.getBody()
    );
    System.assertEquals('high', payload.get('reportedPriority'));
    System.assertEquals('test-triage-request', payload.get('requestId'));
    System.assertNotEquals(null, payload.get('subject'));
    System.assertNotEquals(null, payload.get('description'));
    String description = String.valueOf(payload.get('description'));
    System.assert(description.contains('[redacted-name]'));
    System.assert(description.contains('[redacted-email]'));
    System.assert(description.contains('[redacted-phone]'));
    System.assert(description.contains('[redacted-identifier]'));
    System.assert(description.contains('[redacted-payment]'));
    System.assert(description.contains('[redacted-ssn]'));
    System.assert(description.contains('[redacted-address]'));
    System.assert(description.contains('The customer reports no service'));
    System.assert(!description.contains('Jane Doe'));
    System.assert(!description.contains('jane@example.com'));
    System.assert(!description.contains('415-555-1212'));
    System.assert(!description.contains('ACCT-123456'));
    System.assert(!description.contains('4111 1111 1111 1111'));
    System.assert(!description.contains('123-45-6789'));
    System.assert(!description.contains('123 Main St'));
  }
}

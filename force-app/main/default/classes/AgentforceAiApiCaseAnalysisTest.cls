@IsTest
private class AgentforceAiApiCaseAnalysisTest {
  @IsTest
  static void analyzeReturnsEmptyResponseForEmptyInput() {
    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>()
    );
    Test.stopTest();

    System.assertEquals(0, responses.size());
  }

  @IsTest
  static void analyzeRequiresSubjectAndDescription() {
    AgentforceAiApiCaseAnalysis.AnalysisRequest request = new AgentforceAiApiCaseAnalysis.AnalysisRequest();
    request.caseSubject = 'Missing description';

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].analysisStatus);
    System.assertEquals(null, responses[0].httpStatusCode);
  }

  @IsTest
  static void analyzeMapsSuccessfulResponse() {
    Test.setMock(
      HttpCalloutMock.class,
      new AnalysisMock(
        201,
        '{"summary":"Customer reports no service after an outage.","category":"outage","recommendedPriority":"high","confidence":"high","nextAction":"Dispatch field technician within SLA window.","provider":"openai","model":"gpt-4o-mini","fallbackUsed":false,"latencyMs":312}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{ analysisRequest() }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('ANALYZED', responses[0].analysisStatus);
    System.assertEquals('outage', responses[0].category);
    System.assertEquals('high', responses[0].recommendedPriority);
    System.assertEquals('high', responses[0].confidence);
    System.assertEquals('openai', responses[0].provider);
    System.assertEquals('gpt-4o-mini', responses[0].model);
    System.assertEquals(false, responses[0].fallbackUsed);
    System.assertEquals(312, responses[0].latencyMs);
    System.assertEquals(201, responses[0].httpStatusCode);
    System.assertEquals('/agent/support/analyze-case', responses[0].endpoint);
  }

  @IsTest
  static void analyzeSendsOneCalloutPerValidInput() {
    CountingAnalysisMock mock = new CountingAnalysisMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{
        analysisRequest(),
        analysisRequest('Phase 3 case analysis request two')
      }
    );
    Test.stopTest();

    System.assertEquals(2, responses.size());
    System.assertEquals('ANALYZED', responses[0].analysisStatus);
    System.assertEquals('ANALYZED', responses[1].analysisStatus);
    System.assertEquals(2, mock.callCount);
  }

  @IsTest
  static void analyzeReturnsAuthErrorForUnauthorizedStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new AnalysisMock(401, '{"message":"unauthorized"}')
    );

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{ analysisRequest() }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].analysisStatus);
    System.assertEquals(401, responses[0].httpStatusCode);
  }

  @IsTest
  static void analyzeReturnsBackendErrorForNonSuccessStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new AnalysisMock(503, '{"message":"temporarily unavailable"}')
    );

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{ analysisRequest() }
    );
    Test.stopTest();

    System.assertEquals('BACKEND_ERROR', responses[0].analysisStatus);
    System.assertEquals(503, responses[0].httpStatusCode);
  }

  @IsTest
  static void analyzeRejectsMalformedJson() {
    Test.setMock(HttpCalloutMock.class, new AnalysisMock(201, '{not-json'));

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{ analysisRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].analysisStatus);
  }

  @IsTest
  static void analyzeRejectsUnexpectedContract() {
    Test.setMock(
      HttpCalloutMock.class,
      new AnalysisMock(
        201,
        '{"summary":"Missing fields","category":"weather","recommendedPriority":"urgent","confidence":"unsure","nextAction":"observe"}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{ analysisRequest() }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].analysisStatus);
  }

  @IsTest
  static void analyzeHandlesCalloutException() {
    Test.setMock(HttpCalloutMock.class, new ThrowingAnalysisMock());

    Test.startTest();
    List<AgentforceAiApiCaseAnalysis.AnalysisResponse> responses = AgentforceAiApiCaseAnalysis.analyzeCases(
      new List<AgentforceAiApiCaseAnalysis.AnalysisRequest>{ analysisRequest() }
    );
    Test.stopTest();

    System.assertEquals('CALLOUT_FAILED', responses[0].analysisStatus);
  }

  private static AgentforceAiApiCaseAnalysis.AnalysisRequest analysisRequest() {
    return analysisRequest('Phase 3 support operations case analysis proof');
  }

  private static AgentforceAiApiCaseAnalysis.AnalysisRequest analysisRequest(
    String caseSubject
  ) {
    AgentforceAiApiCaseAnalysis.AnalysisRequest request = new AgentforceAiApiCaseAnalysis.AnalysisRequest();
    request.caseSubject = caseSubject;
    request.caseDescription = 'Customer name is Jane Doe. Email jane@example.com, phone 415-555-1212, account number ACCT-123456, card 4111 1111 1111 1111, SSN 123-45-6789, and service address 123 Main St Apt 4B. The customer reports no service and needs a Support Operations recommendation.';
    request.caseStatus = 'Working';
    request.caseType = 'Outage';
    request.caseOrigin = 'Web';
    request.reportedPriority = 'high';
    request.requestId = 'test-case-analysis-request';
    return request;
  }

  private class AnalysisMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;

    private AnalysisMock(Integer statusCode, String body) {
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

  private class CountingAnalysisMock implements HttpCalloutMock {
    public Integer callCount = 0;

    public HttpResponse respond(HttpRequest request) {
      callCount++;
      assertRequestShape(request);
      HttpResponse response = new HttpResponse();
      response.setStatusCode(201);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(
        '{"summary":"Customer reports an issue.","category":"technical","recommendedPriority":"normal","confidence":"medium","nextAction":"Acknowledge and schedule a follow-up.","provider":"openai","model":"gpt-4o-mini","fallbackUsed":false,"latencyMs":120}'
      );
      return response;
    }
  }

  private class ThrowingAnalysisMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('Simulated timeout');
    }
  }

  private static void assertRequestShape(HttpRequest request) {
    System.assertEquals('POST', request.getMethod());
    System.assertEquals(
      'callout:Agentforce_AI_API_Phase2/agent/support/analyze-case',
      request.getEndpoint()
    );
    System.assertEquals('application/json', request.getHeader('Accept'));
    System.assertEquals('application/json', request.getHeader('Content-Type'));
    System.assertEquals(
      'phase-3-case-analysis',
      request.getHeader('X-Agentforce-Bridge')
    );
    System.assertEquals(null, request.getHeader('Authorization'));

    Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(
      request.getBody()
    );
    System.assertEquals('high', payload.get('reportedPriority'));
    System.assertEquals('test-case-analysis-request', payload.get('requestId'));
    System.assertEquals('Working', payload.get('caseStatus'));
    System.assertEquals('Outage', payload.get('caseType'));
    System.assertEquals('Web', payload.get('caseOrigin'));
    System.assertNotEquals(null, payload.get('caseSubject'));
    System.assertNotEquals(null, payload.get('caseDescription'));
    String description = String.valueOf(payload.get('caseDescription'));
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

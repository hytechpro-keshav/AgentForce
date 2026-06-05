@isTest
private class AgentforceCaseTriageOrchTriggerTest {
  @isTest
  static void enqueuesHandoffForValidCase() {
    CountingMock mock = new CountingMock(202);
    Test.setMock(HttpCalloutMock.class, mock);

    AgentforceCaseTriageOrchestratorTrigger.TriggerRequest request = new AgentforceCaseTriageOrchestratorTrigger.TriggerRequest();
    request.caseId = '500000000000001';
    request.caseNumber = '00001234';

    Test.startTest();
    List<AgentforceCaseTriageOrchestratorTrigger.HandoffResult> results = AgentforceCaseTriageOrchestratorTrigger.enqueueTriage(
      new List<AgentforceCaseTriageOrchestratorTrigger.TriggerRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(1, results.size());
    System.assertEquals(true, results[0].enqueued);
    System.assertEquals(
      1,
      mock.callCount,
      'Expected exactly one async handoff callout.'
    );
  }

  @isTest
  static void rejectsInvalidCaseIdWithoutCallout() {
    CountingMock mock = new CountingMock(202);
    Test.setMock(HttpCalloutMock.class, mock);

    AgentforceCaseTriageOrchestratorTrigger.TriggerRequest request = new AgentforceCaseTriageOrchestratorTrigger.TriggerRequest();
    request.caseId = 'not-an-id';

    Test.startTest();
    List<AgentforceCaseTriageOrchestratorTrigger.HandoffResult> results = AgentforceCaseTriageOrchestratorTrigger.enqueueTriage(
      new List<AgentforceCaseTriageOrchestratorTrigger.TriggerRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(1, results.size());
    System.assertEquals(false, results[0].enqueued);
    System.assertEquals(
      0,
      mock.callCount,
      'Invalid Case Id must not trigger a callout.'
    );
  }

  @isTest
  static void sendsIdentifierOnlyPayloadToTriggerEndpoint() {
    ShapeMock mock = new ShapeMock();
    Test.setMock(HttpCalloutMock.class, mock);

    AgentforceCaseTriageOrchestratorTrigger.TriggerRequest request = new AgentforceCaseTriageOrchestratorTrigger.TriggerRequest();
    request.caseId = '500000000000ABC';
    request.caseNumber = '00009999';
    request.correlationId = 'sf-corr-1';

    Test.startTest();
    AgentforceCaseTriageOrchestratorTrigger.enqueueTriage(
      new List<AgentforceCaseTriageOrchestratorTrigger.TriggerRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals('POST', mock.capturedMethod);
    System.assertEquals(
      'callout:Agentforce_AI_API_Phase2/orchestrator/case-triage/triggers',
      mock.capturedEndpoint
    );
    System.assertEquals('orchestrator-case-triage', mock.capturedBridgeHeader);
    Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(
      mock.capturedBody
    );
    System.assertEquals('500000000000ABC', body.get('caseId'));
    System.assertEquals('00009999', body.get('caseNumber'));
    System.assertEquals('sf-corr-1', body.get('correlationId'));
    // Identifiers only — never Case subject/description.
    System.assert(
      !body.containsKey('subject'),
      'Payload must not carry Case text.'
    );
    System.assert(
      !body.containsKey('description'),
      'Payload must not carry Case text.'
    );
  }

  @isTest
  static void swallowsBackendErrorsQuietly() {
    CountingMock mock = new CountingMock(503);
    Test.setMock(HttpCalloutMock.class, mock);

    AgentforceCaseTriageOrchestratorTrigger.TriggerRequest request = new AgentforceCaseTriageOrchestratorTrigger.TriggerRequest();
    request.caseId = '500000000000001';

    Test.startTest();
    List<AgentforceCaseTriageOrchestratorTrigger.HandoffResult> results = AgentforceCaseTriageOrchestratorTrigger.enqueueTriage(
      new List<AgentforceCaseTriageOrchestratorTrigger.TriggerRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(true, results[0].enqueued);
    System.assertEquals(1, mock.callCount);
  }

  @isTest
  static void swallowsCalloutExceptionQuietly() {
    Test.setMock(HttpCalloutMock.class, new ThrowingMock());

    AgentforceCaseTriageOrchestratorTrigger.TriggerRequest request = new AgentforceCaseTriageOrchestratorTrigger.TriggerRequest();
    request.caseId = '500000000000001';

    Test.startTest();
    List<AgentforceCaseTriageOrchestratorTrigger.HandoffResult> results = AgentforceCaseTriageOrchestratorTrigger.enqueueTriage(
      new List<AgentforceCaseTriageOrchestratorTrigger.TriggerRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(
      true,
      results[0].enqueued,
      'Handoff stays enqueued; callout failure is logged only.'
    );
  }

  @isTest
  static void handlesEmptyAndNullInput() {
    Test.startTest();
    List<AgentforceCaseTriageOrchestratorTrigger.HandoffResult> emptyResults = AgentforceCaseTriageOrchestratorTrigger.enqueueTriage(
      new List<AgentforceCaseTriageOrchestratorTrigger.TriggerRequest>()
    );
    List<AgentforceCaseTriageOrchestratorTrigger.HandoffResult> nullResults = AgentforceCaseTriageOrchestratorTrigger.enqueueTriage(
      null
    );
    Test.stopTest();

    System.assertEquals(0, emptyResults.size());
    System.assertEquals(0, nullResults.size());
  }

  private class CountingMock implements HttpCalloutMock {
    private Integer statusCode;
    public Integer callCount = 0;

    private CountingMock(Integer statusCode) {
      this.statusCode = statusCode;
    }

    public HttpResponse respond(HttpRequest request) {
      callCount++;
      HttpResponse response = new HttpResponse();
      response.setStatusCode(statusCode);
      response.setHeader('Content-Type', 'application/json');
      response.setBody('{"workflowId":"wf-test","status":"assigned"}');
      return response;
    }
  }

  private class ShapeMock implements HttpCalloutMock {
    public String capturedMethod;
    public String capturedEndpoint;
    public String capturedBridgeHeader;
    public String capturedBody;

    public HttpResponse respond(HttpRequest request) {
      capturedMethod = request.getMethod();
      capturedEndpoint = request.getEndpoint();
      capturedBridgeHeader = request.getHeader('X-Agentforce-Bridge');
      capturedBody = request.getBody();
      HttpResponse response = new HttpResponse();
      response.setStatusCode(202);
      response.setHeader('Content-Type', 'application/json');
      response.setBody('{"workflowId":"wf-test","status":"assigned"}');
      return response;
    }
  }

  private class ThrowingMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('Simulated handoff failure');
    }
  }
}

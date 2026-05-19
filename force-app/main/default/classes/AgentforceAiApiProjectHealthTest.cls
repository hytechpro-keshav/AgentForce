@IsTest
private class AgentforceAiApiProjectHealthTest {
  @IsTest
  static void summarizeReturnsEmptyResponseForEmptyInput() {
    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>()
    );
    Test.stopTest();

    System.assertEquals(0, responses.size());
  }

  @IsTest
  static void summarizeRequiresProjectLookupKey() {
    AgentforceAiApiProjectHealth.ProjectHealthRequest request = new AgentforceAiApiProjectHealth.ProjectHealthRequest();

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].actionStatus);
    System.assertEquals(responses[0].safeMessage, responses[0].executiveBrief);
    System.assertEquals(null, responses[0].httpStatusCode);
  }

  @IsTest
  static void summarizeReturnsNotFoundForUnknownProject() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{
        notFoundFacts()
      }
    );
    AgentforceAiApiProjectHealth.ProjectHealthRequest request = new AgentforceAiApiProjectHealth.ProjectHealthRequest();
    request.projectKey =
      'Phase8 Missing Project ' + String.valueOf(Datetime.now().getTime());

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('NOT_FOUND', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeRejectsAmbiguousProjectMatches() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{
        ambiguousFacts()
      }
    );

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000009')
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeMapsSuccessfulResponseUsingCertiniaPsaRecords() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{ baseFacts() }
    );
    ProjectHealthMock mock = new ProjectHealthMock(
      201,
      '{"healthStatus":"red","riskLevel":"high","scheduleStatus":"red","budgetStatus":"yellow","staffingStatus":"yellow","summary":"Delivery risk is elevated from milestones and staffing.","riskDrivers":"late milestones; open staffing demand; submitted timecards","recommendedActions":"review milestone recovery; prioritize staffing; clear timecard approvals","confidence":"high","provider":"openai","model":"gpt-4o-mini","fallbackUsed":false,"latencyMs":245}'
    );
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000001')
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('SUMMARIZED', responses[0].actionStatus);
    System.assertEquals('red', responses[0].healthStatus);
    System.assertEquals('high', responses[0].riskLevel);
    System.assertEquals('red', responses[0].scheduleStatus);
    System.assertEquals('yellow', responses[0].budgetStatus);
    System.assertEquals('yellow', responses[0].staffingStatus);
    System.assertEquals('high', responses[0].confidence);
    System.assertEquals('openai', responses[0].provider);
    System.assertEquals('gpt-4o-mini', responses[0].model);
    System.assertEquals(false, responses[0].fallbackUsed);
    System.assertEquals(245, responses[0].latencyMs);
    System.assert(responses[0].executiveBrief.contains('Project Health Brief'));
    System.assert(
      responses[0].executiveBrief.contains('Red health, High delivery risk.')
    );
    System.assert(responses[0].executiveBrief.contains('Status snapshot'));
    System.assert(responses[0].executiveBrief.contains('Signals reviewed'));
    System.assert(
      responses[0].executiveBrief.contains('Budget: margin signal 12.0')
    );
    System.assert(
      responses[0].executiveBrief.contains('Next best action plan:')
    );
    System.assert(
      responses[0].executiveBrief.contains('no PSA records were changed')
    );
    System.assertEquals(201, responses[0].httpStatusCode);
    System.assertEquals(
      '/agent/services/project-health',
      responses[0].endpoint
    );
    assertPayloadSafety(mock.lastRequestBody);
  }

  @IsTest
  static void summarizeReturnsAuthErrorForUnauthorizedStatus() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{ baseFacts() }
    );
    Test.setMock(
      HttpCalloutMock.class,
      new ProjectHealthMock(401, '{"message":"unauthorized"}')
    );

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000002')
      }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].actionStatus);
    System.assertEquals(401, responses[0].httpStatusCode);
    System.assertEquals(
      'The AI API project-health bearer token was rejected. Confirm the Salesforce external credential secret matches the deployed AI API bearer configuration.',
      responses[0].safeMessage
    );
  }

  @IsTest
  static void summarizeReturnsAuthErrorForForbiddenStatus() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{ baseFacts() }
    );
    Test.setMock(
      HttpCalloutMock.class,
      new ProjectHealthMock(403, '{"message":"forbidden"}')
    );

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000002')
      }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].actionStatus);
    System.assertEquals(403, responses[0].httpStatusCode);
    System.assertEquals(
      'The AI API project-health bearer is authenticated but missing the required agentforce:services-project-health scope.',
      responses[0].safeMessage
    );
  }

  @IsTest
  static void summarizeReturnsBackendErrorForNonSuccessStatus() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{ baseFacts() }
    );
    Test.setMock(
      HttpCalloutMock.class,
      new ProjectHealthMock(503, '{"message":"temporarily unavailable"}')
    );

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000003')
      }
    );
    Test.stopTest();

    System.assertEquals('BACKEND_ERROR', responses[0].actionStatus);
    System.assertEquals(503, responses[0].httpStatusCode);
  }

  @IsTest
  static void summarizeRejectsMalformedJson() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{ baseFacts() }
    );
    Test.setMock(
      HttpCalloutMock.class,
      new ProjectHealthMock(201, '{not-json')
    );

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000004')
      }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeRejectsUnexpectedContract() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{ baseFacts() }
    );
    Test.setMock(
      HttpCalloutMock.class,
      new ProjectHealthMock(
        201,
        '{"healthStatus":"blue","riskLevel":"urgent","summary":"Missing fields"}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000005')
      }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeHandlesCalloutException() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{ baseFacts() }
    );
    Test.setMock(HttpCalloutMock.class, new ThrowingProjectHealthMock());

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000006')
      }
    );
    Test.stopTest();

    System.assertEquals('CALLOUT_FAILED', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeProcessesBulkInputs() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{
        baseFacts(),
        baseFacts()
      }
    );
    CountingProjectHealthMock mock = new CountingProjectHealthMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000007'),
        projectRequest('aAi000000000008')
      }
    );
    Test.stopTest();

    System.assertEquals(2, responses.size());
    System.assertEquals('SUMMARIZED', responses[0].actionStatus);
    System.assertEquals('SUMMARIZED', responses[1].actionStatus);
    System.assertEquals(2, mock.callCount);
  }

  @IsTest(SeeAllData=true)
  static void summarizeUsesExistingCertiniaProjectByRecordId() {
    List<pse__Proj__c> projects = [SELECT Id FROM pse__Proj__c LIMIT 1];
    if (projects.isEmpty()) {
      return;
    }

    Test.setMock(HttpCalloutMock.class, new CountingProjectHealthMock());

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest(String.valueOf(projects[0].Id))
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('SUMMARIZED', responses[0].actionStatus);
  }

  @IsTest(SeeAllData=true)
  static void summarizeUsesExistingCertiniaProjectByProjectId() {
    List<pse__Proj__c> projects = [
      SELECT pse__Project_ID__c
      FROM pse__Proj__c
      WHERE pse__Project_ID__c != NULL
      LIMIT 1
    ];
    if (projects.isEmpty()) {
      return;
    }

    AgentforceAiApiProjectHealth.ProjectHealthRequest request = new AgentforceAiApiProjectHealth.ProjectHealthRequest();
    request.projectKey = projects[0].pse__Project_ID__c;
    request.requestId = 'test-project-health-by-project-id';
    Test.setMock(HttpCalloutMock.class, new CountingProjectHealthMock());

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('SUMMARIZED', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeCapsOversizedBatches() {
    AgentforceAiApiProjectHealth.dataProvider = new FakeProjectHealthDataProvider(
      new List<AgentforceAiApiProjectHealth.ProjectHealthFacts>{
        baseFacts(),
        baseFacts(),
        baseFacts(),
        baseFacts(),
        baseFacts()
      }
    );
    CountingProjectHealthMock mock = new CountingProjectHealthMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceAiApiProjectHealth.ProjectHealthResponse> responses = AgentforceAiApiProjectHealth.summarizeProjectHealth(
      new List<AgentforceAiApiProjectHealth.ProjectHealthRequest>{
        projectRequest('aAi000000000010'),
        projectRequest('aAi000000000011'),
        projectRequest('aAi000000000012'),
        projectRequest('aAi000000000013'),
        projectRequest('aAi000000000014'),
        projectRequest('aAi000000000015')
      }
    );
    Test.stopTest();

    System.assertEquals(6, responses.size());
    System.assertEquals('SUMMARIZED', responses[0].actionStatus);
    System.assertEquals('SUMMARIZED', responses[4].actionStatus);
    System.assertEquals('VALIDATION_ERROR', responses[5].actionStatus);
    System.assertEquals(5, mock.callCount);
  }

  private static AgentforceAiApiProjectHealth.ProjectHealthRequest projectRequest(
    String projectId
  ) {
    AgentforceAiApiProjectHealth.ProjectHealthRequest request = new AgentforceAiApiProjectHealth.ProjectHealthRequest();
    request.recordId = projectId;
    request.requestId = 'test-project-health-request';
    return request;
  }

  private static AgentforceAiApiProjectHealth.ProjectHealthFacts baseFacts() {
    AgentforceAiApiProjectHealth.ProjectHealthFacts facts = new AgentforceAiApiProjectHealth.ProjectHealthFacts();
    facts.found = true;
    facts.projectStatus = 'Yellow';
    facts.projectStartDate = Date.today().addDays(-30);
    facts.projectEndDate = Date.today().addDays(14);
    facts.daysUntilEnd = 14;
    facts.percentHoursComplete = 68;
    facts.plannedHours = 100;
    facts.estimatedHoursAtCompletion = 130;
    facts.remainingAmount = 2000;
    facts.marginPercent = 12;
    facts.assignmentCount = 1;
    facts.activeAssignmentCount = 1;
    facts.assignmentAtRiskCount = 1;
    facts.avgAssignmentAllocationPercent = 75;
    facts.milestoneCount = 2;
    facts.lateMilestoneCount = 1;
    facts.completedMilestoneCount = 0;
    facts.timecardHeaderCount = 1;
    facts.submittedTimecardCount = 1;
    facts.rejectedTimecardCount = 0;
    facts.approvedTimecardCount = 0;
    facts.totalTimecardHours = 8;
    facts.projectTaskCount = 1;
    facts.openProjectTaskCount = 1;
    facts.overdueProjectTaskCount = 1;
    facts.resourceRequestCount = 1;
    facts.openResourceRequestCount = 1;
    facts.closeToStartResourceRequestCount = 1;
    facts.budgetCount = 1;
    facts.budgetAmount = 1000;
    facts.budgetConsumedAmount = 1100;
    facts.budgetRemainingAmount = -100;
    return facts;
  }

  private static AgentforceAiApiProjectHealth.ProjectHealthFacts notFoundFacts() {
    AgentforceAiApiProjectHealth.ProjectHealthFacts facts = new AgentforceAiApiProjectHealth.ProjectHealthFacts();
    facts.found = false;
    return facts;
  }

  private static AgentforceAiApiProjectHealth.ProjectHealthFacts ambiguousFacts() {
    AgentforceAiApiProjectHealth.ProjectHealthFacts facts = new AgentforceAiApiProjectHealth.ProjectHealthFacts();
    facts.found = true;
    facts.ambiguous = true;
    return facts;
  }

  private class FakeProjectHealthDataProvider implements AgentforceAiApiProjectHealth.ProjectHealthDataProvider {
    private List<AgentforceAiApiProjectHealth.ProjectHealthFacts> facts;
    private Integer callIndex = 0;

    private FakeProjectHealthDataProvider(
      List<AgentforceAiApiProjectHealth.ProjectHealthFacts> facts
    ) {
      this.facts = facts;
    }

    public AgentforceAiApiProjectHealth.ProjectHealthFacts findProjectFacts(
      AgentforceAiApiProjectHealth.ProjectHealthRequest input
    ) {
      if (callIndex >= facts.size()) {
        return notFoundFacts();
      }
      AgentforceAiApiProjectHealth.ProjectHealthFacts result = facts[callIndex];
      callIndex++;
      return result;
    }
  }

  private static void assertPayloadSafety(String body) {
    System.assertNotEquals(null, body);
    System.assert(body.contains('"requestId":"test-project-health-request"'));
    System.assert(body.contains('"projectStatus":"yellow"'));
    System.assert(body.contains('"assignmentCount"'));
    System.assert(body.contains('"milestoneCount"'));
    System.assert(body.contains('"timecardHeaderCount"'));
    System.assert(!body.contains('Authorization'));
    System.assert(!body.contains('Phase8 Sensitive Customer Health Project'));
    System.assert(!body.contains('projectName'));
    System.assert(!body.contains('accountName'));
    System.assert(!body.contains('Project_Status_Notes'));
    System.assert(!body.contains('timecard notes'));
  }

  private class ProjectHealthMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;
    public String lastRequestBody;

    private ProjectHealthMock(Integer statusCode, String body) {
      this.statusCode = statusCode;
      this.body = body;
    }

    public HttpResponse respond(HttpRequest request) {
      assertRequestShape(request);
      lastRequestBody = request.getBody();
      HttpResponse response = new HttpResponse();
      response.setStatusCode(statusCode);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(body);
      return response;
    }
  }

  private class CountingProjectHealthMock implements HttpCalloutMock {
    public Integer callCount = 0;

    public HttpResponse respond(HttpRequest request) {
      callCount++;
      assertRequestShape(request);
      HttpResponse response = new HttpResponse();
      response.setStatusCode(201);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(
        '{"healthStatus":"green","riskLevel":"low","scheduleStatus":"green","budgetStatus":"green","staffingStatus":"green","summary":"Project health is stable.","riskDrivers":"no major risk drivers detected","recommendedActions":"continue normal project monitoring","confidence":"medium","provider":"openai","model":"gpt-4o-mini","fallbackUsed":false,"latencyMs":120}'
      );
      return response;
    }
  }

  private class ThrowingProjectHealthMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('Simulated timeout');
    }
  }

  private static void assertRequestShape(HttpRequest request) {
    System.assertEquals('POST', request.getMethod());
    System.assertEquals(
      'callout:Agentforce_AI_API_Phase2/agent/services/project-health',
      request.getEndpoint()
    );
    System.assertEquals('application/json', request.getHeader('Accept'));
    System.assertEquals('application/json', request.getHeader('Content-Type'));
    System.assertEquals(
      'phase-8-services-project-health',
      request.getHeader('X-Agentforce-Bridge')
    );
    System.assertEquals(null, request.getHeader('Authorization'));
  }
}

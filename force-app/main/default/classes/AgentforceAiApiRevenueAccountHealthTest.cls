@IsTest
private class AgentforceAiApiRevenueAccountHealthTest {
  private static Map<String, Object> aggregatePayload;
  private static String aggregateRequestBody;

  @IsTest
  static void summarizeReturnsEmptyResponseForEmptyInput() {
    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>()
    );
    Test.stopTest();

    System.assertEquals(0, responses.size());
  }

  @IsTest
  static void summarizeRequiresAccountKey() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    AgentforceAiApiRevenueAccountHealth.AccountHealthRequest request = new AgentforceAiApiRevenueAccountHealth.AccountHealthRequest();

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals('VALIDATION_ERROR', responses[0].actionStatus);
    System.assertEquals(null, responses[0].httpStatusCode);
  }

  @IsTest
  static void summarizeMapsSuccessfulResponse() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    Test.setMock(
      HttpCalloutMock.class,
      new RevenueHealthMock(
        201,
        '{"accountHealthScore":46,"accountHealthBand":"at_risk","churnRiskScore":82,"churnRiskLevel":"high","expansionScore":64,"expansionLevel":"medium","deliveryRiskLevel":"high","financialRiskLevel":"medium","supportRiskLevel":"high","executiveEngagementLevel":"weak","primaryDecision":"Prioritize retention before expansion.","summary":"Revenue health is pressured by support, delivery, and engagement signals.","decisionRationale":"Escalated cases; late milestones; overdue invoices; low activity","revenueImpact":"Renewal and expansion timing may slip without intervention.","operationalBlockers":"Support escalations; delivery delays; overdue invoices","recommendedActions":"Run executive save plan; resolve top escalations; assign delivery recovery owner; review renewal path","confidence":"high","provider":"openai","model":"gpt-4o-mini","fallbackUsed":false,"latencyMs":312}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('SUMMARIZED', responses[0].actionStatus);
    System.assertEquals(46, responses[0].accountHealthScore);
    System.assertEquals('at_risk', responses[0].accountHealthBand);
    System.assertEquals(82, responses[0].churnRiskScore);
    System.assertEquals('high', responses[0].churnRiskLevel);
    System.assertEquals(64, responses[0].expansionScore);
    System.assertEquals('medium', responses[0].expansionLevel);
    System.assertEquals('weak', responses[0].executiveEngagementLevel);
    System.assertEquals('openai', responses[0].provider);
    System.assertEquals('gpt-4o-mini', responses[0].model);
    System.assertEquals(false, responses[0].fallbackUsed);
    System.assertEquals(312, responses[0].latencyMs);
    System.assertEquals(201, responses[0].httpStatusCode);
    System.assertEquals('/agent/revenue/account-health', responses[0].endpoint);
    System.assert(
      responses[0].executiveBrief.contains('Revenue Account Health Brief')
    );
    System.assert(responses[0].executiveBrief.contains('- Health: 46/100.'));
    System.assert(
      responses[0].executiveBrief.contains('Next best action plan')
    );
    System.assert(
      responses[0].executiveBrief.contains('- Open opportunities: 4.')
    );
  }

  @IsTest
  static void summarizeCollectsStandardSalesforceAggregates() {
    User admin = adminUser();
    insert admin;
    System.runAs(admin) {
      Account account = new Account(
        Name = 'Revenue Health Aggregate Account',
        Industry = 'Technology',
        AnnualRevenue = 1250000,
        NumberOfEmployees = 240
      );
      insert account;

      insert new Case(
        AccountId = account.Id,
        Subject = 'Escalated revenue risk case',
        Status = 'New',
        Origin = 'Phone',
        Priority = 'High',
        IsEscalated = true
      );
      insert new Task(
        WhatId = account.Id,
        Subject = 'Executive checkpoint',
        Status = 'Completed',
        Priority = 'Normal',
        ActivityDate = Date.today().addDays(-3)
      );

      AgentforceAiApiRevenueAccountHealth.AccountHealthRequest request = new AgentforceAiApiRevenueAccountHealth.AccountHealthRequest();
      request.accountId = String.valueOf(account.Id);
      request.analysisIntent = 'qbr_preparation';
      request.requestId = 'standard-aggregate-test';

      Test.setMock(
        HttpCalloutMock.class,
        new AggregateRevenueHealthMock(account.Id)
      );

      Test.startTest();
      List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
        new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
          request
        }
      );
      Test.stopTest();

      System.assert(
        responses[0].actionStatus == 'SUMMARIZED',
        'actionStatus=' +
          responses[0].actionStatus +
          ', safeMessage=' +
          responses[0].safeMessage +
          ', httpStatus=' +
          responses[0].httpStatusCode +
          ', aggregatePayload=' +
          String.valueOf(aggregatePayload)
      );
      System.assertNotEquals(null, aggregatePayload);
      System.assertEquals(
        'standard-aggregate-test',
        aggregatePayload.get('requestId')
      );
      System.assertEquals(
        'qbr_preparation',
        aggregatePayload.get('analysisIntent')
      );
      System.assert(aggregatePayload.containsKey('sourceSystems'));
      System.assert(
        !String.isBlank(String.valueOf(aggregatePayload.get('sourceSystems')))
      );
      System.assert(!aggregateRequestBody.contains(String.valueOf(account.Id)));
      System.assert(responses[0].executiveBrief.contains('Signals reviewed'));
    }
  }

  @IsTest
  static void summarizeReturnsAmbiguousForNameMatches() {
    insert new Account(Name = 'Revenue Health Duplicate One');
    insert new Account(Name = 'Revenue Health Duplicate Two');

    AgentforceAiApiRevenueAccountHealth.AccountHealthRequest request = new AgentforceAiApiRevenueAccountHealth.AccountHealthRequest();
    request.accountKey = 'Revenue Health Duplicate';

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals('VALIDATION_ERROR', responses[0].actionStatus);
    System.assert(responses[0].safeMessage.contains('More than one Account'));
  }

  @IsTest
  static void summarizePrefersExactNameMatchOverPartialMatches() {
    Account exactAccount = new Account(
      Name = 'Prestige Worldwide',
      AnnualRevenue = 111111,
      NumberOfEmployees = 25
    );
    Account partialAccount = new Account(
      Name = 'Prestige Worldwide Holdings',
      AnnualRevenue = 999999,
      NumberOfEmployees = 250
    );
    insert new List<Account>{ exactAccount, partialAccount };

    AgentforceAiApiRevenueAccountHealth.AccountHealthRequest request = new AgentforceAiApiRevenueAccountHealth.AccountHealthRequest();
    request.accountKey = 'Prestige Worldwide';
    request.requestId = 'test-revenue-health-request';

    Test.setMock(
      HttpCalloutMock.class,
      new AggregateRevenueHealthMock(exactAccount.Id)
    );

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals('SUMMARIZED', responses[0].actionStatus);
    System.assertNotEquals(null, aggregatePayload);
    System.assertEquals(111111, aggregatePayload.get('annualRevenue'));
    System.assertEquals(25, aggregatePayload.get('employeeCount'));
    System.assert(
      responses[0].executiveBrief.contains('Revenue Account Health Brief')
    );
  }

  @IsTest
  static void summarizeCapsInvocationBatchSize() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    Test.setMock(
      HttpCalloutMock.class,
      new RevenueHealthMock(201, successBody())
    );

    List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest> requests = new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>();
    for (Integer index = 0; index < 6; index++) {
      requests.add(request());
    }

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      requests
    );
    Test.stopTest();

    System.assertEquals(6, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[5].actionStatus);
    System.assert(responses[5].safeMessage.contains('up to 5 accounts'));
  }

  @IsTest
  static void summarizeHandlesFactCollectionException() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new ThrowingProvider();

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals('UNEXPECTED_ERROR', responses[0].actionStatus);
    System.assertEquals(null, responses[0].httpStatusCode);
  }

  @IsTest
  static void summarizeReturnsNotFoundWhenProviderFindsNoAccount() {
    AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts missing = new AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts();
    missing.found = false;
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      missing
    );

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals('NOT_FOUND', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeReturnsAuthErrorForForbiddenStatus() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    Test.setMock(HttpCalloutMock.class, new RevenueHealthMock(403, '{}'));

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].actionStatus);
    System.assertEquals(403, responses[0].httpStatusCode);
  }

  @IsTest
  static void summarizeReturnsAuthErrorForUnauthorizedStatus() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    Test.setMock(HttpCalloutMock.class, new RevenueHealthMock(401, '{}'));

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].actionStatus);
    System.assertEquals(401, responses[0].httpStatusCode);
  }

  @IsTest
  static void summarizeReturnsBackendErrorForNonSuccessStatus() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    Test.setMock(HttpCalloutMock.class, new RevenueHealthMock(503, '{}'));

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals('BACKEND_ERROR', responses[0].actionStatus);
    System.assertEquals(503, responses[0].httpStatusCode);
  }

  @IsTest
  static void summarizeRejectsMalformedJson() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    Test.setMock(
      HttpCalloutMock.class,
      new RevenueHealthMock(201, '{not-json')
    );

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].actionStatus);
  }

  @IsTest
  static void summarizeHandlesCalloutException() {
    AgentforceAiApiRevenueAccountHealth.dataProvider = new FakeProvider(
      facts()
    );
    Test.setMock(HttpCalloutMock.class, new ThrowingRevenueHealthMock());

    Test.startTest();
    List<AgentforceAiApiRevenueAccountHealth.AccountHealthResponse> responses = AgentforceAiApiRevenueAccountHealth.summarizeAccountHealth(
      new List<AgentforceAiApiRevenueAccountHealth.AccountHealthRequest>{
        request()
      }
    );
    Test.stopTest();

    System.assertEquals('CALLOUT_FAILED', responses[0].actionStatus);
  }

  private static AgentforceAiApiRevenueAccountHealth.AccountHealthRequest request() {
    AgentforceAiApiRevenueAccountHealth.AccountHealthRequest request = new AgentforceAiApiRevenueAccountHealth.AccountHealthRequest();
    request.accountKey = 'Acme Strategic Account';
    request.accountName = 'Jane Doe jane@example.com 415-555-1212';
    request.analysisIntent = 'general';
    request.requestId = 'test-revenue-health-request';
    return request;
  }

  private static AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts facts() {
    AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts facts = new AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts();
    facts.found = true;
    facts.accountId = '001000000000001AAA';
    facts.accountType = 'Customer';
    facts.accountIndustry = 'Software';
    facts.annualRevenue = 2500000;
    facts.employeeCount = 850;
    facts.accountAgeDays = 1400;
    facts.openOpportunityCount = 4;
    facts.openOpportunityAmount = 460000;
    facts.weightedPipelineAmount = 220000;
    facts.daysToNextCloseDate = 21;
    facts.wonOpportunityCountLast180Days = 2;
    facts.lostOpportunityCountLast180Days = 1;
    facts.renewalOpportunityCount = 1;
    facts.renewalOpportunityAmount = 180000;
    facts.expansionOpportunityCount = 2;
    facts.expansionOpportunityAmount = 280000;
    facts.openCaseCount = 7;
    facts.escalatedCaseCount = 2;
    facts.highPriorityCaseCount = 3;
    facts.oldestOpenCaseAgeDays = 42;
    facts.activityCountLast30Days = 1;
    facts.daysSinceLastActivity = 37;
    facts.activeProjectCount = 2;
    facts.atRiskProjectCount = 1;
    facts.lateMilestoneCount = 3;
    facts.openResourceRequestCount = 1;
    facts.avgProjectMarginPercent = 12;
    facts.totalProjectRemainingAmount = -15000;
    facts.overdueInvoiceCount = 2;
    facts.overdueInvoiceAmount = 42000;
    facts.averagePaymentDelayDays = 18;
    facts.marginPressureAmount = 31000;
    facts.productActiveUserCount = 120;
    facts.productUsageTrendPercent = -22;
    facts.featureAdoptionPercent = 41;
    facts.sourceSystems = 'Salesforce CRM aggregates; Certinia PSA aggregates';
    return facts;
  }

  private static String successBody() {
    return '{"accountHealthScore":46,"accountHealthBand":"at_risk","churnRiskScore":82,"churnRiskLevel":"high","expansionScore":64,"expansionLevel":"medium","deliveryRiskLevel":"high","financialRiskLevel":"medium","supportRiskLevel":"high","executiveEngagementLevel":"weak","primaryDecision":"Prioritize retention before expansion.","summary":"Revenue health is pressured by support, delivery, and engagement signals.","decisionRationale":"Escalated cases; late milestones; overdue invoices; low activity","revenueImpact":"Renewal and expansion timing may slip without intervention.","operationalBlockers":"Support escalations; delivery delays; overdue invoices","recommendedActions":"Run executive save plan; resolve top escalations; assign delivery recovery owner; review renewal path","confidence":"high","provider":"openai","model":"gpt-4o-mini","fallbackUsed":false,"latencyMs":312}';
  }

  private static User adminUser() {
    Profile profile = [
      SELECT Id
      FROM Profile
      WHERE Name = 'System Administrator'
      LIMIT 1
    ];
    String uniqueValue = String.valueOf(DateTime.now().getTime());
    return new User(
      Alias = 'rha' + uniqueValue.right(5),
      Email = 'revenue-health-' + uniqueValue + '@example.com',
      EmailEncodingKey = 'UTF-8',
      LastName = 'RevenueHealthAdmin',
      LanguageLocaleKey = 'en_US',
      LocaleSidKey = 'en_US',
      ProfileId = profile.Id,
      TimeZoneSidKey = 'America/Los_Angeles',
      UserName = 'revenue-health-' + uniqueValue + '@example.com'
    );
  }

  private class FakeProvider implements AgentforceAiApiRevenueAccountHealth.RevenueAccountDataProvider {
    private AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts facts;

    private FakeProvider(
      AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts facts
    ) {
      this.facts = facts;
    }

    public AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts findAccountFacts(
      AgentforceAiApiRevenueAccountHealth.AccountHealthRequest input
    ) {
      return facts;
    }
  }

  private class ThrowingProvider implements AgentforceAiApiRevenueAccountHealth.RevenueAccountDataProvider {
    public AgentforceAiApiRevenueAccountHealth.RevenueAccountFacts findAccountFacts(
      AgentforceAiApiRevenueAccountHealth.AccountHealthRequest input
    ) {
      throw new QueryException('Simulated aggregate failure');
    }
  }

  private class RevenueHealthMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;

    private RevenueHealthMock(Integer statusCode, String body) {
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

  private class ThrowingRevenueHealthMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('Simulated timeout');
    }
  }

  private class AggregateRevenueHealthMock implements HttpCalloutMock {
    private Id accountId;

    private AggregateRevenueHealthMock(Id accountId) {
      this.accountId = accountId;
    }

    public HttpResponse respond(HttpRequest request) {
      aggregateRequestBody = request.getBody();
      aggregatePayload = (Map<String, Object>) JSON.deserializeUntyped(
        request.getBody()
      );

      HttpResponse response = new HttpResponse();
      response.setStatusCode(200);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(successBody());
      return response;
    }
  }

  private static void assertRequestShape(HttpRequest request) {
    System.assertEquals('POST', request.getMethod());
    System.assertEquals(
      'callout:Agentforce_AI_API_Phase2/agent/revenue/account-health',
      request.getEndpoint()
    );
    System.assertEquals('application/json', request.getHeader('Accept'));
    System.assertEquals('application/json', request.getHeader('Content-Type'));
    System.assertEquals(
      'phase-9-revenue-account-health',
      request.getHeader('X-Agentforce-Bridge')
    );
    System.assertEquals(null, request.getHeader('Authorization'));

    Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(
      request.getBody()
    );
    System.assertEquals(
      'test-revenue-health-request',
      payload.get('requestId')
    );
    System.assertEquals('general', payload.get('analysisIntent'));
    System.assertEquals(4, payload.get('openOpportunityCount'));
    System.assertEquals(7, payload.get('openCaseCount'));
    System.assertEquals(1, payload.get('activityCountLast30Days'));
    System.assertEquals(2, payload.get('activeProjectCount'));
    System.assertEquals(2, payload.get('overdueInvoiceCount'));
    System.assertEquals(null, payload.get('accountName'));
    String body = request.getBody();
    System.assert(!body.contains('Jane Doe'));
    System.assert(!body.contains('jane@example.com'));
    System.assert(!body.contains('415-555-1212'));
    System.assert(!body.contains('001000000000001AAA'));
  }
}

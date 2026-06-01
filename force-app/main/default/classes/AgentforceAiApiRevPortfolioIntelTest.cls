@IsTest
private class AgentforceAiApiRevPortfolioIntelTest {
  private static Map<String, Object> capturedPayload;
  private static String capturedRequestBody;

  @IsTest
  static void analyzeReturnsNoAccountsForEmptyInput() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>()
    );

    Test.startTest();
    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>()
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('NO_ACCOUNTS', responses[0].analysisStatus);
    System.assertEquals('INSUFFICIENT_DATA', responses[0].portfolioStatus);
    System.assertEquals(null, responses[0].httpStatusCode);
    System.assert(responses[0].portfolioBrief.contains('Insufficient data'));
  }

  @IsTest
  static void analyzeMapsSuccessfulPortfolioResponse() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>{
        account(
          '001000000000001AAA',
          'Acme Strategic Account',
          4,
          1,
          2,
          21,
          7,
          2,
          3,
          37,
          -22
        ),
        account(
          '001000000000002AAA',
          'Global Expansion Account',
          3,
          0,
          2,
          90,
          0,
          0,
          0,
          8,
          18
        )
      }
    );
    Test.setMock(HttpCalloutMock.class, new PortfolioMock(201, successBody()));

    AgentforceAiApiRevPortfolioIntel.PortfolioRequest request = new AgentforceAiApiRevPortfolioIntel.PortfolioRequest();
    request.analysisFocus = 'Risk';
    request.requestId = 'portfolio-test-1';

    Test.startTest();
    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );
    Test.stopTest();

    AgentforceAiApiRevPortfolioIntel.PortfolioResponse response = responses[0];
    System.assertEquals('ANALYZED', response.analysisStatus);
    System.assertEquals('ATTENTION_REQUIRED', response.portfolioStatus);
    System.assertEquals('openai', response.provider);
    System.assertEquals('gpt-4o-mini', response.model);
    System.assertEquals(false, response.fallbackUsed);
    System.assertEquals(false, response.decisionFallbackUsed);
    System.assertEquals(77, response.latencyMs);
    System.assertEquals(201, response.httpStatusCode);
    System.assertEquals(
      '/agent/revenue/portfolio-intelligence',
      response.endpoint
    );
    System.assertEquals('001000000000001AAA', response.topAccountId);
    System.assertEquals('Acme Strategic Account', response.topAccountName);
    System.assert(response.topRiskAccounts.contains('Acme Strategic Account'));
    System.assert(
      response.topExpansionAccounts.contains('Global Expansion Account')
    );
    System.assert(
      response.portfolioWatchlists.contains('Churn risk watchlist')
    );
    System.assert(response.weeklyExecutionPlan.contains('Monday'));
    System.assert(
      response.portfolioBrief.contains('Revenue Portfolio Intelligence Brief')
    );
    System.assert(
      response.portfolioBrief.contains('Autonomous drilldown candidate')
    );
  }

  @IsTest
  static void analyzePayloadUsesReferencesNotRawAccountIdentifiers() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>{
        account(
          '001000000000001AAA',
          'Acme Strategic Account',
          4,
          1,
          2,
          21,
          7,
          2,
          3,
          37,
          -22
        )
      }
    );
    Test.setMock(
      HttpCalloutMock.class,
      new CapturingPortfolioMock(200, successBody())
    );

    AgentforceAiApiRevPortfolioIntel.PortfolioRequest request = new AgentforceAiApiRevPortfolioIntel.PortfolioRequest();
    request.analysisFocus = 'Churn';
    request.requestId = 'portfolio-sanitize-test';

    Test.startTest();
    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals('ANALYZED', responses[0].analysisStatus);
    System.assertNotEquals(null, capturedPayload);
    System.assertEquals(
      'portfolio-sanitize-test',
      capturedPayload.get('requestId')
    );
    System.assertEquals('churn', capturedPayload.get('analysisFocus'));
    List<Object> accounts = (List<Object>) capturedPayload.get('accounts');
    System.assertEquals(1, accounts.size());
    Map<String, Object> firstAccount = (Map<String, Object>) accounts[0];
    System.assertEquals('account-1', firstAccount.get('accountReference'));
    System.assertEquals(7, firstAccount.get('openCaseCount'));
    System.assert(!capturedRequestBody.contains('Acme Strategic Account'));
    System.assert(!capturedRequestBody.contains('001000000000001AAA'));
    System.assert(!capturedRequestBody.contains('accountName'));
    System.assert(!capturedRequestBody.contains('accountId'));
  }

  @IsTest
  static void analyzeCollectsStandardSalesforcePortfolioSignals() {
    Account account = new Account(
      Name = 'Portfolio Aggregate Account',
      Type = 'Customer',
      Industry = 'Software',
      AnnualRevenue = 3200000
    );
    insert account;

    insert new Case(
      AccountId = account.Id,
      Subject = 'Escalated portfolio risk case',
      Status = 'New',
      Origin = 'Phone',
      Priority = 'High',
      IsEscalated = true
    );
    insert new Task(
      WhatId = account.Id,
      Subject = 'Executive portfolio review',
      Status = 'Completed',
      Priority = 'Normal',
      ActivityDate = Date.today().addDays(-10)
    );

    AgentforceAiApiRevPortfolioIntel.useSoqlDataProvider();
    Test.setMock(
      HttpCalloutMock.class,
      new CapturingPortfolioMock(200, successBody())
    );

    AgentforceAiApiRevPortfolioIntel.PortfolioRequest request = new AgentforceAiApiRevPortfolioIntel.PortfolioRequest();
    request.scopeFilter = 'Visible';
    request.searchText = 'Portfolio Aggregate';
    request.attentionFilter = 'Risk';
    request.maxAccounts = 5;
    request.requestId = 'portfolio-soql-test';

    Test.startTest();
    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals('ANALYZED', responses[0].analysisStatus);
    System.assertEquals(1, responses[0].accountCount);
    List<Object> accounts = (List<Object>) capturedPayload.get('accounts');
    Map<String, Object> firstAccount = (Map<String, Object>) accounts[0];
    System.assertEquals(0, firstAccount.get('openOpportunityCount'));
    System.assertEquals(0, firstAccount.get('renewalOpportunityCount'));
    System.assertEquals(0, firstAccount.get('expansionOpportunityCount'));
    System.assertEquals(1, firstAccount.get('openCaseCount'));
    System.assertEquals(1, firstAccount.get('escalatedCaseCount'));
    System.assert(!capturedRequestBody.contains(String.valueOf(account.Id)));
    System.assert(!capturedRequestBody.contains('Portfolio Aggregate Account'));
  }

  @IsTest
  static void analyzeValidatesFilters() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>()
    );
    AgentforceAiApiRevPortfolioIntel.PortfolioRequest request = new AgentforceAiApiRevPortfolioIntel.PortfolioRequest();
    request.analysisFocus = 'Forecast';

    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );
    System.assertEquals('VALIDATION_ERROR', responses[0].analysisStatus);

    request.analysisFocus = null;
    request.attentionFilter = 'Largest ARR';
    responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );
    System.assertEquals('VALIDATION_ERROR', responses[0].analysisStatus);

    request.attentionFilter = null;
    request.scopeFilter = 'Team';
    responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );
    System.assertEquals('VALIDATION_ERROR', responses[0].analysisStatus);
  }

  @IsTest
  static void analyzeFallsBackToVisibleScopeForExpansionWhenOwnedHasNoMatches() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new ScopeAwareProvider(
      new Map<String, List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>>{
        'owned' => new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>(),
        'visible' => new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>{
          account(
            '001000000000003AAA',
            'Visible Expansion Candidate',
            1,
            0,
            0,
            45,
            0,
            0,
            0,
            6,
            12
          )
        }
      }
    );
    Test.setMock(
      HttpCalloutMock.class,
      new CapturingPortfolioMock(201, successBody())
    );

    AgentforceAiApiRevPortfolioIntel.PortfolioRequest request = new AgentforceAiApiRevPortfolioIntel.PortfolioRequest();
    request.analysisFocus = 'Expansion';
    request.requestId = 'portfolio-visible-fallback';

    Test.startTest();
    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals('ANALYZED', responses[0].analysisStatus);
    System.assertEquals(1, responses[0].accountCount);
    System.assertEquals('expansion', capturedPayload.get('analysisFocus'));
    List<Object> accounts = (List<Object>) capturedPayload.get('accounts');
    System.assertEquals(1, accounts.size());
  }

  @IsTest
  static void analyzeHandlesProviderFailure() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new ThrowingProvider();

    AgentforceAiApiRevPortfolioIntel.PortfolioRequest request = new AgentforceAiApiRevPortfolioIntel.PortfolioRequest();
    request.analysisFocus = 'Risk';

    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{ request }
    );

    System.assertEquals('UNEXPECTED_ERROR', responses[0].analysisStatus);
    System.assertEquals(null, responses[0].httpStatusCode);
  }

  @IsTest
  static void analyzeReturnsAuthErrorForForbiddenStatus() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>{
        account(
          '001000000000001AAA',
          'Acme Strategic Account',
          1,
          0,
          0,
          20,
          1,
          0,
          0,
          10,
          0
        )
      }
    );
    Test.setMock(HttpCalloutMock.class, new PortfolioMock(403, '{}'));

    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{
        new AgentforceAiApiRevPortfolioIntel.PortfolioRequest()
      }
    );

    System.assertEquals('AUTH_ERROR', responses[0].analysisStatus);
    System.assertEquals(403, responses[0].httpStatusCode);
  }

  @IsTest
  static void analyzeRejectsMalformedJson() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>{
        account(
          '001000000000001AAA',
          'Acme Strategic Account',
          1,
          0,
          0,
          20,
          1,
          0,
          0,
          10,
          0
        )
      }
    );
    Test.setMock(HttpCalloutMock.class, new PortfolioMock(200, '{not-json'));

    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{
        new AgentforceAiApiRevPortfolioIntel.PortfolioRequest()
      }
    );

    System.assertEquals('MALFORMED_RESPONSE', responses[0].analysisStatus);
  }

  @IsTest
  static void analyzeHandlesCalloutException() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>{
        account(
          '001000000000001AAA',
          'Acme Strategic Account',
          1,
          0,
          0,
          20,
          1,
          0,
          0,
          10,
          0
        )
      }
    );
    Test.setMock(HttpCalloutMock.class, new ThrowingPortfolioMock());

    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>{
        new AgentforceAiApiRevPortfolioIntel.PortfolioRequest()
      }
    );

    System.assertEquals('CALLOUT_FAILED', responses[0].analysisStatus);
  }

  @IsTest
  static void analyzeCapsInvocationBatchSize() {
    AgentforceAiApiRevPortfolioIntel.dataProvider = new FakeProvider(
      new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>{
        account(
          '001000000000001AAA',
          'Acme Strategic Account',
          1,
          0,
          0,
          20,
          1,
          0,
          0,
          10,
          0
        )
      }
    );
    Test.setMock(HttpCalloutMock.class, new PortfolioMock(200, successBody()));

    List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest> requests = new List<AgentforceAiApiRevPortfolioIntel.PortfolioRequest>();
    for (Integer index = 0; index < 4; index++) {
      requests.add(new AgentforceAiApiRevPortfolioIntel.PortfolioRequest());
    }

    List<AgentforceAiApiRevPortfolioIntel.PortfolioResponse> responses = AgentforceAiApiRevPortfolioIntel.analyzePortfolio(
      requests
    );

    System.assertEquals(4, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[3].analysisStatus);
  }

  private static AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts account(
    Id accountId,
    String accountName,
    Integer openOpportunityCount,
    Integer renewalOpportunityCount,
    Integer expansionOpportunityCount,
    Integer daysToNextCloseDate,
    Integer openCaseCount,
    Integer escalatedCaseCount,
    Integer highPriorityCaseCount,
    Integer daysSinceLastActivity,
    Decimal productUsageTrendPercent
  ) {
    AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts account = new AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts();
    account.accountId = accountId;
    account.accountName = accountName;
    account.accountType = 'Customer';
    account.industry = 'Software';
    account.annualRevenue = 2500000;
    account.openOpportunityCount = openOpportunityCount;
    account.renewalOpportunityCount = renewalOpportunityCount;
    account.expansionOpportunityCount = expansionOpportunityCount;
    account.daysToNextCloseDate = daysToNextCloseDate;
    account.openCaseCount = openCaseCount;
    account.escalatedCaseCount = escalatedCaseCount;
    account.highPriorityCaseCount = highPriorityCaseCount;
    account.daysSinceLastActivity = daysSinceLastActivity;
    account.productUsageTrendPercent = productUsageTrendPercent;
    return account;
  }

  private static String successBody() {
    return '{"portfolioStatus":"ATTENTION_REQUIRED","summary":"Portfolio needs retention focus before expansion sequencing.","topRiskAccounts":[{"accountReference":"account-1","rank":1,"score":88,"level":"high","reason":"Escalations and renewal proximity.","supportingSignals":["open escalations","renewal proximity"],"recommendedAction":"Run executive outreach."}],"topExpansionAccounts":[{"accountReference":"account-2","rank":1,"score":72,"level":"high","reason":"Expansion pipeline and usage momentum.","supportingSignals":["expansion pipeline","usage growth"],"recommendedAction":"Sequence expansion outreach."}],"urgentRenewals":[{"accountReference":"account-1","rank":1,"score":80,"level":"high","reason":"Renewal is near close.","supportingSignals":["renewal proximity"],"recommendedAction":"Review renewal blockers."}],"escalationAccounts":[{"accountReference":"account-1","rank":1,"score":82,"level":"high","reason":"Open escalations.","supportingSignals":["open escalations"],"recommendedAction":"Run support review."}],"silentAccounts":[{"accountReference":"account-1","rank":1,"score":60,"level":"medium","reason":"Low recent activity.","supportingSignals":["account inactivity window"],"recommendedAction":"Schedule customer-success sync."}],"portfolioWatchlists":[{"name":"Churn risk watchlist","accountReferences":["account-1"],"rationale":"Retention pressure is concentrated."}],"portfolioTrends":[{"trend":"Renewal risk concentration","direction":"near_term","severity":"high","rationale":"One high-risk renewal is close."}],"recommendedActions":[{"priority":"high","action":"Run executive outreach.","accountReferences":["account-1"],"rationale":"Risk is urgent."}],"weeklyExecutionPlan":[{"day":"Monday","actions":["Call account-1 renewal team"]}],"provider":"openai","model":"gpt-4o-mini","fallbackUsed":false,"decisionFallbackUsed":false,"latencyMs":77}';
  }

  private class FakeProvider implements AgentforceAiApiRevPortfolioIntel.PortfolioDataProvider {
    private List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> accounts;

    private FakeProvider(
      List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> accounts
    ) {
      this.accounts = accounts;
    }

    public List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> findPortfolioFacts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> results = new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>();
      for (
        AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts account : accounts
      ) {
        if (results.size() >= maxRows) {
          break;
        }
        results.add(account);
      }
      return results;
    }
  }

  private class ThrowingProvider implements AgentforceAiApiRevPortfolioIntel.PortfolioDataProvider {
    public List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> findPortfolioFacts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      throw new QueryException('simulated provider failure');
    }
  }

  private class ScopeAwareProvider implements AgentforceAiApiRevPortfolioIntel.PortfolioDataProvider {
    private Map<String, List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>> accountsByScope;

    private ScopeAwareProvider(
      Map<String, List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>> accountsByScope
    ) {
      this.accountsByScope = accountsByScope;
    }

    public List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> findPortfolioFacts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> source = accountsByScope.containsKey(
          scopeFilter
        )
        ? accountsByScope.get(scopeFilter)
        : new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>();
      List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts> results = new List<AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts>();
      for (
        AgentforceAiApiRevPortfolioIntel.PortfolioAccountFacts account : source
      ) {
        if (results.size() >= maxRows) {
          break;
        }
        results.add(account);
      }
      return results;
    }
  }

  private class PortfolioMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;

    private PortfolioMock(Integer statusCode, String body) {
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

  private class CapturingPortfolioMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;

    private CapturingPortfolioMock(Integer statusCode, String body) {
      this.statusCode = statusCode;
      this.body = body;
    }

    public HttpResponse respond(HttpRequest request) {
      assertRequestShape(request);
      capturedRequestBody = request.getBody();
      capturedPayload = (Map<String, Object>) JSON.deserializeUntyped(
        request.getBody()
      );
      HttpResponse response = new HttpResponse();
      response.setStatusCode(statusCode);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(body);
      return response;
    }
  }

  private class ThrowingPortfolioMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('simulated timeout');
    }
  }

  private static void assertRequestShape(HttpRequest request) {
    System.assertEquals('POST', request.getMethod());
    System.assertEquals(
      'callout:Agentforce_AI_API_Phase2/agent/revenue/portfolio-intelligence',
      request.getEndpoint()
    );
    System.assertEquals('application/json', request.getHeader('Accept'));
    System.assertEquals('application/json', request.getHeader('Content-Type'));
    System.assertEquals(
      'phase-9b-revenue-portfolio-intelligence',
      request.getHeader('X-Agentforce-Bridge')
    );
    System.assertEquals(null, request.getHeader('Authorization'));
  }
}

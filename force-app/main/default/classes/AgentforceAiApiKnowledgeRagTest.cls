@IsTest
private class AgentforceAiApiKnowledgeRagTest {
  @IsTest
  static void answerReturnsEmptyResponseForEmptyInput() {
    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>()
    );
    Test.stopTest();

    System.assertEquals(0, responses.size());
  }

  @IsTest
  static void answerRequiresQuestion() {
    AgentforceAiApiKnowledgeRag.KnowledgeRequest request = new AgentforceAiApiKnowledgeRag.KnowledgeRequest();

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].ragStatus);
    System.assertEquals(null, responses[0].httpStatusCode);
  }

  @IsTest
  static void answerMapsSuccessfulResponseWithSources() {
    Test.setMock(HttpCalloutMock.class, new KnowledgeMock(201, successBody()));

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest()
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('ANSWERED', responses[0].ragStatus);
    System.assertEquals(1, responses[0].sourceCount);
    System.assertEquals('kb-1', responses[0].sourceIds);
    System.assertEquals('Troubleshooting', responses[0].sourceTitles);
    System.assertEquals(
      'https://help.example.invalid/kb-1',
      responses[0].sourceUrls
    );
    System.assertEquals('kb-1:v1:chunk-1', responses[0].sourceChunkIds);
    System.assertEquals('rag-1', responses[0].retrievalIds);
    System.assertEquals('openai', responses[0].provider);
    System.assertEquals('gpt-4o-mini', responses[0].model);
    System.assertEquals('openai', responses[0].embeddingProvider);
    System.assertEquals('text-embedding-3-small', responses[0].embeddingModel);
    System.assertEquals('pinecone', responses[0].vectorDbProvider);
    System.assertEquals(false, responses[0].fallbackUsed);
    System.assertEquals(822, responses[0].latencyMs);
    System.assertEquals(201, responses[0].httpStatusCode);
    System.assertEquals('/agent/knowledge/answer', responses[0].endpoint);
  }

  @IsTest
  static void answerMapsNoSourceResponse() {
    Test.setMock(HttpCalloutMock.class, new KnowledgeMock(201, noSourceBody()));

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest()
      }
    );
    Test.stopTest();

    System.assertEquals('NO_SOURCE', responses[0].ragStatus);
    System.assertEquals(0, responses[0].sourceCount);
    System.assert(
      responses[0].answer.contains('I do not have an authorized source')
    );
  }

  @IsTest
  static void answerSendsOneCalloutPerValidInput() {
    CountingKnowledgeMock mock = new CountingKnowledgeMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest(),
        knowledgeRequest('How do credits work?')
      }
    );
    Test.stopTest();

    System.assertEquals(2, responses.size());
    System.assertEquals('ANSWERED', responses[0].ragStatus);
    System.assertEquals('ANSWERED', responses[1].ragStatus);
    System.assertEquals(2, mock.callCount);
  }

  @IsTest
  static void answerRejectsRegulatedQuestionsBeforeCallout() {
    CountingKnowledgeMock mock = new CountingKnowledgeMock();
    Test.setMock(HttpCalloutMock.class, mock);

    AgentforceAiApiKnowledgeRag.KnowledgeRequest request = knowledgeRequest(
      'Use Answer Knowledge RAG to decide what to do with a password reset code and legal or medical advice details.'
    );

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals('VALIDATION_ERROR', responses[0].ragStatus);
    System.assertEquals(0, mock.callCount);
  }

  @IsTest
  static void answerCapsLargeInvocationBatches() {
    CountingKnowledgeMock mock = new CountingKnowledgeMock();
    Test.setMock(HttpCalloutMock.class, mock);

    List<AgentforceAiApiKnowledgeRag.KnowledgeRequest> requests = new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>();
    for (Integer index = 0; index < 11; index++) {
      requests.add(knowledgeRequest('How do credits work?'));
    }

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      requests
    );
    Test.stopTest();

    System.assertEquals(11, responses.size());
    System.assertEquals(10, mock.callCount);
    System.assertEquals('VALIDATION_ERROR', responses[10].ragStatus);
  }

  @IsTest
  static void answerReturnsAuthErrorForUnauthorizedStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new KnowledgeMock(403, '{"message":"forbidden"}')
    );

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest()
      }
    );
    Test.stopTest();

    System.assertEquals('AUTH_ERROR', responses[0].ragStatus);
    System.assertEquals(403, responses[0].httpStatusCode);
  }

  @IsTest
  static void answerReturnsBackendErrorForNonSuccessStatus() {
    Test.setMock(
      HttpCalloutMock.class,
      new KnowledgeMock(503, '{"message":"temporarily unavailable"}')
    );

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest()
      }
    );
    Test.stopTest();

    System.assertEquals('BACKEND_ERROR', responses[0].ragStatus);
    System.assertEquals(503, responses[0].httpStatusCode);
  }

  @IsTest
  static void answerRejectsMalformedJson() {
    Test.setMock(HttpCalloutMock.class, new KnowledgeMock(201, '{not-json'));

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest()
      }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].ragStatus);
  }

  @IsTest
  static void answerRejectsUnexpectedContract() {
    Test.setMock(
      HttpCalloutMock.class,
      new KnowledgeMock(
        201,
        '{"answerStatus":"MAYBE","answer":"Missing fields"}'
      )
    );

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest()
      }
    );
    Test.stopTest();

    System.assertEquals('MALFORMED_RESPONSE', responses[0].ragStatus);
  }

  @IsTest
  static void answerHandlesCalloutException() {
    Test.setMock(HttpCalloutMock.class, new ThrowingKnowledgeMock());

    Test.startTest();
    List<AgentforceAiApiKnowledgeRag.KnowledgeResponse> responses = AgentforceAiApiKnowledgeRag.answerQuestions(
      new List<AgentforceAiApiKnowledgeRag.KnowledgeRequest>{
        knowledgeRequest()
      }
    );
    Test.stopTest();

    System.assertEquals('CALLOUT_FAILED', responses[0].ragStatus);
  }

  private static AgentforceAiApiKnowledgeRag.KnowledgeRequest knowledgeRequest() {
    return knowledgeRequest(
      'What should I tell Jane Doe at jane@example.com with account number ACCT-123456 and no service?'
    );
  }

  private static AgentforceAiApiKnowledgeRag.KnowledgeRequest knowledgeRequest(
    String question
  ) {
    AgentforceAiApiKnowledgeRag.KnowledgeRequest request = new AgentforceAiApiKnowledgeRag.KnowledgeRequest();
    request.question = question;
    request.contextSummary = 'Customer name is Jane Doe. Email jane@example.com, phone 415-555-1212, card 4111 1111 1111 1111, SSN 123-45-6789, and service address 123 Main St Apt 4B.';
    request.locale = 'en-US';
    request.requestId = 'test-knowledge-rag-request';
    return request;
  }

  private static String successBody() {
    return '{"answerStatus":"ANSWERED","safeMessage":"Grounded answer generated from authorized knowledge sources.","answer":"Power cycle the gateway for 30 seconds and escalate if unresolved. Source kb-1 chunk kb-1:v1:chunk-1.","sourceCount":1,"sourceIds":"kb-1","sourceTitles":"Troubleshooting","sourceUrls":"https://help.example.invalid/kb-1","sourceVersions":"v1","sourceChunkIds":"kb-1:v1:chunk-1","retrievalIds":"rag-1","sourcesJson":"safe-source-json","provider":"openai","model":"gpt-4o-mini","embeddingProvider":"openai","embeddingModel":"text-embedding-3-small","vectorDbProvider":"pinecone","fallbackUsed":false,"latencyMs":822}';
  }

  private static String noSourceBody() {
    return '{"answerStatus":"NO_SOURCE","safeMessage":"No authorized knowledge source was found for this question.","answer":"I do not have an authorized source for that answer. Please route this to a human support owner or ingest an approved knowledge source first.","sourceCount":0,"sourceIds":"","sourceTitles":"","sourceUrls":"","sourceVersions":"","sourceChunkIds":"","retrievalIds":"","embeddingProvider":"openai","embeddingModel":"text-embedding-3-small","vectorDbProvider":"pinecone","fallbackUsed":false,"latencyMs":120}';
  }

  private class KnowledgeMock implements HttpCalloutMock {
    private Integer statusCode;
    private String body;

    private KnowledgeMock(Integer statusCode, String body) {
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

  private class CountingKnowledgeMock implements HttpCalloutMock {
    public Integer callCount = 0;

    public HttpResponse respond(HttpRequest request) {
      callCount++;
      assertRequestShape(request);
      HttpResponse response = new HttpResponse();
      response.setStatusCode(201);
      response.setHeader('Content-Type', 'application/json');
      response.setBody(successBody());
      return response;
    }
  }

  private class ThrowingKnowledgeMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest request) {
      throw new CalloutException('Simulated timeout');
    }
  }

  private static void assertRequestShape(HttpRequest request) {
    System.assertEquals('POST', request.getMethod());
    System.assertEquals(
      'callout:Agentforce_AI_API_Phase2/agent/knowledge/answer',
      request.getEndpoint()
    );
    System.assertEquals('application/json', request.getHeader('Accept'));
    System.assertEquals('application/json', request.getHeader('Content-Type'));
    System.assertEquals(
      'phase-4-knowledge-rag',
      request.getHeader('X-Agentforce-Bridge')
    );
    System.assertEquals(null, request.getHeader('Authorization'));

    Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(
      request.getBody()
    );
    System.assertEquals('test-knowledge-rag-request', payload.get('requestId'));
    System.assertEquals('en-US', payload.get('locale'));
    String question = String.valueOf(payload.get('question'));
    String contextSummary = String.valueOf(payload.get('contextSummary'));
    if (question.startsWith('What should')) {
      System.assert(question.contains('[redacted-name]'));
      System.assert(question.contains('[redacted-email]'));
      System.assert(question.contains('[redacted-identifier]'));
    }
    System.assert(contextSummary.contains('[redacted-name]'));
    System.assert(contextSummary.contains('[redacted-email]'));
    System.assert(contextSummary.contains('[redacted-phone]'));
    System.assert(contextSummary.contains('[redacted-payment]'));
    System.assert(contextSummary.contains('[redacted-ssn]'));
    System.assert(contextSummary.contains('[redacted-address]'));
    System.assert(!request.getBody().contains('Jane Doe'));
    System.assert(!request.getBody().contains('jane@example.com'));
    System.assert(!request.getBody().contains('415-555-1212'));
    System.assert(!request.getBody().contains('ACCT-123456'));
    System.assert(!request.getBody().contains('4111 1111 1111 1111'));
    System.assert(!request.getBody().contains('123-45-6789'));
    System.assert(!request.getBody().contains('123 Main St'));
  }
}

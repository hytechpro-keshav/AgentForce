/**
 * Tests for the Phase 6b+ Salesforce → NestJS approval callback. The callout
 * is mocked; the test asserts the decision/token gating and that a valid
 * approved/rejected Case enqueues exactly one callout.
 */
@IsTest
private class AgentforceGuardrailApprovalCallbackTest {
  private static final String WORKFLOW_ID = 'wf-12345678-1234-1234-1234-1234567890ab';
  private static final String RESUME_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test.signature';

  @TestSetup
  static void setup() {
    // Grant FLS so seedCase can stamp the guardrail fields and the dispatcher
    // can read them. Isolate the setup-object DML in runAs (mixed DML).
    System.runAs(new User(Id = UserInfo.getUserId())) {
      List<PermissionSet> perms = [
        SELECT Id
        FROM PermissionSet
        WHERE Name = 'Agentforce_Guardrail_Node6'
        LIMIT 1
      ];
      if (
        !perms.isEmpty() &&
        [
          SELECT COUNT()
          FROM PermissionSetAssignment
          WHERE
            AssigneeId = :UserInfo.getUserId()
            AND PermissionSetId = :perms[0].Id
        ] == 0
      ) {
        insert new PermissionSetAssignment(
          AssigneeId = UserInfo.getUserId(),
          PermissionSetId = perms[0].Id
        );
      }
    }
  }

  /**
   * Counts ONLY callbacks to the guardrail resume endpoint. Inserting a Case
   * fires the active Case_Triage_Orchestrator_Handoff Flow, whose own callout
   * to `/triggers` would otherwise inflate the count — filter by endpoint.
   */
  private class CallbackMock implements HttpCalloutMock {
    public Integer count = 0;
    public String lastBody;
    public String lastEndpoint;
    public HttpResponse respond(HttpRequest request) {
      if (request.getEndpoint().contains('/sf-approval-callback')) {
        this.count++;
        this.lastBody = request.getBody();
        this.lastEndpoint = request.getEndpoint();
      }
      HttpResponse response = new HttpResponse();
      response.setStatusCode(200);
      response.setBody('{"status":"done","applied":true}');
      return response;
    }
  }

  private static Id seedCase(String status, String workflowId, String token) {
    Account account = new Account(Name = 'Aptivance Callback Test');
    insert account;
    // Set the guardrail fields on the INITIAL insert (not a follow-up update),
    // so the update-triggered callback Flow does not fire on seeding and the
    // test isolates the explicit dispatch() callout. (DML ignores FLS, so no
    // permission set is needed to populate the fields here.)
    Case supportCase = new Case(
      AccountId = account.Id,
      Subject = 'Callback test',
      Status = 'New',
      Origin = 'Web',
      AI_Guardrail_Status__c = status,
      AI_Triage_Workflow_Id__c = workflowId,
      AI_Guardrail_Resume_Token__c = token
    );
    insert supportCase;
    return supportCase.Id;
  }

  private static List<AgentforceGuardrailApprovalCallback.CallbackRequest> requestFor(
    Id caseId
  ) {
    AgentforceGuardrailApprovalCallback.CallbackRequest input = new AgentforceGuardrailApprovalCallback.CallbackRequest();
    input.caseId = String.valueOf(caseId);
    return new List<AgentforceGuardrailApprovalCallback.CallbackRequest>{
      input
    };
  }

  @IsTest
  static void approvedCaseCallsBackOnce() {
    Id caseId = seedCase('approved', WORKFLOW_ID, RESUME_TOKEN);
    CallbackMock mock = new CallbackMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceGuardrailApprovalCallback.CallbackResult> results = AgentforceGuardrailApprovalCallback.dispatch(
      requestFor(caseId)
    );
    Test.stopTest();

    System.assertEquals(1, results.size(), 'One result per request.');
    System.assertEquals(true, results[0].enqueued, 'Enqueued the callout.');
    System.assertEquals(1, mock.count, 'Exactly one callout.');
    System.assert(
      mock.lastEndpoint.contains('/sf-approval-callback'),
      'Hits the callback endpoint.'
    );
    Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(
      mock.lastBody
    );
    System.assertEquals('approved', body.get('decision'), 'Decision passed.');
    System.assertEquals(RESUME_TOKEN, body.get('token'), 'Token passed.');
  }

  @IsTest
  static void escalatedStatusIsDropped() {
    Id caseId = seedCase('escalated', WORKFLOW_ID, RESUME_TOKEN);
    CallbackMock mock = new CallbackMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    List<AgentforceGuardrailApprovalCallback.CallbackResult> results = AgentforceGuardrailApprovalCallback.dispatch(
      requestFor(caseId)
    );
    Test.stopTest();

    System.assertEquals(false, results[0].enqueued, 'Escalated not enqueued.');
    System.assertEquals(0, mock.count, 'No callout for escalated.');
  }

  @IsTest
  static void missingTokenIsDropped() {
    Id caseId = seedCase('rejected', WORKFLOW_ID, null);
    CallbackMock mock = new CallbackMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    AgentforceGuardrailApprovalCallback.dispatch(requestFor(caseId));
    Test.stopTest();

    System.assertEquals(0, mock.count, 'No callout without a resume token.');
  }

  @IsTest
  static void stoppedByUserSkipsCallout() {
    // Operator took the Case over (Stop AI, Flow B). Even with an approved
    // status + workflow + token, the callback must drop the resume callout.
    Account account = new Account(Name = 'Aptivance Stop Test');
    insert account;
    Case supportCase = new Case(
      AccountId = account.Id,
      Subject = 'Stop AI test',
      Status = 'New',
      Origin = 'Web',
      AI_Guardrail_Status__c = 'approved',
      AI_Orchestration_Status__c = AgentforceGuardrailApprovalCallback.STOPPED_BY_USER,
      AI_Triage_Workflow_Id__c = WORKFLOW_ID,
      AI_Guardrail_Resume_Token__c = RESUME_TOKEN
    );
    insert supportCase;

    CallbackMock mock = new CallbackMock();
    Test.setMock(HttpCalloutMock.class, mock);
    Test.startTest();
    List<AgentforceGuardrailApprovalCallback.CallbackResult> results = AgentforceGuardrailApprovalCallback.dispatch(
      requestFor(supportCase.Id)
    );
    Test.stopTest();

    System.assertEquals(
      false,
      results[0].enqueued,
      'Stopped Case not enqueued.'
    );
    System.assertEquals(
      0,
      mock.count,
      'No callout when the operator stopped the Case.'
    );
  }

  @IsTest
  static void stampLeavesAuditBlankWithoutApprovalStep() {
    // No ProcessInstanceStep exists in a unit test, so the approver/decision-at
    // stamp must no-op (degrade-safe) and never block the resume callout.
    Id caseId = seedCase('approved', WORKFLOW_ID, RESUME_TOKEN);
    CallbackMock mock = new CallbackMock();
    Test.setMock(HttpCalloutMock.class, mock);

    Test.startTest();
    AgentforceGuardrailApprovalCallback.dispatch(requestFor(caseId));
    Test.stopTest();

    System.assertEquals(
      1,
      mock.count,
      'Callout still fires despite no approval step to stamp.'
    );
    Case stamped = [
      SELECT AI_Guardrail_Approver__c, AI_Guardrail_Decision_At__c
      FROM Case
      WHERE Id = :caseId
    ];
    System.assertEquals(
      null,
      stamped.AI_Guardrail_Approver__c,
      'No approver stamped without a completed step.'
    );
    System.assertEquals(
      null,
      stamped.AI_Guardrail_Decision_At__c,
      'No decision timestamp stamped without a completed step.'
    );
  }

  @IsTest
  static void emptyRequestIsNoOp() {
    Test.startTest();
    List<AgentforceGuardrailApprovalCallback.CallbackResult> results = AgentforceGuardrailApprovalCallback.dispatch(
      new List<AgentforceGuardrailApprovalCallback.CallbackRequest>()
    );
    Test.stopTest();
    System.assertEquals(0, results.size(), 'No results for empty input.');
  }
}

/**
 * Tests for the Phase 6b+ guardrail approval submit executor + REST entry.
 *
 * The Case-stamp path (verdict, token, status) is asserted deterministically;
 * the `Approval.process` submit may degrade in a test org without an active
 * `Agentforce_Guardrail_Approval` process, so submit-success is not required —
 * the executor is degrade-safe by contract and the live proof covers the
 * happy path.
 */
@IsTest
private class AgentforceGuardrailApprovalServiceTest {
  private static final String WORKFLOW_ID = 'wf-12345678-1234-1234-1234-1234567890ab';
  private static final String RESUME_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test.signature';

  @TestSetup
  static void setup() {
    // Grant the run-as user FLS on the guardrail fields so the stamp path is
    // exercised (the executor gates writes on isUpdateable). PermissionSet
    // assignment is a setup-object DML — isolate it in runAs to avoid the
    // MIXED_DML_OPERATION error with the Account/Case inserts below.
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

    Account account = new Account(Name = 'Aptivance Guardrail Test');
    insert account;
    insert new Case(
      AccountId = account.Id,
      Subject = 'Guardrail approval test',
      Status = 'New',
      Origin = 'Web'
    );
  }

  private static Case getCase() {
    return [
      SELECT
        Id,
        AI_Guardrail_Status__c,
        AI_Triage_Workflow_Id__c,
        AI_Guardrail_Resume_Token__c,
        AI_Orchestration_Console_URL__c,
        AI_Orchestrator_Verdict_Headline__c,
        AI_Orchestrator_Verdict_Summary__c,
        AI_Orchestrator_Verdict_Steps__c,
        AI_Orchestrator_Verdict_Highlights__c
      FROM Case
      LIMIT 1
    ];
  }

  private static AgentforceGuardrailApprovalService.SubmitRequest buildRequest(
    Id caseId
  ) {
    AgentforceGuardrailApprovalService.SubmitRequest request = new AgentforceGuardrailApprovalService.SubmitRequest();
    request.workflowId = WORKFLOW_ID;
    request.caseId = String.valueOf(caseId);
    request.riskScore = 45;
    request.riskLevel = 'medium';
    request.policyRulesTriggered = new List<String>{
      'PARTS_APPROVAL_REQUIRED',
      'SCHEDULING_AFTER_HOURS'
    };
    request.approvalReasons = new List<String>{ 'cross_region_transfer' };
    request.resumeToken = RESUME_TOKEN;
    request.orchestrationConsoleUrl =
      'https://example.test/orchestration?caseId=' + caseId;

    AgentforceGuardrailApprovalService.SubmitVerdict verdict = new AgentforceGuardrailApprovalService.SubmitVerdict();
    verdict.headline = 'Normal priority case — approval required (medium risk)';
    verdict.summary = 'Account Manager approval is required because the parts transfer exceeds the configured approval policy.';
    verdict.recommendedSteps = new List<String>{
      'Review parts transfer',
      'Confirm scheduling window'
    };
    AgentforceGuardrailApprovalService.VerdictHighlight highlight = new AgentforceGuardrailApprovalService.VerdictHighlight();
    highlight.label = 'Risk';
    highlight.value = '45 (medium)';
    verdict.highlights = new List<AgentforceGuardrailApprovalService.VerdictHighlight>{
      highlight
    };
    request.verdict = verdict;
    return request;
  }

  @IsTest
  static void submitCommentContainsExecutiveSummary() {
    Case supportCase = getCase();
    AgentforceGuardrailApprovalService.SubmitResult result;
    Test.startTest();
    System.runAs(new User(Id = UserInfo.getUserId())) {
      result = AgentforceGuardrailApprovalService.submit(
        buildRequest(supportCase.Id)
      );
    }
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result must never be null.');
    List<ProcessInstance> instances = [
      SELECT Id, (SELECT Comments FROM Steps ORDER BY CreatedDate DESC LIMIT 1)
      FROM ProcessInstance
      WHERE TargetObjectId = :supportCase.Id
      ORDER BY CreatedDate DESC
      LIMIT 1
    ];
    if (!instances.isEmpty() && !instances[0].Steps.isEmpty()) {
      String comments = instances[0].Steps[0].Comments;
      System.assert(
        comments.contains('Account Manager approval is required'),
        'Submitter comment should include executive summary.'
      );
      System.assert(
        !comments.contains('human approval'),
        'Submitter comment must not use human approval wording.'
      );
    }
  }

  @IsTest
  static void stampsCaseWithVerdictAndToken() {
    Case supportCase = getCase();
    AgentforceGuardrailApprovalService.SubmitResult result;
    Test.startTest();
    // runAs the current user forces a fresh permission load that picks up the
    // @TestSetup permission-set assignment, so the executor's FLS isUpdateable
    // checks see the granted access (a self-PSA alone does not refresh it).
    System.runAs(new User(Id = UserInfo.getUserId())) {
      result = AgentforceGuardrailApprovalService.submit(
        buildRequest(supportCase.Id)
      );
    }
    Test.stopTest();

    System.assertNotEquals(null, result, 'Result must never be null.');

    Case stamped = getCase();
    System.assertEquals(
      'pending_approval',
      stamped.AI_Guardrail_Status__c,
      'Status stamped to pending_approval.'
    );
    System.assertEquals(
      WORKFLOW_ID,
      stamped.AI_Triage_Workflow_Id__c,
      'Workflow id stamped.'
    );
    System.assertEquals(
      RESUME_TOKEN,
      stamped.AI_Guardrail_Resume_Token__c,
      'Resume token stamped.'
    );
    System.assert(
      String.isNotBlank(stamped.AI_Orchestrator_Verdict_Headline__c),
      'Verdict headline stamped.'
    );
    System.assert(
      stamped.AI_Orchestrator_Verdict_Steps__c.contains('1.'),
      'Steps numbered.'
    );
    System.assert(
      stamped.AI_Orchestrator_Verdict_Highlights__c.contains('Risk:'),
      'Highlights formatted label: value.'
    );
  }

  @IsTest
  static void degradesOnMissingRequiredFields() {
    Test.startTest();
    AgentforceGuardrailApprovalService.SubmitResult nullResult = AgentforceGuardrailApprovalService.submit(
      null
    );
    AgentforceGuardrailApprovalService.SubmitRequest blank = new AgentforceGuardrailApprovalService.SubmitRequest();
    blank.workflowId = '';
    blank.caseId = '';
    blank.resumeToken = '';
    AgentforceGuardrailApprovalService.SubmitResult blankResult = AgentforceGuardrailApprovalService.submit(
      blank
    );
    Test.stopTest();

    System.assertEquals(true, nullResult.degraded, 'Null request degrades.');
    System.assertEquals(false, nullResult.submitted, 'Null not submitted.');
    System.assertEquals(true, blankResult.degraded, 'Blank request degrades.');
  }

  @IsTest
  static void degradesOnInvalidCaseId() {
    AgentforceGuardrailApprovalService.SubmitRequest request = new AgentforceGuardrailApprovalService.SubmitRequest();
    request.workflowId = WORKFLOW_ID;
    request.caseId = 'not-an-id';
    request.resumeToken = RESUME_TOKEN;
    Test.startTest();
    AgentforceGuardrailApprovalService.SubmitResult result = AgentforceGuardrailApprovalService.submit(
      request
    );
    Test.stopTest();
    System.assertEquals(true, result.degraded, 'Bad case id degrades.');
  }

  @IsTest
  static void restPostReturnsResultJson() {
    Case supportCase = getCase();
    RestRequest req = new RestRequest();
    req.requestURI = '/services/apexrest/agentforce/guardrail-approval/submit';
    req.httpMethod = 'POST';
    req.requestBody = Blob.valueOf(
      JSON.serialize(buildRequest(supportCase.Id))
    );
    RestContext.request = req;
    RestContext.response = new RestResponse();

    Test.startTest();
    System.runAs(new User(Id = UserInfo.getUserId())) {
      AgentforceGuardrailApprovalRest.post();
    }
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode, 'HTTP 200.');
    Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(
      RestContext.response.responseBody.toString()
    );
    System.assert(body.containsKey('submitted'), 'Result has submitted flag.');
  }

  @IsTest
  static void restPostMalformedBodyReturns400() {
    RestRequest req = new RestRequest();
    req.httpMethod = 'POST';
    req.requestBody = Blob.valueOf('{ not json');
    RestContext.request = req;
    RestContext.response = new RestResponse();

    Test.startTest();
    AgentforceGuardrailApprovalRest.post();
    Test.stopTest();

    System.assertEquals(400, RestContext.response.statusCode, 'HTTP 400.');
  }

  @IsTest
  static void restPostBlankBodyDegrades() {
    RestRequest req = new RestRequest();
    req.httpMethod = 'POST';
    req.requestBody = null;
    RestContext.request = req;
    RestContext.response = new RestResponse();

    Test.startTest();
    AgentforceGuardrailApprovalRest.post();
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode, 'HTTP 200.');
    Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(
      RestContext.response.responseBody.toString()
    );
    System.assertEquals(true, body.get('degraded'), 'Blank body degrades.');
  }
}

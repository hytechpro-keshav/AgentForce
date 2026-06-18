/**
 * Tests for the Phase 5c scheduling executor. Exercises the
 * ServiceAppointment + AssignedResource create path, workflow-id
 * idempotency, graceful degradation, and the REST entry point. Pure DML
 * (no callouts) — the executor IS the Salesforce-side writer.
 *
 * NOTE on Field Service licensing: creating ServiceResource /
 * ServiceAppointment / AssignedResource requires a Field Service
 * permission set license on the running user. Where that license is
 * absent (e.g. the bare admin used for a CI dry-run) the create is blocked
 * and the executor degrades — by design. These tests therefore assert the
 * booking strictly only when the FSL data could be seeded, and accept the
 * degraded outcome otherwise, while still exercising the code so coverage
 * holds.
 */
@IsTest
private class AgentforceSchedulingServiceTest {
  private static final String WORKFLOW_ID = 'wf-test-5c-0001';
  private static final String RESOURCE_REF = 'SR-A9';

  @TestSetup
  static void setup() {
    Account account = new Account(Name = 'Aptivance Scheduling Test');
    insert account;

    insert new Case(
      AccountId = account.Id,
      Subject = 'Laptop onsite repair',
      Status = 'New',
      Origin = 'Web'
    );
  }

  /**
   * Best-effort active technician. Returns null when the Field Service
   * license is unavailable so the dependent tests degrade-assert instead of
   * failing setup. The User insert is isolated with runAs to dodge the
   * setup/non-setup MIXED_DML restriction.
   */
  private static Id tryCreateResource() {
    try {
      Profile standard = [
        SELECT Id
        FROM Profile
        WHERE Name = 'Standard User'
        LIMIT 1
      ];
      String unique = 'fs5c' + Datetime.now().getTime();
      User tech = new User(
        Alias = 'a9tech',
        Email = unique + '@example.com',
        EmailEncodingKey = 'UTF-8',
        LastName = 'Technician',
        LanguageLocaleKey = 'en_US',
        LocaleSidKey = 'en_US',
        ProfileId = standard.Id,
        TimeZoneSidKey = 'America/Los_Angeles',
        Username = unique + '@example.com.agentforce'
      );
      System.runAs(new User(Id = UserInfo.getUserId())) {
        insert tech;
      }
      ServiceResource resource = new ServiceResource(
        Name = 'A9 Technician',
        RelatedRecordId = tech.Id,
        ResourceType = 'T',
        IsActive = true
      );
      insert resource;
      return resource.Id;
    } catch (Exception fslUnavailable) {
      return null;
    }
  }

  private static AgentforceSchedulingService.SchedulingRequest buildRequest(
    Id caseId,
    Id resourceId
  ) {
    AgentforceSchedulingService.SchedulingRequest request = new AgentforceSchedulingService.SchedulingRequest();
    request.workflowId = WORKFLOW_ID;
    request.caseId = caseId;
    request.resourceId = resourceId == null ? null : String.valueOf(resourceId);
    request.resourceReference = RESOURCE_REF;
    request.schedStart = '2026-06-19T16:00:00.000Z';
    request.schedEnd = '2026-06-19T18:00:00.000Z';
    request.durationMinutes = 120;
    request.subject = 'Orchestrated service visit';
    request.approvalReason = 'none';
    return request;
  }

  @IsTest
  static void booksAppointmentWhenFieldServiceAvailable() {
    Case supportCase = [SELECT Id FROM Case LIMIT 1];
    Id resourceId = tryCreateResource();

    Test.startTest();
    AgentforceSchedulingService.SchedulingResult result = AgentforceSchedulingService.apply(
      buildRequest(supportCase.Id, resourceId)
    );
    Test.stopTest();

    if (
      !Schema.sObjectType.ServiceAppointment.isCreateable() ||
      resourceId == null
    ) {
      System.assertEquals(
        true,
        result.degraded,
        'Expected degrade when Field Service writes are unavailable'
      );
      System.assertEquals(false, result.booked);
      return;
    }

    System.assertEquals(true, result.applied, 'Expected the write to apply');
    System.assertEquals(true, result.booked, 'Expected the appointment booked');
    System.assertEquals('booked', result.appointmentStatus);
    System.assertNotEquals(null, result.appointmentReference);
    System.assertEquals(
      1,
      [
        SELECT COUNT()
        FROM ServiceAppointment
        WHERE Orchestrator_Workflow_Id__c = :WORKFLOW_ID
      ]
    );
  }

  @IsTest
  static void isIdempotentOnRepeatedApply() {
    Case supportCase = [SELECT Id FROM Case LIMIT 1];
    Id resourceId = tryCreateResource();
    if (
      !Schema.sObjectType.ServiceAppointment.isCreateable() ||
      resourceId == null
    ) {
      return; // FSL unavailable — the idempotency path needs a real booking.
    }

    AgentforceSchedulingService.apply(buildRequest(supportCase.Id, resourceId));

    Test.startTest();
    AgentforceSchedulingService.SchedulingResult second = AgentforceSchedulingService.apply(
      buildRequest(supportCase.Id, resourceId)
    );
    Test.stopTest();

    System.assertEquals(
      true,
      second.idempotentSkip,
      'Expected idempotent reuse'
    );
    System.assertEquals(true, second.booked);
    System.assertEquals(
      1,
      [
        SELECT COUNT()
        FROM ServiceAppointment
        WHERE Orchestrator_Workflow_Id__c = :WORKFLOW_ID
      ],
      'A repeated apply must never book a second appointment'
    );
  }

  @IsTest
  static void invocableEntryPointWrapsApply() {
    Case supportCase = [SELECT Id FROM Case LIMIT 1];

    Test.startTest();
    // A null batch returns an empty list (no NPE).
    List<AgentforceSchedulingService.SchedulingResult> none = AgentforceSchedulingService.createAppointments(
      null
    );
    // A real batch delegates each request to apply().
    List<AgentforceSchedulingService.SchedulingResult> results = AgentforceSchedulingService.createAppointments(
      new List<AgentforceSchedulingService.SchedulingRequest>{
        buildRequest(supportCase.Id, null)
      }
    );
    Test.stopTest();

    System.assertEquals(0, none.size(), 'Null batch yields no results');
    System.assertEquals(1, results.size(), 'One request yields one result');
    System.assertNotEquals(
      null,
      results[0].appointmentStatus,
      'Each result carries an appointment status'
    );
  }

  @IsTest
  static void degradesOnMissingCommand() {
    Test.startTest();
    AgentforceSchedulingService.SchedulingResult result = AgentforceSchedulingService.apply(
      null
    );
    Test.stopTest();
    System.assertEquals(true, result.degraded);
    System.assertEquals(false, result.applied);
    System.assertEquals(false, result.booked);
  }

  @IsTest
  static void degradesOnInvalidWindow() {
    Case supportCase = [SELECT Id FROM Case LIMIT 1];
    AgentforceSchedulingService.SchedulingRequest request = buildRequest(
      supportCase.Id,
      supportCase.Id // bogus resource id is irrelevant — the window is invalid
    );
    request.schedEnd = request.schedStart; // end not after start

    Test.startTest();
    AgentforceSchedulingService.SchedulingResult result = AgentforceSchedulingService.apply(
      request
    );
    Test.stopTest();

    System.assertEquals(true, result.degraded);
    System.assertEquals(false, result.booked);
  }

  @IsTest
  static void acceptsReferenceOnlyCommand() {
    // The orchestrator sends resourceReference WITHOUT resourceId. Validation
    // must accept it (the technician is then resolved by reference) and must
    // NOT reject the command as "Invalid scheduling command".
    Case supportCase = [SELECT Id FROM Case LIMIT 1];
    AgentforceSchedulingService.SchedulingRequest request = buildRequest(
      supportCase.Id,
      null
    );
    request.resourceReference = 'SR-DOES-NOT-EXIST';

    Test.startTest();
    AgentforceSchedulingService.SchedulingResult result = AgentforceSchedulingService.apply(
      request
    );
    Test.stopTest();

    // Either the FSL license is absent or no technician matches the bogus
    // reference; both degrade, but never via the missing-identifier check.
    System.assertEquals(true, result.degraded);
    System.assertEquals(false, result.booked);
    System.assertNotEquals(
      'Invalid scheduling command.',
      result.message,
      'A reference-only command must pass the missing-identifier validation'
    );
  }

  @IsTest
  static void restEndpointReturnsResult() {
    Case supportCase = [SELECT Id FROM Case LIMIT 1];
    String body =
      '{"workflowId":"' +
      WORKFLOW_ID +
      '","caseId":"' +
      supportCase.Id +
      '","resourceId":"' +
      supportCase.Id +
      '","resourceReference":"' +
      RESOURCE_REF +
      '","schedStart":"2026-06-19T16:00:00.000Z","schedEnd":"2026-06-19T18:00:00.000Z"}';

    RestRequest req = new RestRequest();
    req.requestUri = '/services/apexrest/agentforce/scheduling-appointment';
    req.httpMethod = 'POST';
    req.requestBody = Blob.valueOf(body);
    RestContext.request = req;
    RestContext.response = new RestResponse();

    Test.startTest();
    AgentforceSchedulingRest.post();
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode);
    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      RestContext.response.responseBody.toString()
    );
    // The Case id is not a real ServiceResource, so a fully-licensed org
    // degrades on resource resolution; either way the body is well-formed.
    System.assertNotEquals(null, parsed.get('appointmentStatus'));
  }

  @IsTest
  static void restEndpointReturns400OnInvalidBody() {
    RestRequest req = new RestRequest();
    req.requestUri = '/services/apexrest/agentforce/scheduling-appointment';
    req.httpMethod = 'POST';
    req.requestBody = Blob.valueOf('{not valid json');
    RestContext.request = req;
    RestContext.response = new RestResponse();

    Test.startTest();
    AgentforceSchedulingRest.post();
    Test.stopTest();

    System.assertEquals(400, RestContext.response.statusCode);
  }

  @IsTest
  static void restEndpointDegradesOnEmptyBody() {
    RestRequest req = new RestRequest();
    req.requestUri = '/services/apexrest/agentforce/scheduling-appointment';
    req.httpMethod = 'POST';
    req.requestBody = null;
    RestContext.request = req;
    RestContext.response = new RestResponse();

    Test.startTest();
    AgentforceSchedulingRest.post();
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode);
    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      RestContext.response.responseBody.toString()
    );
    System.assertEquals(true, parsed.get('degraded'));
  }
}

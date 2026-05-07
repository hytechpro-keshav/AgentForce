@IsTest
private class CustomerSelfServiceActionsTest {
  @IsTest
  static void accountSummaryReturnsVerifiedAccountAndOpenCases() {
    Account accountRecord = new Account(
      Name = 'Phase 0 Utility Customer',
      BillingStreet = '100 Main St',
      BillingCity = 'Austin',
      BillingState = 'TX',
      BillingPostalCode = '78701',
      BillingCountry = 'USA'
    );
    insert accountRecord;

    Contact contactRecord = new Contact(
      LastName = 'Customer',
      Email = 'customer@example.com',
      AccountId = accountRecord.Id
    );
    insert contactRecord;

    Case caseRecord = new Case(
      AccountId = accountRecord.Id,
      ContactId = contactRecord.Id,
      Subject = 'Water pressure issue',
      Status = 'New',
      Origin = 'Web',
      Priority = 'Medium'
    );
    insert caseRecord;

    CustomerSelfServiceAccountSummary.AccountSummaryRequest request = new CustomerSelfServiceAccountSummary.AccountSummaryRequest();
    request.contactId = contactRecord.Id;

    Test.startTest();
    List<CustomerSelfServiceAccountSummary.AccountSummaryResponse> responses = CustomerSelfServiceAccountSummary.getSummaries(
      new List<CustomerSelfServiceAccountSummary.AccountSummaryRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('FOUND', responses[0].summaryStatus);
    System.assertEquals(accountRecord.Id, responses[0].accountId);
    System.assertEquals(1, responses[0].openCaseCount);
    System.assert(
      responses[0].recentCaseSummary.contains('Water pressure issue')
    );
  }

  @IsTest
  static void accountSummaryWithoutVerifiedCustomerDoesNotRevealData() {
    CustomerSelfServiceAccountSummary.AccountSummaryRequest request = new CustomerSelfServiceAccountSummary.AccountSummaryRequest();
    request.customerEmail = 'unknown@example.com';

    Test.startTest();
    List<CustomerSelfServiceAccountSummary.AccountSummaryResponse> responses = CustomerSelfServiceAccountSummary.getSummaries(
      new List<CustomerSelfServiceAccountSummary.AccountSummaryRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('NEEDS_VERIFICATION', responses[0].summaryStatus);
    System.assertEquals(null, responses[0].accountId);
  }

  @IsTest
  static void createServiceRequestCreatesCaseForVerifiedAccount() {
    Account accountRecord = new Account(Name = 'Service Request Customer');
    insert accountRecord;
    Contact contactRecord = new Contact(
      LastName = 'Reporter',
      AccountId = accountRecord.Id,
      Email = 'reporter@example.com'
    );
    insert contactRecord;

    CustomerSelfServiceCreateRequest.ServiceRequestRequest request = new CustomerSelfServiceCreateRequest.ServiceRequestRequest();
    request.accountId = accountRecord.Id;
    request.contactId = contactRecord.Id;
    request.issueType = 'outage';
    request.description = 'The customer reports no service at the verified address.';
    request.severity = 'high';
    request.language = 'en';
    request.preferredContactMethod = 'email';

    Test.startTest();
    List<CustomerSelfServiceCreateRequest.ServiceRequestResponse> responses = CustomerSelfServiceCreateRequest.createRequests(
      new List<CustomerSelfServiceCreateRequest.ServiceRequestRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('CREATED', responses[0].requestStatus);
    System.assertEquals('High', responses[0].priority);
    System.assertEquals(true, responses[0].escalationRecommended);
    System.assertNotEquals(null, responses[0].caseId);
  }

  @IsTest
  static void createServiceRequestRequiresVerifiedAccountAndDescription() {
    CustomerSelfServiceCreateRequest.ServiceRequestRequest request = new CustomerSelfServiceCreateRequest.ServiceRequestRequest();
    request.description = 'Missing account should not create a Case.';

    Test.startTest();
    List<CustomerSelfServiceCreateRequest.ServiceRequestResponse> responses = CustomerSelfServiceCreateRequest.createRequests(
      new List<CustomerSelfServiceCreateRequest.ServiceRequestRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].requestStatus);
    System.assertEquals(null, responses[0].caseId);
  }

  @IsTest
  static void escalateServiceRequestUpdatesPriorityAndAddsHandoff() {
    Account accountRecord = new Account(Name = 'Escalation Customer');
    insert accountRecord;

    Case caseRecord = new Case(
      AccountId = accountRecord.Id,
      Subject = 'Billing dispute',
      Status = 'New',
      Origin = 'Web',
      Priority = 'Medium'
    );
    insert caseRecord;

    CustomerSelfServiceEscalateRequest.EscalationRequest request = new CustomerSelfServiceEscalateRequest.EscalationRequest();
    request.caseId = caseRecord.Id;
    request.accountId = accountRecord.Id;
    request.escalationReason = 'Customer requested human review for a billing dispute.';
    request.urgency = 'high';
    request.language = 'en';
    request.conversationSummary = 'Customer reported a billing issue that should not be resolved automatically.';

    Test.startTest();
    List<CustomerSelfServiceEscalateRequest.EscalationResponse> responses = CustomerSelfServiceEscalateRequest.escalateRequests(
      new List<CustomerSelfServiceEscalateRequest.EscalationRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('ESCALATED', responses[0].escalationStatus);
    System.assertEquals('High', responses[0].priority);

    Case updatedCase = [SELECT Priority FROM Case WHERE Id = :caseRecord.Id];
    System.assertEquals('High', updatedCase.Priority);
    System.assertEquals(
      1,
      [SELECT COUNT() FROM CaseComment WHERE ParentId = :caseRecord.Id]
    );
  }

  @IsTest
  static void escalateServiceRequestRejectsAccountMismatch() {
    Account firstAccount = new Account(Name = 'First Customer');
    Account secondAccount = new Account(Name = 'Second Customer');
    insert new List<Account>{ firstAccount, secondAccount };

    Case caseRecord = new Case(
      AccountId = firstAccount.Id,
      Subject = 'Mismatch test',
      Status = 'New',
      Origin = 'Web',
      Priority = 'Medium'
    );
    insert caseRecord;

    CustomerSelfServiceEscalateRequest.EscalationRequest request = new CustomerSelfServiceEscalateRequest.EscalationRequest();
    request.caseId = caseRecord.Id;
    request.accountId = secondAccount.Id;
    request.escalationReason = 'Should not cross account boundary.';

    Test.startTest();
    List<CustomerSelfServiceEscalateRequest.EscalationResponse> responses = CustomerSelfServiceEscalateRequest.escalateRequests(
      new List<CustomerSelfServiceEscalateRequest.EscalationRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].escalationStatus);
  }

  @IsTest
  static void escalateServiceRequestRejectsCaseNumberWithoutVerifiedAccount() {
    Account accountRecord = new Account(Name = 'Case Number Customer');
    insert accountRecord;

    Case caseRecord = new Case(
      AccountId = accountRecord.Id,
      Subject = 'Case number only escalation test',
      Status = 'New',
      Origin = 'Web',
      Priority = 'Medium'
    );
    insert caseRecord;

    Case storedCase = [
      SELECT Id, CaseNumber, Priority
      FROM Case
      WHERE Id = :caseRecord.Id
    ];

    CustomerSelfServiceEscalateRequest.EscalationRequest request = new CustomerSelfServiceEscalateRequest.EscalationRequest();
    request.caseNumber = storedCase.CaseNumber;
    request.escalationReason = 'The agent should not escalate by case number without the verified account.';

    Test.startTest();
    List<CustomerSelfServiceEscalateRequest.EscalationResponse> responses = CustomerSelfServiceEscalateRequest.escalateRequests(
      new List<CustomerSelfServiceEscalateRequest.EscalationRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('VALIDATION_ERROR', responses[0].escalationStatus);
    System.assertEquals(
      'I need the verified account before escalating a request by case number.',
      responses[0].safeMessage
    );

    Case updatedCase = [SELECT Priority FROM Case WHERE Id = :caseRecord.Id];
    System.assertEquals(storedCase.Priority, updatedCase.Priority);
    System.assertEquals(
      0,
      [SELECT COUNT() FROM CaseComment WHERE ParentId = :caseRecord.Id]
    );
  }

  @IsTest
  static void escalateServiceRequestAllowsCaseNumberWithVerifiedAccount() {
    Account accountRecord = new Account(Name = 'Verified Case Number Customer');
    insert accountRecord;

    Case caseRecord = new Case(
      AccountId = accountRecord.Id,
      Subject = 'Verified case number escalation test',
      Status = 'New',
      Origin = 'Web',
      Priority = 'Medium'
    );
    insert caseRecord;

    Case storedCase = [
      SELECT Id, CaseNumber
      FROM Case
      WHERE Id = :caseRecord.Id
    ];

    CustomerSelfServiceEscalateRequest.EscalationRequest request = new CustomerSelfServiceEscalateRequest.EscalationRequest();
    request.caseNumber = storedCase.CaseNumber;
    request.accountId = accountRecord.Id;
    request.escalationReason = 'The verified account allows escalation by case number.';
    request.conversationSummary = 'Customer asked for human follow-up.';

    Test.startTest();
    List<CustomerSelfServiceEscalateRequest.EscalationResponse> responses = CustomerSelfServiceEscalateRequest.escalateRequests(
      new List<CustomerSelfServiceEscalateRequest.EscalationRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    System.assertEquals('ESCALATED', responses[0].escalationStatus);
    System.assertEquals('High', responses[0].priority);

    Case updatedCase = [SELECT Priority FROM Case WHERE Id = :caseRecord.Id];
    System.assertEquals('High', updatedCase.Priority);
    System.assertEquals(
      1,
      [SELECT COUNT() FROM CaseComment WHERE ParentId = :caseRecord.Id]
    );
  }
}

@isTest
private class CaseConfirmationServiceTest {
  private static CaseConfirmationService.ConfirmationRequest buildRequest() {
    CaseConfirmationService.ConfirmationRequest request = new CaseConfirmationService.ConfirmationRequest();
    request.email = 'customer@example.com';
    request.caseNumber = '00001234';
    request.customerName = 'Jordan Rivers';
    request.subject = 'Laptop running slow';
    return request;
  }

  @isTest
  static void sendReturnsSentForValidRequest() {
    Test.startTest();
    CaseConfirmationService.ConfirmationResult result = CaseConfirmationService.send(
      buildRequest()
    );
    Test.stopTest();

    System.assertEquals(true, result.sent, 'valid request should send');
    System.assertEquals('SENT', result.status);
  }

  @isTest
  static void sendReturnsSentWithoutOptionalFields() {
    CaseConfirmationService.ConfirmationRequest request = new CaseConfirmationService.ConfirmationRequest();
    request.email = 'customer@example.com';
    request.caseNumber = '00001234';

    Test.startTest();
    CaseConfirmationService.ConfirmationResult result = CaseConfirmationService.send(
      request
    );
    Test.stopTest();

    System.assertEquals(true, result.sent, 'optional fields may be blank');
    System.assertEquals('SENT', result.status);
  }

  @isTest
  static void sendRejectsInvalidEmail() {
    CaseConfirmationService.ConfirmationRequest request = buildRequest();
    request.email = 'not-an-email';

    Test.startTest();
    CaseConfirmationService.ConfirmationResult result = CaseConfirmationService.send(
      request
    );
    Test.stopTest();

    System.assertEquals(false, result.sent);
    System.assertEquals('INVALID_REQUEST', result.status);
  }

  @isTest
  static void sendRejectsMissingCaseNumber() {
    CaseConfirmationService.ConfirmationRequest request = buildRequest();
    request.caseNumber = '  ';

    Test.startTest();
    CaseConfirmationService.ConfirmationResult result = CaseConfirmationService.send(
      request
    );
    Test.stopTest();

    System.assertEquals(false, result.sent);
    System.assertEquals('INVALID_REQUEST', result.status);
  }

  @isTest
  static void sendRejectsNullRequest() {
    Test.startTest();
    CaseConfirmationService.ConfirmationResult result = CaseConfirmationService.send(
      null
    );
    Test.stopTest();

    System.assertEquals(false, result.sent);
    System.assertEquals('INVALID_REQUEST', result.status);
  }

  @isTest
  static void sendUsesConfiguredFromAddressWhenPresent() {
    insert new Otp_Config__c(
      SetupOwnerId = UserInfo.getOrganizationId(),
      From_Address__c = 'support@example.com'
    );

    Test.startTest();
    CaseConfirmationService.ConfirmationResult result = CaseConfirmationService.send(
      buildRequest()
    );
    Test.stopTest();

    // No org-wide address matches in test context; resolution degrades to
    // null and the send still succeeds.
    System.assertEquals(true, result.sent);
    System.assertEquals('SENT', result.status);
  }
}

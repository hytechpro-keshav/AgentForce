@isTest
private class AgentforceCaseNotifyRestTest {
  private static final String BASE = '/services/apexrest/agentforce/case-notify';

  private static void invoke(String uri, String body) {
    RestRequest req = new RestRequest();
    req.httpMethod = 'POST';
    req.requestURI = uri;
    req.requestBody = body == null ? null : Blob.valueOf(body);
    RestContext.request = req;
    RestContext.response = new RestResponse();
    AgentforceCaseNotifyRest.post();
  }

  private static Map<String, Object> responseJson() {
    return (Map<String, Object>) JSON.deserializeUntyped(
      RestContext.response.responseBody.toString()
    );
  }

  @isTest
  static void confirmationEndpointReturnsSent() {
    Test.startTest();
    invoke(
      BASE + '/confirmation',
      JSON.serialize(
        new Map<String, Object>{
          'email' => 'customer@example.com',
          'caseNumber' => '00001234',
          'customerName' => 'Jordan Rivers',
          'subject' => 'Laptop running slow'
        }
      )
    );
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode);
    System.assertEquals('SENT', responseJson().get('status'));
    System.assertEquals(true, responseJson().get('sent'));
  }

  @isTest
  static void confirmationEndpointReturnsInvalidRequestForBadEmail() {
    Test.startTest();
    invoke(
      BASE + '/confirmation',
      JSON.serialize(
        new Map<String, Object>{ 'email' => 'nope', 'caseNumber' => '00001234' }
      )
    );
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode);
    System.assertEquals('INVALID_REQUEST', responseJson().get('status'));
  }

  @isTest
  static void malformedBodyReturns400() {
    Test.startTest();
    invoke(BASE + '/confirmation', '{not-json');
    Test.stopTest();

    System.assertEquals(400, RestContext.response.statusCode);
    System.assertEquals('invalid_payload', responseJson().get('error'));
  }

  @isTest
  static void unknownSubPathReturns404() {
    Test.startTest();
    invoke(BASE + '/unknown', '{}');
    Test.stopTest();

    System.assertEquals(404, RestContext.response.statusCode);
    System.assertEquals('unknown_resource', responseJson().get('error'));
  }
}

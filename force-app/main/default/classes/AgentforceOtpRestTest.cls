@isTest
private class AgentforceOtpRestTest {
  private static final String BASE = '/services/apexrest/agentforce/otp';
  private static final String EMAIL = 'user@example.com';

  private static void invoke(String uri, String body) {
    RestRequest req = new RestRequest();
    req.httpMethod = 'POST';
    req.requestURI = uri;
    req.requestBody = body == null ? null : Blob.valueOf(body);
    RestContext.request = req;
    RestContext.response = new RestResponse();
    AgentforceOtpRest.post();
  }

  private static Map<String, Object> responseJson() {
    return (Map<String, Object>) JSON.deserializeUntyped(
      RestContext.response.responseBody.toString()
    );
  }

  @isTest
  static void generateEndpointReturnsSent() {
    Test.startTest();
    invoke(
      BASE + '/generate',
      JSON.serialize(new Map<String, Object>{ 'email' => EMAIL })
    );
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode);
    System.assertEquals('SENT', responseJson().get('status'));
    System.assertEquals(1, [SELECT COUNT() FROM Verification_Code__c]);
  }

  @isTest
  static void verifyEndpointReturnsValidForMatchingCode() {
    String salt = 'saltvalue';
    String hash = EncodingUtil.convertToHex(
      Crypto.generateDigest('SHA-256', Blob.valueOf('123456:' + salt + ':'))
    );
    insert new Verification_Code__c(
      Email__c = EMAIL,
      Purpose__c = 'chat_intake',
      Code_Salt__c = salt,
      Code_Hash__c = hash,
      Expires_At__c = Datetime.now().addSeconds(600),
      Attempts__c = 0,
      Consumed__c = false
    );

    Test.startTest();
    invoke(
      BASE + '/verify',
      JSON.serialize(
        new Map<String, Object>{ 'email' => EMAIL, 'code' => '123456' }
      )
    );
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode);
    Map<String, Object> out = responseJson();
    System.assertEquals(true, out.get('valid'));
    System.assertEquals('VERIFIED', out.get('status'));
  }

  @isTest
  static void malformedPayloadReturns400() {
    Test.startTest();
    invoke(BASE + '/generate', '{ this is not json');
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

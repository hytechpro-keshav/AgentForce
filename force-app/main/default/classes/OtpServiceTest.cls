@isTest
private class OtpServiceTest {
  private static final String EMAIL = 'user@example.com';

  // Rebuilds the exact hash OtpService stores: SHA-256(code + ':' + salt + ':' + pepper).
  private static String hashOf(String code, String salt, String pepper) {
    String material = code + ':' + salt + ':' + (pepper == null ? '' : pepper);
    return EncodingUtil.convertToHex(
      Crypto.generateDigest('SHA-256', Blob.valueOf(material))
    );
  }

  private static Verification_Code__c seedCode(
    String code,
    String pepper,
    Integer ttlSeconds,
    Integer attempts,
    Boolean consumed
  ) {
    String salt = 'saltvalue';
    Verification_Code__c record = new Verification_Code__c(
      Email__c = EMAIL,
      Purpose__c = 'chat_intake',
      Code_Salt__c = salt,
      Code_Hash__c = hashOf(code, salt, pepper),
      Expires_At__c = Datetime.now().addSeconds(ttlSeconds),
      Attempts__c = attempts,
      Consumed__c = consumed
    );
    insert record;
    return record;
  }

  private static OtpService.GenerateRequest genReq(String email) {
    OtpService.GenerateRequest request = new OtpService.GenerateRequest();
    request.email = email;
    request.purpose = 'chat_intake';
    request.correlationId = 'corr-1';
    return request;
  }

  private static OtpService.VerifyRequest verReq(String email, String code) {
    OtpService.VerifyRequest request = new OtpService.VerifyRequest();
    request.email = email;
    request.code = code;
    request.purpose = 'chat_intake';
    return request;
  }

  @isTest
  static void generateStoresHashedCodeAndReturnsSent() {
    Test.startTest();
    OtpService.GenerateResult result = OtpService.generate(
      genReq('User@Example.com')
    );
    Test.stopTest();

    System.assertEquals('SENT', result.status, 'valid email should send');
    System.assertEquals(600, result.expiresInSeconds, 'default TTL');

    List<Verification_Code__c> rows = [
      SELECT Email__c, Code_Hash__c, Code_Salt__c, Consumed__c, Attempts__c
      FROM Verification_Code__c
    ];
    System.assertEquals(1, rows.size(), 'one code stored');
    System.assertEquals(
      EMAIL,
      rows[0].Email__c,
      'email normalized to lowercase'
    );
    System.assert(
      String.isNotBlank(rows[0].Code_Hash__c),
      'hash must be stored, never the plaintext code'
    );
    System.assertEquals(false, rows[0].Consumed__c, 'new code not consumed');
    System.assertEquals(0, rows[0].Attempts__c, 'new code has zero attempts');
  }

  @isTest
  static void generateRejectsInvalidEmail() {
    Test.startTest();
    OtpService.GenerateResult result = OtpService.generate(
      genReq('not-an-email')
    );
    Test.stopTest();

    System.assertEquals('INVALID_EMAIL', result.status);
    System.assertEquals(0, [SELECT COUNT() FROM Verification_Code__c]);
  }

  @isTest
  static void generateRateLimitsPerEmail() {
    Test.startTest();
    for (Integer i = 0; i < 5; i++) {
      System.assertEquals('SENT', OtpService.generate(genReq(EMAIL)).status);
    }
    OtpService.GenerateResult limited = OtpService.generate(genReq(EMAIL));
    Test.stopTest();

    System.assertEquals(
      'RATE_LIMITED',
      limited.status,
      '6th within window blocked'
    );
    System.assertEquals(
      5,
      [SELECT COUNT() FROM Verification_Code__c],
      'no 6th record'
    );
  }

  @isTest
  static void verifyMatchingCodeSucceedsAndConsumes() {
    Verification_Code__c seeded = seedCode('123456', null, 600, 0, false);

    Test.startTest();
    OtpService.VerifyResult result = OtpService.verify(verReq(EMAIL, '123456'));
    Test.stopTest();

    System.assertEquals(true, result.valid);
    System.assertEquals('VERIFIED', result.status);

    Verification_Code__c after = [
      SELECT Consumed__c, Attempts__c
      FROM Verification_Code__c
      WHERE Id = :seeded.Id
    ];
    System.assertEquals(
      true,
      after.Consumed__c,
      'single-use: consumed on success'
    );
    System.assertEquals(1, after.Attempts__c, 'attempt recorded');
  }

  @isTest
  static void verifyWrongCodeFailsAndIncrementsAttempts() {
    Verification_Code__c seeded = seedCode('123456', null, 600, 0, false);

    Test.startTest();
    OtpService.VerifyResult result = OtpService.verify(verReq(EMAIL, '000000'));
    Test.stopTest();

    System.assertEquals(false, result.valid);
    System.assertEquals('INVALID_CODE', result.status);

    Verification_Code__c after = [
      SELECT Consumed__c, Attempts__c
      FROM Verification_Code__c
      WHERE Id = :seeded.Id
    ];
    System.assertEquals(false, after.Consumed__c, 'wrong code not consumed');
    System.assertEquals(1, after.Attempts__c, 'attempt still recorded');
  }

  @isTest
  static void verifyExpiredCodeReturnsExpired() {
    seedCode('123456', null, -60, 0, false);

    Test.startTest();
    OtpService.VerifyResult result = OtpService.verify(verReq(EMAIL, '123456'));
    Test.stopTest();

    System.assertEquals(false, result.valid);
    System.assertEquals('EXPIRED', result.status);
  }

  @isTest
  static void verifyMissingCodeReturnsNotFound() {
    Test.startTest();
    OtpService.VerifyResult result = OtpService.verify(verReq(EMAIL, '123456'));
    Test.stopTest();

    System.assertEquals(false, result.valid);
    System.assertEquals('NOT_FOUND', result.status);
  }

  @isTest
  static void verifyTooManyAttemptsLocksOut() {
    seedCode('123456', null, 600, 5, false);

    Test.startTest();
    OtpService.VerifyResult result = OtpService.verify(verReq(EMAIL, '123456'));
    Test.stopTest();

    System.assertEquals(false, result.valid);
    System.assertEquals('TOO_MANY_ATTEMPTS', result.status);
  }

  @isTest
  static void verifyRejectsBlankInputs() {
    OtpService.VerifyResult noCode = OtpService.verify(verReq(EMAIL, ''));
    System.assertEquals(false, noCode.valid);
    OtpService.VerifyResult noEmail = OtpService.verify(
      verReq('bad', '123456')
    );
    System.assertEquals(false, noEmail.valid);
  }

  @isTest
  static void configOverridesTtlPepperAndRateLimit() {
    insert new Otp_Config__c(
      SetupOwnerId = UserInfo.getOrganizationId(),
      Pepper__c = 'pep',
      Code_Ttl_Seconds__c = 300,
      Max_Attempts__c = 3,
      Rate_Limit_Max__c = 2,
      Rate_Limit_Window_Seconds__c = 300
    );

    Test.startTest();
    OtpService.GenerateResult first = OtpService.generate(genReq(EMAIL));
    OtpService.GenerateResult second = OtpService.generate(genReq(EMAIL));
    OtpService.GenerateResult third = OtpService.generate(genReq(EMAIL));

    // Pepper-aware verify against a seeded code proves the pepper is applied.
    Verification_Code__c seeded = seedCode('654321', 'pep', 300, 0, false);
    OtpService.VerifyResult verified = OtpService.verify(
      verReq(EMAIL, '654321')
    );
    Test.stopTest();

    System.assertEquals('SENT', first.status);
    System.assertEquals(300, first.expiresInSeconds, 'TTL override applied');
    System.assertEquals('SENT', second.status);
    System.assertEquals(
      'RATE_LIMITED',
      third.status,
      'rate limit override to 2'
    );
    System.assertEquals(true, verified.valid, 'pepper-aware hash matches');
  }

  @isTest
  static void purgeRemovesExpiredAndConsumed() {
    seedCode('111111', null, -60, 0, false); // expired
    seedCode('222222', null, 600, 0, true); // consumed
    seedCode('333333', null, 600, 0, false); // live

    Test.startTest();
    Integer purged = OtpService.purgeExpired(100);
    Test.stopTest();

    System.assertEquals(2, purged, 'expired + consumed purged');
    System.assertEquals(
      1,
      [SELECT COUNT() FROM Verification_Code__c],
      'live code remains'
    );
  }
}

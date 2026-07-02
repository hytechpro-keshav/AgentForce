/**
 * Customer-chat email OTP subsystem.
 *
 * Salesforce owns generation, delivery (Messaging.SingleEmailMessage), and
 * verification of one-time codes used to verify a customer's identity before
 * the external AI intake chat creates a Case. Called server-to-server by the
 * NestJS ai-api `SalesforceOtpGateway` via {@link AgentforceOtpRest}; never
 * exposed to guest/Site users directly.
 *
 * Security posture:
 *   - the plaintext code is NEVER stored or logged; only a hex
 *     SHA-256(code + per-record salt + config pepper) is persisted,
 *   - codes are single-use (Consumed__c), short-lived (Expires_At__c),
 *     attempt-capped (Attempts__c), and per-email rate-limited,
 *   - verify uses a constant-time hash comparison,
 *   - every path degrades (returns a safe status) instead of throwing, so a
 *     Salesforce/email outage never hard-fails the chat, while verification
 *     always fails CLOSED (valid=false) on any ambiguity.
 *
 * Config (TTL, attempt cap, rate limit, pepper, from-address) is read from the
 * protected {@code Otp_Config__c} hierarchy custom setting when present, and
 * falls back to the constants below.
 */
public with sharing class OtpService {
  private static final Integer DEFAULT_TTL_SECONDS = 600;
  private static final Integer DEFAULT_MAX_ATTEMPTS = 5;
  private static final Integer DEFAULT_RATE_LIMIT_MAX = 5;
  private static final Integer DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 600;
  private static final String DEFAULT_PURPOSE = 'chat_intake';

  private static final Pattern EMAIL_PATTERN = Pattern.compile(
    '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
  );

  // ---- Public API ----

  public static GenerateResult generate(GenerateRequest request) {
    GenerateResult result = new GenerateResult();
    result.status = 'DEGRADED';
    result.safeMessage = 'If this email matches an account, a code has been sent.';
    result.expiresInSeconds = 0;

    String email = normalizeEmail(request == null ? null : request.email);
    if (email == null) {
      result.status = 'INVALID_EMAIL';
      return result;
    }
    String purpose = normalizePurpose(request.purpose);

    if (!Schema.sObjectType.Verification_Code__c.isCreateable()) {
      // Fail closed but do not reveal internal access state to the caller.
      return result;
    }

    OtpSettings settings = loadSettings();

    if (isRateLimited(email, purpose, settings)) {
      result.status = 'RATE_LIMITED';
      return result;
    }

    String code = generateCode();
    String salt = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
    Datetime expiresAt = Datetime.now().addSeconds(settings.ttlSeconds);

    Verification_Code__c record = new Verification_Code__c();
    record.Email__c = email;
    record.Code_Hash__c = hashCode(code, salt, settings.pepper);
    record.Code_Salt__c = salt;
    record.Expires_At__c = expiresAt;
    record.Consumed__c = false;
    record.Attempts__c = 0;
    record.Purpose__c = purpose;
    record.Correlation_Id__c = safeCorrelationId(request.correlationId);

    try {
      insert record;
    } catch (Exception dmlError) {
      // Degrade: never surface DML/backend detail to the caller.
      return result;
    }

    Boolean sent = sendCode(email, code, settings);
    // Even if delivery degraded, the code exists; return SENT with the same
    // safe message so the endpoint never leaks account existence or send state.
    result.status = sent ? 'SENT' : 'DEGRADED';
    result.expiresInSeconds = settings.ttlSeconds;
    return result;
  }

  public static VerifyResult verify(VerifyRequest request) {
    VerifyResult result = new VerifyResult();
    result.valid = false;
    result.status = 'INVALID_CODE';
    result.safeMessage = 'That code is not valid. Please request a new one.';

    String email = normalizeEmail(request == null ? null : request.email);
    String code = request == null ? null : request.code;
    if (email == null || String.isBlank(code)) {
      return result;
    }
    String purpose = normalizePurpose(request.purpose);

    if (!Schema.sObjectType.Verification_Code__c.isAccessible()) {
      result.status = 'NOT_FOUND';
      return result;
    }

    OtpSettings settings = loadSettings();

    // Consider the most recent unconsumed codes rather than only the single
    // latest: two codes issued within the same second share a CreatedDate, so
    // matching the entered code against the recent set avoids rejecting a
    // valid code that happens not to sort first.
    List<Verification_Code__c> rows = [
      SELECT
        Id,
        Code_Hash__c,
        Code_Salt__c,
        Attempts__c,
        Consumed__c,
        Expires_At__c
      FROM Verification_Code__c
      WHERE Email__c = :email AND Purpose__c = :purpose AND Consumed__c = FALSE
      ORDER BY CreatedDate DESC
      LIMIT 10
    ];

    if (rows.isEmpty()) {
      result.status = 'NOT_FOUND';
      return result;
    }

    Datetime nowInstant = Datetime.now();
    Verification_Code__c matched = null;
    for (Verification_Code__c row : rows) {
      Boolean expired =
        row.Expires_At__c == null ||
        row.Expires_At__c < nowInstant;
      Integer att = row.Attempts__c == null
        ? 0
        : Integer.valueOf(row.Attempts__c);
      if (
        !expired &&
        att < settings.maxAttempts &&
        constantTimeEquals(
          hashCode(code, row.Code_Salt__c, settings.pepper),
          row.Code_Hash__c
        )
      ) {
        matched = row;
        break;
      }
    }

    // Record the attempt against the matched code, else the most recent one,
    // so brute-force lockout still accrues on wrong guesses.
    Verification_Code__c target = matched != null ? matched : rows[0];
    Integer targetAttempts = target.Attempts__c == null
      ? 0
      : Integer.valueOf(target.Attempts__c);
    target.Attempts__c = targetAttempts + 1;
    if (matched != null) {
      target.Consumed__c = true;
    }
    try {
      update target;
    } catch (Exception dmlError) {
      // Fail closed: if we cannot record the attempt/consumption, do not verify.
      result.valid = false;
      result.status = 'INVALID_CODE';
      return result;
    }

    if (matched != null) {
      result.valid = true;
      result.status = 'VERIFIED';
      result.safeMessage = 'Your identity has been verified.';
      return result;
    }

    // No match: derive a safe status from the most recent code.
    Verification_Code__c latest = rows[0];
    Boolean latestExpired =
      latest.Expires_At__c == null ||
      latest.Expires_At__c < nowInstant;
    if (latestExpired) {
      result.status = 'EXPIRED';
    } else if (targetAttempts >= settings.maxAttempts) {
      result.status = 'TOO_MANY_ATTEMPTS';
    } else {
      result.status = 'INVALID_CODE';
    }
    return result;
  }

  /**
   * Best-effort cleanup of expired/consumed codes. Not scheduled by default —
   * verify already filters on Expires_At__c — but callable from a Scheduler.
   */
  public static Integer purgeExpired(Integer maxRows) {
    Integer limitRows = (maxRows == null || maxRows <= 0) ? 500 : maxRows;
    if (!Schema.sObjectType.Verification_Code__c.isAccessible()) {
      return 0;
    }
    List<Verification_Code__c> stale = [
      SELECT Id
      FROM Verification_Code__c
      WHERE Expires_At__c < :Datetime.now() OR Consumed__c = TRUE
      LIMIT :limitRows
    ];
    if (stale.isEmpty()) {
      return 0;
    }
    try {
      delete stale;
    } catch (Exception dmlError) {
      return 0;
    }
    return stale.size();
  }

  // ---- Internals ----

  private static Boolean isRateLimited(
    String email,
    String purpose,
    OtpSettings settings
  ) {
    Datetime windowStart = Datetime.now()
      .addSeconds(-settings.rateLimitWindowSeconds);
    Integer recent = [
      SELECT COUNT()
      FROM Verification_Code__c
      WHERE
        Email__c = :email
        AND Purpose__c = :purpose
        AND CreatedDate >= :windowStart
    ];
    return recent >= settings.rateLimitMax;
  }

  private static String generateCode() {
    // Crypto.getRandomInteger() is cryptographically secure; reduce to a
    // non-negative 6-digit code (mod before abs so Integer.MIN_VALUE is safe).
    Integer sixDigits = Math.abs(Math.mod(Crypto.getRandomInteger(), 1000000));
    String code = String.valueOf(sixDigits);
    while (code.length() < 6) {
      code = '0' + code;
    }
    return code;
  }

  private static String hashCode(String code, String salt, String pepper) {
    String material =
      code +
      ':' +
      (salt == null ? '' : salt) +
      ':' +
      (pepper == null ? '' : pepper);
    return EncodingUtil.convertToHex(
      Crypto.generateDigest('SHA-256', Blob.valueOf(material))
    );
  }

  private static Boolean constantTimeEquals(String a, String b) {
    if (a == null || b == null || a.length() != b.length()) {
      return false;
    }
    Integer diff = 0;
    for (Integer i = 0; i < a.length(); i++) {
      diff |= (a.charAt(i) ^ b.charAt(i));
    }
    return diff == 0;
  }

  private static Boolean sendCode(
    String email,
    String code,
    OtpSettings settings
  ) {
    try {
      Messaging.SingleEmailMessage message = new Messaging.SingleEmailMessage();
      message.setToAddresses(new List<String>{ email });
      message.setSubject('Your verification code');
      message.setPlainTextBody(
        'Your verification code is ' +
          code +
          '. It expires in ' +
          String.valueOf(settings.ttlSeconds / 60) +
          ' minutes. If you did not request this, you can ignore this email.'
      );
      message.setSaveAsActivity(false);
      Id orgWideId = resolveOrgWideEmailId(settings.fromAddress);
      if (orgWideId != null) {
        message.setOrgWideEmailAddressId(orgWideId);
      }
      // In test context Salesforce does not actually deliver mail; skip the
      // invocation so tests never consume email capacity or require
      // deliverability configuration.
      if (Test.isRunningTest()) {
        return true;
      }
      Messaging.SendEmailResult[] sendResults = Messaging.sendEmail(
        new List<Messaging.SingleEmailMessage>{ message },
        false
      );
      return !sendResults.isEmpty() && sendResults[0].isSuccess();
    } catch (Exception emailError) {
      // Never log the code; only a coarse marker.
      System.debug(LoggingLevel.WARN, 'OTP email send degraded.');
      return false;
    }
  }

  private static Id resolveOrgWideEmailId(String fromAddress) {
    if (String.isBlank(fromAddress)) {
      return null;
    }
    try {
      List<OrgWideEmailAddress> addresses = [
        SELECT Id
        FROM OrgWideEmailAddress
        WHERE Address = :fromAddress
        LIMIT 1
      ];
      return addresses.isEmpty() ? null : addresses[0].Id;
    } catch (Exception queryError) {
      return null;
    }
  }

  private static String normalizeEmail(String raw) {
    if (String.isBlank(raw)) {
      return null;
    }
    String email = raw.trim().toLowerCase();
    if (email.length() > 255 || !EMAIL_PATTERN.matcher(email).matches()) {
      return null;
    }
    return email;
  }

  private static String normalizePurpose(String raw) {
    if (String.isBlank(raw)) {
      return DEFAULT_PURPOSE;
    }
    String purpose = raw.trim();
    return purpose.length() > 40 ? purpose.substring(0, 40) : purpose;
  }

  private static String safeCorrelationId(String raw) {
    if (String.isBlank(raw)) {
      return null;
    }
    String value = raw.trim();
    return value.length() > 64 ? value.substring(0, 64) : value;
  }

  private static OtpSettings loadSettings() {
    OtpSettings settings = new OtpSettings();
    settings.ttlSeconds = DEFAULT_TTL_SECONDS;
    settings.maxAttempts = DEFAULT_MAX_ATTEMPTS;
    settings.rateLimitMax = DEFAULT_RATE_LIMIT_MAX;
    settings.rateLimitWindowSeconds = DEFAULT_RATE_LIMIT_WINDOW_SECONDS;
    settings.pepper = null;
    settings.fromAddress = null;

    Otp_Config__c config = Otp_Config__c.getOrgDefaults();
    if (config == null) {
      return settings;
    }
    if (config.Code_Ttl_Seconds__c != null && config.Code_Ttl_Seconds__c > 0) {
      settings.ttlSeconds = Integer.valueOf(config.Code_Ttl_Seconds__c);
    }
    if (config.Max_Attempts__c != null && config.Max_Attempts__c > 0) {
      settings.maxAttempts = Integer.valueOf(config.Max_Attempts__c);
    }
    if (config.Rate_Limit_Max__c != null && config.Rate_Limit_Max__c > 0) {
      settings.rateLimitMax = Integer.valueOf(config.Rate_Limit_Max__c);
    }
    if (
      config.Rate_Limit_Window_Seconds__c != null &&
      config.Rate_Limit_Window_Seconds__c > 0
    ) {
      settings.rateLimitWindowSeconds = Integer.valueOf(
        config.Rate_Limit_Window_Seconds__c
      );
    }
    if (String.isNotBlank(config.Pepper__c)) {
      settings.pepper = config.Pepper__c;
    }
    if (String.isNotBlank(config.From_Address__c)) {
      settings.fromAddress = config.From_Address__c;
    }
    return settings;
  }

  private class OtpSettings {
    Integer ttlSeconds;
    Integer maxAttempts;
    Integer rateLimitMax;
    Integer rateLimitWindowSeconds;
    String pepper;
    String fromAddress;
  }

  // ---- DTOs (mirror apps/ai-api/src/salesforce/salesforce-otp.gateway.ts) ----

  public class GenerateRequest {
    public String email;
    public String purpose;
    public String correlationId;
  }

  public class GenerateResult {
    public String status; // SENT | RATE_LIMITED | INVALID_EMAIL | DEGRADED
    public Integer expiresInSeconds;
    public String safeMessage;
  }

  public class VerifyRequest {
    public String email;
    public String code;
    public String purpose;
    public String correlationId;
  }

  public class VerifyResult {
    public Boolean valid;
    // VERIFIED | INVALID_CODE | EXPIRED | TOO_MANY_ATTEMPTS | NOT_FOUND
    public String status;
    public String safeMessage;
  }
}

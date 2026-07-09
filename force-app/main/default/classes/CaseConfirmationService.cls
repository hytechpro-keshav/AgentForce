/**
 * Sends the customer confirmation email after a chat-created Case, mirroring
 * OtpService's mail conventions: plain-text Messaging.SingleEmailMessage,
 * optional org-wide from address from Otp_Config__c.From_Address__c,
 * degrade-not-throw (a mail outage never fails the caller), and a
 * Test.isRunningTest() short-circuit so tests never consume email capacity.
 */
public with sharing class CaseConfirmationService {
  private static final Pattern EMAIL_PATTERN = Pattern.compile(
    '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
  );

  public class ConfirmationRequest {
    public String email;
    public String caseNumber;
    public String customerName;
    public String subject;
    public String correlationId;
  }

  public class ConfirmationResult {
    public Boolean sent;
    public String status;

    public ConfirmationResult(Boolean sent, String status) {
      this.sent = sent;
      this.status = status;
    }
  }

  public static ConfirmationResult send(ConfirmationRequest request) {
    String email = normalizeEmail(request == null ? null : request.email);
    String caseNumber = request == null || String.isBlank(request.caseNumber)
      ? null
      : request.caseNumber.trim();
    if (email == null || caseNumber == null || caseNumber.length() > 40) {
      return new ConfirmationResult(false, 'INVALID_REQUEST');
    }

    try {
      Messaging.SingleEmailMessage message = new Messaging.SingleEmailMessage();
      message.setToAddresses(new List<String>{ email });
      message.setSubject(
        'We received your service request — Case #' + caseNumber
      );
      message.setPlainTextBody(buildBody(request, caseNumber));
      message.setSaveAsActivity(false);
      Id orgWideId = resolveOrgWideEmailId();
      if (orgWideId != null) {
        message.setOrgWideEmailAddressId(orgWideId);
      }
      // In test context Salesforce does not actually deliver mail; skip the
      // invocation so tests never require deliverability configuration.
      if (Test.isRunningTest()) {
        return new ConfirmationResult(true, 'SENT');
      }
      Messaging.SendEmailResult[] sendResults = Messaging.sendEmail(
        new List<Messaging.SingleEmailMessage>{ message },
        false
      );
      Boolean sent = !sendResults.isEmpty() && sendResults[0].isSuccess();
      return new ConfirmationResult(sent, sent ? 'SENT' : 'DEGRADED');
    } catch (Exception emailError) {
      // Never log recipient or body; only a coarse marker.
      System.debug(LoggingLevel.WARN, 'Case confirmation email degraded.');
      return new ConfirmationResult(false, 'DEGRADED');
    }
  }

  private static String buildBody(
    ConfirmationRequest request,
    String caseNumber
  ) {
    String greeting = request != null && String.isNotBlank(request.customerName)
      ? 'Hi ' + request.customerName.trim() + ','
      : 'Hi,';
    String issueLine = request != null && String.isNotBlank(request.subject)
      ? ' for: ' + request.subject.trim()
      : '';
    return greeting +
      '\n\n' +
      'We have taken your request and created case #' +
      caseNumber +
      issueLine +
      '. Our service team is on it — you will receive updates at every stage.' +
      '\n\n' +
      'You can ask Ably in the support chat for a live status update anytime.' +
      '\n\n' +
      'Thank you,\nAblyPro Support';
  }

  private static Id resolveOrgWideEmailId() {
    Otp_Config__c config = Otp_Config__c.getOrgDefaults();
    if (config == null || String.isBlank(config.From_Address__c)) {
      return null;
    }
    try {
      List<OrgWideEmailAddress> addresses = [
        SELECT Id
        FROM OrgWideEmailAddress
        WHERE Address = :config.From_Address__c
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
}

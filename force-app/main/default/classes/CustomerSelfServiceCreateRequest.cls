public with sharing class CustomerSelfServiceCreateRequest {
  @InvocableMethod(
    label='Create Service Request'
    description='Creates a customer service Case for a verified customer issue.'
  )
  public static List<ServiceRequestResponse> createRequests(
    List<ServiceRequestRequest> requests
  ) {
    List<ServiceRequestResponse> responses = new List<ServiceRequestResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    for (
      Integer requestIndex = 0; requestIndex < requests.size(); requestIndex++
    ) {
      ServiceRequestResponse response = new ServiceRequestResponse();
      response.requestStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'I need a verified account and issue description before creating a service request.';
      responses.add(response);
    }

    if (!Schema.sObjectType.Case.isCreateable()) {
      for (ServiceRequestResponse response : responses) {
        response.requestStatus = 'ACCESS_RESTRICTED';
        response.safeMessage = 'I cannot create a service request from this session.';
      }
      return responses;
    }

    Set<Id> requestedContactIds = new Set<Id>();
    for (ServiceRequestRequest request : requests) {
      Id contactId = parseId(request == null ? null : request.contactId);
      if (contactId != null) {
        requestedContactIds.add(contactId);
      }
    }

    Map<Id, Contact> contactsById = new Map<Id, Contact>();
    if (
      Schema.sObjectType.Contact.isAccessible() &&
      !requestedContactIds.isEmpty()
    ) {
      contactsById = new Map<Id, Contact>(
        [
          SELECT Id, AccountId
          FROM Contact
          WHERE Id IN :requestedContactIds
        ]
      );
    }

    List<Case> casesToInsert = new List<Case>();
    List<Integer> responseIndexes = new List<Integer>();

    for (
      Integer requestIndex = 0; requestIndex < requests.size(); requestIndex++
    ) {
      ServiceRequestRequest request = requests[requestIndex];
      Id accountId = parseId(request == null ? null : request.accountId);
      Id contactId = parseId(request == null ? null : request.contactId);
      String description = request == null ? null : request.description;

      if (accountId == null || String.isBlank(description)) {
        continue;
      }

      Contact contactRecord = contactId == null
        ? null
        : contactsById.get(contactId);
      if (
        contactRecord != null &&
        contactRecord.AccountId != null &&
        contactRecord.AccountId != accountId
      ) {
        responses[requestIndex]
          .safeMessage = 'I could not match the verified contact to the verified account.';
        continue;
      }

      Case caseRecord = new Case();
      caseRecord.AccountId = accountId;
      if (contactRecord != null) {
        caseRecord.ContactId = contactRecord.Id;
      }
      caseRecord.Subject = limitText(buildSubject(request), 255);
      caseRecord.Description = limitText(buildDescription(request), 32000);
      caseRecord.Origin = 'Web';
      caseRecord.Status = 'New';
      caseRecord.Priority = normalizePriority(request.severity);
      casesToInsert.add(caseRecord);
      responseIndexes.add(requestIndex);
    }

    if (casesToInsert.isEmpty()) {
      return responses;
    }

    Database.SaveResult[] saveResults = Database.insert(casesToInsert, false);
    Set<Id> createdCaseIds = new Set<Id>();
    for (
      Integer resultIndex = 0; resultIndex < saveResults.size(); resultIndex++
    ) {
      if (saveResults[resultIndex].isSuccess()) {
        createdCaseIds.add(casesToInsert[resultIndex].Id);
      }
    }

    Map<Id, Case> createdCasesById = new Map<Id, Case>();
    if (!createdCaseIds.isEmpty() && Schema.sObjectType.Case.isAccessible()) {
      createdCasesById = new Map<Id, Case>(
        [
          SELECT Id, CaseNumber, Priority, Status
          FROM Case
          WHERE Id IN :createdCaseIds
        ]
      );
    }

    for (
      Integer resultIndex = 0; resultIndex < saveResults.size(); resultIndex++
    ) {
      Integer responseIndex = responseIndexes[resultIndex];
      ServiceRequestResponse response = responses[responseIndex];
      if (saveResults[resultIndex].isSuccess()) {
        Case createdCase = createdCasesById.get(casesToInsert[resultIndex].Id);
        response.requestStatus = 'CREATED';
        response.caseId = casesToInsert[resultIndex].Id;
        response.caseNumber = createdCase == null
          ? null
          : createdCase.CaseNumber;
        response.priority = createdCase == null
          ? casesToInsert[resultIndex].Priority
          : createdCase.Priority;
        response.caseStatus = createdCase == null ? 'New' : createdCase.Status;
        response.escalationRecommended = response.priority == 'High';
        response.safeMessage = 'I created a service request for this issue.';
      } else {
        Database.Error error = saveResults[resultIndex].getErrors()[0];
        response.requestStatus = 'CREATE_FAILED';
        response.safeFallbackReason = String.valueOf(error.getStatusCode());
        response.safeMessage = 'I could not create the service request. I should escalate this to a human support team.';
      }
    }

    return responses;
  }

  private static String buildSubject(ServiceRequestRequest request) {
    if (String.isNotBlank(request.subject)) {
      return request.subject.trim();
    }
    if (String.isNotBlank(request.issueType)) {
      return 'Customer self-service: ' + request.issueType.trim();
    }
    return 'Customer self-service request';
  }

  private static String buildDescription(ServiceRequestRequest request) {
    List<String> parts = new List<String>();
    addLine(parts, 'Issue type', request.issueType);
    addLine(parts, 'Customer description', request.description);
    addLine(parts, 'Severity', request.severity);
    addLine(parts, 'Language', request.language);
    addLine(parts, 'Preferred contact method', request.preferredContactMethod);
    addLine(parts, 'Service address notes', request.serviceAddress);
    parts.add('Source: Agentforce Customer Self-Service Phase 0');
    return String.join(parts, '\n');
  }

  private static void addLine(List<String> parts, String label, String value) {
    if (String.isNotBlank(value)) {
      parts.add(label + ': ' + value.trim());
    }
  }

  private static String normalizePriority(String severity) {
    if (String.isBlank(severity)) {
      return 'Medium';
    }
    String normalizedSeverity = severity.trim().toLowerCase();
    if (
      normalizedSeverity == 'critical' ||
      normalizedSeverity == 'emergency' ||
      normalizedSeverity == 'high'
    ) {
      return 'High';
    }
    if (normalizedSeverity == 'low') {
      return 'Low';
    }
    return 'Medium';
  }

  private static String limitText(String value, Integer maxLength) {
    if (String.isBlank(value) || value.length() <= maxLength) {
      return value;
    }
    return value.substring(0, maxLength);
  }

  private static Id parseId(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    try {
      return (Id) value.trim();
    } catch (Exception parseException) {
      return null;
    }
  }

  public class ServiceRequestRequest {
    @InvocableVariable(
      label='Account Id'
      description='Verified Account Id for the service request.'
    )
    public String accountId;

    @InvocableVariable(
      label='Contact Id'
      description='Verified Contact Id for the customer, when available.'
    )
    public String contactId;

    @InvocableVariable(
      label='Issue Type'
      description='Short issue category such as billing, outage, appointment, or service issue.'
    )
    public String issueType;

    @InvocableVariable(
      label='Subject'
      description='Short customer-safe service request subject.'
    )
    public String subject;

    @InvocableVariable(
      label='Description'
      description='Customer issue description collected by the agent.'
    )
    public String description;

    @InvocableVariable(
      label='Severity'
      description='Customer-reported severity: low, medium, high, critical, or emergency.'
    )
    public String severity;

    @InvocableVariable(
      label='Language'
      description='Customer conversation language, such as en or es.'
    )
    public String language;

    @InvocableVariable(
      label='Preferred Contact Method'
      description='Customer preferred follow-up channel.'
    )
    public String preferredContactMethod;

    @InvocableVariable(
      label='Service Address'
      description='Customer-provided service address notes for the issue.'
    )
    public String serviceAddress;
  }

  public class ServiceRequestResponse {
    @InvocableVariable(
      label='Request Status'
      description='CREATED, VALIDATION_ERROR, ACCESS_RESTRICTED, or CREATE_FAILED.'
    )
    public String requestStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Customer-safe message that the agent can display.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Case Id'
      description='Created Salesforce Case Id.'
    )
    public String caseId;

    @InvocableVariable(
      label='Case Number'
      description='Created customer-visible Case number.'
    )
    public String caseNumber;

    @InvocableVariable(label='Case Status' description='Created Case status.')
    public String caseStatus;

    @InvocableVariable(label='Priority' description='Created Case priority.')
    public String priority;

    @InvocableVariable(
      label='Escalation Recommended'
      description='True when the issue should be escalated after Case creation.'
    )
    public Boolean escalationRecommended;

    @InvocableVariable(
      label='Safe Fallback Reason'
      description='Non-sensitive failure reason for support diagnostics.'
    )
    public String safeFallbackReason;
  }
}

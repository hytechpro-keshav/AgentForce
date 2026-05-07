public with sharing class CustomerSelfServiceEscalateRequest {
  @InvocableMethod(
    label='Escalate Service Request'
    description='Escalates an existing service Case and adds a private human handoff summary.'
  )
  public static List<EscalationResponse> escalateRequests(
    List<EscalationRequest> requests
  ) {
    List<EscalationResponse> responses = new List<EscalationResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    for (
      Integer requestIndex = 0; requestIndex < requests.size(); requestIndex++
    ) {
      EscalationResponse response = new EscalationResponse();
      response.escalationStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'I need an existing case and escalation reason before escalating.';
      responses.add(response);
    }

    if (
      !Schema.sObjectType.Case.isAccessible() ||
      !Schema.sObjectType.Case.isUpdateable()
    ) {
      for (EscalationResponse response : responses) {
        response.escalationStatus = 'ACCESS_RESTRICTED';
        response.safeMessage = 'I cannot escalate this service request from this session.';
      }
      return responses;
    }

    Set<Id> requestedCaseIds = new Set<Id>();
    Set<String> requestedCaseNumbers = new Set<String>();
    for (EscalationRequest request : requests) {
      Id caseId = parseId(request == null ? null : request.caseId);
      if (caseId != null) {
        requestedCaseIds.add(caseId);
      }
      if (request != null && String.isNotBlank(request.caseNumber)) {
        requestedCaseNumbers.add(request.caseNumber.trim());
      }
    }

    Map<Id, Case> casesById = new Map<Id, Case>();
    Map<String, Case> casesByNumber = new Map<String, Case>();
    if (!requestedCaseIds.isEmpty() || !requestedCaseNumbers.isEmpty()) {
      for (Case caseRecord : [
        SELECT Id, CaseNumber, AccountId, Priority, Status
        FROM Case
        WHERE Id IN :requestedCaseIds OR CaseNumber IN :requestedCaseNumbers
      ]) {
        casesById.put(caseRecord.Id, caseRecord);
        casesByNumber.put(caseRecord.CaseNumber, caseRecord);
      }
    }

    List<Case> casesToUpdate = new List<Case>();
    List<CaseComment> commentsToInsert = new List<CaseComment>();
    List<Integer> responseIndexes = new List<Integer>();
    Boolean canCreateCaseComment = Schema.sObjectType.CaseComment.isCreateable();

    for (
      Integer requestIndex = 0; requestIndex < requests.size(); requestIndex++
    ) {
      EscalationRequest request = requests[requestIndex];
      if (request == null || String.isBlank(request.escalationReason)) {
        continue;
      }

      if (requiresVerifiedAccountForCaseNumber(request)) {
        responses[requestIndex]
          .safeMessage = 'I need the verified account before escalating a request by case number.';
        continue;
      }

      Case caseRecord = findCase(request, casesById, casesByNumber);
      if (caseRecord == null || !matchesAccount(request, caseRecord)) {
        responses[requestIndex]
          .safeMessage = 'I could not find a verified case to escalate.';
        continue;
      }

      Case caseUpdate = new Case(Id = caseRecord.Id, Priority = 'High');
      casesToUpdate.add(caseUpdate);
      responseIndexes.add(requestIndex);

      if (canCreateCaseComment) {
        CaseComment commentRecord = new CaseComment();
        commentRecord.ParentId = caseRecord.Id;
        commentRecord.IsPublished = false;
        commentRecord.CommentBody = limitText(buildComment(request), 4000);
        commentsToInsert.add(commentRecord);
      }
    }

    if (casesToUpdate.isEmpty()) {
      return responses;
    }

    Database.SaveResult[] updateResults = Database.update(casesToUpdate, false);
    if (!commentsToInsert.isEmpty()) {
      Database.insert(commentsToInsert, false);
    }

    for (
      Integer resultIndex = 0; resultIndex < updateResults.size(); resultIndex++
    ) {
      Integer responseIndex = responseIndexes[resultIndex];
      EscalationResponse response = responses[responseIndex];
      if (updateResults[resultIndex].isSuccess()) {
        response.escalationStatus = 'ESCALATED';
        response.caseId = casesToUpdate[resultIndex].Id;
        response.priority = 'High';
        response.safeMessage = 'I escalated this service request for human follow-up.';
        response.handoffCaptured = canCreateCaseComment;
      } else {
        Database.Error error = updateResults[resultIndex].getErrors()[0];
        response.escalationStatus = 'ESCALATION_FAILED';
        response.safeFallbackReason = String.valueOf(error.getStatusCode());
        response.safeMessage = 'I could not update the service request. A human support team should review this conversation.';
      }
    }

    return responses;
  }

  private static Case findCase(
    EscalationRequest request,
    Map<Id, Case> casesById,
    Map<String, Case> casesByNumber
  ) {
    Id caseId = parseId(request.caseId);
    if (caseId != null && casesById.containsKey(caseId)) {
      return casesById.get(caseId);
    }
    if (String.isNotBlank(request.caseNumber)) {
      return casesByNumber.get(request.caseNumber.trim());
    }
    return null;
  }

  private static Boolean requiresVerifiedAccountForCaseNumber(
    EscalationRequest request
  ) {
    return parseId(request.caseId) == null &&
      String.isNotBlank(request.caseNumber) &&
      parseId(request.accountId) == null;
  }

  private static Boolean matchesAccount(
    EscalationRequest request,
    Case caseRecord
  ) {
    Id accountId = parseId(request.accountId);
    return accountId == null || caseRecord.AccountId == accountId;
  }

  private static String buildComment(EscalationRequest request) {
    List<String> parts = new List<String>();
    addLine(parts, 'Escalation reason', request.escalationReason);
    addLine(parts, 'Urgency', request.urgency);
    addLine(parts, 'Language', request.language);
    addLine(parts, 'Conversation summary', request.conversationSummary);
    parts.add('Source: Agentforce Customer Self-Service Phase 0');
    return String.join(parts, '\n');
  }

  private static void addLine(List<String> parts, String label, String value) {
    if (String.isNotBlank(value)) {
      parts.add(label + ': ' + value.trim());
    }
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

  public class EscalationRequest {
    @InvocableVariable(
      label='Case Id'
      description='Salesforce Case Id to escalate.'
    )
    public String caseId;

    @InvocableVariable(
      label='Case Number'
      description='Customer-visible Case number to escalate when Case Id is not available.'
    )
    public String caseNumber;

    @InvocableVariable(
      label='Account Id'
      description='Verified Account Id used to prevent cross-account escalation.'
    )
    public String accountId;

    @InvocableVariable(
      label='Escalation Reason'
      description='Reason the request must be handed to a human.'
    )
    public String escalationReason;

    @InvocableVariable(
      label='Urgency'
      description='Customer or agent urgency indicator.'
    )
    public String urgency;

    @InvocableVariable(
      label='Language'
      description='Customer conversation language, such as en or es.'
    )
    public String language;

    @InvocableVariable(
      label='Conversation Summary'
      description='Safe summary of the conversation for human handoff.'
    )
    public String conversationSummary;
  }

  public class EscalationResponse {
    @InvocableVariable(
      label='Escalation Status'
      description='ESCALATED, VALIDATION_ERROR, ACCESS_RESTRICTED, or ESCALATION_FAILED.'
    )
    public String escalationStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Customer-safe message that the agent can display.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Case Id'
      description='Escalated Salesforce Case Id.'
    )
    public String caseId;

    @InvocableVariable(label='Priority' description='Updated Case priority.')
    public String priority;

    @InvocableVariable(
      label='Handoff Captured'
      description='True when a private Case comment was added for human handoff.'
    )
    public Boolean handoffCaptured;

    @InvocableVariable(
      label='Safe Fallback Reason'
      description='Non-sensitive failure reason for support diagnostics.'
    )
    public String safeFallbackReason;
  }
}

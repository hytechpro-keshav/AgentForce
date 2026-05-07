public with sharing class CustomerSelfServiceAccountSummary {
  @InvocableMethod(
    label='Get Customer Account Summary'
    description='Returns a customer-safe account and open case summary after customer verification.'
  )
  public static List<AccountSummaryResponse> getSummaries(
    List<AccountSummaryRequest> requests
  ) {
    List<AccountSummaryResponse> responses = new List<AccountSummaryResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    for (
      Integer requestIndex = 0; requestIndex < requests.size(); requestIndex++
    ) {
      AccountSummaryResponse response = new AccountSummaryResponse();
      response.summaryStatus = 'NEEDS_VERIFICATION';
      response.safeMessage = 'I need to verify the customer before showing account information.';
      responses.add(response);
    }

    if (!Schema.sObjectType.Account.isAccessible()) {
      for (AccountSummaryResponse response : responses) {
        response.summaryStatus = 'ACCESS_RESTRICTED';
        response.safeMessage = 'I cannot access account information for this request.';
      }
      return responses;
    }

    Set<Id> requestedAccountIds = new Set<Id>();
    Set<Id> requestedContactIds = new Set<Id>();
    Set<String> requestedEmails = new Set<String>();

    for (AccountSummaryRequest request : requests) {
      Id accountId = parseId(request == null ? null : request.accountId);
      Id contactId = parseId(request == null ? null : request.contactId);
      if (accountId != null) {
        requestedAccountIds.add(accountId);
      }
      if (contactId != null) {
        requestedContactIds.add(contactId);
      }
      if (request != null && String.isNotBlank(request.customerEmail)) {
        requestedEmails.add(request.customerEmail.trim());
      }
    }

    Map<Id, Contact> contactsById = new Map<Id, Contact>();
    Map<String, Contact> contactsByEmail = new Map<String, Contact>();
    if (
      Schema.sObjectType.Contact.isAccessible() &&
      (!requestedContactIds.isEmpty() || !requestedEmails.isEmpty())
    ) {
      for (Contact contactRecord : [
        SELECT Id, AccountId, Email
        FROM Contact
        WHERE Id IN :requestedContactIds OR Email IN :requestedEmails
      ]) {
        contactsById.put(contactRecord.Id, contactRecord);
        if (String.isNotBlank(contactRecord.Email)) {
          String emailKey = contactRecord.Email.trim().toLowerCase();
          if (!contactsByEmail.containsKey(emailKey)) {
            contactsByEmail.put(emailKey, contactRecord);
          }
        }
        if (contactRecord.AccountId != null) {
          requestedAccountIds.add(contactRecord.AccountId);
        }
      }
    }

    Map<Integer, Id> accountIdByRequestIndex = new Map<Integer, Id>();
    for (
      Integer requestIndex = 0; requestIndex < requests.size(); requestIndex++
    ) {
      AccountSummaryRequest request = requests[requestIndex];
      Id accountId = parseId(request == null ? null : request.accountId);
      if (accountId == null) {
        Id contactId = parseId(request == null ? null : request.contactId);
        Contact contactRecord = contactId == null
          ? null
          : contactsById.get(contactId);
        if (
          contactRecord == null &&
          request != null &&
          String.isNotBlank(request.customerEmail)
        ) {
          contactRecord = contactsByEmail.get(
            request.customerEmail.trim().toLowerCase()
          );
        }
        accountId = contactRecord == null ? null : contactRecord.AccountId;
      }
      if (accountId != null) {
        accountIdByRequestIndex.put(requestIndex, accountId);
      }
    }

    Set<Id> resolvedAccountIds = new Set<Id>(accountIdByRequestIndex.values());
    if (resolvedAccountIds.isEmpty()) {
      return responses;
    }

    Map<Id, Account> accountsById = new Map<Id, Account>(
      [
        SELECT
          Id,
          Name,
          BillingStreet,
          BillingCity,
          BillingState,
          BillingPostalCode,
          BillingCountry
        FROM Account
        WHERE Id IN :resolvedAccountIds
      ]
    );

    Map<Id, Integer> openCaseCountByAccountId = new Map<Id, Integer>();
    Map<Id, List<OpenCaseSummary>> openCasesByAccountId = new Map<Id, List<OpenCaseSummary>>();
    Boolean canReadCases = Schema.sObjectType.Case.isAccessible();

    if (canReadCases) {
      for (AggregateResult aggregateResult : [
        SELECT AccountId accountId, COUNT(Id) caseCount
        FROM Case
        WHERE AccountId IN :resolvedAccountIds AND IsClosed = FALSE
        GROUP BY AccountId
      ]) {
        openCaseCountByAccountId.put(
          (Id) aggregateResult.get('accountId'),
          Integer.valueOf(String.valueOf(aggregateResult.get('caseCount')))
        );
      }

      for (Case caseRecord : [
        SELECT
          Id,
          CaseNumber,
          Subject,
          Status,
          Priority,
          LastModifiedDate,
          AccountId
        FROM Case
        WHERE AccountId IN :resolvedAccountIds AND IsClosed = FALSE
        ORDER BY LastModifiedDate DESC
        LIMIT 200
      ]) {
        if (!openCasesByAccountId.containsKey(caseRecord.AccountId)) {
          openCasesByAccountId.put(
            caseRecord.AccountId,
            new List<OpenCaseSummary>()
          );
        }
        if (openCasesByAccountId.get(caseRecord.AccountId).size() < 5) {
          openCasesByAccountId.get(caseRecord.AccountId)
            .add(toOpenCaseSummary(caseRecord));
        }
      }
    }

    for (
      Integer requestIndex = 0; requestIndex < requests.size(); requestIndex++
    ) {
      Id accountId = accountIdByRequestIndex.get(requestIndex);
      Account accountRecord = accountId == null
        ? null
        : accountsById.get(accountId);
      if (accountRecord == null) {
        continue;
      }

      AccountSummaryResponse response = responses[requestIndex];
      response.summaryStatus = 'FOUND';
      response.safeMessage = 'I found the verified account summary.';
      response.accountId = accountRecord.Id;
      response.accountName = accountRecord.Name;
      response.serviceAddressSummary = buildAddress(accountRecord);
      response.openCaseCount = openCaseCountByAccountId.containsKey(
          accountRecord.Id
        )
        ? openCaseCountByAccountId.get(accountRecord.Id)
        : 0;
      response.recentCaseSummary = buildRecentCaseSummary(
        openCasesByAccountId.containsKey(accountRecord.Id)
          ? openCasesByAccountId.get(accountRecord.Id)
          : new List<OpenCaseSummary>()
      );
      response.caseAccessRestricted = !canReadCases;
    }

    return responses;
  }

  private static OpenCaseSummary toOpenCaseSummary(Case caseRecord) {
    OpenCaseSummary summary = new OpenCaseSummary();
    summary.caseId = caseRecord.Id;
    summary.caseNumber = caseRecord.CaseNumber;
    summary.subject = caseRecord.Subject;
    summary.status = caseRecord.Status;
    summary.priority = caseRecord.Priority;
    summary.lastModifiedDate = caseRecord.LastModifiedDate;
    return summary;
  }

  private static String buildRecentCaseSummary(
    List<OpenCaseSummary> openCases
  ) {
    if (openCases == null || openCases.isEmpty()) {
      return 'No open cases found for the verified account.';
    }

    List<String> caseLines = new List<String>();
    for (OpenCaseSummary openCase : openCases) {
      caseLines.add(
        openCase.caseNumber +
          ': ' +
          openCase.subject +
          ' (' +
          openCase.status +
          ', ' +
          openCase.priority +
          ')'
      );
    }
    return String.join(caseLines, '\n');
  }

  private static String buildAddress(Account accountRecord) {
    List<String> parts = new List<String>();
    addIfPresent(parts, accountRecord.BillingStreet);
    addIfPresent(parts, accountRecord.BillingCity);
    addIfPresent(parts, accountRecord.BillingState);
    addIfPresent(parts, accountRecord.BillingPostalCode);
    addIfPresent(parts, accountRecord.BillingCountry);
    return String.join(parts, ', ');
  }

  private static void addIfPresent(List<String> parts, String value) {
    if (String.isNotBlank(value)) {
      parts.add(value.trim());
    }
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

  public class AccountSummaryRequest {
    @InvocableVariable(
      label='Account Id'
      description='Verified Account Id. Preferred input after customer verification.'
    )
    public String accountId;

    @InvocableVariable(
      label='Contact Id'
      description='Verified Contact Id. Used to locate the Account when Account Id is not available.'
    )
    public String contactId;

    @InvocableVariable(
      label='Customer Email'
      description='Verified customer email. Use only after customer verification.'
    )
    public String customerEmail;
  }

  public class AccountSummaryResponse {
    @InvocableVariable(
      label='Summary Status'
      description='FOUND, NEEDS_VERIFICATION, or ACCESS_RESTRICTED.'
    )
    public String summaryStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Customer-safe message that the agent can display.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Account Id'
      description='Verified Salesforce Account Id.'
    )
    public String accountId;

    @InvocableVariable(
      label='Account Name'
      description='Verified Account name.'
    )
    public String accountName;

    @InvocableVariable(
      label='Service Address Summary'
      description='Customer-safe account service or billing address summary.'
    )
    public String serviceAddressSummary;

    @InvocableVariable(
      label='Open Case Count'
      description='Number of open Cases for the verified Account.'
    )
    public Integer openCaseCount;

    @InvocableVariable(
      label='Recent Case Summary'
      description='Customer-safe text summary of up to five recent open Cases.'
    )
    public String recentCaseSummary;

    @InvocableVariable(
      label='Case Access Restricted'
      description='True when Case access is not available to this action context.'
    )
    public Boolean caseAccessRestricted;
  }

  public class OpenCaseSummary {
    @InvocableVariable(label='Case Id' description='Salesforce Case Id.')
    public String caseId;

    @InvocableVariable(
      label='Case Number'
      description='Customer-visible Case number.'
    )
    public String caseNumber;

    @InvocableVariable(label='Subject' description='Case subject.')
    public String subject;

    @InvocableVariable(label='Status' description='Case status.')
    public String status;

    @InvocableVariable(label='Priority' description='Case priority.')
    public String priority;

    @InvocableVariable(
      label='Last Modified Date'
      description='Most recent Case update timestamp.'
    )
    public Datetime lastModifiedDate;
  }
}

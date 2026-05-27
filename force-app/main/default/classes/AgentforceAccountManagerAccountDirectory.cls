public with sharing class AgentforceAccountManagerAccountDirectory {
  private static final Integer DEFAULT_LIMIT = 10;
  private static final Integer MAX_LIMIT = 25;
  private static final Integer MAX_FETCH_ROWS = 100;
  private static final Set<String> VALID_ATTENTION_FILTERS = new Set<String>{
    'all',
    'needs_attention',
    'renewal',
    'expansion',
    'quiet'
  };
  private static final Set<String> VALID_SCOPE_FILTERS = new Set<String>{
    'owned',
    'visible'
  };

  @TestVisible
  private static AccountDirectoryDataProvider dataProvider = new SoqlAccountDirectoryDataProvider();

  @TestVisible
  private static void useSoqlDataProvider() {
    dataProvider = new SoqlAccountDirectoryDataProvider();
  }

  @InvocableMethod(
    label='List Account Manager Accounts'
    description='Lists read-only Salesforce Accounts visible to the running Account Manager with copyable Account IDs and safe commercial attention signals.'
  )
  public static List<AccountDirectoryResponse> listAccounts(
    List<AccountDirectoryRequest> requests
  ) {
    List<AccountDirectoryResponse> responses = new List<AccountDirectoryResponse>();
    if (requests == null || requests.isEmpty()) {
      responses.add(listOne(new AccountDirectoryRequest()));
      return responses;
    }

    for (AccountDirectoryRequest request : requests) {
      responses.add(
        listOne(request == null ? new AccountDirectoryRequest() : request)
      );
    }
    return responses;
  }

  private static AccountDirectoryResponse listOne(
    AccountDirectoryRequest input
  ) {
    AccountDirectoryResponse response = new AccountDirectoryResponse();
    Integer resultLimit = normalizeLimit(input.maxResults);
    String attentionFilter = normalizeAttentionFilter(input.attentionFilter);
    String scopeFilter = normalizeScopeFilter(input.scopeFilter);
    String searchText = normalizeSearch(input.searchText);

    if (String.isNotBlank(input.attentionFilter) && attentionFilter == null) {
      response.directoryStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'Attention filter must be All, Needs Attention, Renewal, Expansion, or Quiet.';
      response.accountDirectory = response.safeMessage;
      return response;
    }

    if (String.isNotBlank(input.scopeFilter) && scopeFilter == null) {
      response.directoryStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'Scope filter must be Owned or Visible.';
      response.accountDirectory = response.safeMessage;
      return response;
    }

    if (attentionFilter == null) {
      attentionFilter = 'all';
    }
    if (scopeFilter == null) {
      scopeFilter = 'owned';
    }

    List<AccountSummary> accounts;
    try {
      accounts = dataProvider.findAccounts(
        scopeFilter,
        searchText,
        Math.min((resultLimit + 1) * 5, MAX_FETCH_ROWS)
      );
    } catch (Exception queryException) {
      response.directoryStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'The Account Manager account directory could not be collected safely.';
      response.accountDirectory = response.safeMessage;
      return response;
    }

    List<AccountSummary> matchingAccounts = new List<AccountSummary>();
    for (AccountSummary account : accounts) {
      if (matchesAttentionFilter(account, attentionFilter)) {
        insertByAttention(matchingAccounts, account);
      }
    }

    Integer visibleCount = Math.min(matchingAccounts.size(), resultLimit);
    Boolean hasMore =
      matchingAccounts.size() > resultLimit ||
      accounts.size() == MAX_FETCH_ROWS;
    List<AccountSummary> visibleAccounts = new List<AccountSummary>();
    for (Integer index = 0; index < visibleCount; index++) {
      visibleAccounts.add(matchingAccounts[index]);
    }

    response.directoryStatus = 'LISTED';
    response.safeMessage = visibleCount == 0
      ? 'No Account Manager accounts matched the request.'
      : 'Account Manager accounts listed.';
    response.accountCount = visibleCount;
    response.resultLimit = resultLimit;
    response.hasMore = hasMore;
    response.accountIds = joinAccountIds(visibleAccounts);
    if (!visibleAccounts.isEmpty()) {
      AccountSummary topAccount = visibleAccounts[0];
      response.topAccountId = String.valueOf(topAccount.accountId);
      response.topAccountName = safeName(topAccount.accountName);
      response.topAccountAttentionSignals = String.join(
        attentionSignals(topAccount),
        '; '
      );
    }
    response.attentionBasis = 'Salesforce-visible account, opportunity, case, and activity signals only; run the account-health summary for LLM-led risk and recommendation decisions.';
    response.accountDirectory = buildAccountDirectory(
      visibleAccounts,
      resultLimit,
      hasMore,
      attentionFilter,
      scopeFilter,
      searchText
    );
    return response;
  }

  private static String buildAccountDirectory(
    List<AccountSummary> accounts,
    Integer resultLimit,
    Boolean hasMore,
    String attentionFilter,
    String scopeFilter,
    String searchText
  ) {
    List<String> lines = new List<String>();
    lines.add('Account Manager Account Directory');
    lines.add(
      'Showing up to ' +
        String.valueOf(resultLimit) +
        ' accounts ' +
        scopeLabel(scopeFilter) +
        filterLabel(attentionFilter, searchText) +
        ', ordered by Salesforce-visible attention signals.'
    );
    lines.add('');

    if (accounts.isEmpty()) {
      lines.add(
        'No matching accounts were found. Try a different search term, attention filter, or scope filter.'
      );
      return String.join(lines, '\n');
    }

    Integer rowNumber = 1;
    for (AccountSummary account : accounts) {
      lines.add(
        String.valueOf(rowNumber) + '. ' + safeName(account.accountName)
      );
      lines.add(
        '   Salesforce Account ID: ' + String.valueOf(account.accountId)
      );
      lines.add(
        '   Profile: ' +
          valueOrDash(account.accountType) +
          ' | ' +
          valueOrDash(account.industry) +
          ' | Annual revenue: ' +
          amountValue(account.annualRevenue)
      );
      lines.add(
        '   Pipeline: ' +
          String.valueOf(account.openOpportunityCount) +
          ' open | renewals: ' +
          String.valueOf(account.renewalOpportunityCount) +
          ' | expansion: ' +
          String.valueOf(account.expansionOpportunityCount) +
          ' | next close: ' +
          daysValue(account.daysToNextCloseDate)
      );
      lines.add(
        '   Support: ' +
          String.valueOf(account.openCaseCount) +
          ' open | escalated: ' +
          String.valueOf(account.escalatedCaseCount) +
          ' | high priority: ' +
          String.valueOf(account.highPriorityCaseCount)
      );
      lines.add(
        '   Engagement: last completed activity ' +
          daysValue(account.daysSinceLastActivity) +
          ' | activities last 90 days: ' +
          String.valueOf(account.activityCountLast90Days)
      );
      lines.add(
        '   Attention signals: ' + String.join(attentionSignals(account), '; ')
      );
      lines.add('');
      rowNumber++;
    }

    if (hasMore) {
      lines.add(
        'More accounts may be available. Ask for a search term, attention filter, visible scope, or a higher limit up to ' +
          String.valueOf(MAX_LIMIT) +
          '.'
      );
    }
    lines.add(
      'Next step: copy a Salesforce Account ID above and ask, "Summarize account health for Account ID <id>."'
    );
    return String.join(lines, '\n');
  }

  private static String filterLabel(String attentionFilter, String searchText) {
    List<String> filters = new List<String>();
    if (String.isNotBlank(attentionFilter) && attentionFilter != 'all') {
      filters.add('attention=' + attentionLabel(attentionFilter));
    }
    if (String.isNotBlank(searchText)) {
      filters.add('search=' + searchText);
    }
    return filters.isEmpty() ? '' : ' where ' + String.join(filters, ', ');
  }

  private static String scopeLabel(String scopeFilter) {
    return scopeFilter == 'visible' ? 'visible to you' : 'owned by you';
  }

  private static String attentionLabel(String value) {
    if (String.isBlank(value)) {
      return 'All';
    }
    String normalized = value.replace('_', ' ');
    return normalized.substring(0, 1).toUpperCase() + normalized.substring(1);
  }

  private static String joinAccountIds(List<AccountSummary> accounts) {
    List<String> ids = new List<String>();
    for (AccountSummary account : accounts) {
      ids.add(String.valueOf(account.accountId));
    }
    return String.join(ids, ';');
  }

  private static void insertByAttention(
    List<AccountSummary> sortedAccounts,
    AccountSummary account
  ) {
    Integer accountRank = attentionRank(account);
    Integer position = 0;
    while (position < sortedAccounts.size()) {
      if (attentionRank(sortedAccounts[position]) < accountRank) {
        break;
      }
      position++;
    }
    if (position >= sortedAccounts.size()) {
      sortedAccounts.add(account);
    } else {
      sortedAccounts.add(position, account);
    }
  }

  private static Boolean matchesAttentionFilter(
    AccountSummary account,
    String attentionFilter
  ) {
    if (attentionFilter == 'all') {
      return true;
    }
    if (attentionFilter == 'needs_attention') {
      return attentionRank(account) > 0;
    }
    if (attentionFilter == 'renewal') {
      return account.renewalOpportunityCount > 0 ||
        isNearClose(account.daysToNextCloseDate);
    }
    if (attentionFilter == 'expansion') {
      return account.expansionOpportunityCount > 0;
    }
    if (attentionFilter == 'quiet') {
      return account.daysSinceLastActivity == null ||
        account.daysSinceLastActivity >= 30;
    }
    return false;
  }

  private static Integer attentionRank(AccountSummary account) {
    Integer rank = 0;
    rank += account.escalatedCaseCount * 5;
    rank += account.highPriorityCaseCount * 3;
    if (account.openCaseCount >= 5) {
      rank += 2;
    }
    if (
      account.renewalOpportunityCount > 0 &&
      isNearClose(account.daysToNextCloseDate)
    ) {
      rank += 4;
    } else if (isNearClose(account.daysToNextCloseDate)) {
      rank += 2;
    }
    if (account.expansionOpportunityCount > 0) {
      rank += 2;
    }
    if (
      account.daysSinceLastActivity == null ||
      account.daysSinceLastActivity >= 30
    ) {
      rank += 2;
    }
    return rank;
  }

  private static List<String> attentionSignals(AccountSummary account) {
    List<String> signals = new List<String>();
    if (account.escalatedCaseCount > 0) {
      signals.add('escalated support');
    }
    if (account.highPriorityCaseCount > 0) {
      signals.add('high-priority support');
    }
    if (account.openCaseCount >= 5) {
      signals.add('support burden');
    }
    if (
      account.renewalOpportunityCount > 0 &&
      isNearClose(account.daysToNextCloseDate)
    ) {
      signals.add('renewal close window');
    } else if (isNearClose(account.daysToNextCloseDate)) {
      signals.add('near-term close window');
    }
    if (account.expansionOpportunityCount > 0) {
      signals.add('expansion opportunity present');
    }
    if (account.daysSinceLastActivity == null) {
      signals.add('no completed activity found');
    } else if (account.daysSinceLastActivity >= 30) {
      signals.add('low recent engagement');
    }
    if (signals.isEmpty()) {
      signals.add('no urgent directory signal');
    }
    return signals;
  }

  private static Boolean isNearClose(Integer daysToNextCloseDate) {
    return daysToNextCloseDate != null &&
      daysToNextCloseDate >= 0 &&
      daysToNextCloseDate <= 45;
  }

  private static Integer normalizeLimit(Integer requestedLimit) {
    if (requestedLimit == null || requestedLimit <= 0) {
      return DEFAULT_LIMIT;
    }
    return Math.min(requestedLimit, MAX_LIMIT);
  }

  private static String normalizeAttentionFilter(String attentionFilter) {
    if (String.isBlank(attentionFilter)) {
      return null;
    }
    String normalized = attentionFilter.trim()
      .toLowerCase()
      .replace(' ', '_')
      .replace('-', '_');
    return VALID_ATTENTION_FILTERS.contains(normalized) ? normalized : null;
  }

  private static String normalizeScopeFilter(String scopeFilter) {
    if (String.isBlank(scopeFilter)) {
      return null;
    }
    String normalized = scopeFilter.trim().toLowerCase();
    return VALID_SCOPE_FILTERS.contains(normalized) ? normalized : null;
  }

  private static String normalizeSearch(String searchText) {
    if (String.isBlank(searchText)) {
      return null;
    }
    String trimmed = searchText.trim();
    return trimmed.length() > 80 ? trimmed.substring(0, 80) : trimmed;
  }

  private static String safeName(String value) {
    if (String.isBlank(value)) {
      return 'Unnamed account';
    }
    String safe = value.replaceAll('[\r\n\t]+', ' ').trim();
    return safe.length() > 80 ? safe.substring(0, 80) : safe;
  }

  private static String valueOrDash(String value) {
    return String.isBlank(value) ? '-' : value.trim();
  }

  private static String daysValue(Integer value) {
    if (value == null) {
      return '-';
    }
    if (value == 0) {
      return 'today';
    }
    if (value < 0) {
      return String.valueOf(Math.abs(value)) + ' days ago';
    }
    return String.valueOf(value) + ' days';
  }

  private static String amountValue(Decimal value) {
    return value == null ? '-' : String.valueOf(value.setScale(2));
  }

  public interface AccountDirectoryDataProvider {
    List<AccountSummary> findAccounts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    );
  }

  private with sharing class SoqlAccountDirectoryDataProvider implements AccountDirectoryDataProvider {
    public List<AccountSummary> findAccounts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      List<String> filters = new List<String>();
      if (scopeFilter == 'owned') {
        filters.add(
          'OwnerId = \'' +
            String.escapeSingleQuotes(UserInfo.getUserId()) +
            '\''
        );
      }
      if (String.isNotBlank(searchText)) {
        String searchLike =
          '%' +
          String.escapeSingleQuotes(searchText.trim()) +
          '%';
        filters.add('Name LIKE \'' + searchLike + '\'');
      }

      String query = 'SELECT Id, Name, Type, Industry, AnnualRevenue, OwnerId FROM Account';
      if (!filters.isEmpty()) {
        query += ' WHERE ' + String.join(filters, ' AND ');
      }
      query +=
        ' WITH USER_MODE ORDER BY LastModifiedDate DESC LIMIT ' +
        String.valueOf(maxRows);

      List<Account> accountRecords = Database.query(query);
      List<AccountSummary> accounts = new List<AccountSummary>();
      Map<Id, AccountSummary> summariesById = new Map<Id, AccountSummary>();
      Set<Id> accountIds = new Set<Id>();

      for (Account accountRecord : accountRecords) {
        AccountSummary summary = new AccountSummary();
        summary.accountId = accountRecord.Id;
        summary.accountName = accountRecord.Name;
        summary.accountType = accountRecord.Type;
        summary.industry = accountRecord.Industry;
        summary.annualRevenue = accountRecord.AnnualRevenue;
        accounts.add(summary);
        summariesById.put(summary.accountId, summary);
        accountIds.add(summary.accountId);
      }

      if (accountIds.isEmpty()) {
        return accounts;
      }

      collectOpportunitySignals(summariesById, accountIds);
      collectCaseSignals(summariesById, accountIds);
      collectActivitySignals(summariesById, accountIds);
      return accounts;
    }

    private void collectOpportunitySignals(
      Map<Id, AccountSummary> summariesById,
      Set<Id> accountIds
    ) {
      for (Opportunity opportunityRecord : [
        SELECT AccountId, Amount, CloseDate, Type
        FROM Opportunity
        WHERE AccountId IN :accountIds AND IsClosed = FALSE
        WITH USER_MODE
      ]) {
        AccountSummary summary = summariesById.get(opportunityRecord.AccountId);
        if (summary == null) {
          continue;
        }
        summary.openOpportunityCount++;
        if (opportunityRecord.Amount != null) {
          summary.openOpportunityAmount += opportunityRecord.Amount;
        }
        if (opportunityRecord.CloseDate != null) {
          Integer daysToClose = Date.today()
            .daysBetween(opportunityRecord.CloseDate);
          if (
            summary.daysToNextCloseDate == null ||
            daysToClose < summary.daysToNextCloseDate
          ) {
            summary.daysToNextCloseDate = daysToClose;
          }
        }

        String opportunityType = String.isBlank(opportunityRecord.Type)
          ? ''
          : opportunityRecord.Type.toLowerCase();
        if (opportunityType.contains('renewal')) {
          summary.renewalOpportunityCount++;
        }
        if (
          opportunityType.contains('expansion') ||
          opportunityType.contains('upsell') ||
          opportunityType.contains('add-on')
        ) {
          summary.expansionOpportunityCount++;
        }
      }
    }

    private void collectCaseSignals(
      Map<Id, AccountSummary> summariesById,
      Set<Id> accountIds
    ) {
      for (Case caseRecord : [
        SELECT AccountId, IsEscalated, Priority, CreatedDate
        FROM Case
        WHERE AccountId IN :accountIds AND IsClosed = FALSE
        WITH USER_MODE
      ]) {
        AccountSummary summary = summariesById.get(caseRecord.AccountId);
        if (summary == null) {
          continue;
        }
        summary.openCaseCount++;
        if (caseRecord.IsEscalated) {
          summary.escalatedCaseCount++;
        }
        String priority = String.isBlank(caseRecord.Priority)
          ? ''
          : caseRecord.Priority.toLowerCase();
        if (priority == 'high' || priority == 'critical') {
          summary.highPriorityCaseCount++;
        }
        Integer caseAgeDays = caseRecord.CreatedDate.date()
          .daysBetween(Date.today());
        if (
          summary.oldestOpenCaseAgeDays == null ||
          caseAgeDays > summary.oldestOpenCaseAgeDays
        ) {
          summary.oldestOpenCaseAgeDays = caseAgeDays;
        }
      }
    }

    private void collectActivitySignals(
      Map<Id, AccountSummary> summariesById,
      Set<Id> accountIds
    ) {
      for (Task taskRecord : [
        SELECT WhatId, ActivityDate
        FROM Task
        WHERE WhatId IN :accountIds AND IsClosed = TRUE AND ActivityDate != NULL
        WITH USER_MODE
        ORDER BY ActivityDate DESC
        LIMIT 500
      ]) {
        AccountSummary summary = summariesById.get(taskRecord.WhatId);
        if (summary == null) {
          continue;
        }
        if (
          summary.lastActivityDate == null ||
          taskRecord.ActivityDate > summary.lastActivityDate
        ) {
          summary.lastActivityDate = taskRecord.ActivityDate;
          summary.daysSinceLastActivity = taskRecord.ActivityDate.daysBetween(
            Date.today()
          );
        }
        if (taskRecord.ActivityDate.daysBetween(Date.today()) <= 90) {
          summary.activityCountLast90Days++;
        }
      }
    }
  }

  public class AccountSummary {
    public Id accountId;
    public String accountName;
    public String accountType;
    public String industry;
    public Decimal annualRevenue;
    public Integer openOpportunityCount = 0;
    public Decimal openOpportunityAmount = 0;
    public Integer renewalOpportunityCount = 0;
    public Integer expansionOpportunityCount = 0;
    public Integer daysToNextCloseDate;
    public Integer openCaseCount = 0;
    public Integer escalatedCaseCount = 0;
    public Integer highPriorityCaseCount = 0;
    public Integer oldestOpenCaseAgeDays;
    public Date lastActivityDate;
    public Integer daysSinceLastActivity;
    public Integer activityCountLast90Days = 0;
  }

  public class AccountDirectoryRequest {
    @InvocableVariable(
      label='Attention Filter'
      description='Optional account attention filter: All, Needs Attention, Renewal, Expansion, or Quiet.'
    )
    public String attentionFilter;

    @InvocableVariable(
      label='Scope Filter'
      description='Optional scope filter: Owned for the Account Manager book of business or Visible for all visible Accounts. Defaults to Owned.'
    )
    public String scopeFilter;

    @InvocableVariable(
      label='Search Text'
      description='Optional Account name search text.'
    )
    public String searchText;

    @InvocableVariable(
      label='Max Results'
      description='Optional maximum number of accounts to list. Defaults to 10 and caps at 25.'
    )
    public Integer maxResults;
  }

  public class AccountDirectoryResponse {
    @InvocableVariable(
      label='Directory Status'
      description='LISTED, VALIDATION_ERROR, or UNEXPECTED_ERROR.'
    )
    public String directoryStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Safe status message for the Account Manager account directory request.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Account Directory'
      description='Formatted list of Account Manager accounts with copyable Salesforce Account IDs and safe commercial attention signals.'
    )
    public String accountDirectory;

    @InvocableVariable(
      label='Account Count'
      description='Number of accounts returned in this response.'
    )
    public Integer accountCount;

    @InvocableVariable(
      label='Result Limit'
      description='Maximum number of accounts requested after safety caps.'
    )
    public Integer resultLimit;

    @InvocableVariable(
      label='Has More Accounts'
      description='True when more accounts may be available than this response returned.'
    )
    public Boolean hasMore;

    @InvocableVariable(
      label='Account Ids'
      description='Semicolon-separated Salesforce Account IDs returned in this response.'
    )
    public String accountIds;

    @InvocableVariable(
      label='Top Account Id'
      description='Planner-only Salesforce Account ID for the top-ranked account in this directory response.'
    )
    public String topAccountId;

    @InvocableVariable(
      label='Top Account Name'
      description='Planner-only Account name for the top-ranked account in this directory response.'
    )
    public String topAccountName;

    @InvocableVariable(
      label='Top Account Attention Signals'
      description='Planner-only safe attention-signal summary for the top-ranked account in this directory response.'
    )
    public String topAccountAttentionSignals;

    @InvocableVariable(
      label='Attention Basis'
      description='Planner-only explanation that the directory uses Salesforce-visible signals for selection, not LLM-led portfolio scoring.'
    )
    public String attentionBasis;
  }
}

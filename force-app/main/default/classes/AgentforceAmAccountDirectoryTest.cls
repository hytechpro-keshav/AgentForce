@IsTest
private class AgentforceAmAccountDirectoryTest {
  @IsTest
  static void listsAccountManagerAccountsWithCopyableIds() {
    AgentforceAccountManagerAccountDirectory.dataProvider = new FakeDirectoryProvider(
      new List<AgentforceAccountManagerAccountDirectory.AccountSummary>{
        account(
          '001000000000001AAA',
          'Acme Strategic Account',
          'Customer',
          'Software',
          2500000,
          4,
          1,
          2,
          21,
          7,
          2,
          3,
          37,
          1
        ),
        account(
          '001000000000002AAA',
          'Global Expansion Account',
          'Customer',
          'Manufacturing',
          1750000,
          2,
          0,
          1,
          90,
          0,
          0,
          0,
          8,
          4
        )
      }
    );

    AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest request = new AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest();
    request.attentionFilter = 'Needs Attention';
    request.maxResults = 10;

    Test.startTest();
    List<AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse> responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse response = responses[0];
    System.assertEquals('LISTED', response.directoryStatus);
    System.assertEquals(2, response.accountCount);
    System.assertEquals(false, response.hasMore);
    System.assert(response.accountIds.contains('001000000000001AAA'));
    System.assertEquals('001000000000001AAA', response.topAccountId);
    System.assertEquals('Acme Strategic Account', response.topAccountName);
    System.assertEquals(
      'escalated support; high-priority support; support burden; renewal close window; expansion opportunity present; low recent engagement',
      response.topAccountAttentionSignals
    );
    System.assert(
      response.accountDirectory.contains('Account Manager Account Directory')
    );
    System.assert(
      response.accountDirectory.contains(
        'Salesforce Account ID: 001000000000001AAA'
      )
    );
    System.assert(response.accountDirectory.contains('escalated support'));
    System.assert(
      response.accountDirectory.contains(
        'Next step: copy a Salesforce Account ID'
      )
    );
    System.assert(response.attentionBasis.contains('Salesforce-visible'));
  }

  @IsTest
  static void filtersExpansionAccounts() {
    AgentforceAccountManagerAccountDirectory.dataProvider = new FakeDirectoryProvider(
      new List<AgentforceAccountManagerAccountDirectory.AccountSummary>{
        account(
          '001000000000003AAA',
          'Renewal Only Account',
          'Customer',
          'Software',
          1000000,
          1,
          1,
          0,
          30,
          0,
          0,
          0,
          12,
          3
        ),
        account(
          '001000000000004AAA',
          'Expansion Upside Account',
          'Customer',
          'Software',
          2000000,
          3,
          0,
          2,
          50,
          0,
          0,
          0,
          16,
          2
        )
      }
    );

    AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest request = new AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest();
    request.attentionFilter = 'Expansion';

    List<AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse> responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>{
        request
      }
    );

    System.assertEquals(1, responses[0].accountCount);
    System.assert(
      responses[0].accountDirectory.contains('Expansion Upside Account')
    );
    System.assert(
      !responses[0].accountDirectory.contains('Renewal Only Account')
    );
  }

  @IsTest
  static void capsResultsAndReportsMoreAccounts() {
    List<AgentforceAccountManagerAccountDirectory.AccountSummary> accounts = new List<AgentforceAccountManagerAccountDirectory.AccountSummary>();
    for (Integer index = 0; index < 27; index++) {
      accounts.add(
        account(
          '001000000000001AAA',
          'Account ' + String.valueOf(index),
          'Customer',
          'Software',
          null,
          0,
          0,
          0,
          null,
          0,
          0,
          0,
          10,
          1
        )
      );
    }
    AgentforceAccountManagerAccountDirectory.dataProvider = new FakeDirectoryProvider(
      accounts
    );

    AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest request = new AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest();
    request.maxResults = 50;

    List<AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse> responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>{
        request
      }
    );

    System.assertEquals(25, responses[0].resultLimit);
    System.assertEquals(25, responses[0].accountCount);
    System.assertEquals(true, responses[0].hasMore);
    System.assert(
      responses[0].accountDirectory.contains('More accounts may be available')
    );
  }

  @IsTest
  static void validatesFilters() {
    AgentforceAccountManagerAccountDirectory.dataProvider = new FakeDirectoryProvider(
      new List<AgentforceAccountManagerAccountDirectory.AccountSummary>()
    );
    AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest request = new AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest();
    request.attentionFilter = 'Highest ARR';

    List<AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse> responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>{
        request
      }
    );

    System.assertEquals('VALIDATION_ERROR', responses[0].directoryStatus);
    System.assertEquals(
      'Attention filter must be All, Needs Attention, Renewal, Expansion, or Quiet.',
      responses[0].accountDirectory
    );

    request.attentionFilter = null;
    request.scopeFilter = 'Team';
    responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>{
        request
      }
    );

    System.assertEquals('VALIDATION_ERROR', responses[0].directoryStatus);
    System.assertEquals(
      'Scope filter must be Owned or Visible.',
      responses[0].accountDirectory
    );
  }

  @IsTest
  static void handlesProviderFailureSafely() {
    AgentforceAccountManagerAccountDirectory.dataProvider = new ThrowingDirectoryProvider();
    AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest request = new AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest();
    request.searchText = 'Acme';

    List<AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse> responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>{
        request
      }
    );

    System.assertEquals('UNEXPECTED_ERROR', responses[0].directoryStatus);
    System.assertEquals(
      'The Account Manager account directory could not be collected safely.',
      responses[0].accountDirectory
    );
  }

  @IsTest
  static void handlesEmptyRequestList() {
    AgentforceAccountManagerAccountDirectory.dataProvider = new FakeDirectoryProvider(
      new List<AgentforceAccountManagerAccountDirectory.AccountSummary>()
    );

    List<AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse> responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>()
    );

    System.assertEquals(1, responses.size());
    System.assertEquals('LISTED', responses[0].directoryStatus);
    System.assertEquals(0, responses[0].accountCount);
    System.assert(
      responses[0].accountDirectory.contains('No matching accounts were found')
    );
  }

  @IsTest
  static void collectsStandardSalesforceSignals() {
    Account account = new Account(
      Name = 'AM Directory Aggregate Account',
      Type = 'Customer',
      Industry = 'Software',
      AnnualRevenue = 3200000
    );
    insert account;

    insert new Opportunity(
      Name = 'AM Renewal Opportunity',
      AccountId = account.Id,
      StageName = 'Prospecting',
      CloseDate = Date.today().addDays(20),
      Amount = 180000,
      Type = 'Renewal'
    );
    insert new Opportunity(
      Name = 'AM Expansion Opportunity',
      AccountId = account.Id,
      StageName = 'Prospecting',
      CloseDate = Date.today().addDays(35),
      Amount = 90000,
      Type = 'Expansion'
    );
    insert new Opportunity(
      Name = 'AM Undefined Type Opportunity',
      AccountId = account.Id,
      StageName = 'Prospecting',
      CloseDate = Date.today().addDays(14),
      Amount = 45000
    );
    insert new Case(
      AccountId = account.Id,
      Subject = 'Escalated account risk case',
      Status = 'New',
      Origin = 'Phone',
      Priority = 'High',
      IsEscalated = true
    );
    insert new Task(
      WhatId = account.Id,
      Subject = 'Executive account review',
      Status = 'Completed',
      Priority = 'Normal',
      ActivityDate = Date.today().addDays(-10)
    );

    AgentforceAccountManagerAccountDirectory.useSoqlDataProvider();
    AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest request = new AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest();
    request.scopeFilter = 'Visible';
    request.searchText = 'AM Directory Aggregate';
    request.attentionFilter = 'Needs Attention';
    request.maxResults = 5;

    Test.startTest();
    List<AgentforceAccountManagerAccountDirectory.AccountDirectoryResponse> responses = AgentforceAccountManagerAccountDirectory.listAccounts(
      new List<AgentforceAccountManagerAccountDirectory.AccountDirectoryRequest>{
        request
      }
    );
    Test.stopTest();

    System.assertEquals('LISTED', responses[0].directoryStatus);
    System.assertEquals(1, responses[0].accountCount);
    System.assert(responses[0].accountIds.contains(String.valueOf(account.Id)));
    System.assertEquals(String.valueOf(account.Id), responses[0].topAccountId);
    System.assert(
      responses[0].accountDirectory.contains('renewal close window')
    );
    System.assert(
      responses[0].accountDirectory.contains('expansion opportunity present')
    );
    System.assert(
      responses[0].accountDirectory.contains('high-priority support')
    );
    System.assert(
      responses[0].topAccountAttentionSignals.contains('renewal close window')
    );
  }

  private static AgentforceAccountManagerAccountDirectory.AccountSummary account(
    Id accountId,
    String accountName,
    String accountType,
    String industry,
    Decimal annualRevenue,
    Integer openOpportunityCount,
    Integer renewalOpportunityCount,
    Integer expansionOpportunityCount,
    Integer daysToNextCloseDate,
    Integer openCaseCount,
    Integer escalatedCaseCount,
    Integer highPriorityCaseCount,
    Integer daysSinceLastActivity,
    Integer activityCountLast90Days
  ) {
    AgentforceAccountManagerAccountDirectory.AccountSummary account = new AgentforceAccountManagerAccountDirectory.AccountSummary();
    account.accountId = accountId;
    account.accountName = accountName;
    account.accountType = accountType;
    account.industry = industry;
    account.annualRevenue = annualRevenue;
    account.openOpportunityCount = openOpportunityCount;
    account.renewalOpportunityCount = renewalOpportunityCount;
    account.expansionOpportunityCount = expansionOpportunityCount;
    account.daysToNextCloseDate = daysToNextCloseDate;
    account.openCaseCount = openCaseCount;
    account.escalatedCaseCount = escalatedCaseCount;
    account.highPriorityCaseCount = highPriorityCaseCount;
    account.daysSinceLastActivity = daysSinceLastActivity;
    account.activityCountLast90Days = activityCountLast90Days;
    return account;
  }

  private class FakeDirectoryProvider implements AgentforceAccountManagerAccountDirectory.AccountDirectoryDataProvider {
    private List<AgentforceAccountManagerAccountDirectory.AccountSummary> accounts;

    FakeDirectoryProvider(
      List<AgentforceAccountManagerAccountDirectory.AccountSummary> accounts
    ) {
      this.accounts = accounts;
    }

    public List<AgentforceAccountManagerAccountDirectory.AccountSummary> findAccounts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      List<AgentforceAccountManagerAccountDirectory.AccountSummary> results = new List<AgentforceAccountManagerAccountDirectory.AccountSummary>();
      for (
        AgentforceAccountManagerAccountDirectory.AccountSummary account : accounts
      ) {
        if (results.size() >= maxRows) {
          break;
        }
        results.add(account);
      }
      return results;
    }
  }

  private class ThrowingDirectoryProvider implements AgentforceAccountManagerAccountDirectory.AccountDirectoryDataProvider {
    public List<AgentforceAccountManagerAccountDirectory.AccountSummary> findAccounts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      throw new QueryException('simulated provider failure');
    }
  }
}

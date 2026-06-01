public with sharing class AgentforceAiApiRevPortfolioIntel {
  private static final String PORTFOLIO_ENDPOINT = 'callout:Agentforce_AI_API_Phase2/agent/revenue/portfolio-intelligence';
  private static final String SAFE_ENDPOINT = '/agent/revenue/portfolio-intelligence';
  private static final Integer TIMEOUT_MS = 60000;
  private static final Integer DEFAULT_LIMIT = 10;
  private static final Integer MAX_LIMIT = 25;
  private static final Integer MAX_FETCH_ROWS = 100;
  private static final Integer MAX_REQUESTS_PER_INVOCATION = 3;
  private static final Set<String> VALID_FOCUS_VALUES = new Set<String>{
    'general',
    'risk',
    'expansion',
    'churn',
    'weekly_plan'
  };
  private static final Set<String> VALID_ATTENTION_FILTERS = new Set<String>{
    'all',
    'risk',
    'renewal',
    'expansion',
    'churn',
    'quiet',
    'escalation'
  };
  private static final Set<String> VALID_SCOPE_FILTERS = new Set<String>{
    'owned',
    'visible'
  };
  private static final Set<String> VALID_PORTFOLIO_STATUSES = new Set<String>{
    'STABLE',
    'WATCH',
    'ATTENTION_REQUIRED',
    'CRITICAL',
    'INSUFFICIENT_DATA'
  };

  @TestVisible
  private static PortfolioDataProvider dataProvider = new SoqlPortfolioDataProvider();

  @TestVisible
  private static void useSoqlDataProvider() {
    dataProvider = new SoqlPortfolioDataProvider();
  }

  @InvocableMethod(
    label='Analyze Revenue Portfolio Intelligence'
    description='Analyzes sanitized aggregate facts for Account Manager-owned or visible Accounts and returns portfolio-level rankings, watchlists, trends, recommendations, and execution plans.'
  )
  public static List<PortfolioResponse> analyzePortfolio(
    List<PortfolioRequest> requests
  ) {
    List<PortfolioResponse> responses = new List<PortfolioResponse>();
    if (requests == null || requests.isEmpty()) {
      responses.add(analyzeOne(new PortfolioRequest(), 0));
      return responses;
    }

    for (Integer index = 0; index < requests.size(); index++) {
      if (index >= MAX_REQUESTS_PER_INVOCATION) {
        responses.add(excessBatchResponse(requests[index], index));
        continue;
      }
      responses.add(analyzeOne(requests[index], index));
    }
    return responses;
  }

  private static PortfolioResponse analyzeOne(
    PortfolioRequest input,
    Integer requestIndex
  ) {
    PortfolioRequest safeInput = input == null ? new PortfolioRequest() : input;
    PortfolioResponse response = baseResponse(safeInput, requestIndex);
    String analysisFocus = normalizeFocus(safeInput.analysisFocus);
    String attentionFilter = normalizeAttentionFilter(
      safeInput.attentionFilter
    );
    String scopeFilter = normalizeScopeFilter(safeInput.scopeFilter);
    String searchText = normalizeSearch(safeInput.searchText);
    Integer accountLimit = normalizeLimit(safeInput.maxAccounts);

    if (String.isNotBlank(safeInput.analysisFocus) && analysisFocus == null) {
      response.analysisStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'Analysis focus must be General, Risk, Expansion, Churn, or Weekly Plan.';
      response.portfolioBrief = response.safeMessage;
      return response;
    }
    if (
      String.isNotBlank(safeInput.attentionFilter) && attentionFilter == null
    ) {
      response.analysisStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'Attention filter must be All, Risk, Renewal, Expansion, Churn, Quiet, or Escalation.';
      response.portfolioBrief = response.safeMessage;
      return response;
    }
    if (String.isNotBlank(safeInput.scopeFilter) && scopeFilter == null) {
      response.analysisStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'Scope filter must be Owned or Visible.';
      response.portfolioBrief = response.safeMessage;
      return response;
    }

    if (analysisFocus == null) {
      analysisFocus = 'general';
    }
    if (attentionFilter == null) {
      attentionFilter = focusToAttentionFilter(analysisFocus);
    }
    Boolean usedImplicitOwnedScope = scopeFilter == null;
    if (scopeFilter == null) {
      scopeFilter = 'owned';
    }

    List<PortfolioAccountFacts> accounts;
    List<PortfolioAccountFacts> matchingAccounts;
    Integer maxRows = Math.min((accountLimit + 1) * 5, MAX_FETCH_ROWS);
    try {
      accounts = dataProvider.findPortfolioFacts(
        scopeFilter,
        searchText,
        maxRows
      );
      matchingAccounts = selectMatchingAccounts(accounts, attentionFilter);
      if (usedImplicitOwnedScope && matchingAccounts.isEmpty()) {
        List<PortfolioAccountFacts> visibleAccounts = dataProvider.findPortfolioFacts(
          'visible',
          searchText,
          maxRows
        );
        List<PortfolioAccountFacts> visibleMatches = selectMatchingAccounts(
          visibleAccounts,
          attentionFilter
        );
        if (!visibleAccounts.isEmpty() || !visibleMatches.isEmpty()) {
          scopeFilter = 'visible';
          accounts = visibleAccounts;
          matchingAccounts = visibleMatches;
        }
      }
    } catch (Exception queryException) {
      response.analysisStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'Revenue portfolio context could not be collected safely.';
      response.portfolioBrief = response.safeMessage;
      return response;
    }

    Integer visibleCount = Math.min(matchingAccounts.size(), accountLimit);
    List<PortfolioAccountFacts> visibleAccounts = new List<PortfolioAccountFacts>();
    for (Integer index = 0; index < visibleCount; index++) {
      PortfolioAccountFacts account = matchingAccounts[index];
      account.accountReference = 'account-' + String.valueOf(index + 1);
      visibleAccounts.add(account);
    }

    response.accountCount = visibleAccounts.size();
    response.resultLimit = accountLimit;
    response.hasMore =
      matchingAccounts.size() > accountLimit ||
      accounts.size() == MAX_FETCH_ROWS;
    response.accountIds = joinAccountIds(visibleAccounts);

    if (visibleAccounts.isEmpty()) {
      response.analysisStatus = 'NO_ACCOUNTS';
      response.safeMessage = 'No Account Manager accounts matched the portfolio intelligence request.';
      response.portfolioStatus = 'INSUFFICIENT_DATA';
      response.portfolioBrief = buildNoAccountsBrief(
        attentionFilter,
        scopeFilter,
        searchText
      );
      return response;
    }

    HttpRequest request = new HttpRequest();
    request.setEndpoint(PORTFOLIO_ENDPOINT);
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader(
      'X-Agentforce-Bridge',
      'phase-9b-revenue-portfolio-intelligence'
    );
    request.setBody(
      JSON.serialize(
        buildPayload(visibleAccounts, analysisFocus, response.requestId)
      )
    );

    try {
      HttpResponse httpResponse = new Http().send(request);
      response.httpStatusCode = httpResponse.getStatusCode();

      if (httpResponse.getStatusCode() == 401) {
        response.analysisStatus = 'AUTH_ERROR';
        response.safeMessage = 'The revenue portfolio analysis service rejected the request.';
        response.portfolioBrief = response.safeMessage;
        return response;
      }

      if (httpResponse.getStatusCode() == 403) {
        response.analysisStatus = 'AUTH_ERROR';
        response.safeMessage = 'The revenue portfolio analysis service is not authorized for this request.';
        response.portfolioBrief = response.safeMessage;
        return response;
      }

      if (
        httpResponse.getStatusCode() < 200 ||
        httpResponse.getStatusCode() > 299
      ) {
        response.analysisStatus = 'BACKEND_ERROR';
        response.safeMessage = 'The revenue portfolio analysis service returned an error.';
        response.portfolioBrief = response.safeMessage;
        return response;
      }

      return parsePortfolioResponse(
        httpResponse.getBody(),
        response,
        visibleAccounts
      );
    } catch (CalloutException calloutException) {
      response.analysisStatus = 'CALLOUT_FAILED';
      response.safeMessage = 'The revenue portfolio analysis service could not be reached.';
      response.portfolioBrief = response.safeMessage;
      return response;
    } catch (Exception unexpectedException) {
      response.analysisStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'Revenue portfolio intelligence could not be completed safely.';
      response.portfolioBrief = response.safeMessage;
      return response;
    }
  }

  private static Map<String, Object> buildPayload(
    List<PortfolioAccountFacts> accounts,
    String analysisFocus,
    String requestId
  ) {
    Map<String, Object> payload = new Map<String, Object>();
    payload.put('requestId', requestId);
    payload.put('analysisFocus', analysisFocus);
    payload.put('sourceSystems', buildSourceSystems(accounts));
    List<Object> accountPayloads = new List<Object>();
    for (PortfolioAccountFacts account : accounts) {
      Map<String, Object> accountPayload = new Map<String, Object>();
      putString(accountPayload, 'accountReference', account.accountReference);
      putString(accountPayload, 'accountType', account.accountType);
      putString(accountPayload, 'accountIndustry', account.industry);
      putDecimal(accountPayload, 'annualRevenue', account.annualRevenue);
      putInteger(accountPayload, 'employeeCount', account.employeeCount);
      putInteger(accountPayload, 'accountAgeDays', account.accountAgeDays);
      putInteger(
        accountPayload,
        'openOpportunityCount',
        account.openOpportunityCount
      );
      putDecimal(
        accountPayload,
        'openOpportunityAmount',
        account.openOpportunityAmount
      );
      putDecimal(
        accountPayload,
        'weightedPipelineAmount',
        account.weightedPipelineAmount
      );
      putInteger(
        accountPayload,
        'daysToNextCloseDate',
        account.daysToNextCloseDate
      );
      putInteger(
        accountPayload,
        'wonOpportunityCountLast180Days',
        account.wonOpportunityCountLast180Days
      );
      putInteger(
        accountPayload,
        'lostOpportunityCountLast180Days',
        account.lostOpportunityCountLast180Days
      );
      putInteger(
        accountPayload,
        'renewalOpportunityCount',
        account.renewalOpportunityCount
      );
      putDecimal(
        accountPayload,
        'renewalOpportunityAmount',
        account.renewalOpportunityAmount
      );
      putInteger(
        accountPayload,
        'expansionOpportunityCount',
        account.expansionOpportunityCount
      );
      putDecimal(
        accountPayload,
        'expansionOpportunityAmount',
        account.expansionOpportunityAmount
      );
      putInteger(accountPayload, 'openCaseCount', account.openCaseCount);
      putInteger(
        accountPayload,
        'escalatedCaseCount',
        account.escalatedCaseCount
      );
      putInteger(
        accountPayload,
        'highPriorityCaseCount',
        account.highPriorityCaseCount
      );
      putInteger(
        accountPayload,
        'oldestOpenCaseAgeDays',
        account.oldestOpenCaseAgeDays
      );
      putInteger(
        accountPayload,
        'activityCountLast30Days',
        account.activityCountLast30Days
      );
      putInteger(
        accountPayload,
        'daysSinceLastActivity',
        account.daysSinceLastActivity
      );
      putInteger(
        accountPayload,
        'executiveActivityCountLast90Days',
        account.executiveActivityCountLast90Days
      );
      putInteger(
        accountPayload,
        'activeProjectCount',
        account.activeProjectCount
      );
      putInteger(
        accountPayload,
        'atRiskProjectCount',
        account.atRiskProjectCount
      );
      putInteger(
        accountPayload,
        'lateMilestoneCount',
        account.lateMilestoneCount
      );
      putInteger(
        accountPayload,
        'openResourceRequestCount',
        account.openResourceRequestCount
      );
      putDecimal(
        accountPayload,
        'avgProjectMarginPercent',
        account.avgProjectMarginPercent
      );
      putDecimal(
        accountPayload,
        'totalProjectRemainingAmount',
        account.totalProjectRemainingAmount
      );
      putInteger(
        accountPayload,
        'overdueInvoiceCount',
        account.overdueInvoiceCount
      );
      putDecimal(
        accountPayload,
        'overdueInvoiceAmount',
        account.overdueInvoiceAmount
      );
      putDecimal(
        accountPayload,
        'averagePaymentDelayDays',
        account.averagePaymentDelayDays
      );
      putDecimal(
        accountPayload,
        'marginPressureAmount',
        account.marginPressureAmount
      );
      putInteger(
        accountPayload,
        'productActiveUserCount',
        account.productActiveUserCount
      );
      putDecimal(
        accountPayload,
        'productUsageTrendPercent',
        account.productUsageTrendPercent
      );
      putDecimal(
        accountPayload,
        'featureAdoptionPercent',
        account.featureAdoptionPercent
      );
      accountPayloads.add(accountPayload);
    }
    payload.put('accounts', accountPayloads);
    return payload;
  }

  private static PortfolioResponse parsePortfolioResponse(
    String body,
    PortfolioResponse response,
    List<PortfolioAccountFacts> accounts
  ) {
    try {
      Map<String, Object> payload = asMap(JSON.deserializeUntyped(body));
      String portfolioStatus = normalizePortfolioStatus(
        getString(payload, 'portfolioStatus')
      );
      String provider = getString(payload, 'provider');
      String model = getString(payload, 'model');
      String summary = getString(payload, 'summary');

      if (
        portfolioStatus == null ||
        String.isBlank(provider) ||
        String.isBlank(model) ||
        String.isBlank(summary)
      ) {
        response.analysisStatus = 'MALFORMED_RESPONSE';
        response.safeMessage = 'The revenue portfolio analysis service returned an unexpected response.';
        response.portfolioBrief = response.safeMessage;
        return response;
      }

      Map<String, PortfolioAccountFacts> accountsByReference = accountsByReference(
        accounts
      );
      response.analysisStatus = 'ANALYZED';
      response.safeMessage = 'Revenue portfolio intelligence completed.';
      response.portfolioStatus = portfolioStatus;
      response.summary = limitText(maskSensitiveText(summary), 360);
      response.topRiskAccounts = formatRankedAccounts(
        asList(payload.get('topRiskAccounts')),
        accountsByReference
      );
      response.topExpansionAccounts = formatRankedAccounts(
        asList(payload.get('topExpansionAccounts')),
        accountsByReference
      );
      response.urgentRenewals = formatRankedAccounts(
        asList(payload.get('urgentRenewals')),
        accountsByReference
      );
      response.escalationAccounts = formatRankedAccounts(
        asList(payload.get('escalationAccounts')),
        accountsByReference
      );
      response.silentAccounts = formatRankedAccounts(
        asList(payload.get('silentAccounts')),
        accountsByReference
      );
      response.portfolioWatchlists = formatWatchlists(
        asList(payload.get('portfolioWatchlists')),
        accountsByReference
      );
      response.portfolioTrends = formatTrends(
        asList(payload.get('portfolioTrends'))
      );
      response.recommendedActions = formatActions(
        asList(payload.get('recommendedActions')),
        accountsByReference
      );
      response.weeklyExecutionPlan = formatPlan(
        asList(payload.get('weeklyExecutionPlan'))
      );
      response.provider = provider;
      response.model = model;
      response.fallbackUsed = getBoolean(payload, 'fallbackUsed');
      response.decisionFallbackUsed = getBoolean(
        payload,
        'decisionFallbackUsed'
      );
      response.latencyMs = getInteger(payload, 'latencyMs');
      assignTopAccount(response, payload, accountsByReference);
      response.portfolioBrief = buildPortfolioBrief(response);
      return response;
    } catch (Exception parseException) {
      response.analysisStatus = 'MALFORMED_RESPONSE';
      response.safeMessage = 'The revenue portfolio analysis service returned an unreadable response.';
      response.portfolioBrief = response.safeMessage;
      return response;
    }
  }

  private static void assignTopAccount(
    PortfolioResponse response,
    Map<String, Object> payload,
    Map<String, PortfolioAccountFacts> accountsByReference
  ) {
    List<String> rankedFields = new List<String>{
      'topRiskAccounts',
      'urgentRenewals',
      'escalationAccounts',
      'topExpansionAccounts',
      'silentAccounts'
    };
    for (String fieldName : rankedFields) {
      for (Object item : asList(payload.get(fieldName))) {
        Map<String, Object> ranked = asMap(item);
        PortfolioAccountFacts account = accountsByReference.get(
          getString(ranked, 'accountReference')
        );
        if (account != null) {
          response.topAccountId = String.valueOf(account.accountId);
          response.topAccountName = safeName(account.accountName);
          response.topAccountRecommendationReason = limitText(
            maskSensitiveText(getString(ranked, 'reason')),
            240
          );
          return;
        }
      }
    }
  }

  private static PortfolioResponse baseResponse(
    PortfolioRequest input,
    Integer requestIndex
  ) {
    PortfolioResponse response = new PortfolioResponse();
    response.analysisStatus = 'NOT_ANALYZED';
    response.safeMessage = 'Revenue portfolio intelligence has not completed.';
    response.portfolioBrief = response.safeMessage;
    response.endpoint = SAFE_ENDPOINT;
    response.requestId = buildRequestId(input, requestIndex);
    response.analyzedAt = Datetime.now()
      .formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
    return response;
  }

  private static PortfolioResponse excessBatchResponse(
    PortfolioRequest input,
    Integer requestIndex
  ) {
    PortfolioResponse response = baseResponse(input, requestIndex);
    response.analysisStatus = 'VALIDATION_ERROR';
    response.safeMessage = 'Revenue portfolio intelligence can process up to 3 requests per Agentforce invocation.';
    response.portfolioBrief = response.safeMessage;
    return response;
  }

  private static String buildPortfolioBrief(PortfolioResponse response) {
    List<String> lines = new List<String>();
    lines.add('Revenue Portfolio Intelligence Brief');
    lines.add('');
    lines.add('Portfolio status');
    lines.add(
      label(response.portfolioStatus) + '. ' + ensureSentence(response.summary)
    );
    lines.add('');
    lines.add('Top risk accounts');
    lines.add(valueOrNone(response.topRiskAccounts));
    lines.add('');
    lines.add('Top expansion accounts');
    lines.add(valueOrNone(response.topExpansionAccounts));
    lines.add('');
    lines.add('Watchlists');
    lines.add(valueOrNone(response.portfolioWatchlists));
    lines.add('');
    lines.add('Portfolio trends');
    lines.add(valueOrNone(response.portfolioTrends));
    lines.add('');
    lines.add('Recommended actions');
    lines.add(valueOrNone(response.recommendedActions));
    lines.add('');
    lines.add('Weekly execution plan');
    lines.add(valueOrNone(response.weeklyExecutionPlan));
    if (String.isNotBlank(response.topAccountId)) {
      lines.add('');
      lines.add('Autonomous drilldown candidate');
      lines.add(
        safeName(response.topAccountName) +
          ' is the top follow-up candidate. After confirmation, run the single-account revenue health summary for this account' +
          '.'
      );
    }
    return String.join(lines, '\n');
  }

  private static String buildNoAccountsBrief(
    String attentionFilter,
    String scopeFilter,
    String searchText
  ) {
    List<String> lines = new List<String>();
    lines.add('Revenue Portfolio Intelligence Brief');
    lines.add('');
    lines.add('Portfolio status');
    lines.add(
      'Insufficient data. No accounts matched the requested portfolio filter.'
    );
    lines.add('');
    lines.add('Filters reviewed');
    lines.add(
      'Scope: ' +
        scopeFilter +
        '; attention: ' +
        attentionFilter +
        '; search: ' +
        (String.isBlank(searchText) ? '-' : searchText) +
        '.'
    );
    lines.add('');
    lines.add('Recommended action');
    lines.add(
      'Refresh the Account Manager account directory, broaden filters, or switch from Owned to Visible scope if appropriate.'
    );
    return String.join(lines, '\n');
  }

  private static String formatRankedAccounts(
    List<Object> items,
    Map<String, PortfolioAccountFacts> accountsByReference
  ) {
    List<String> lines = new List<String>();
    Integer rowNumber = 1;
    for (Object item : items) {
      Map<String, Object> ranked = asMap(item);
      PortfolioAccountFacts account = accountsByReference.get(
        getString(ranked, 'accountReference')
      );
      if (account == null) {
        continue;
      }
      String scoreText = getInteger(ranked, 'score') == null
        ? 'not scored'
        : String.valueOf(getInteger(ranked, 'score')) + '/100';
      lines.add(
        String.valueOf(rowNumber) +
          '. ' +
          safeName(account.accountName) +
          ' - ' +
          label(getString(ranked, 'level')) +
          ', score ' +
          scoreText +
          '. Why: ' +
          ensureSentence(
            limitText(maskSensitiveText(getString(ranked, 'reason')), 220)
          ) +
          ' Action: ' +
          ensureSentence(
            limitText(
              maskSensitiveText(getString(ranked, 'recommendedAction')),
              180
            )
          )
      );
      rowNumber++;
    }
    return String.join(lines, '\n');
  }

  private static String formatWatchlists(
    List<Object> items,
    Map<String, PortfolioAccountFacts> accountsByReference
  ) {
    List<String> lines = new List<String>();
    for (Object item : items) {
      Map<String, Object> watchlist = asMap(item);
      List<String> accountNames = new List<String>();
      for (Object reference : asList(watchlist.get('accountReferences'))) {
        PortfolioAccountFacts account = accountsByReference.get(
          String.valueOf(reference)
        );
        if (account != null) {
          accountNames.add(safeName(account.accountName));
        }
      }
      lines.add(
        '- ' +
          limitText(maskSensitiveText(getString(watchlist, 'name')), 80) +
          ': ' +
          (accountNames.isEmpty()
            ? 'No mapped accounts'
            : String.join(accountNames, ', ')) +
          '. ' +
          ensureSentence(
            limitText(maskSensitiveText(getString(watchlist, 'rationale')), 220)
          )
      );
    }
    return String.join(lines, '\n');
  }

  private static String formatTrends(List<Object> items) {
    List<String> lines = new List<String>();
    for (Object item : items) {
      Map<String, Object> trend = asMap(item);
      lines.add(
        '- ' +
          limitText(maskSensitiveText(getString(trend, 'trend')), 90) +
          ' (' +
          label(getString(trend, 'severity')) +
          ', ' +
          limitText(maskSensitiveText(getString(trend, 'direction')), 60) +
          '): ' +
          ensureSentence(
            limitText(maskSensitiveText(getString(trend, 'rationale')), 240)
          )
      );
    }
    return String.join(lines, '\n');
  }

  private static String formatActions(
    List<Object> items,
    Map<String, PortfolioAccountFacts> accountsByReference
  ) {
    List<String> lines = new List<String>();
    for (Object item : items) {
      Map<String, Object> action = asMap(item);
      List<String> accountNames = new List<String>();
      for (Object reference : asList(action.get('accountReferences'))) {
        PortfolioAccountFacts account = accountsByReference.get(
          String.valueOf(reference)
        );
        if (account != null) {
          accountNames.add(safeName(account.accountName));
        }
      }
      lines.add(
        '- ' +
          label(getString(action, 'priority')) +
          ': ' +
          ensureSentence(
            limitText(maskSensitiveText(getString(action, 'action')), 220)
          ) +
          ' Accounts: ' +
          (accountNames.isEmpty()
            ? 'portfolio-level'
            : String.join(accountNames, ', ')) +
          '. Rationale: ' +
          ensureSentence(
            limitText(maskSensitiveText(getString(action, 'rationale')), 220)
          )
      );
    }
    return String.join(lines, '\n');
  }

  private static String formatPlan(List<Object> items) {
    List<String> lines = new List<String>();
    for (Object item : items) {
      Map<String, Object> planDay = asMap(item);
      List<String> actions = new List<String>();
      for (Object action : asList(planDay.get('actions'))) {
        actions.add(
          ensureSentence(
            limitText(maskSensitiveText(String.valueOf(action)), 180)
          )
        );
      }
      lines.add(
        '- ' +
          limitText(maskSensitiveText(getString(planDay, 'day')), 40) +
          ': ' +
          (actions.isEmpty()
            ? 'Review portfolio follow-ups.'
            : String.join(actions, ' '))
      );
    }
    return String.join(lines, '\n');
  }

  private class SoqlPortfolioDataProvider implements PortfolioDataProvider {
    public List<PortfolioAccountFacts> findPortfolioFacts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      List<Account> accountRecords = findAccounts(
        scopeFilter,
        searchText,
        maxRows
      );
      List<PortfolioAccountFacts> accounts = new List<PortfolioAccountFacts>();
      Map<Id, PortfolioAccountFacts> factsByAccountId = new Map<Id, PortfolioAccountFacts>();
      Set<Id> accountIds = new Set<Id>();
      for (Account accountRecord : accountRecords) {
        PortfolioAccountFacts facts = new PortfolioAccountFacts();
        facts.accountId = accountRecord.Id;
        facts.accountName = getRecordString(accountRecord, 'Name');
        facts.accountType = getRecordString(accountRecord, 'Type');
        facts.industry = getRecordString(accountRecord, 'Industry');
        facts.annualRevenue = getRecordDecimal(accountRecord, 'AnnualRevenue');
        facts.employeeCount = getRecordInteger(
          accountRecord,
          'NumberOfEmployees'
        );
        Datetime createdDate = getRecordDatetime(accountRecord, 'CreatedDate');
        if (createdDate != null) {
          facts.accountAgeDays = createdDate.date().daysBetween(Date.today());
        }
        Date lastActivityDate = getRecordDate(
          accountRecord,
          'LastActivityDate'
        );
        if (lastActivityDate != null) {
          facts.daysSinceLastActivity = lastActivityDate.daysBetween(
            Date.today()
          );
        }
        accounts.add(facts);
        factsByAccountId.put(facts.accountId, facts);
        accountIds.add(facts.accountId);
      }

      if (!accountIds.isEmpty()) {
        safelyCollectOpportunitySignals(factsByAccountId, accountIds);
        safelyCollectCaseSignals(factsByAccountId, accountIds);
        safelyCollectActivitySignals(factsByAccountId, accountIds);
      }
      return accounts;
    }

    private List<Account> findAccounts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    ) {
      try {
        List<String> filters = new List<String>();
        if (scopeFilter == 'owned') {
          filters.add(
            'OwnerId = \'' +
              String.escapeSingleQuotes(UserInfo.getUserId()) +
              '\''
          );
        }
        if (String.isNotBlank(searchText)) {
          filters.add(
            'Name LIKE \'%' +
              String.escapeSingleQuotes(searchText.trim()) +
              '%\''
          );
        }
        String query = 'SELECT Id, Name, Type, Industry, AnnualRevenue, NumberOfEmployees, CreatedDate, LastActivityDate FROM Account';
        if (!filters.isEmpty()) {
          query += ' WHERE ' + String.join(filters, ' AND ');
        }
        query +=
          ' WITH USER_MODE ORDER BY LastModifiedDate DESC LIMIT ' +
          String.valueOf(maxRows);
        return Database.query(query);
      } catch (Exception extendedQueryException) {
        return findAccountsWithMinimalFields(scopeFilter, searchText, maxRows);
      }
    }

    private List<Account> findAccountsWithMinimalFields(
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
        filters.add(
          'Name LIKE \'%' + String.escapeSingleQuotes(searchText.trim()) + '%\''
        );
      }
      String query = 'SELECT Id, Name FROM Account';
      if (!filters.isEmpty()) {
        query += ' WHERE ' + String.join(filters, ' AND ');
      }
      query +=
        ' WITH USER_MODE ORDER BY LastModifiedDate DESC LIMIT ' +
        String.valueOf(maxRows);
      return Database.query(query);
    }

    private void safelyCollectOpportunitySignals(
      Map<Id, PortfolioAccountFacts> factsByAccountId,
      Set<Id> accountIds
    ) {
      try {
        collectOpportunitySignals(factsByAccountId, accountIds);
      } catch (Exception opportunityException) {
      }
    }

    private void collectOpportunitySignals(
      Map<Id, PortfolioAccountFacts> factsByAccountId,
      Set<Id> accountIds
    ) {
      Date today = Date.today();
      Date last180 = today.addDays(-180);
      for (Opportunity opportunityRecord : [
        SELECT
          AccountId,
          IsClosed,
          IsWon,
          Amount,
          Probability,
          CloseDate,
          StageName,
          Type
        FROM Opportunity
        WHERE
          AccountId IN :accountIds
          AND (IsClosed = FALSE
          OR CloseDate >= :last180)
        WITH USER_MODE
        LIMIT 2000
      ]) {
        PortfolioAccountFacts facts = factsByAccountId.get(
          opportunityRecord.AccountId
        );
        if (facts == null) {
          continue;
        }
        Boolean closed =
          getRecordBoolean(opportunityRecord, 'IsClosed') == true;
        Boolean won = getRecordBoolean(opportunityRecord, 'IsWon') == true;
        Decimal amount = getRecordDecimal(opportunityRecord, 'Amount');
        amount = amount == null ? 0 : amount;
        Date closeDate = getRecordDate(opportunityRecord, 'CloseDate');
        if (!closed) {
          facts.openOpportunityCount++;
          facts.openOpportunityAmount += amount;
          Decimal probability = getRecordDecimal(
            opportunityRecord,
            'Probability'
          );
          probability = probability == null ? 0 : probability;
          facts.weightedPipelineAmount += amount * probability / 100;
          if (
            closeDate != null &&
            (facts.daysToNextCloseDate == null ||
            today.daysBetween(closeDate) < facts.daysToNextCloseDate)
          ) {
            facts.daysToNextCloseDate = today.daysBetween(closeDate);
          }
        } else if (won && closeDate != null && closeDate >= last180) {
          facts.wonOpportunityCountLast180Days++;
        } else if (!won && closeDate != null && closeDate >= last180) {
          facts.lostOpportunityCountLast180Days++;
        }
        String opportunityType = String.valueOf(
            getRecordString(opportunityRecord, 'Type')
          )
          .toLowerCase();
        String stageName = String.valueOf(
            getRecordString(opportunityRecord, 'StageName')
          )
          .toLowerCase();
        if (opportunityType.contains('renew') || stageName.contains('renew')) {
          facts.renewalOpportunityCount++;
          facts.renewalOpportunityAmount += amount;
        }
        if (
          opportunityType.contains('expansion') ||
          opportunityType.contains('upgrade') ||
          opportunityType.contains('upsell') ||
          opportunityType.contains('add-on') ||
          stageName.contains('expansion') ||
          stageName.contains('upsell')
        ) {
          facts.expansionOpportunityCount++;
          facts.expansionOpportunityAmount += amount;
        }
      }
    }

    private void safelyCollectCaseSignals(
      Map<Id, PortfolioAccountFacts> factsByAccountId,
      Set<Id> accountIds
    ) {
      try {
        collectCaseSignals(factsByAccountId, accountIds);
      } catch (Exception caseException) {
      }
    }

    private void collectCaseSignals(
      Map<Id, PortfolioAccountFacts> factsByAccountId,
      Set<Id> accountIds
    ) {
      Date today = Date.today();
      Date last180 = today.addDays(-180);
      for (Case caseRecord : [
        SELECT AccountId, IsClosed, IsEscalated, Priority, CreatedDate
        FROM Case
        WHERE
          AccountId IN :accountIds
          AND (IsClosed = FALSE
          OR CreatedDate >= :last180)
        WITH USER_MODE
        LIMIT 2000
      ]) {
        PortfolioAccountFacts facts = factsByAccountId.get(
          caseRecord.AccountId
        );
        if (facts == null) {
          continue;
        }
        Boolean closed = getRecordBoolean(caseRecord, 'IsClosed') == true;
        if (!closed) {
          facts.openCaseCount++;
          Datetime createdDate = getRecordDatetime(caseRecord, 'CreatedDate');
          if (createdDate != null) {
            Integer caseAgeDays = createdDate.date().daysBetween(today);
            if (
              facts.oldestOpenCaseAgeDays == null ||
              caseAgeDays > facts.oldestOpenCaseAgeDays
            ) {
              facts.oldestOpenCaseAgeDays = caseAgeDays;
            }
          }
        }
        if (getRecordBoolean(caseRecord, 'IsEscalated') == true) {
          facts.escalatedCaseCount++;
        }
        String priority = String.valueOf(
            getRecordString(caseRecord, 'Priority')
          )
          .toLowerCase();
        if (priority == 'high' || priority == 'critical') {
          facts.highPriorityCaseCount++;
        }
      }
    }

    private void safelyCollectActivitySignals(
      Map<Id, PortfolioAccountFacts> factsByAccountId,
      Set<Id> accountIds
    ) {
      try {
        collectActivitySignals(factsByAccountId, accountIds);
      } catch (Exception activityException) {
      }
    }

    private void collectActivitySignals(
      Map<Id, PortfolioAccountFacts> factsByAccountId,
      Set<Id> accountIds
    ) {
      Date today = Date.today();
      Date last30 = today.addDays(-30);
      Date last90 = today.addDays(-90);
      for (Task taskRecord : [
        SELECT WhatId, ActivityDate, CreatedDate
        FROM Task
        WHERE WhatId IN :accountIds AND CreatedDate >= :last90
        WITH USER_MODE
        LIMIT 2000
      ]) {
        PortfolioAccountFacts facts = factsByAccountId.get(taskRecord.WhatId);
        if (facts == null) {
          continue;
        }
        Date activityDate = getRecordDate(taskRecord, 'ActivityDate');
        Datetime createdDate = getRecordDatetime(taskRecord, 'CreatedDate');
        if (activityDate == null && createdDate != null) {
          activityDate = createdDate.date();
        }
        if (activityDate == null) {
          continue;
        }
        if (activityDate >= last30) {
          facts.activityCountLast30Days++;
        }
        if (activityDate >= last90) {
          facts.executiveActivityCountLast90Days = facts.executiveActivityCountLast90Days ==
            null
            ? 1
            : facts.executiveActivityCountLast90Days + 1;
        }
        Integer daysSinceTask = activityDate.daysBetween(today);
        if (
          facts.daysSinceLastActivity == null ||
          daysSinceTask < facts.daysSinceLastActivity
        ) {
          facts.daysSinceLastActivity = daysSinceTask;
        }
      }
    }

    private Object getRecordValue(SObject record, String fieldName) {
      Map<String, Object> values = record.getPopulatedFieldsAsMap();
      return values.containsKey(fieldName) ? values.get(fieldName) : null;
    }

    private String getRecordString(SObject record, String fieldName) {
      Object value = getRecordValue(record, fieldName);
      return value == null ? null : String.valueOf(value);
    }

    private Decimal getRecordDecimal(SObject record, String fieldName) {
      Object value = getRecordValue(record, fieldName);
      return value instanceof Decimal ? (Decimal) value : null;
    }

    private Integer getRecordInteger(SObject record, String fieldName) {
      Object value = getRecordValue(record, fieldName);
      return value instanceof Integer ? (Integer) value : null;
    }

    private Boolean getRecordBoolean(SObject record, String fieldName) {
      Object value = getRecordValue(record, fieldName);
      return value instanceof Boolean ? (Boolean) value : null;
    }

    private Datetime getRecordDatetime(SObject record, String fieldName) {
      Object value = getRecordValue(record, fieldName);
      return value instanceof Datetime ? (Datetime) value : null;
    }

    private Date getRecordDate(SObject record, String fieldName) {
      Object value = getRecordValue(record, fieldName);
      return value instanceof Date ? (Date) value : null;
    }
  }

  public interface PortfolioDataProvider {
    List<PortfolioAccountFacts> findPortfolioFacts(
      String scopeFilter,
      String searchText,
      Integer maxRows
    );
  }

  public class PortfolioAccountFacts {
    public Id accountId;
    public String accountReference;
    public String accountName;
    public String accountType;
    public String industry;
    public Decimal annualRevenue;
    public Integer employeeCount;
    public Integer accountAgeDays;
    public Integer openOpportunityCount = 0;
    public Decimal openOpportunityAmount = 0;
    public Decimal weightedPipelineAmount = 0;
    public Integer daysToNextCloseDate;
    public Integer wonOpportunityCountLast180Days = 0;
    public Integer lostOpportunityCountLast180Days = 0;
    public Integer renewalOpportunityCount = 0;
    public Decimal renewalOpportunityAmount = 0;
    public Integer expansionOpportunityCount = 0;
    public Decimal expansionOpportunityAmount = 0;
    public Integer openCaseCount = 0;
    public Integer escalatedCaseCount = 0;
    public Integer highPriorityCaseCount = 0;
    public Integer oldestOpenCaseAgeDays;
    public Integer activityCountLast30Days = 0;
    public Integer daysSinceLastActivity;
    public Integer executiveActivityCountLast90Days;
    public Integer activeProjectCount;
    public Integer atRiskProjectCount;
    public Integer lateMilestoneCount;
    public Integer openResourceRequestCount;
    public Decimal avgProjectMarginPercent;
    public Decimal totalProjectRemainingAmount;
    public Integer overdueInvoiceCount;
    public Decimal overdueInvoiceAmount;
    public Decimal averagePaymentDelayDays;
    public Decimal marginPressureAmount;
    public Integer productActiveUserCount;
    public Decimal productUsageTrendPercent;
    public Decimal featureAdoptionPercent;
  }

  private static String normalizeFocus(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    String normalized = value.trim()
      .toLowerCase()
      .replace(' ', '_')
      .replace('-', '_');
    return VALID_FOCUS_VALUES.contains(normalized) ? normalized : null;
  }

  private static String normalizeAttentionFilter(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    String normalized = value.trim()
      .toLowerCase()
      .replace(' ', '_')
      .replace('-', '_');
    return VALID_ATTENTION_FILTERS.contains(normalized) ? normalized : null;
  }

  private static String normalizeScopeFilter(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    String normalized = value.trim().toLowerCase();
    return VALID_SCOPE_FILTERS.contains(normalized) ? normalized : null;
  }

  private static String focusToAttentionFilter(String analysisFocus) {
    if (analysisFocus == 'risk' || analysisFocus == 'churn') {
      return 'risk';
    }
    return 'all';
  }

  private static List<PortfolioAccountFacts> selectMatchingAccounts(
    List<PortfolioAccountFacts> accounts,
    String attentionFilter
  ) {
    List<PortfolioAccountFacts> matchingAccounts = new List<PortfolioAccountFacts>();
    if (accounts == null) {
      return matchingAccounts;
    }
    for (PortfolioAccountFacts account : accounts) {
      if (matchesAttentionFilter(account, attentionFilter)) {
        insertByPortfolioRank(matchingAccounts, account);
      }
    }
    return matchingAccounts;
  }

  private static Boolean matchesAttentionFilter(
    PortfolioAccountFacts account,
    String attentionFilter
  ) {
    if (attentionFilter == 'all') {
      return true;
    }
    if (attentionFilter == 'risk') {
      return portfolioRank(account) > 0;
    }
    if (attentionFilter == 'renewal') {
      return account.renewalOpportunityCount > 0 ||
        isNearClose(account.daysToNextCloseDate);
    }
    if (attentionFilter == 'expansion') {
      return account.expansionOpportunityCount > 0;
    }
    if (attentionFilter == 'churn') {
      return portfolioRank(account) >= 4 || usageDeclining(account);
    }
    if (attentionFilter == 'quiet') {
      return account.daysSinceLastActivity == null ||
        account.daysSinceLastActivity >= 30;
    }
    if (attentionFilter == 'escalation') {
      return account.escalatedCaseCount > 0 ||
        account.highPriorityCaseCount > 0;
    }
    return false;
  }

  private static Integer portfolioRank(PortfolioAccountFacts account) {
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
    if (
      account.daysSinceLastActivity == null ||
      account.daysSinceLastActivity >= 30
    ) {
      rank += 2;
    }
    if (usageDeclining(account)) {
      rank += 3;
    }
    if (account.expansionOpportunityCount > 0) {
      rank += 1;
    }
    return rank;
  }

  private static Boolean usageDeclining(PortfolioAccountFacts account) {
    return account.productUsageTrendPercent != null &&
      account.productUsageTrendPercent <= -10;
  }

  private static Boolean isNearClose(Integer daysToNextCloseDate) {
    return daysToNextCloseDate != null &&
      daysToNextCloseDate >= 0 &&
      daysToNextCloseDate <= 45;
  }

  private static void insertByPortfolioRank(
    List<PortfolioAccountFacts> sortedAccounts,
    PortfolioAccountFacts account
  ) {
    Integer accountRank = portfolioRank(account);
    Integer position = 0;
    while (position < sortedAccounts.size()) {
      if (portfolioRank(sortedAccounts[position]) < accountRank) {
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

  private static Integer normalizeLimit(Integer requestedLimit) {
    if (requestedLimit == null || requestedLimit <= 0) {
      return DEFAULT_LIMIT;
    }
    return Math.min(requestedLimit, MAX_LIMIT);
  }

  private static String normalizeSearch(String searchText) {
    if (String.isBlank(searchText)) {
      return null;
    }
    String trimmed = searchText.trim();
    return trimmed.length() > 80 ? trimmed.substring(0, 80) : trimmed;
  }

  private static String buildRequestId(PortfolioRequest input, Integer index) {
    if (input != null && String.isNotBlank(input.requestId)) {
      String providedRequestId = input.requestId.trim();
      if (
        Pattern.matches('[A-Za-z0-9_.:-]{1,64}', providedRequestId) &&
        !isSalesforceId(providedRequestId)
      ) {
        return providedRequestId;
      }
    }
    return 'sf-revenue-portfolio-' +
      String.valueOf(Datetime.now().getTime()) +
      '-' +
      String.valueOf(index);
  }

  private static Boolean isSalesforceId(String value) {
    return String.isNotBlank(value) &&
      Pattern.matches('[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?', value.trim());
  }

  private static String buildSourceSystems(
    List<PortfolioAccountFacts> accounts
  ) {
    return 'Salesforce Account; Salesforce Opportunity aggregates; Salesforce Case aggregates; Salesforce Task aggregates; accounts=' +
      String.valueOf(accounts.size());
  }

  private static Map<String, PortfolioAccountFacts> accountsByReference(
    List<PortfolioAccountFacts> accounts
  ) {
    Map<String, PortfolioAccountFacts> result = new Map<String, PortfolioAccountFacts>();
    for (PortfolioAccountFacts account : accounts) {
      result.put(account.accountReference, account);
    }
    return result;
  }

  private static String joinAccountIds(List<PortfolioAccountFacts> accounts) {
    List<String> ids = new List<String>();
    for (PortfolioAccountFacts account : accounts) {
      ids.add(String.valueOf(account.accountId));
    }
    return String.join(ids, ';');
  }

  private static void putString(
    Map<String, Object> payload,
    String key,
    String value
  ) {
    if (String.isNotBlank(value)) {
      payload.put(key, maskSensitiveText(value.trim()));
    }
  }

  private static void putInteger(
    Map<String, Object> payload,
    String key,
    Integer value
  ) {
    if (value != null) {
      payload.put(key, value);
    }
  }

  private static void putDecimal(
    Map<String, Object> payload,
    String key,
    Decimal value
  ) {
    if (value != null) {
      payload.put(key, value);
    }
  }

  private static String normalizePortfolioStatus(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    String normalized = value.trim()
      .toUpperCase()
      .replace(' ', '_')
      .replace('-', '_');
    return VALID_PORTFOLIO_STATUSES.contains(normalized) ? normalized : null;
  }

  private static Map<String, Object> asMap(Object value) {
    if (value == null) {
      return new Map<String, Object>();
    }
    try {
      return (Map<String, Object>) value;
    } catch (Exception mapException) {
      return new Map<String, Object>();
    }
  }

  private static List<Object> asList(Object value) {
    if (value == null) {
      return new List<Object>();
    }
    try {
      return (List<Object>) value;
    } catch (Exception listException) {
      return new List<Object>();
    }
  }

  private static String getString(Map<String, Object> source, String key) {
    if (source == null || !source.containsKey(key) || source.get(key) == null) {
      return null;
    }
    return String.valueOf(source.get(key));
  }

  private static Boolean getBoolean(Map<String, Object> source, String key) {
    if (source == null || !source.containsKey(key) || source.get(key) == null) {
      return false;
    }
    Object value = source.get(key);
    if (value instanceof Boolean) {
      return (Boolean) value;
    }
    return String.valueOf(value).toLowerCase() == 'true';
  }

  private static Integer getInteger(Map<String, Object> source, String key) {
    if (source == null || !source.containsKey(key) || source.get(key) == null) {
      return null;
    }
    try {
      return Integer.valueOf(String.valueOf(source.get(key)));
    } catch (Exception parseException) {
      return null;
    }
  }

  private static String valueOrNone(String value) {
    return String.isBlank(value) ? 'None returned.' : value;
  }

  private static String safeName(String value) {
    if (String.isBlank(value)) {
      return 'Unnamed account';
    }
    String safe = value.replaceAll('[\r\n\t]+', ' ').trim();
    return safe.length() > 80 ? safe.substring(0, 80) : safe;
  }

  private static String label(String value) {
    if (String.isBlank(value)) {
      return 'Unknown';
    }
    return value.replace('_', ' ').toLowerCase().capitalize();
  }

  private static String ensureSentence(String value) {
    if (String.isBlank(value)) {
      return '';
    }
    String trimmed = value.trim();
    if (
      trimmed.endsWith('.') ||
      trimmed.endsWith('!') ||
      trimmed.endsWith('?')
    ) {
      return trimmed;
    }
    return trimmed + '.';
  }

  private static String limitText(String value, Integer maxLength) {
    if (String.isBlank(value) || value.length() <= maxLength) {
      return value;
    }
    return value.substring(0, maxLength);
  }

  private static String maskSensitiveText(String value) {
    if (String.isBlank(value)) {
      return value;
    }
    String masked = value;
    masked = masked.replaceAll(
      '(?i)[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}',
      '[redacted-email]'
    );
    masked = masked.replaceAll(
      '\\b(?:\\d[ -]?){13,19}\\b',
      '[redacted-payment]'
    );
    masked = masked.replaceAll('\\b\\d{3}-\\d{2}-\\d{4}\\b', '[redacted-ssn]');
    masked = masked.replaceAll(
      '(?i)\\b\\d{1,6}\\s+[A-Z0-9.\'\\-]+(?:\\s+[A-Z0-9.\'\\-]+){0,5}\\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|circle|cir|way|place|pl)\\b(?:[.,]?\\s*(?:apt|apartment|unit|suite|ste|#)\\s*[A-Z0-9-]+)?',
      '[redacted-address]'
    );
    masked = masked.replaceAll(
      '\\b(?:\\+?1[-.\\s]?)?(?:\\(?\\d{3}\\)?[-.\\s]?){2}\\d{4}\\b',
      '[redacted-phone]'
    );
    masked = masked.replaceAll(
      '(?i)\\b(?:account|customer|contact|case|order|invoice|policy|subscription|member)\\s*(?:id|number|no|#|:|-)\\s*[A-Z0-9][A-Z0-9_.-]{4,}\\b',
      '[redacted-identifier]'
    );
    masked = masked.replaceAll(
      '(?i)\\b[A-Z0-9]{15}(?:[A-Z0-9]{3})?\\b',
      '[redacted-salesforce-id]'
    );
    masked = masked.replaceAll('\\b\\d{6,}\\b', '[redacted-number]');
    return masked;
  }

  public class PortfolioRequest {
    @InvocableVariable(
      label='Analysis Focus'
      description='Optional portfolio focus: General, Risk, Expansion, Churn, or Weekly Plan.'
    )
    public String analysisFocus;

    @InvocableVariable(
      label='Attention Filter'
      description='Optional deterministic account filter: All, Risk, Renewal, Expansion, Churn, Quiet, or Escalation.'
    )
    public String attentionFilter;

    @InvocableVariable(
      label='Scope Filter'
      description='Optional scope filter: Owned for the Account Manager book of business or Visible for all visible Accounts. Defaults to Owned.'
    )
    public String scopeFilter;

    @InvocableVariable(
      label='Search Text'
      description='Optional Account name search text. Used only in Salesforce to choose visible Accounts and not sent to the external AI API.'
    )
    public String searchText;

    @InvocableVariable(
      label='Max Accounts'
      description='Optional maximum number of Accounts to analyze. Defaults to 10 and caps at 25.'
    )
    public Integer maxAccounts;

    @InvocableVariable(
      label='Request Id'
      description='Optional safe correlation id for backend telemetry. Do not use Salesforce record ids.'
    )
    public String requestId;
  }

  public class PortfolioResponse {
    @InvocableVariable(
      label='Analysis Status'
      description='ANALYZED, NO_ACCOUNTS, VALIDATION_ERROR, AUTH_ERROR, BACKEND_ERROR, CALLOUT_FAILED, MALFORMED_RESPONSE, UNEXPECTED_ERROR, or NOT_ANALYZED.'
    )
    public String analysisStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Safe status message for planner reasoning.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Revenue Portfolio Intelligence Brief'
      description='Display this field as the user-facing answer. It contains portfolio status, ranked accounts, watchlists, trends, recommended actions, weekly plan, and drilldown candidate.'
    )
    public String portfolioBrief;

    @InvocableVariable(
      label='Portfolio Status'
      description='Portfolio status: STABLE, WATCH, ATTENTION_REQUIRED, CRITICAL, or INSUFFICIENT_DATA.'
    )
    public String portfolioStatus;

    @InvocableVariable(
      label='Summary'
      description='Short safe portfolio summary.'
    )
    public String summary;

    @InvocableVariable(
      label='Top Risk Accounts'
      description='Planner-visible ranked risk accounts with safe reasons and Salesforce Account IDs for confirmation-based drilldown.'
    )
    public String topRiskAccounts;

    @InvocableVariable(
      label='Top Expansion Accounts'
      description='Planner-visible ranked expansion accounts with safe reasons.'
    )
    public String topExpansionAccounts;

    @InvocableVariable(
      label='Urgent Renewals'
      description='Planner-visible renewal watchlist accounts.'
    )
    public String urgentRenewals;

    @InvocableVariable(
      label='Escalation Accounts'
      description='Planner-visible escalation watchlist accounts.'
    )
    public String escalationAccounts;

    @InvocableVariable(
      label='Silent Accounts'
      description='Planner-visible low-engagement watchlist accounts.'
    )
    public String silentAccounts;

    @InvocableVariable(
      label='Portfolio Watchlists'
      description='Planner-visible portfolio watchlist groups.'
    )
    public String portfolioWatchlists;

    @InvocableVariable(
      label='Portfolio Trends'
      description='Planner-visible portfolio trend detection output.'
    )
    public String portfolioTrends;

    @InvocableVariable(
      label='Recommended Actions'
      description='Planner-visible proactive portfolio recommendations.'
    )
    public String recommendedActions;

    @InvocableVariable(
      label='Weekly Execution Plan'
      description='Planner-visible multi-account weekly execution plan.'
    )
    public String weeklyExecutionPlan;

    @InvocableVariable(
      label='Top Account Id'
      description='Planner-only Salesforce Account ID for the highest-priority drilldown candidate.'
    )
    public String topAccountId;

    @InvocableVariable(
      label='Top Account Name'
      description='Planner-only Account name for the highest-priority drilldown candidate.'
    )
    public String topAccountName;

    @InvocableVariable(
      label='Top Account Recommendation Reason'
      description='Planner-only safe reason for the highest-priority drilldown candidate.'
    )
    public String topAccountRecommendationReason;

    @InvocableVariable(
      label='Account Count'
      description='Number of Accounts analyzed in this response.'
    )
    public Integer accountCount;

    @InvocableVariable(
      label='Result Limit'
      description='Maximum number of Accounts requested after safety caps.'
    )
    public Integer resultLimit;

    @InvocableVariable(
      label='Has More Accounts'
      description='True when more Accounts may be available than this response analyzed.'
    )
    public Boolean hasMore;

    @InvocableVariable(
      label='Account Ids'
      description='Semicolon-separated Salesforce Account IDs analyzed in this response.'
    )
    public String accountIds;

    @InvocableVariable(
      label='Provider'
      description='LLM provider used by the AI API ModelRouter.'
    )
    public String provider;

    @InvocableVariable(
      label='Model'
      description='LLM model used by the AI API ModelRouter.'
    )
    public String model;

    @InvocableVariable(
      label='Fallback Used'
      description='True when the AI API ModelRouter used a fallback provider.'
    )
    public Boolean fallbackUsed;

    @InvocableVariable(
      label='Decision Fallback Used'
      description='True when the AI API used deterministic signal grouping because model output was incomplete.'
    )
    public Boolean decisionFallbackUsed;

    @InvocableVariable(
      label='Latency Ms'
      description='AI API provider call latency in milliseconds.'
    )
    public Integer latencyMs;

    @InvocableVariable(
      label='HTTP Status Code'
      description='HTTP status code returned by the AI API portfolio-intelligence endpoint.'
    )
    public Integer httpStatusCode;

    @InvocableVariable(
      label='Endpoint'
      description='AI API endpoint called by Apex.'
    )
    public String endpoint;

    @InvocableVariable(
      label='Request Id'
      description='Safe correlation id sent to backend telemetry.'
    )
    public String requestId;

    @InvocableVariable(
      label='Analyzed At'
      description='Timestamp when Apex analyzed revenue portfolio intelligence.'
    )
    public String analyzedAt;
  }
}

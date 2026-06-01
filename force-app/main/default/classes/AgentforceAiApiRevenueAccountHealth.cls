public with sharing class AgentforceAiApiRevenueAccountHealth {
  private static final String ACCOUNT_HEALTH_ENDPOINT = 'callout:Agentforce_AI_API_Phase2/agent/revenue/account-health';
  private static final String SAFE_ENDPOINT = '/agent/revenue/account-health';
  private static final Integer TIMEOUT_MS = 20000;
  private static final Integer MAX_REQUESTS_PER_INVOCATION = 5;
  private static final Set<String> VALID_HEALTH_BANDS = new Set<String>{
    'excellent',
    'healthy',
    'watch',
    'at_risk',
    'critical',
    'unknown'
  };
  private static final Set<String> VALID_RISK_LEVELS = new Set<String>{
    'low',
    'medium',
    'high',
    'critical',
    'unknown'
  };
  private static final Set<String> VALID_OPPORTUNITY_LEVELS = new Set<String>{
    'low',
    'medium',
    'high',
    'unknown'
  };
  private static final Set<String> VALID_ENGAGEMENT_LEVELS = new Set<String>{
    'strong',
    'steady',
    'weak',
    'unknown'
  };
  private static final Set<String> VALID_ANALYSIS_INTENTS = new Set<String>{
    'general',
    'qbr_preparation',
    'renewal_readiness',
    'churn_risk',
    'expansion_upside',
    'future_revenue',
    'risk_severity',
    'next_action'
  };
  private static final Set<String> VALID_CONFIDENCES = new Set<String>{
    'low',
    'medium',
    'high'
  };

  @TestVisible
  private static RevenueAccountDataProvider dataProvider = new SoqlRevenueAccountDataProvider();

  @InvocableMethod(
    label='Summarize Revenue Account Health with AI API'
    description='Calls the NestJS AI API revenue account-health endpoint with sanitized aggregate Salesforce account facts and returns an LLM-led Revenue Operations Intelligence decision.'
  )
  public static List<AccountHealthResponse> summarizeAccountHealth(
    List<AccountHealthRequest> requests
  ) {
    List<AccountHealthResponse> responses = new List<AccountHealthResponse>();
    if (requests == null || requests.isEmpty()) {
      return responses;
    }

    for (Integer index = 0; index < requests.size(); index++) {
      if (index >= MAX_REQUESTS_PER_INVOCATION) {
        responses.add(excessBatchResponse(requests[index], index));
        continue;
      }
      responses.add(summarizeOne(requests[index], index));
    }
    return responses;
  }

  private static AccountHealthResponse summarizeOne(
    AccountHealthRequest input,
    Integer requestIndex
  ) {
    AccountHealthResponse response = baseResponse(input, requestIndex);
    if (input == null || String.isBlank(firstAccountLookupKey(input))) {
      response.actionStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'I need an Account name or Salesforce Account record id before summarizing revenue health.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    RevenueAccountFacts facts;
    try {
      facts = dataProvider.findAccountFacts(input);
    } catch (Exception queryException) {
      response.actionStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'Revenue account context could not be collected safely.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    if (facts == null || !facts.found) {
      response.actionStatus = 'NOT_FOUND';
      response.safeMessage = 'No matching Salesforce Account was found for the provided account key.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    if (facts.ambiguous) {
      response.actionStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'More than one Account matched. Please provide a Salesforce Account record id.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    HttpRequest request = new HttpRequest();
    request.setEndpoint(ACCOUNT_HEALTH_ENDPOINT);
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'phase-9-revenue-account-health');
    request.setBody(
      JSON.serialize(buildPayload(facts, response.requestId, input))
    );

    try {
      HttpResponse httpResponse = new Http().send(request);
      response.httpStatusCode = httpResponse.getStatusCode();

      if (httpResponse.getStatusCode() == 401) {
        response.actionStatus = 'AUTH_ERROR';
        response.safeMessage = 'The AI API revenue account-health bearer token was rejected.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      if (httpResponse.getStatusCode() == 403) {
        response.actionStatus = 'AUTH_ERROR';
        response.safeMessage = 'The AI API bearer is missing the required agentforce:revenue-account-health scope.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      if (
        httpResponse.getStatusCode() < 200 ||
        httpResponse.getStatusCode() > 299
      ) {
        response.actionStatus = 'BACKEND_ERROR';
        response.safeMessage = 'The AI API revenue account-health endpoint returned an error.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      return parseAccountHealthResponse(
        httpResponse.getBody(),
        response,
        facts
      );
    } catch (CalloutException calloutException) {
      response.actionStatus = 'CALLOUT_FAILED';
      response.safeMessage = 'The AI API revenue account-health endpoint could not be reached.';
      response.executiveBrief = response.safeMessage;
      return response;
    } catch (Exception unexpectedException) {
      response.actionStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'Revenue account health could not be summarized safely.';
      response.executiveBrief = response.safeMessage;
      return response;
    }
  }

  private static Map<String, Object> buildPayload(
    RevenueAccountFacts facts,
    String requestId,
    AccountHealthRequest input
  ) {
    Map<String, Object> payload = new Map<String, Object>();
    payload.put('requestId', requestId);
    payload.put('analysisIntent', analysisIntentValue(input));
    putString(payload, 'accountType', facts.accountType);
    putString(payload, 'accountIndustry', facts.accountIndustry);
    putDecimal(payload, 'annualRevenue', facts.annualRevenue);
    putInteger(payload, 'employeeCount', facts.employeeCount);
    putInteger(payload, 'accountAgeDays', facts.accountAgeDays);
    putInteger(payload, 'openOpportunityCount', facts.openOpportunityCount);
    putDecimal(payload, 'openOpportunityAmount', facts.openOpportunityAmount);
    putDecimal(payload, 'weightedPipelineAmount', facts.weightedPipelineAmount);
    putInteger(payload, 'daysToNextCloseDate', facts.daysToNextCloseDate);
    putInteger(
      payload,
      'wonOpportunityCountLast180Days',
      facts.wonOpportunityCountLast180Days
    );
    putInteger(
      payload,
      'lostOpportunityCountLast180Days',
      facts.lostOpportunityCountLast180Days
    );
    putInteger(
      payload,
      'renewalOpportunityCount',
      facts.renewalOpportunityCount
    );
    putDecimal(
      payload,
      'renewalOpportunityAmount',
      facts.renewalOpportunityAmount
    );
    putInteger(
      payload,
      'expansionOpportunityCount',
      facts.expansionOpportunityCount
    );
    putDecimal(
      payload,
      'expansionOpportunityAmount',
      facts.expansionOpportunityAmount
    );
    putInteger(payload, 'openCaseCount', facts.openCaseCount);
    putInteger(payload, 'escalatedCaseCount', facts.escalatedCaseCount);
    putInteger(payload, 'highPriorityCaseCount', facts.highPriorityCaseCount);
    putInteger(payload, 'oldestOpenCaseAgeDays', facts.oldestOpenCaseAgeDays);
    putInteger(
      payload,
      'activityCountLast30Days',
      facts.activityCountLast30Days
    );
    putInteger(payload, 'daysSinceLastActivity', facts.daysSinceLastActivity);
    putInteger(
      payload,
      'executiveActivityCountLast90Days',
      facts.executiveActivityCountLast90Days
    );
    putInteger(payload, 'activeProjectCount', facts.activeProjectCount);
    putInteger(payload, 'atRiskProjectCount', facts.atRiskProjectCount);
    putInteger(payload, 'lateMilestoneCount', facts.lateMilestoneCount);
    putInteger(
      payload,
      'openResourceRequestCount',
      facts.openResourceRequestCount
    );
    putDecimal(
      payload,
      'avgProjectMarginPercent',
      facts.avgProjectMarginPercent
    );
    putDecimal(
      payload,
      'totalProjectRemainingAmount',
      facts.totalProjectRemainingAmount
    );
    putInteger(payload, 'overdueInvoiceCount', facts.overdueInvoiceCount);
    putDecimal(payload, 'overdueInvoiceAmount', facts.overdueInvoiceAmount);
    putDecimal(
      payload,
      'averagePaymentDelayDays',
      facts.averagePaymentDelayDays
    );
    putDecimal(payload, 'marginPressureAmount', facts.marginPressureAmount);
    putInteger(payload, 'productActiveUserCount', facts.productActiveUserCount);
    putDecimal(
      payload,
      'productUsageTrendPercent',
      facts.productUsageTrendPercent
    );
    putDecimal(payload, 'featureAdoptionPercent', facts.featureAdoptionPercent);
    putString(payload, 'sourceSystems', facts.sourceSystems);
    return payload;
  }

  private static AccountHealthResponse parseAccountHealthResponse(
    String body,
    AccountHealthResponse response,
    RevenueAccountFacts facts
  ) {
    try {
      Map<String, Object> payload = asMap(JSON.deserializeUntyped(body));
      String accountHealthBand = normalizeEnum(
        getString(payload, 'accountHealthBand'),
        VALID_HEALTH_BANDS
      );
      String churnRiskLevel = normalizeEnum(
        getString(payload, 'churnRiskLevel'),
        VALID_RISK_LEVELS
      );
      String expansionLevel = normalizeEnum(
        getString(payload, 'expansionLevel'),
        VALID_OPPORTUNITY_LEVELS
      );
      String deliveryRiskLevel = normalizeEnum(
        getString(payload, 'deliveryRiskLevel'),
        VALID_RISK_LEVELS
      );
      String financialRiskLevel = normalizeEnum(
        getString(payload, 'financialRiskLevel'),
        VALID_RISK_LEVELS
      );
      String supportRiskLevel = normalizeEnum(
        getString(payload, 'supportRiskLevel'),
        VALID_RISK_LEVELS
      );
      String executiveEngagementLevel = normalizeEnum(
        getString(payload, 'executiveEngagementLevel'),
        VALID_ENGAGEMENT_LEVELS
      );
      String confidence = normalizeEnum(
        getString(payload, 'confidence'),
        VALID_CONFIDENCES
      );
      String provider = getString(payload, 'provider');
      String model = getString(payload, 'model');
      String primaryDecision = getString(payload, 'primaryDecision');
      String summary = getString(payload, 'summary');
      String decisionRationale = getString(payload, 'decisionRationale');
      String revenueImpact = getString(payload, 'revenueImpact');
      String operationalBlockers = getString(payload, 'operationalBlockers');
      String recommendedActions = getString(payload, 'recommendedActions');

      if (
        accountHealthBand == null ||
        churnRiskLevel == null ||
        expansionLevel == null ||
        deliveryRiskLevel == null ||
        financialRiskLevel == null ||
        supportRiskLevel == null ||
        executiveEngagementLevel == null ||
        confidence == null ||
        String.isBlank(provider) ||
        String.isBlank(model) ||
        String.isBlank(primaryDecision) ||
        String.isBlank(summary) ||
        String.isBlank(decisionRationale) ||
        String.isBlank(revenueImpact) ||
        String.isBlank(operationalBlockers) ||
        String.isBlank(recommendedActions)
      ) {
        response.actionStatus = 'MALFORMED_RESPONSE';
        response.safeMessage = 'The AI API revenue account-health endpoint returned an unexpected response.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      response.actionStatus = 'SUMMARIZED';
      response.safeMessage = 'Revenue account health summary completed.';
      response.accountHealthScore = getScore(payload, 'accountHealthScore');
      response.accountHealthBand = accountHealthBand;
      response.churnRiskScore = getScore(payload, 'churnRiskScore');
      response.churnRiskLevel = churnRiskLevel;
      response.expansionScore = getScore(payload, 'expansionScore');
      response.expansionLevel = expansionLevel;
      response.deliveryRiskLevel = deliveryRiskLevel;
      response.financialRiskLevel = financialRiskLevel;
      response.supportRiskLevel = supportRiskLevel;
      response.executiveEngagementLevel = executiveEngagementLevel;
      response.primaryDecision = limitText(
        maskSensitiveText(primaryDecision),
        180
      );
      response.summary = limitText(maskSensitiveText(summary), 280);
      response.decisionRationale = limitText(
        maskSensitiveText(decisionRationale),
        420
      );
      response.revenueImpact = limitText(maskSensitiveText(revenueImpact), 220);
      response.operationalBlockers = limitText(
        maskSensitiveText(operationalBlockers),
        360
      );
      response.recommendedActions = limitText(
        maskSensitiveText(recommendedActions),
        420
      );
      response.confidence = confidence;
      response.provider = provider;
      response.model = model;
      response.fallbackUsed = getBoolean(payload, 'fallbackUsed');
      response.latencyMs = getInteger(payload, 'latencyMs');
      response.executiveBrief = buildExecutiveBrief(response, facts);
      return response;
    } catch (Exception parseException) {
      response.actionStatus = 'MALFORMED_RESPONSE';
      response.safeMessage = 'The AI API revenue account-health endpoint returned an unreadable response.';
      response.executiveBrief = response.safeMessage;
      return response;
    }
  }

  private static AccountHealthResponse baseResponse(
    AccountHealthRequest input,
    Integer requestIndex
  ) {
    AccountHealthResponse response = new AccountHealthResponse();
    response.actionStatus = 'NOT_SUMMARIZED';
    response.safeMessage = 'Revenue account health summary has not completed.';
    response.executiveBrief = response.safeMessage;
    response.endpoint = SAFE_ENDPOINT;
    response.requestId = buildRequestId(input, requestIndex);
    response.summarizedAt = Datetime.now()
      .formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
    return response;
  }

  private static AccountHealthResponse excessBatchResponse(
    AccountHealthRequest input,
    Integer requestIndex
  ) {
    AccountHealthResponse response = baseResponse(input, requestIndex);
    response.actionStatus = 'VALIDATION_ERROR';
    response.safeMessage = 'Revenue account health can process up to 5 accounts per Agentforce invocation.';
    response.executiveBrief = response.safeMessage;
    return response;
  }

  private static String buildExecutiveBrief(
    AccountHealthResponse response,
    RevenueAccountFacts facts
  ) {
    List<String> lines = new List<String>();
    lines.add('Revenue Account Health Brief');
    lines.add('');
    lines.add('Overall');
    lines.add('- Health: ' + scoreLabel(response.accountHealthScore) + '.');
    lines.add('- Band: ' + label(response.accountHealthBand) + '.');
    lines.add(
      '- Churn risk: ' +
        scoreLabel(response.churnRiskScore) +
        ' ' +
        label(response.churnRiskLevel) +
        '.'
    );
    lines.add(
      '- Expansion: ' +
        scoreLabel(response.expansionScore) +
        ' ' +
        label(response.expansionLevel) +
        '.'
    );
    lines.add('');
    lines.add('Decision');
    lines.add(ensureSentence(response.primaryDecision));
    lines.add(ensureSentence(response.summary));
    lines.add('');
    lines.add('Risk and opportunity');
    lines.add('- Delivery risk: ' + label(response.deliveryRiskLevel) + '.');
    lines.add('- Support risk: ' + label(response.supportRiskLevel) + '.');
    lines.add('- Financial risk: ' + label(response.financialRiskLevel) + '.');
    lines.add(
      '- Executive engagement: ' +
        label(response.executiveEngagementLevel) +
        '.'
    );
    lines.add('');
    lines.add('Why this result');
    lines.add(ensureSentence(response.decisionRationale));
    lines.add('- Revenue impact: ' + ensureSentence(response.revenueImpact));
    List<String> blockers = splitList(response.operationalBlockers);
    if (blockers.isEmpty()) {
      lines.add('- Operational blockers: None provided.');
    } else {
      lines.add('- Operational blockers:');
      for (String blocker : blockers) {
        lines.add('  - ' + ensureSentence(blocker));
      }
    }
    lines.add('');
    lines.add('Next best action plan');
    for (String action : splitList(response.recommendedActions)) {
      lines.add('- ' + ensureSentence(action));
    }
    lines.add('');
    lines.add('Signals reviewed');
    for (String signal : signalLines(facts)) {
      lines.add('- ' + signal);
    }
    lines.add('');
    lines.add('Confidence');
    lines.add('- ' + label(response.confidence) + '.');
    return String.join(lines, '\n');
  }

  private class SoqlRevenueAccountDataProvider implements RevenueAccountDataProvider {
    public RevenueAccountFacts findAccountFacts(AccountHealthRequest input) {
      RevenueAccountFacts facts = new RevenueAccountFacts();
      String key = firstAccountLookupKey(input);
      List<Account> accounts = findAccounts(key);
      if (accounts.isEmpty()) {
        facts.found = false;
        return facts;
      }
      if (accounts.size() > 1) {
        facts.found = true;
        facts.ambiguous = true;
        return facts;
      }

      Account account = accounts[0];
      facts.found = true;
      facts.accountId = account.Id;
      facts.accountType = getAccountString(account, 'Type');
      facts.accountIndustry = getAccountString(account, 'Industry');
      facts.annualRevenue = getAccountDecimal(account, 'AnnualRevenue');
      facts.employeeCount = getAccountInteger(account, 'NumberOfEmployees');
      Datetime createdDate = getAccountDatetime(account, 'CreatedDate');
      if (createdDate != null) {
        facts.accountAgeDays = createdDate.date().daysBetween(Date.today());
      }
      Date lastActivityDate = getAccountDate(account, 'LastActivityDate');
      if (lastActivityDate != null) {
        facts.daysSinceLastActivity = lastActivityDate.daysBetween(
          Date.today()
        );
      }
      safelyCollectOpportunityFacts(facts);
      safelyCollectCaseFacts(facts);
      safelyCollectActivityFacts(facts);
      safelyCollectOptionalPsaProjectFacts(facts);
      buildSourceSystems(facts);
      return facts;
    }

    private List<Account> findAccounts(String key) {
      try {
        if (isSalesforceId(key)) {
          return [
            SELECT
              Id,
              Type,
              Industry,
              AnnualRevenue,
              NumberOfEmployees,
              CreatedDate,
              LastActivityDate
            FROM Account
            WHERE Id = :key
            WITH USER_MODE
            LIMIT 2
          ];
        }
        String exactKey = key.trim();
        List<Account> exactMatches = [
          SELECT
            Id,
            Type,
            Industry,
            AnnualRevenue,
            NumberOfEmployees,
            CreatedDate,
            LastActivityDate
          FROM Account
          WHERE Name = :exactKey
          WITH USER_MODE
          ORDER BY LastModifiedDate DESC
          LIMIT 2
        ];
        if (!exactMatches.isEmpty()) {
          return exactMatches;
        }
        String pattern = '%' + exactKey + '%';
        return [
          SELECT
            Id,
            Type,
            Industry,
            AnnualRevenue,
            NumberOfEmployees,
            CreatedDate,
            LastActivityDate
          FROM Account
          WHERE Name LIKE :pattern
          WITH USER_MODE
          ORDER BY LastModifiedDate DESC
          LIMIT 2
        ];
      } catch (Exception extendedQueryException) {
        return findAccountsWithMinimalFields(key);
      }
    }

    private List<Account> findAccountsWithMinimalFields(String key) {
      if (isSalesforceId(key)) {
        return [
          SELECT Id
          FROM Account
          WHERE Id = :key
          WITH USER_MODE
          LIMIT 2
        ];
      }
      String exactKey = key.trim();
      List<Account> exactMatches = [
        SELECT Id, Name
        FROM Account
        WHERE Name = :exactKey
        WITH USER_MODE
        ORDER BY LastModifiedDate DESC
        LIMIT 2
      ];
      if (!exactMatches.isEmpty()) {
        return exactMatches;
      }
      String pattern = '%' + exactKey + '%';
      return [
        SELECT Id, Name
        FROM Account
        WHERE Name LIKE :pattern
        WITH USER_MODE
        ORDER BY LastModifiedDate DESC
        LIMIT 2
      ];
    }

    private void safelyCollectOpportunityFacts(RevenueAccountFacts facts) {
      try {
        collectOpportunityFacts(facts);
        facts.opportunitySignalAvailable = true;
      } catch (Exception opportunityException) {
        facts.opportunitySignalAvailable = false;
      }
    }

    private void safelyCollectCaseFacts(RevenueAccountFacts facts) {
      try {
        collectCaseFacts(facts);
        facts.caseSignalAvailable = true;
      } catch (Exception caseException) {
        facts.caseSignalAvailable = false;
      }
    }

    private void safelyCollectActivityFacts(RevenueAccountFacts facts) {
      try {
        collectActivityFacts(facts);
        facts.activitySignalAvailable = true;
      } catch (Exception activityException) {
        facts.activitySignalAvailable = false;
      }
    }

    private void safelyCollectOptionalPsaProjectFacts(
      RevenueAccountFacts facts
    ) {
      try {
        collectOptionalPsaProjectFacts(facts);
      } catch (Exception optionalPsaException) {
        facts.servicesSignalAvailable = false;
      }
    }

    private void collectOpportunityFacts(RevenueAccountFacts facts) {
      Decimal openAmount = 0;
      Decimal weightedAmount = 0;
      Decimal renewalAmount = 0;
      Decimal expansionAmount = 0;
      Date today = Date.today();
      Date last180 = today.addDays(-180);
      Date nextCloseDate;
      facts.openOpportunityCount = 0;
      facts.wonOpportunityCountLast180Days = 0;
      facts.lostOpportunityCountLast180Days = 0;
      facts.renewalOpportunityCount = 0;
      facts.expansionOpportunityCount = 0;

      for (Opportunity opp : [
        SELECT IsClosed, IsWon, Amount, Probability, CloseDate, StageName, Type
        FROM Opportunity
        WHERE
          AccountId = :facts.accountId
          AND (IsClosed = FALSE
          OR CloseDate >= :last180)
        WITH USER_MODE
        LIMIT 200
      ]) {
        Boolean closed = getRecordBoolean(opp, 'IsClosed') == true;
        Boolean won = getRecordBoolean(opp, 'IsWon') == true;
        Decimal amount = getRecordDecimal(opp, 'Amount');
        amount = amount == null ? 0 : amount;
        Date closeDate = getRecordDate(opp, 'CloseDate');
        if (!closed) {
          facts.openOpportunityCount++;
          openAmount += amount;
          Decimal probability = getRecordDecimal(opp, 'Probability');
          probability = probability == null ? 0 : probability;
          weightedAmount += amount * probability / 100;
          if (
            closeDate != null &&
            (nextCloseDate == null ||
            closeDate < nextCloseDate)
          ) {
            nextCloseDate = closeDate;
          }
        } else if (won && closeDate != null && closeDate >= last180) {
          facts.wonOpportunityCountLast180Days++;
        } else if (!won && closeDate != null && closeDate >= last180) {
          facts.lostOpportunityCountLast180Days++;
        }

        String opportunityType = String.valueOf(getRecordString(opp, 'Type'))
          .toLowerCase();
        String stage = String.valueOf(getRecordString(opp, 'StageName'))
          .toLowerCase();
        if (opportunityType.contains('renew') || stage.contains('renew')) {
          facts.renewalOpportunityCount++;
          renewalAmount += amount;
        }
        if (
          opportunityType.contains('expansion') ||
          opportunityType.contains('upgrade') ||
          opportunityType.contains('upsell') ||
          stage.contains('expansion') ||
          stage.contains('upsell')
        ) {
          facts.expansionOpportunityCount++;
          expansionAmount += amount;
        }
      }
      facts.openOpportunityAmount = openAmount;
      facts.weightedPipelineAmount = weightedAmount;
      facts.renewalOpportunityAmount = renewalAmount;
      facts.expansionOpportunityAmount = expansionAmount;
      if (nextCloseDate != null) {
        facts.daysToNextCloseDate = today.daysBetween(nextCloseDate);
      }
    }

    private void collectCaseFacts(RevenueAccountFacts facts) {
      Date today = Date.today();
      Date last180 = today.addDays(-180);
      facts.openCaseCount = 0;
      facts.escalatedCaseCount = 0;
      facts.highPriorityCaseCount = 0;
      Integer oldestAge;
      for (Case caseRecord : [
        SELECT IsClosed, IsEscalated, Priority, CreatedDate
        FROM Case
        WHERE
          AccountId = :facts.accountId
          AND (IsClosed = FALSE
          OR CreatedDate >= :last180)
        WITH USER_MODE
        LIMIT 200
      ]) {
        Boolean closed = getRecordBoolean(caseRecord, 'IsClosed') == true;
        if (!closed) {
          facts.openCaseCount++;
          Datetime createdDate = getRecordDatetime(caseRecord, 'CreatedDate');
          if (createdDate != null) {
            Integer age = createdDate.date().daysBetween(today);
            if (oldestAge == null || age > oldestAge) {
              oldestAge = age;
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
      facts.oldestOpenCaseAgeDays = oldestAge;
    }

    private void collectActivityFacts(RevenueAccountFacts facts) {
      Date today = Date.today();
      Date last30 = today.addDays(-30);
      Date last90 = today.addDays(-90);
      Date latestActivityDate;
      Integer activityCount = 0;
      for (Task taskRecord : [
        SELECT ActivityDate, CreatedDate
        FROM Task
        WHERE WhatId = :facts.accountId AND CreatedDate >= :last90
        WITH USER_MODE
        LIMIT 200
      ]) {
        Date activityDate = getRecordDate(taskRecord, 'ActivityDate');
        Datetime createdDate = getRecordDatetime(taskRecord, 'CreatedDate');
        if (activityDate == null && createdDate != null) {
          activityDate = createdDate.date();
        }
        if (activityDate == null) {
          continue;
        }
        if (activityDate >= last30) {
          activityCount++;
        }
        if (latestActivityDate == null || activityDate > latestActivityDate) {
          latestActivityDate = activityDate;
        }
      }
      facts.activityCountLast30Days = activityCount;
      facts.executiveActivityCountLast90Days = null;
      if (latestActivityDate != null) {
        Integer daysSinceTask = latestActivityDate.daysBetween(today);
        if (
          facts.daysSinceLastActivity == null ||
          daysSinceTask < facts.daysSinceLastActivity
        ) {
          facts.daysSinceLastActivity = daysSinceTask;
        }
      }
    }

    private void collectOptionalPsaProjectFacts(RevenueAccountFacts facts) {
      if (!hasObjectField('pse__Proj__c', 'pse__Account__c')) {
        return;
      }
      try {
        String accountId = String.valueOf(facts.accountId);
        String query =
          'SELECT pse__Project_Status__c, pse__Margin__c, pse__Remaining_Amount__c ' +
          'FROM pse__Proj__c WHERE pse__Account__c = :accountId WITH USER_MODE LIMIT 100';
        List<SObject> projects = Database.query(query);
        facts.activeProjectCount = 0;
        facts.atRiskProjectCount = 0;
        Decimal totalMargin = 0;
        Integer marginCount = 0;
        Decimal totalRemaining = 0;
        Boolean hasRemaining = false;
        for (SObject project : projects) {
          String status = String.valueOf(project.get('pse__Project_Status__c'))
            .toLowerCase();
          if (!status.contains('complete') && !status.contains('cancel')) {
            facts.activeProjectCount++;
          }
          if (
            status.contains('red') ||
            status.contains('yellow') ||
            status.contains('risk') ||
            status.contains('hold')
          ) {
            facts.atRiskProjectCount++;
          }
          Object marginValue = project.get('pse__Margin__c');
          if (marginValue instanceof Decimal) {
            totalMargin += (Decimal) marginValue;
            marginCount++;
          }
          Object remainingValue = project.get('pse__Remaining_Amount__c');
          if (remainingValue instanceof Decimal) {
            totalRemaining += (Decimal) remainingValue;
            hasRemaining = true;
          }
        }
        if (marginCount > 0) {
          facts.avgProjectMarginPercent = totalMargin / marginCount;
        }
        if (hasRemaining) {
          facts.totalProjectRemainingAmount = totalRemaining;
        }
        facts.servicesSignalAvailable = true;
      } catch (Exception optionalPsaException) {
        facts.servicesSignalAvailable = false;
      }
    }

    private void buildSourceSystems(RevenueAccountFacts facts) {
      List<String> sources = new List<String>{ 'Salesforce Account' };
      if (facts.opportunitySignalAvailable) {
        sources.add('Salesforce Opportunity aggregates');
      }
      if (facts.caseSignalAvailable) {
        sources.add('Salesforce Case aggregates');
      }
      if (facts.activitySignalAvailable) {
        sources.add('Salesforce Task aggregates');
      }
      if (facts.servicesSignalAvailable) {
        sources.add('Certinia PSA project aggregates');
      }
      facts.sourceSystems = String.join(sources, '; ');
    }

    private Object getAccountValue(Account account, String fieldName) {
      return getRecordValue(account, fieldName);
    }

    private String getAccountString(Account account, String fieldName) {
      Object value = getAccountValue(account, fieldName);
      return value == null ? null : String.valueOf(value);
    }

    private Decimal getAccountDecimal(Account account, String fieldName) {
      Object value = getAccountValue(account, fieldName);
      return value instanceof Decimal ? (Decimal) value : null;
    }

    private Integer getAccountInteger(Account account, String fieldName) {
      Object value = getAccountValue(account, fieldName);
      return value instanceof Integer ? (Integer) value : null;
    }

    private Datetime getAccountDatetime(Account account, String fieldName) {
      Object value = getAccountValue(account, fieldName);
      return value instanceof Datetime ? (Datetime) value : null;
    }

    private Date getAccountDate(Account account, String fieldName) {
      Object value = getAccountValue(account, fieldName);
      return value instanceof Date ? (Date) value : null;
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

  public interface RevenueAccountDataProvider {
    RevenueAccountFacts findAccountFacts(AccountHealthRequest input);
  }

  public class RevenueAccountFacts {
    public Boolean found = true;
    public Boolean ambiguous = false;
    public Id accountId;
    public String accountType;
    public String accountIndustry;
    public Decimal annualRevenue;
    public Integer employeeCount;
    public Integer accountAgeDays;
    public Integer openOpportunityCount;
    public Decimal openOpportunityAmount;
    public Decimal weightedPipelineAmount;
    public Integer daysToNextCloseDate;
    public Integer wonOpportunityCountLast180Days;
    public Integer lostOpportunityCountLast180Days;
    public Integer renewalOpportunityCount;
    public Decimal renewalOpportunityAmount;
    public Integer expansionOpportunityCount;
    public Decimal expansionOpportunityAmount;
    public Integer openCaseCount;
    public Integer escalatedCaseCount;
    public Integer highPriorityCaseCount;
    public Integer oldestOpenCaseAgeDays;
    public Integer activityCountLast30Days;
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
    public String sourceSystems;
    public Boolean opportunitySignalAvailable = false;
    public Boolean caseSignalAvailable = false;
    public Boolean activitySignalAvailable = false;
    public Boolean servicesSignalAvailable = false;
  }

  private static String firstAccountLookupKey(AccountHealthRequest input) {
    if (input == null) {
      return null;
    }
    if (String.isNotBlank(input.accountId)) {
      return input.accountId.trim();
    }
    if (String.isNotBlank(input.recordId)) {
      return input.recordId.trim();
    }
    if (String.isNotBlank(input.accountKey)) {
      return input.accountKey.trim();
    }
    if (String.isNotBlank(input.accountName)) {
      return input.accountName.trim();
    }
    return null;
  }

  private static String buildRequestId(
    AccountHealthRequest input,
    Integer index
  ) {
    if (input != null && String.isNotBlank(input.requestId)) {
      String providedRequestId = input.requestId.trim();
      if (
        Pattern.matches('[A-Za-z0-9_.:-]{1,64}', providedRequestId) &&
        !isSalesforceId(providedRequestId)
      ) {
        return providedRequestId;
      }
    }
    return 'sf-revenue-health-' +
      String.valueOf(Datetime.now().getTime()) +
      '-' +
      String.valueOf(index);
  }

  private static Boolean isSalesforceId(String value) {
    return String.isNotBlank(value) &&
      Pattern.matches('[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?', value.trim());
  }

  private static Boolean hasObjectField(String objectName, String fieldName) {
    Schema.SObjectType objectType = Schema.getGlobalDescribe().get(objectName);
    if (objectType == null) {
      return false;
    }
    return objectType.getDescribe().fields.getMap().containsKey(fieldName);
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

  private static String normalizeEnum(String value, Set<String> validValues) {
    if (String.isBlank(value)) {
      return null;
    }
    String normalized = value.trim()
      .toLowerCase()
      .replace(' ', '_')
      .replace('-', '_');
    if (!validValues.contains(normalized)) {
      return null;
    }
    return normalized;
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

  private static Integer getScore(Map<String, Object> source, String key) {
    Integer score = getInteger(source, key);
    if (score == null) {
      return null;
    }
    if (score < 0 || score > 100) {
      return null;
    }
    return score;
  }

  private static String scoreLabel(Integer score) {
    return score == null ? 'not scored' : String.valueOf(score) + '/100';
  }

  private static String label(String value) {
    return String.isBlank(value)
      ? 'Unknown'
      : value.replace('_', ' ').capitalize();
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

  private static String listAsSentence(String value) {
    List<String> parts = splitList(value);
    if (parts.isEmpty()) {
      return 'None provided.';
    }
    return ensureSentence(String.join(parts, '; '));
  }

  private static List<String> splitList(String value) {
    List<String> result = new List<String>();
    if (String.isBlank(value)) {
      return result;
    }
    for (String part : value.split(';')) {
      String trimmed = part.trim();
      if (String.isNotBlank(trimmed)) {
        result.add(trimmed);
      }
    }
    if (result.isEmpty()) {
      result.add(value.trim());
    }
    return result;
  }

  private static String analysisIntentValue(AccountHealthRequest input) {
    if (input == null || String.isBlank(input.analysisIntent)) {
      return 'general';
    }
    String normalized = input.analysisIntent.trim().toLowerCase();
    return VALID_ANALYSIS_INTENTS.contains(normalized) ? normalized : 'general';
  }

  private static List<String> signalLines(RevenueAccountFacts facts) {
    List<String> signals = new List<String>();
    signals.add(
      'Open opportunities: ' + safeNumber(facts.openOpportunityCount) + '.'
    );
    signals.add('Open cases: ' + safeNumber(facts.openCaseCount) + '.');
    signals.add(
      'Escalated cases: ' + safeNumber(facts.escalatedCaseCount) + '.'
    );
    signals.add(
      'Days since last activity: ' +
        safeNumber(facts.daysSinceLastActivity) +
        '.'
    );
    signals.add(
      'Active projects: ' + safeNumber(facts.activeProjectCount) + '.'
    );
    signals.add(
      'At-risk projects: ' + safeNumber(facts.atRiskProjectCount) + '.'
    );
    signals.add(
      'Overdue invoices: ' + safeNumber(facts.overdueInvoiceCount) + '.'
    );
    return signals;
  }

  private static String safeNumber(Object value) {
    return value == null ? 'unknown' : String.valueOf(value);
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
    masked = masked.replaceAll(
      '\\b((?:(?:my|My|customer|Customer|contact|Contact|caller|Caller|account holder|Account holder|policyholder|Policyholder)\\s+name\\s*(?:is|:)?|(?:name|Name)\\s*:)\\s+)[A-Z][A-Za-z\'\\-]+(?:\\s+[A-Z][A-Za-z\'\\-]+){0,2}\\b',
      '$1[redacted-name]'
    );
    masked = masked.replaceAll(
      '\\b((?:for|For|from|From|by|By|customer|Customer|contact|Contact|caller|Caller)\\s+)[A-Z][A-Za-z\'\\-]+(?:\\s+[A-Z][A-Za-z\'\\-]+){1,2}\\b',
      '$1[redacted-name]'
    );
    return masked;
  }

  public class AccountHealthRequest {
    @InvocableVariable(
      label='Selected Account'
      description='Salesforce Account name or record id. Used only by Apex to collect aggregate revenue facts.'
    )
    public String accountKey;

    @InvocableVariable(
      label='Account Name'
      description='Optional Account name. Used only by Apex to find the Account and not sent to the external AI API.'
    )
    public String accountName;

    @InvocableVariable(
      label='Account Id'
      description='Optional Salesforce Account record id.'
    )
    public String accountId;

    @InvocableVariable(
      label='Record Id'
      description='Optional Salesforce Account record id from the current record context.'
    )
    public String recordId;

    @InvocableVariable(
      label='Analysis Intent'
      description='Optional planner-only follow-up angle such as qbr_preparation, renewal_readiness, churn_risk, expansion_upside, future_revenue, risk_severity, next_action, or general.'
    )
    public String analysisIntent;

    @InvocableVariable(
      label='Request Id'
      description='Optional safe correlation id for backend telemetry. Do not use Salesforce record ids.'
    )
    public String requestId;
  }

  public class AccountHealthResponse {
    @InvocableVariable(
      label='Action Status'
      description='SUMMARIZED, VALIDATION_ERROR, NOT_FOUND, AUTH_ERROR, BACKEND_ERROR, CALLOUT_FAILED, MALFORMED_RESPONSE, UNEXPECTED_ERROR, or NOT_SUMMARIZED.'
    )
    public String actionStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Safe status message for planner reasoning.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Revenue Account Health Brief'
      description='Display this field as the user-facing answer. It contains a clean Revenue Operations Intelligence decision and next-best-action plan.'
    )
    public String executiveBrief;

    @InvocableVariable(
      label='Account Health Score'
      description='LLM-derived account health score from 0 to 100, where 100 is healthiest.'
    )
    public Integer accountHealthScore;

    @InvocableVariable(
      label='Account Health Band'
      description='LLM-derived health band: excellent, healthy, watch, at_risk, critical, or unknown.'
    )
    public String accountHealthBand;

    @InvocableVariable(
      label='Churn Risk Score'
      description='LLM-derived churn risk score from 0 to 100, where 100 is highest churn risk.'
    )
    public Integer churnRiskScore;

    @InvocableVariable(
      label='Churn Risk Level'
      description='LLM-derived churn risk level: low, medium, high, critical, or unknown.'
    )
    public String churnRiskLevel;

    @InvocableVariable(
      label='Expansion Score'
      description='LLM-derived expansion potential score from 0 to 100, where 100 is strongest expansion potential.'
    )
    public Integer expansionScore;

    @InvocableVariable(
      label='Expansion Level'
      description='LLM-derived expansion level: low, medium, high, or unknown.'
    )
    public String expansionLevel;

    @InvocableVariable(
      label='Delivery Risk Level'
      description='LLM-derived services delivery risk level.'
    )
    public String deliveryRiskLevel;

    @InvocableVariable(
      label='Financial Risk Level'
      description='LLM-derived financial risk level.'
    )
    public String financialRiskLevel;

    @InvocableVariable(
      label='Support Risk Level'
      description='LLM-derived support burden risk level.'
    )
    public String supportRiskLevel;

    @InvocableVariable(
      label='Executive Engagement Level'
      description='LLM-derived executive engagement level: strong, steady, weak, or unknown.'
    )
    public String executiveEngagementLevel;

    @InvocableVariable(
      label='Primary Decision'
      description='Primary LLM decision for revenue operators.'
    )
    public String primaryDecision;

    @InvocableVariable(
      label='Summary'
      description='Short safe Revenue Operations Intelligence summary.'
    )
    public String summary;

    @InvocableVariable(
      label='Decision Rationale'
      description='Concise rationale for the LLM-led decision.'
    )
    public String decisionRationale;

    @InvocableVariable(
      label='Revenue Impact'
      description='LLM-described revenue impact.'
    )
    public String revenueImpact;

    @InvocableVariable(
      label='Operational Blockers'
      description='Semicolon-separated operational blockers.'
    )
    public String operationalBlockers;

    @InvocableVariable(
      label='Recommended Actions'
      description='Semicolon-separated next best actions.'
    )
    public String recommendedActions;

    @InvocableVariable(
      label='Confidence'
      description='LLM confidence: low, medium, or high.'
    )
    public String confidence;

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
      label='Latency Ms'
      description='AI API provider call latency in milliseconds.'
    )
    public Integer latencyMs;

    @InvocableVariable(
      label='HTTP Status Code'
      description='HTTP status code returned by the AI API account-health endpoint.'
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
      label='Summarized At'
      description='Timestamp when Apex summarized revenue account health.'
    )
    public String summarizedAt;
  }
}

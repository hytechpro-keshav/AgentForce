public with sharing class AgentforceAiApiProjectHealth {
  private static final String PROJECT_HEALTH_ENDPOINT = 'callout:Agentforce_AI_API_Phase2/agent/services/project-health';
  private static final String SAFE_ENDPOINT = '/agent/services/project-health';
  private static final Integer TIMEOUT_MS = 20000;
  private static final Integer MAX_REQUESTS_PER_INVOCATION = 5;
  private static final Set<String> VALID_HEALTH_STATUSES = new Set<String>{
    'green',
    'yellow',
    'red'
  };
  private static final Set<String> VALID_RISK_LEVELS = new Set<String>{
    'low',
    'medium',
    'high',
    'critical'
  };
  private static final Set<String> VALID_CONFIDENCES = new Set<String>{
    'low',
    'medium',
    'high'
  };
  private static final Set<String> CLOSED_STATUSES = new Set<String>{
    'closed',
    'complete',
    'completed',
    'canceled',
    'cancelled',
    'staffed'
  };

  @TestVisible
  private static ProjectHealthDataProvider dataProvider = new SoqlProjectHealthDataProvider();

  @InvocableMethod(
    label='Summarize Project Health with AI API'
    description='Summarizes read-only Certinia PSA project delivery health through the NestJS AI API using sanitized aggregate project facts.'
  )
  public static List<ProjectHealthResponse> summarizeProjectHealth(
    List<ProjectHealthRequest> requests
  ) {
    List<ProjectHealthResponse> responses = new List<ProjectHealthResponse>();
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

  private static ProjectHealthResponse summarizeOne(
    ProjectHealthRequest input,
    Integer requestIndex
  ) {
    ProjectHealthResponse response = baseResponse(input, requestIndex);
    if (input == null || String.isBlank(firstProjectLookupKey(input))) {
      response.actionStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'I need a project name, project code, project key, project id, or Salesforce record id before summarizing project health.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    ProjectHealthFacts facts;
    try {
      facts = dataProvider.findProjectFacts(input);
    } catch (Exception queryException) {
      response.actionStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'Project health context could not be collected safely.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    if (facts == null || !facts.found) {
      response.actionStatus = 'NOT_FOUND';
      response.safeMessage = 'No matching Certinia PSA project was found for the provided project key.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    if (facts.ambiguous) {
      response.actionStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'More than one Certinia PSA project matched. Please provide a Salesforce project record id or PSA project id.';
      response.executiveBrief = response.safeMessage;
      return response;
    }

    HttpRequest request = new HttpRequest();
    request.setEndpoint(PROJECT_HEALTH_ENDPOINT);
    request.setMethod('POST');
    request.setTimeout(TIMEOUT_MS);
    request.setHeader('Accept', 'application/json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('X-Agentforce-Bridge', 'phase-8-services-project-health');
    request.setBody(JSON.serialize(buildPayload(facts, response.requestId)));

    try {
      HttpResponse httpResponse = new Http().send(request);
      response.httpStatusCode = httpResponse.getStatusCode();

      if (httpResponse.getStatusCode() == 401) {
        response.actionStatus = 'AUTH_ERROR';
        response.safeMessage = 'The AI API project-health bearer token was rejected. Confirm the Salesforce external credential secret matches the deployed AI API bearer configuration.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      if (httpResponse.getStatusCode() == 403) {
        response.actionStatus = 'AUTH_ERROR';
        response.safeMessage = 'The AI API project-health bearer is authenticated but missing the required agentforce:services-project-health scope.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      if (
        httpResponse.getStatusCode() < 200 ||
        httpResponse.getStatusCode() > 299
      ) {
        response.actionStatus = 'BACKEND_ERROR';
        response.safeMessage = 'The AI API project-health endpoint returned an error.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      return parseProjectHealthResponse(
        httpResponse.getBody(),
        response,
        facts
      );
    } catch (CalloutException calloutException) {
      response.actionStatus = 'CALLOUT_FAILED';
      response.safeMessage = 'The AI API project-health endpoint could not be reached.';
      response.executiveBrief = response.safeMessage;
      return response;
    } catch (Exception unexpectedException) {
      response.actionStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'Project health could not be summarized safely.';
      response.executiveBrief = response.safeMessage;
      return response;
    }
  }

  private static Map<String, Object> buildPayload(
    ProjectHealthFacts facts,
    String requestId
  ) {
    Map<String, Object> payload = new Map<String, Object>();
    payload.put('requestId', requestId);
    putString(
      payload,
      'projectStatus',
      normalizeProjectStatus(facts.projectStatus)
    );
    putString(
      payload,
      'projectStartDate',
      dateToString(facts.projectStartDate)
    );
    putString(payload, 'projectEndDate', dateToString(facts.projectEndDate));
    putInteger(payload, 'daysUntilEnd', facts.daysUntilEnd);
    putDecimal(payload, 'percentHoursComplete', facts.percentHoursComplete);
    putDecimal(payload, 'plannedHours', facts.plannedHours);
    putDecimal(
      payload,
      'estimatedHoursAtCompletion',
      facts.estimatedHoursAtCompletion
    );
    putDecimal(payload, 'remainingAmount', facts.remainingAmount);
    putDecimal(payload, 'marginPercent', facts.marginPercent);
    putInteger(payload, 'assignmentCount', facts.assignmentCount);
    putInteger(payload, 'activeAssignmentCount', facts.activeAssignmentCount);
    putInteger(payload, 'assignmentAtRiskCount', facts.assignmentAtRiskCount);
    putDecimal(
      payload,
      'avgAssignmentAllocationPercent',
      facts.avgAssignmentAllocationPercent
    );
    putInteger(payload, 'milestoneCount', facts.milestoneCount);
    putInteger(payload, 'lateMilestoneCount', facts.lateMilestoneCount);
    putInteger(
      payload,
      'completedMilestoneCount',
      facts.completedMilestoneCount
    );
    putInteger(payload, 'timecardHeaderCount', facts.timecardHeaderCount);
    putInteger(payload, 'submittedTimecardCount', facts.submittedTimecardCount);
    putInteger(payload, 'rejectedTimecardCount', facts.rejectedTimecardCount);
    putInteger(payload, 'approvedTimecardCount', facts.approvedTimecardCount);
    putDecimal(payload, 'totalTimecardHours', facts.totalTimecardHours);
    putInteger(payload, 'projectTaskCount', facts.projectTaskCount);
    putInteger(payload, 'openProjectTaskCount', facts.openProjectTaskCount);
    putInteger(
      payload,
      'overdueProjectTaskCount',
      facts.overdueProjectTaskCount
    );
    putInteger(payload, 'resourceRequestCount', facts.resourceRequestCount);
    putInteger(
      payload,
      'openResourceRequestCount',
      facts.openResourceRequestCount
    );
    putInteger(
      payload,
      'closeToStartResourceRequestCount',
      facts.closeToStartResourceRequestCount
    );
    putInteger(payload, 'budgetCount', facts.budgetCount);
    putDecimal(payload, 'budgetAmount', facts.budgetAmount);
    putDecimal(payload, 'budgetConsumedAmount', facts.budgetConsumedAmount);
    putDecimal(payload, 'budgetRemainingAmount', facts.budgetRemainingAmount);
    return payload;
  }

  private static ProjectHealthResponse parseProjectHealthResponse(
    String body,
    ProjectHealthResponse response,
    ProjectHealthFacts facts
  ) {
    try {
      Map<String, Object> payload = asMap(JSON.deserializeUntyped(body));
      String healthStatus = normalizeHealthStatus(
        getString(payload, 'healthStatus')
      );
      String riskLevel = normalizeRiskLevel(getString(payload, 'riskLevel'));
      String scheduleStatus = normalizeHealthStatus(
        getString(payload, 'scheduleStatus')
      );
      String budgetStatus = normalizeHealthStatus(
        getString(payload, 'budgetStatus')
      );
      String staffingStatus = normalizeHealthStatus(
        getString(payload, 'staffingStatus')
      );
      String confidence = normalizeConfidence(getString(payload, 'confidence'));
      String summary = getString(payload, 'summary');
      String riskDrivers = getString(payload, 'riskDrivers');
      String recommendedActions = getString(payload, 'recommendedActions');
      String provider = getString(payload, 'provider');
      String model = getString(payload, 'model');

      if (
        healthStatus == null ||
        riskLevel == null ||
        scheduleStatus == null ||
        budgetStatus == null ||
        staffingStatus == null ||
        confidence == null ||
        String.isBlank(summary) ||
        String.isBlank(riskDrivers) ||
        String.isBlank(recommendedActions) ||
        String.isBlank(provider) ||
        String.isBlank(model)
      ) {
        response.actionStatus = 'MALFORMED_RESPONSE';
        response.safeMessage = 'The AI API project-health endpoint returned an unexpected response.';
        response.executiveBrief = response.safeMessage;
        return response;
      }

      response.actionStatus = 'SUMMARIZED';
      response.safeMessage = 'Project health summary completed.';
      response.healthStatus = healthStatus;
      response.riskLevel = riskLevel;
      response.scheduleStatus = scheduleStatus;
      response.budgetStatus = budgetStatus;
      response.staffingStatus = staffingStatus;
      response.summary = limitText(maskSensitiveText(summary), 220);
      response.riskDrivers = limitText(maskSensitiveText(riskDrivers), 300);
      response.recommendedActions = limitText(
        maskSensitiveText(recommendedActions),
        300
      );
      response.confidence = confidence;
      response.executiveBrief = buildExecutiveBrief(response, facts);
      response.provider = provider;
      response.model = model;
      response.fallbackUsed = getBoolean(payload, 'fallbackUsed');
      response.latencyMs = getInteger(payload, 'latencyMs');
      return response;
    } catch (Exception parseException) {
      response.actionStatus = 'MALFORMED_RESPONSE';
      response.safeMessage = 'The AI API project-health endpoint returned an unreadable response.';
      response.executiveBrief = response.safeMessage;
      return response;
    }
  }

  private static ProjectHealthResponse baseResponse(
    ProjectHealthRequest input,
    Integer requestIndex
  ) {
    ProjectHealthResponse response = new ProjectHealthResponse();
    response.actionStatus = 'NOT_SUMMARIZED';
    response.safeMessage = 'Project health summary has not completed.';
    response.executiveBrief = response.safeMessage;
    response.endpoint = SAFE_ENDPOINT;
    response.requestId = buildRequestId(input, requestIndex);
    response.summarizedAt = Datetime.now()
      .formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
    return response;
  }

  private static ProjectHealthResponse excessBatchResponse(
    ProjectHealthRequest input,
    Integer requestIndex
  ) {
    ProjectHealthResponse response = baseResponse(input, requestIndex);
    response.actionStatus = 'VALIDATION_ERROR';
    response.safeMessage = 'Project health can process up to 5 projects per Agentforce invocation.';
    response.executiveBrief = response.safeMessage;
    return response;
  }

  private static String buildExecutiveBrief(
    ProjectHealthResponse response,
    ProjectHealthFacts facts
  ) {
    List<String> lines = new List<String>();
    lines.add('Project Health Brief');
    lines.add('');
    lines.add('Overall');
    lines.add(
      statusLabel(response.healthStatus) +
        ' health, ' +
        riskLabel(response.riskLevel) +
        ' delivery risk.'
    );
    lines.add('');
    lines.add('Status snapshot');
    lines.add(
      '- Schedule: ' +
        statusLabel(response.scheduleStatus) +
        ' - ' +
        statusMeaning(response.scheduleStatus) +
        '.'
    );
    lines.add(
      '- Budget: ' +
        statusLabel(response.budgetStatus) +
        ' - ' +
        statusMeaning(response.budgetStatus) +
        '.'
    );
    lines.add(
      '- Staffing: ' +
        statusLabel(response.staffingStatus) +
        ' - ' +
        statusMeaning(response.staffingStatus) +
        '.'
    );
    lines.add('');
    lines.add('Why this result');
    lines.add(ensureSentence(response.summary));
    lines.add('Key drivers: ' + listAsSentence(response.riskDrivers));
    lines.add('');
    lines.add('Signals reviewed');
    for (String signal : sourceSignals(facts)) {
      lines.add(signal);
    }
    lines.add('');
    lines.add('Next best action plan:');
    Integer actionNumber = 1;
    for (String action : nextBestActions(response)) {
      lines.add(
        String.valueOf(actionNumber) +
          '. ' +
          ensureSentence(sentenceStart(action))
      );
      actionNumber++;
    }
    lines.add('');
    lines.add(
      'Confidence: ' +
        riskLabel(response.confidence) +
        '. Basis: read-only aggregate Certinia PSA fields; no PSA records were changed.'
    );
    return limitText(String.join(lines, '\n'), 1800);
  }

  private static List<String> sourceSignals(ProjectHealthFacts facts) {
    List<String> signals = new List<String>();
    if (facts == null) {
      signals.add('- Source: Certinia PSA aggregate project facts.');
      return signals;
    }
    signals.add(
      '- Project: status ' +
        statusLabel(facts.projectStatus) +
        '; ' +
        countValue(facts.daysUntilEnd) +
        ' days until end; ' +
        percentValue(facts.percentHoursComplete) +
        ' hours complete.'
    );
    signals.add(
      '- Schedule: ' +
        countValue(facts.lateMilestoneCount) +
        ' late milestones; ' +
        countValue(facts.overdueProjectTaskCount) +
        ' overdue tasks; ' +
        countValue(facts.rejectedTimecardCount) +
        ' rejected timecards.'
    );
    signals.add(
      '- Budget: margin signal ' +
        numberValue(facts.marginPercent, 1) +
        '; forecast ' +
        numberValue(facts.estimatedHoursAtCompletion, 1) +
        ' EAC vs ' +
        numberValue(facts.plannedHours, 1) +
        ' planned hours; remaining amount ' +
        numberValue(facts.remainingAmount, 2) +
        '.'
    );
    signals.add(
      '- Staffing: ' +
        countValue(facts.openResourceRequestCount) +
        ' open resource requests; ' +
        countValue(facts.assignmentAtRiskCount) +
        ' at-risk assignments; ' +
        countValue(facts.activeAssignmentCount) +
        ' active assignments.'
    );
    return signals;
  }

  private static List<String> nextBestActions(ProjectHealthResponse response) {
    List<String> actions = splitList(response.recommendedActions);
    if (response.budgetStatus != 'green') {
      actions.add(
        'Run a margin review with the project manager and delivery lead, comparing planned hours, estimated hours at completion, remaining amount, and staffing mix.'
      );
    }
    if (
      String.isNotBlank(response.riskDrivers) &&
      response.riskDrivers.toLowerCase().contains('margin')
    ) {
      actions.add(
        'Validate whether the margin pressure is caused by scope growth, role mix, or forecasted effort before absorbing more unplanned work.'
      );
    }
    if (response.scheduleStatus != 'green') {
      actions.add(
        'Review milestone owners, overdue tasks, and recovery dates in the next delivery checkpoint.'
      );
    } else {
      actions.add(
        'Keep schedule monitoring lightweight because schedule is currently green; watch for new milestone or task slippage.'
      );
    }
    if (response.staffingStatus != 'green') {
      actions.add(
        'Prioritize open or at-risk staffing demand before the next project status review.'
      );
    } else if (response.budgetStatus != 'green') {
      actions.add(
        'Keep staffing coverage stable and check whether the current staffing mix is contributing to budget or margin pressure.'
      );
    }
    return firstUnique(actions, 3);
  }

  private static String sentenceStart(String value) {
    if (String.isBlank(value)) {
      return value;
    }
    String trimmed = value.trim();
    if (trimmed.length() == 1) {
      return trimmed.toUpperCase();
    }
    return trimmed.substring(0, 1).toUpperCase() + trimmed.substring(1);
  }

  private static String countValue(Integer value) {
    return value == null ? '-' : String.valueOf(value);
  }

  private static String percentValue(Decimal value) {
    return value == null ? '-' : String.valueOf(value.setScale(1)) + '%';
  }

  private static String numberValue(Decimal value, Integer scale) {
    return value == null ? '-' : String.valueOf(value.setScale(scale));
  }

  private static List<String> splitList(String value) {
    List<String> results = new List<String>();
    if (String.isBlank(value)) {
      return results;
    }
    for (String item : value.split(';')) {
      String trimmed = item == null ? null : item.trim();
      if (String.isNotBlank(trimmed)) {
        results.add(trimmed);
      }
    }
    return results;
  }

  private static List<String> firstUnique(
    List<String> values,
    Integer limitSize
  ) {
    List<String> results = new List<String>();
    Set<String> seen = new Set<String>();
    for (String value : values) {
      String normalized = String.isBlank(value)
        ? null
        : value.trim().toLowerCase();
      if (String.isBlank(normalized) || seen.contains(normalized)) {
        continue;
      }
      seen.add(normalized);
      results.add(value.trim());
      if (results.size() >= limitSize) {
        break;
      }
    }
    return results;
  }

  private static String listAsSentence(String value) {
    List<String> items = splitList(value);
    if (items.isEmpty()) {
      return 'No major risk drivers were returned.';
    }
    return ensureSentence(String.join(items, '; '));
  }

  private static String ensureSentence(String value) {
    if (String.isBlank(value)) {
      return 'No detail was returned.';
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

  private static String statusLabel(String status) {
    if (String.isBlank(status)) {
      return 'Unknown';
    }
    return status.substring(0, 1).toUpperCase() + status.substring(1);
  }

  private static String riskLabel(String value) {
    return statusLabel(value);
  }

  private static String statusMeaning(String status) {
    if (status == 'green') {
      return 'on track';
    }
    if (status == 'yellow') {
      return 'needs management attention';
    }
    if (status == 'red') {
      return 'requires immediate intervention';
    }
    return 'not available';
  }

  private static String firstProjectLookupKey(ProjectHealthRequest input) {
    if (input == null) {
      return null;
    }
    if (String.isNotBlank(input.recordId))
      return input.recordId.trim();
    if (String.isNotBlank(input.projectId))
      return input.projectId.trim();
    if (String.isNotBlank(input.projectCode))
      return input.projectCode.trim();
    if (String.isNotBlank(input.projectKey))
      return input.projectKey.trim();
    if (String.isNotBlank(input.projectName))
      return input.projectName.trim();
    return null;
  }

  private static String buildRequestId(
    ProjectHealthRequest input,
    Integer index
  ) {
    if (input != null && String.isNotBlank(input.requestId)) {
      String providedRequestId = input.requestId.trim();
      if (
        Pattern.matches('[A-Za-z0-9_.:-]{1,64}', providedRequestId) &&
        !isSalesforceRecordId(providedRequestId)
      ) {
        return providedRequestId;
      }
    }
    return 'sf-project-health-' +
      String.valueOf(Datetime.now().getTime()) +
      '-' +
      String.valueOf(index);
  }

  private static String normalizeProjectStatus(String status) {
    if (String.isBlank(status)) {
      return null;
    }
    String normalized = status.trim().toLowerCase();
    if (VALID_HEALTH_STATUSES.contains(normalized)) {
      return normalized;
    }
    return null;
  }

  private static String normalizeHealthStatus(String status) {
    if (String.isBlank(status)) {
      return null;
    }
    String normalized = status.trim().toLowerCase();
    if (!VALID_HEALTH_STATUSES.contains(normalized)) {
      return null;
    }
    return normalized;
  }

  private static String normalizeRiskLevel(String riskLevel) {
    if (String.isBlank(riskLevel)) {
      return null;
    }
    String normalized = riskLevel.trim().toLowerCase();
    if (!VALID_RISK_LEVELS.contains(normalized)) {
      return null;
    }
    return normalized;
  }

  private static String normalizeConfidence(String confidence) {
    if (String.isBlank(confidence)) {
      return null;
    }
    String normalized = confidence.trim().toLowerCase();
    if (!VALID_CONFIDENCES.contains(normalized)) {
      return null;
    }
    return normalized;
  }

  private static Boolean isClosedStatus(String status) {
    return String.isNotBlank(status) &&
      CLOSED_STATUSES.contains(status.trim().toLowerCase());
  }

  private static Boolean isSalesforceRecordId(String value) {
    return String.isNotBlank(value) &&
      Pattern.matches('[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?', value.trim());
  }

  private static List<String> lookupTextTerms(ProjectHealthRequest input) {
    List<String> terms = new List<String>();
    addTextTerm(terms, input.projectCode);
    addTextTerm(terms, input.projectKey);
    addTextTerm(terms, input.projectName);
    if (!isSalesforceRecordId(input.projectId)) {
      addTextTerm(terms, input.projectId);
    }
    if (!isSalesforceRecordId(input.recordId)) {
      addTextTerm(terms, input.recordId);
    }
    return terms;
  }

  private static List<Id> lookupRecordIds(ProjectHealthRequest input) {
    List<Id> recordIds = new List<Id>();
    addRecordId(recordIds, input.recordId);
    addRecordId(recordIds, input.projectId);
    addRecordId(recordIds, input.projectKey);
    return recordIds;
  }

  private static void addTextTerm(List<String> terms, String value) {
    if (String.isBlank(value) || isSalesforceRecordId(value)) {
      return;
    }
    String trimmed = value.trim();
    if (!terms.contains(trimmed)) {
      terms.add(trimmed);
    }
  }

  private static void addRecordId(List<Id> recordIds, String value) {
    if (!isSalesforceRecordId(value)) {
      return;
    }
    Id recordId = (Id) value.trim();
    if (!recordIds.contains(recordId)) {
      recordIds.add(recordId);
    }
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
    return integerValue(source.get(key));
  }

  private static Integer integerValue(Object value) {
    if (value == null) {
      return 0;
    }
    try {
      return Integer.valueOf(String.valueOf(value));
    } catch (Exception parseException) {
      return 0;
    }
  }

  private static Decimal decimalValue(Object value) {
    if (value == null) {
      return null;
    }
    try {
      return Decimal.valueOf(String.valueOf(value));
    } catch (Exception parseException) {
      return null;
    }
  }

  private static String dateToString(Date value) {
    return value == null ? null : String.valueOf(value);
  }

  private static void putString(
    Map<String, Object> payload,
    String key,
    String value
  ) {
    if (String.isNotBlank(value)) {
      payload.put(key, value);
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
      '(?i)\\b(?:account|customer|contact|case|order|invoice|policy|subscription|member|project)\\s*(?:id|number|no|#|:|-)\\s*[A-Z0-9][A-Z0-9_.-]{4,}\\b',
      '[redacted-identifier]'
    );
    masked = masked.replaceAll(
      '(?i)\\b(?:001|003|005|006|00D|00Q|00T|500|501|701|a0[A-Za-z0-9])[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\\b',
      '[redacted-salesforce-id]'
    );
    masked = masked.replaceAll('\\b\\d{6,}\\b', '[redacted-number]');
    masked = masked.replaceAll(
      '\\b((?:(?:my|My|customer|Customer|contact|Contact|caller|Caller|account holder|Account holder|policyholder|Policyholder|project|Project)\\s+name\\s*(?:is|:)?|(?:name|Name)\\s*:)\\s+)[A-Z][A-Za-z\'\\-]+(?:\\s+[A-Z][A-Za-z\'\\-]+){0,2}\\b',
      '$1[redacted-name]'
    );
    return masked;
  }

  public interface ProjectHealthDataProvider {
    ProjectHealthFacts findProjectFacts(ProjectHealthRequest input);
  }

  private with sharing class SoqlProjectHealthDataProvider implements ProjectHealthDataProvider {
    public ProjectHealthFacts findProjectFacts(ProjectHealthRequest input) {
      ProjectHealthFacts facts = new ProjectHealthFacts();
      List<pse__Proj__c> projects = findProjects(input);
      if (projects.isEmpty()) {
        facts.found = false;
        return facts;
      }
      facts.found = true;
      facts.ambiguous = projects.size() > 1;
      if (facts.ambiguous) {
        return facts;
      }

      pse__Proj__c project = projects[0];
      facts.projectId = project.Id;
      facts.projectStatus = String.valueOf(project.pse__Project_Status__c);
      facts.projectStartDate = project.pse__Start_Date__c;
      facts.projectEndDate = project.pse__End_Date__c;
      facts.daysUntilEnd = project.pse__End_Date__c == null
        ? null
        : Date.today().daysBetween(project.pse__End_Date__c);
      facts.percentHoursComplete = project.pse__Percent_Hours_Complete__c;
      facts.plannedHours = project.pse__Planned_Hours__c;
      facts.estimatedHoursAtCompletion = project.pse__Estimated_Hours_at_Completion__c;
      facts.remainingAmount = project.pse__Remaining_Amount__c;
      facts.marginPercent = project.pse__Margin__c;

      try {
        collectAssignmentFacts(facts);
      } catch (Exception assignmentException) {
      }
      try {
        collectMilestoneFacts(facts);
      } catch (Exception milestoneException) {
      }
      try {
        collectTimecardFacts(facts);
      } catch (Exception timecardException) {
      }
      try {
        collectProjectTaskFacts(facts);
      } catch (Exception projectTaskException) {
      }
      try {
        collectResourceRequestFacts(facts);
      } catch (Exception resourceRequestException) {
      }
      try {
        collectBudgetFacts(facts);
      } catch (Exception budgetException) {
      }
      return facts;
    }

    private List<pse__Proj__c> findProjects(ProjectHealthRequest input) {
      Map<Id, pse__Proj__c> matches = new Map<Id, pse__Proj__c>();
      List<Id> recordIds = lookupRecordIds(input);
      if (!recordIds.isEmpty()) {
        for (pse__Proj__c project : [
          SELECT
            Id,
            pse__Project_Status__c,
            pse__Start_Date__c,
            pse__End_Date__c,
            pse__Percent_Hours_Complete__c,
            pse__Planned_Hours__c,
            pse__Estimated_Hours_at_Completion__c,
            pse__Remaining_Amount__c,
            pse__Margin__c
          FROM pse__Proj__c
          WHERE Id IN :recordIds
          WITH USER_MODE
          LIMIT 2
        ]) {
          matches.put(project.Id, project);
        }
      }

      List<String> textTerms = lookupTextTerms(input);
      if (!textTerms.isEmpty()) {
        try {
          for (pse__Proj__c project : [
            SELECT
              Id,
              pse__Project_Status__c,
              pse__Start_Date__c,
              pse__End_Date__c,
              pse__Percent_Hours_Complete__c,
              pse__Planned_Hours__c,
              pse__Estimated_Hours_at_Completion__c,
              pse__Remaining_Amount__c,
              pse__Margin__c
            FROM pse__Proj__c
            WHERE pse__Project_ID__c IN :textTerms OR Name IN :textTerms
            WITH USER_MODE
            ORDER BY LastModifiedDate DESC
            LIMIT 2
          ]) {
            matches.put(project.Id, project);
          }
        } catch (Exception projectIdLookupException) {
          for (pse__Proj__c project : [
            SELECT
              Id,
              pse__Project_Status__c,
              pse__Start_Date__c,
              pse__End_Date__c,
              pse__Percent_Hours_Complete__c,
              pse__Planned_Hours__c,
              pse__Estimated_Hours_at_Completion__c,
              pse__Remaining_Amount__c,
              pse__Margin__c
            FROM pse__Proj__c
            WHERE Name IN :textTerms
            WITH USER_MODE
            ORDER BY LastModifiedDate DESC
            LIMIT 2
          ]) {
            matches.put(project.Id, project);
          }
        }
      }
      return matches.values();
    }

    private void collectAssignmentFacts(ProjectHealthFacts facts) {
      AggregateResult assignmentTotals = [
        SELECT
          COUNT(Id) recordCount,
          AVG(pse__Percent_Allocated__c) avgAllocation
        FROM pse__Assignment__c
        WHERE pse__Project__c = :facts.projectId
        WITH USER_MODE
      ];
      facts.assignmentCount = integerValue(assignmentTotals.get('recordCount'));
      facts.avgAssignmentAllocationPercent = decimalValue(
        assignmentTotals.get('avgAllocation')
      );

      AggregateResult activeAssignments = [
        SELECT COUNT(Id) recordCount
        FROM pse__Assignment__c
        WHERE
          pse__Project__c = :facts.projectId
          AND (pse__Status__c = NULL
          OR pse__Status__c NOT IN :CLOSED_STATUSES)
        WITH USER_MODE
      ];
      facts.activeAssignmentCount = integerValue(
        activeAssignments.get('recordCount')
      );

      Date today = Date.today();
      AggregateResult atRiskAssignments = [
        SELECT COUNT(Id) recordCount
        FROM pse__Assignment__c
        WHERE
          pse__Project__c = :facts.projectId
          AND pse__End_Date__c < :today
          AND (pse__Status__c = NULL
          OR pse__Status__c NOT IN :CLOSED_STATUSES)
        WITH USER_MODE
      ];
      facts.assignmentAtRiskCount = integerValue(
        atRiskAssignments.get('recordCount')
      );
    }

    private void collectMilestoneFacts(ProjectHealthFacts facts) {
      AggregateResult allMilestones = [
        SELECT COUNT(Id) recordCount
        FROM pse__Milestone__c
        WHERE pse__Project__c = :facts.projectId
        WITH USER_MODE
      ];
      facts.milestoneCount = integerValue(allMilestones.get('recordCount'));

      AggregateResult lateMilestones = [
        SELECT COUNT(Id) recordCount
        FROM pse__Milestone__c
        WHERE
          pse__Project__c = :facts.projectId
          AND psaws__Milestone_Is_Late__c = TRUE
        WITH USER_MODE
      ];
      facts.lateMilestoneCount = integerValue(
        lateMilestones.get('recordCount')
      );

      AggregateResult completedMilestones = [
        SELECT COUNT(Id) recordCount
        FROM pse__Milestone__c
        WHERE
          pse__Project__c = :facts.projectId
          AND (pse__Actual_Date__c != NULL
          OR PercentComplete__c >= 100
          OR pse__Status__c IN :CLOSED_STATUSES)
        WITH USER_MODE
      ];
      facts.completedMilestoneCount = integerValue(
        completedMilestones.get('recordCount')
      );
    }

    private void collectTimecardFacts(ProjectHealthFacts facts) {
      AggregateResult timecards = [
        SELECT COUNT(Id) recordCount, SUM(pse__Total_Hours__c) totalHours
        FROM pse__Timecard_Header__c
        WHERE pse__Project__c = :facts.projectId
        WITH USER_MODE
      ];
      facts.timecardHeaderCount = integerValue(timecards.get('recordCount'));
      facts.totalTimecardHours = decimalValue(timecards.get('totalHours'));
      facts.submittedTimecardCount = countTimecardsByStatus(
        facts.projectId,
        'Submitted'
      );
      facts.rejectedTimecardCount = countTimecardsByStatus(
        facts.projectId,
        'Rejected'
      );
      facts.approvedTimecardCount = countTimecardsByStatus(
        facts.projectId,
        'Approved'
      );
    }

    private Integer countTimecardsByStatus(Id projectId, String status) {
      AggregateResult result = [
        SELECT COUNT(Id) recordCount
        FROM pse__Timecard_Header__c
        WHERE pse__Project__c = :projectId AND pse__Status__c = :status
        WITH USER_MODE
      ];
      return integerValue(result.get('recordCount'));
    }

    private void collectProjectTaskFacts(ProjectHealthFacts facts) {
      AggregateResult allTasks = [
        SELECT COUNT(Id) recordCount
        FROM pse__Project_Task__c
        WHERE pse__Project__c = :facts.projectId
        WITH USER_MODE
      ];
      facts.projectTaskCount = integerValue(allTasks.get('recordCount'));

      AggregateResult openTasks = [
        SELECT COUNT(Id) recordCount
        FROM pse__Project_Task__c
        WHERE
          pse__Project__c = :facts.projectId
          AND (pse__Completed__c = FALSE
          OR pse__Completed__c = NULL
          OR pse__Status__c NOT IN :CLOSED_STATUSES)
        WITH USER_MODE
      ];
      facts.openProjectTaskCount = integerValue(openTasks.get('recordCount'));

      Date today = Date.today();
      AggregateResult overdueTasks = [
        SELECT COUNT(Id) recordCount
        FROM pse__Project_Task__c
        WHERE
          pse__Project__c = :facts.projectId
          AND pse__End_Date__c < :today
          AND (pse__Completed__c = FALSE
          OR pse__Completed__c = NULL)
        WITH USER_MODE
      ];
      facts.overdueProjectTaskCount = integerValue(
        overdueTasks.get('recordCount')
      );
    }

    private void collectResourceRequestFacts(ProjectHealthFacts facts) {
      AggregateResult allRequests = [
        SELECT COUNT(Id) recordCount
        FROM pse__Resource_Request__c
        WHERE pse__Project__c = :facts.projectId
        WITH USER_MODE
      ];
      facts.resourceRequestCount = integerValue(allRequests.get('recordCount'));

      AggregateResult openRequests = [
        SELECT COUNT(Id) recordCount
        FROM pse__Resource_Request__c
        WHERE
          pse__Project__c = :facts.projectId
          AND (pse__Status__c = NULL
          OR pse__Status__c NOT IN :CLOSED_STATUSES)
        WITH USER_MODE
      ];
      facts.openResourceRequestCount = integerValue(
        openRequests.get('recordCount')
      );

      AggregateResult closeToStartRequests = [
        SELECT COUNT(Id) recordCount
        FROM pse__Resource_Request__c
        WHERE
          pse__Project__c = :facts.projectId
          AND psaws__Close_To_Start_Date__c = TRUE
        WITH USER_MODE
      ];
      facts.closeToStartResourceRequestCount = integerValue(
        closeToStartRequests.get('recordCount')
      );
    }

    private void collectBudgetFacts(ProjectHealthFacts facts) {
      AggregateResult budgets = [
        SELECT
          COUNT(Id) recordCount,
          SUM(pse__Amount__c) amount,
          SUM(pse__Amount_Consumed__c) consumed,
          SUM(pse__Amount_Remaining__c) remaining
        FROM pse__Budget__c
        WHERE pse__Project__c = :facts.projectId
        WITH USER_MODE
      ];
      facts.budgetCount = integerValue(budgets.get('recordCount'));
      facts.budgetAmount = decimalValue(budgets.get('amount'));
      facts.budgetConsumedAmount = decimalValue(budgets.get('consumed'));
      facts.budgetRemainingAmount = decimalValue(budgets.get('remaining'));
    }
  }

  public class ProjectHealthFacts {
    public Boolean found = false;
    public Boolean ambiguous = false;
    public Id projectId;
    public String projectStatus;
    public Date projectStartDate;
    public Date projectEndDate;
    public Integer daysUntilEnd;
    public Decimal percentHoursComplete;
    public Decimal plannedHours;
    public Decimal estimatedHoursAtCompletion;
    public Decimal remainingAmount;
    public Decimal marginPercent;
    public Integer assignmentCount = 0;
    public Integer activeAssignmentCount = 0;
    public Integer assignmentAtRiskCount = 0;
    public Decimal avgAssignmentAllocationPercent;
    public Integer milestoneCount = 0;
    public Integer lateMilestoneCount = 0;
    public Integer completedMilestoneCount = 0;
    public Integer timecardHeaderCount = 0;
    public Integer submittedTimecardCount = 0;
    public Integer rejectedTimecardCount = 0;
    public Integer approvedTimecardCount = 0;
    public Decimal totalTimecardHours;
    public Integer projectTaskCount = 0;
    public Integer openProjectTaskCount = 0;
    public Integer overdueProjectTaskCount = 0;
    public Integer resourceRequestCount = 0;
    public Integer openResourceRequestCount = 0;
    public Integer closeToStartResourceRequestCount = 0;
    public Integer budgetCount = 0;
    public Decimal budgetAmount;
    public Decimal budgetConsumedAmount;
    public Decimal budgetRemainingAmount;
  }

  public class ProjectHealthRequest {
    @InvocableVariable(
      label='Project Key'
      description='Certinia PSA project name, project id, project code, or Salesforce record id.'
    )
    public String projectKey;

    @InvocableVariable(
      label='Project Name'
      description='Optional Certinia PSA project name. Used only to find the project and not sent to the AI API.'
    )
    public String projectName;

    @InvocableVariable(
      label='Project Code'
      description='Optional Certinia PSA project id or code. Used only to find the project and not sent to the AI API.'
    )
    public String projectCode;

    @InvocableVariable(
      label='Project Id'
      description='Optional Certinia PSA project id or Salesforce record id.'
    )
    public String projectId;

    @InvocableVariable(
      label='Record Id'
      description='Optional Salesforce pse__Proj__c record id.'
    )
    public String recordId;

    @InvocableVariable(
      label='Request Id'
      description='Optional safe correlation id for backend telemetry. Salesforce record ids are ignored.'
    )
    public String requestId;
  }

  public class ProjectHealthResponse {
    @InvocableVariable(
      label='Action Status'
      description='SUMMARIZED, VALIDATION_ERROR, NOT_FOUND, AUTH_ERROR, BACKEND_ERROR, CALLOUT_FAILED, MALFORMED_RESPONSE, UNEXPECTED_ERROR, or NOT_SUMMARIZED.'
    )
    public String actionStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Safe status message that Agentforce can display.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Executive Brief'
      description='Labeled executive-ready project health brief with status explanations and next best actions.'
    )
    public String executiveBrief;

    @InvocableVariable(
      label='Health Status'
      description='Overall delivery health status: green, yellow, or red.'
    )
    public String healthStatus;

    @InvocableVariable(
      label='Risk Level'
      description='Overall delivery risk level: low, medium, high, or critical.'
    )
    public String riskLevel;

    @InvocableVariable(
      label='Schedule Status'
      description='Schedule health status: green, yellow, or red.'
    )
    public String scheduleStatus;

    @InvocableVariable(
      label='Budget Status'
      description='Budget health status: green, yellow, or red.'
    )
    public String budgetStatus;

    @InvocableVariable(
      label='Staffing Status'
      description='Staffing health status: green, yellow, or red.'
    )
    public String staffingStatus;

    @InvocableVariable(
      label='Summary'
      description='Short safe delivery health summary.'
    )
    public String summary;

    @InvocableVariable(
      label='Risk Drivers'
      description='Semicolon-separated safe risk drivers.'
    )
    public String riskDrivers;

    @InvocableVariable(
      label='Recommended Actions'
      description='Semicolon-separated safe recommended actions.'
    )
    public String recommendedActions;

    @InvocableVariable(
      label='Confidence'
      description='Summary confidence: low, medium, or high.'
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
      description='HTTP status code returned by the AI API project-health endpoint.'
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
      description='Timestamp when Apex summarized project health.'
    )
    public String summarizedAt;
  }
}

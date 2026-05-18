public with sharing class AgentforcePsaProjectDirectory {
  private static final Integer DEFAULT_LIMIT = 10;
  private static final Integer MAX_LIMIT = 25;
  private static final Set<String> VALID_STATUSES = new Set<String>{
    'green',
    'yellow',
    'red'
  };

  @TestVisible
  private static ProjectDirectoryDataProvider dataProvider = new SoqlProjectDirectoryDataProvider();

  @InvocableMethod(
    label='List PSA Projects'
    description='Lists read-only Certinia PSA projects visible to the running user so the user can copy a project id for project-health summarization.'
  )
  public static List<ProjectDirectoryResponse> listProjects(
    List<ProjectDirectoryRequest> requests
  ) {
    List<ProjectDirectoryResponse> responses = new List<ProjectDirectoryResponse>();
    if (requests == null || requests.isEmpty()) {
      responses.add(listOne(new ProjectDirectoryRequest()));
      return responses;
    }

    for (ProjectDirectoryRequest request : requests) {
      responses.add(
        listOne(request == null ? new ProjectDirectoryRequest() : request)
      );
    }
    return responses;
  }

  private static ProjectDirectoryResponse listOne(
    ProjectDirectoryRequest input
  ) {
    ProjectDirectoryResponse response = new ProjectDirectoryResponse();
    Integer resultLimit = normalizeLimit(input.maxResults);
    String statusFilter = normalizeStatus(input.statusFilter);
    String searchText = normalizeSearch(input.searchText);

    if (String.isNotBlank(input.statusFilter) && statusFilter == null) {
      response.directoryStatus = 'VALIDATION_ERROR';
      response.safeMessage = 'Status filter must be Green, Yellow, or Red.';
      response.projectDirectory = response.safeMessage;
      return response;
    }

    List<ProjectSummary> projects;
    try {
      projects = dataProvider.findProjects(
        statusFilter,
        searchText,
        resultLimit + 1
      );
    } catch (Exception queryException) {
      response.directoryStatus = 'UNEXPECTED_ERROR';
      response.safeMessage = 'The project directory could not be collected safely.';
      response.projectDirectory = response.safeMessage;
      return response;
    }

    Integer visibleCount = Math.min(projects.size(), resultLimit);
    Boolean hasMore = projects.size() > resultLimit;
    List<ProjectSummary> visibleProjects = new List<ProjectSummary>();
    for (Integer index = 0; index < visibleCount; index++) {
      visibleProjects.add(projects[index]);
    }

    response.directoryStatus = 'LISTED';
    response.safeMessage = visibleCount == 0
      ? 'No visible Certinia PSA projects matched the request.'
      : 'Visible Certinia PSA projects listed.';
    response.projectCount = visibleCount;
    response.resultLimit = resultLimit;
    response.hasMore = hasMore;
    response.projectIds = joinProjectIds(visibleProjects);
    response.projectDirectory = buildProjectDirectory(
      visibleProjects,
      resultLimit,
      hasMore,
      statusFilter,
      searchText
    );
    return response;
  }

  private static String buildProjectDirectory(
    List<ProjectSummary> projects,
    Integer resultLimit,
    Boolean hasMore,
    String statusFilter,
    String searchText
  ) {
    List<String> lines = new List<String>();
    lines.add('Project Directory');
    lines.add(
      'Showing up to ' +
        String.valueOf(resultLimit) +
        ' projects visible to you' +
        filterLabel(statusFilter, searchText) +
        '.'
    );
    lines.add('');

    if (projects.isEmpty()) {
      lines.add(
        'No matching projects were found. Try a different status filter or search term.'
      );
      return String.join(lines, '\n');
    }

    Integer rowNumber = 1;
    for (ProjectSummary project : projects) {
      lines.add(
        String.valueOf(rowNumber) + '. ' + safeName(project.projectName)
      );
      lines.add(
        '   Salesforce Project ID: ' + String.valueOf(project.projectId)
      );
      lines.add('   PSA Project ID: ' + valueOrDash(project.projectCode));
      lines.add('   Status: ' + statusLabel(project.projectStatus));
      lines.add(
        '   Dates: ' +
          dateValue(project.startDate) +
          ' to ' +
          dateValue(project.endDate) +
          ' | Hours complete: ' +
          percentValue(project.percentHoursComplete)
      );
      lines.add(
        '   Margin signal: ' +
          numericValue(project.marginPercent) +
          ' (' +
          marginRisk(project.marginPercent) +
          ')'
      );
      lines.add(
        '   Forecast: ' +
          hoursValue(project.estimatedHoursAtCompletion) +
          ' EAC vs ' +
          hoursValue(project.plannedHours) +
          ' planned | Remaining amount: ' +
          amountValue(project.remainingAmount)
      );
      lines.add('');
      rowNumber++;
    }

    if (hasMore) {
      lines.add(
        'More projects are available. Ask for a status filter, a search term, or a higher limit up to ' +
          String.valueOf(MAX_LIMIT) +
          '.'
      );
    }
    lines.add(
      'Next step: copy a Salesforce Project ID above and ask, "Summarize health for project ID <id>."'
    );
    return String.join(lines, '\n');
  }

  private static String filterLabel(String statusFilter, String searchText) {
    List<String> filters = new List<String>();
    if (String.isNotBlank(statusFilter)) {
      filters.add('status=' + statusLabel(statusFilter));
    }
    if (String.isNotBlank(searchText)) {
      filters.add('search=' + searchText);
    }
    return filters.isEmpty() ? '' : ' where ' + String.join(filters, ', ');
  }

  private static String joinProjectIds(List<ProjectSummary> projects) {
    List<String> ids = new List<String>();
    for (ProjectSummary project : projects) {
      ids.add(String.valueOf(project.projectId));
    }
    return String.join(ids, ';');
  }

  private static Integer normalizeLimit(Integer requestedLimit) {
    if (requestedLimit == null || requestedLimit <= 0) {
      return DEFAULT_LIMIT;
    }
    return Math.min(requestedLimit, MAX_LIMIT);
  }

  private static String normalizeStatus(String statusFilter) {
    if (String.isBlank(statusFilter)) {
      return null;
    }
    String normalized = statusFilter.trim().toLowerCase();
    return VALID_STATUSES.contains(normalized) ? normalized : null;
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
      return 'Unnamed project';
    }
    String safe = value.replaceAll('[\r\n\t]+', ' ').trim();
    return safe.length() > 80 ? safe.substring(0, 80) : safe;
  }

  private static String valueOrDash(String value) {
    return String.isBlank(value) ? '-' : value.trim();
  }

  private static String statusLabel(String value) {
    if (String.isBlank(value)) {
      return 'Unknown';
    }
    String normalized = value.trim().toLowerCase();
    return normalized.substring(0, 1).toUpperCase() + normalized.substring(1);
  }

  private static String marginRisk(Decimal marginPercent) {
    if (marginPercent == null) {
      return 'unknown margin risk';
    }
    if (marginPercent < 0) {
      return 'red margin risk';
    }
    if (marginPercent < 15) {
      return 'yellow margin risk';
    }
    return 'green margin risk';
  }

  private static String dateValue(Date value) {
    return value == null ? '-' : String.valueOf(value);
  }

  private static String percentValue(Decimal value) {
    return value == null ? '-' : String.valueOf(value.setScale(1)) + '%';
  }

  private static String hoursValue(Decimal value) {
    return value == null ? '-' : String.valueOf(value.setScale(1));
  }

  private static String numericValue(Decimal value) {
    return value == null ? '-' : String.valueOf(value.setScale(1));
  }

  private static String amountValue(Decimal value) {
    return value == null ? '-' : String.valueOf(value.setScale(2));
  }

  public interface ProjectDirectoryDataProvider {
    List<ProjectSummary> findProjects(
      String statusFilter,
      String searchText,
      Integer maxRows
    );
  }

  private with sharing class SoqlProjectDirectoryDataProvider implements ProjectDirectoryDataProvider {
    public List<ProjectSummary> findProjects(
      String statusFilter,
      String searchText,
      Integer maxRows
    ) {
      List<String> filters = new List<String>();
      if (String.isNotBlank(statusFilter)) {
        filters.add(
          'pse__Project_Status__c = \'' +
            String.escapeSingleQuotes(statusFilter) +
            '\''
        );
      }
      if (String.isNotBlank(searchText)) {
        String searchLike =
          '%' +
          String.escapeSingleQuotes(searchText.trim()) +
          '%';
        filters.add(
          '(Name LIKE \'' +
            searchLike +
            '\' OR pse__Project_ID__c LIKE \'' +
            searchLike +
            '\')'
        );
      }

      String query = 'SELECT Id, Name, pse__Project_ID__c, pse__Project_Status__c, pse__Start_Date__c, pse__End_Date__c, pse__Percent_Hours_Complete__c, pse__Planned_Hours__c, pse__Estimated_Hours_at_Completion__c, pse__Remaining_Amount__c, pse__Margin__c FROM pse__Proj__c';
      if (!filters.isEmpty()) {
        query += ' WHERE ' + String.join(filters, ' AND ');
      }
      query +=
        ' WITH USER_MODE ORDER BY LastModifiedDate DESC LIMIT ' +
        String.valueOf(maxRows);
      List<pse__Proj__c> records = Database.query(query);
      List<ProjectSummary> projects = new List<ProjectSummary>();
      for (pse__Proj__c record : records) {
        ProjectSummary project = new ProjectSummary();
        project.projectId = record.Id;
        project.projectName = record.Name;
        project.projectCode = record.pse__Project_ID__c;
        project.projectStatus = String.valueOf(record.pse__Project_Status__c);
        project.startDate = record.pse__Start_Date__c;
        project.endDate = record.pse__End_Date__c;
        project.percentHoursComplete = record.pse__Percent_Hours_Complete__c;
        project.plannedHours = record.pse__Planned_Hours__c;
        project.estimatedHoursAtCompletion = record.pse__Estimated_Hours_at_Completion__c;
        project.remainingAmount = record.pse__Remaining_Amount__c;
        project.marginPercent = record.pse__Margin__c;
        projects.add(project);
      }
      return projects;
    }
  }

  public class ProjectSummary {
    public Id projectId;
    public String projectName;
    public String projectCode;
    public String projectStatus;
    public Date startDate;
    public Date endDate;
    public Decimal percentHoursComplete;
    public Decimal plannedHours;
    public Decimal estimatedHoursAtCompletion;
    public Decimal remainingAmount;
    public Decimal marginPercent;
  }

  public class ProjectDirectoryRequest {
    @InvocableVariable(
      label='Status Filter'
      description='Optional project status filter: Green, Yellow, or Red.'
    )
    public String statusFilter;

    @InvocableVariable(
      label='Search Text'
      description='Optional project name or PSA project id search text.'
    )
    public String searchText;

    @InvocableVariable(
      label='Max Results'
      description='Optional maximum number of projects to list. Defaults to 10 and caps at 25.'
    )
    public Integer maxResults;
  }

  public class ProjectDirectoryResponse {
    @InvocableVariable(
      label='Directory Status'
      description='LISTED, VALIDATION_ERROR, or UNEXPECTED_ERROR.'
    )
    public String directoryStatus;

    @InvocableVariable(
      label='Safe Message'
      description='Safe status message for the project directory request.'
    )
    public String safeMessage;

    @InvocableVariable(
      label='Project Directory'
      description='Formatted list of visible Certinia PSA projects with copyable Salesforce Project IDs and safe status details.'
    )
    public String projectDirectory;

    @InvocableVariable(
      label='Project Count'
      description='Number of projects returned in this response.'
    )
    public Integer projectCount;

    @InvocableVariable(
      label='Result Limit'
      description='Maximum number of projects requested after safety caps.'
    )
    public Integer resultLimit;

    @InvocableVariable(
      label='Has More Projects'
      description='True when more projects are available than this response returned.'
    )
    public Boolean hasMore;

    @InvocableVariable(
      label='Project Ids'
      description='Semicolon-separated Salesforce Project IDs returned in this response.'
    )
    public String projectIds;
  }
}

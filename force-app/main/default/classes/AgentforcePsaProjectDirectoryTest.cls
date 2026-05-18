@IsTest
private class AgentforcePsaProjectDirectoryTest {
  @IsTest
  static void listsVisibleProjectsWithCopyableIds() {
    AgentforcePsaProjectDirectory.dataProvider = new FakeDirectoryProvider(
      new List<AgentforcePsaProjectDirectory.ProjectSummary>{
        project(
          'aAiam000006oM3eCAE',
          'Pilot Implementation',
          'PSA-1001',
          'Yellow',
          Date.today().addDays(-20),
          Date.today().addDays(35),
          62,
          1000,
          1110,
          50000,
          12.5
        ),
        project(
          'aAiam000006oM3fCAE',
          'Managed Services Expansion',
          'PSA-1002',
          'Green',
          Date.today().addDays(-5),
          Date.today().addDays(80),
          15,
          300,
          295,
          125000,
          28.1
        )
      }
    );

    AgentforcePsaProjectDirectory.ProjectDirectoryRequest request = new AgentforcePsaProjectDirectory.ProjectDirectoryRequest();
    request.maxResults = 10;

    Test.startTest();
    List<AgentforcePsaProjectDirectory.ProjectDirectoryResponse> responses = AgentforcePsaProjectDirectory.listProjects(
      new List<AgentforcePsaProjectDirectory.ProjectDirectoryRequest>{ request }
    );
    Test.stopTest();

    System.assertEquals(1, responses.size());
    AgentforcePsaProjectDirectory.ProjectDirectoryResponse response = responses[0];
    System.assertEquals('LISTED', response.directoryStatus);
    System.assertEquals(2, response.projectCount);
    System.assertEquals(false, response.hasMore);
    System.assert(response.projectIds.contains('aAiam000006oM3eCAE'));
    System.assert(response.projectDirectory.contains('Project Directory'));
    System.assert(
      response.projectDirectory.contains(
        'Salesforce Project ID: aAiam000006oM3eCAE'
      )
    );
    System.assert(response.projectDirectory.contains('yellow margin risk'));
    System.assert(
      response.projectDirectory.contains(
        'Next step: copy a Salesforce Project ID'
      )
    );
  }

  @IsTest
  static void capsResultsAndReportsMoreProjects() {
    List<AgentforcePsaProjectDirectory.ProjectSummary> projects = new List<AgentforcePsaProjectDirectory.ProjectSummary>();
    for (Integer index = 0; index < 27; index++) {
      projects.add(
        project(
          'aAiam000006oM3eCAE',
          'Project ' + String.valueOf(index),
          'PSA-' + String.valueOf(index),
          'Green',
          null,
          null,
          null,
          null,
          null,
          null,
          null
        )
      );
    }
    AgentforcePsaProjectDirectory.dataProvider = new FakeDirectoryProvider(
      projects
    );

    AgentforcePsaProjectDirectory.ProjectDirectoryRequest request = new AgentforcePsaProjectDirectory.ProjectDirectoryRequest();
    request.maxResults = 50;

    List<AgentforcePsaProjectDirectory.ProjectDirectoryResponse> responses = AgentforcePsaProjectDirectory.listProjects(
      new List<AgentforcePsaProjectDirectory.ProjectDirectoryRequest>{ request }
    );

    System.assertEquals(25, responses[0].resultLimit);
    System.assertEquals(25, responses[0].projectCount);
    System.assertEquals(true, responses[0].hasMore);
    System.assert(
      responses[0].projectDirectory.contains('More projects are available')
    );
  }

  @IsTest
  static void validatesStatusFilter() {
    AgentforcePsaProjectDirectory.dataProvider = new FakeDirectoryProvider(
      new List<AgentforcePsaProjectDirectory.ProjectSummary>()
    );
    AgentforcePsaProjectDirectory.ProjectDirectoryRequest request = new AgentforcePsaProjectDirectory.ProjectDirectoryRequest();
    request.statusFilter = 'At Risk';

    List<AgentforcePsaProjectDirectory.ProjectDirectoryResponse> responses = AgentforcePsaProjectDirectory.listProjects(
      new List<AgentforcePsaProjectDirectory.ProjectDirectoryRequest>{ request }
    );

    System.assertEquals('VALIDATION_ERROR', responses[0].directoryStatus);
    System.assertEquals(
      'Status filter must be Green, Yellow, or Red.',
      responses[0].projectDirectory
    );
  }

  @IsTest
  static void handlesProviderFailureSafely() {
    AgentforcePsaProjectDirectory.dataProvider = new ThrowingDirectoryProvider();
    AgentforcePsaProjectDirectory.ProjectDirectoryRequest request = new AgentforcePsaProjectDirectory.ProjectDirectoryRequest();
    request.statusFilter = 'Green';
    request.searchText = 'Pilot';

    List<AgentforcePsaProjectDirectory.ProjectDirectoryResponse> responses = AgentforcePsaProjectDirectory.listProjects(
      new List<AgentforcePsaProjectDirectory.ProjectDirectoryRequest>{ request }
    );

    System.assertEquals('UNEXPECTED_ERROR', responses[0].directoryStatus);
    System.assertEquals(
      'The project directory could not be collected safely.',
      responses[0].projectDirectory
    );
  }

  @IsTest
  static void handlesEmptyRequestList() {
    AgentforcePsaProjectDirectory.dataProvider = new FakeDirectoryProvider(
      new List<AgentforcePsaProjectDirectory.ProjectSummary>()
    );

    List<AgentforcePsaProjectDirectory.ProjectDirectoryResponse> responses = AgentforcePsaProjectDirectory.listProjects(
      new List<AgentforcePsaProjectDirectory.ProjectDirectoryRequest>()
    );

    System.assertEquals(1, responses.size());
    System.assertEquals('LISTED', responses[0].directoryStatus);
    System.assertEquals(0, responses[0].projectCount);
    System.assert(
      responses[0].projectDirectory.contains('No matching projects were found')
    );
  }

  private static AgentforcePsaProjectDirectory.ProjectSummary project(
    Id projectId,
    String projectName,
    String projectCode,
    String projectStatus,
    Date startDate,
    Date endDate,
    Decimal percentHoursComplete,
    Decimal plannedHours,
    Decimal estimatedHoursAtCompletion,
    Decimal remainingAmount,
    Decimal marginPercent
  ) {
    AgentforcePsaProjectDirectory.ProjectSummary project = new AgentforcePsaProjectDirectory.ProjectSummary();
    project.projectId = projectId;
    project.projectName = projectName;
    project.projectCode = projectCode;
    project.projectStatus = projectStatus;
    project.startDate = startDate;
    project.endDate = endDate;
    project.percentHoursComplete = percentHoursComplete;
    project.plannedHours = plannedHours;
    project.estimatedHoursAtCompletion = estimatedHoursAtCompletion;
    project.remainingAmount = remainingAmount;
    project.marginPercent = marginPercent;
    return project;
  }

  private class FakeDirectoryProvider implements AgentforcePsaProjectDirectory.ProjectDirectoryDataProvider {
    private List<AgentforcePsaProjectDirectory.ProjectSummary> projects;

    FakeDirectoryProvider(
      List<AgentforcePsaProjectDirectory.ProjectSummary> projects
    ) {
      this.projects = projects;
    }

    public List<AgentforcePsaProjectDirectory.ProjectSummary> findProjects(
      String statusFilter,
      String searchText,
      Integer maxRows
    ) {
      List<AgentforcePsaProjectDirectory.ProjectSummary> results = new List<AgentforcePsaProjectDirectory.ProjectSummary>();
      for (AgentforcePsaProjectDirectory.ProjectSummary project : projects) {
        if (results.size() >= maxRows) {
          break;
        }
        results.add(project);
      }
      return results;
    }
  }

  private class ThrowingDirectoryProvider implements AgentforcePsaProjectDirectory.ProjectDirectoryDataProvider {
    public List<AgentforcePsaProjectDirectory.ProjectSummary> findProjects(
      String statusFilter,
      String searchText,
      Integer maxRows
    ) {
      throw new QueryException('simulated provider failure');
    }
  }
}

/**
 * Controller class for retrieving Opportunity records.
 * Provides an invocable method for use in Flows and other declarative tools.
 */
public without sharing class OpportunityController {
  /**
   * Retrieves Opportunity records by name.
   * If opportunityName is provided, filters by name using a LIKE search.
   * Otherwise returns all opportunities ordered by CloseDate descending.
   * @param requests List of OpportunityRequest containing optional search criteria
   * @return List of OpportunityResponse containing matching opportunity details
   */
  @InvocableMethod(
    label='Retrieve Opportunities'
    description='Retrieves Opportunity records by name. If opportunityName is provided, filters by name. Otherwise returns all opportunities.'
  )
  public static List<OpportunityResponse> getOpportunities(
    List<OpportunityRequest> requests
  ) {
    // Collect responses to return
    List<OpportunityResponse> responses = new List<OpportunityResponse>();

    // Extract the opportunity name from the first request, if provided
    String opportunityName = (requests != null && !requests.isEmpty())
      ? requests[0].opportunityName
      : null;

    // Query opportunities based on whether a name filter was provided
    List<Opportunity> opportunities;
    if (String.isNotBlank(opportunityName)) {
      String searchName = '%' + opportunityName + '%';
      opportunities = [
        SELECT Id, Name, Account.Name, Amount, CloseDate, StageName
        FROM Opportunity
        WHERE Name LIKE :searchName
        ORDER BY CloseDate DESC
      ];
    } else {
      opportunities = [
        SELECT Id, Name, Account.Name, Amount, CloseDate, StageName
        FROM Opportunity
        ORDER BY CloseDate DESC
      ];
    }

    // Build the response with opportunity details
    OpportunityResponse response = new OpportunityResponse();
    response.opportunityOptions = new List<OpportunityDetail>();

    for (Opportunity opp : opportunities) {
      response.opportunityOptions.add(
        new OpportunityDetail(
          opp.Id,
          opp.Name,
          opp.Account?.Name,
          opp.Amount,
          opp.CloseDate,
          opp.StageName
        )
      );
    }

    responses.add(response);
    return responses;
  }

  /**
   * Wrapper class for the invocable method input.
   * Contains the optional opportunity name to search for.
   */
  public class OpportunityRequest {
    /** Optional opportunity name to filter by. Leave empty to retrieve all opportunities. */
    @InvocableVariable(
      required=false
      description='Optional. The name of the opportunity to search for. Leave empty to retrieve all opportunities.'
    )
    public String opportunityName;
  }

  /**
   * Wrapper class for the invocable method output.
   * Contains a list of matching opportunity details.
   */
  public class OpportunityResponse {
    /** List of opportunity details matching the search criteria */
    @InvocableVariable
    public List<OpportunityDetail> opportunityOptions;
  }

  /**
   * Represents the details of a single Opportunity record.
   * Used to pass structured opportunity data back through invocable methods.
   */
  public class OpportunityDetail {
    /** Opportunity record Id */
    @InvocableVariable(label='Id' description='Opportunity record Id')
    public String id;

    /** Opportunity name */
    @InvocableVariable(label='Opportunity Name' description='Opportunity name')
    public String name;

    /** Related Account name */
    @InvocableVariable(label='Account Name' description='Related Account name')
    public String accountName;

    /** Opportunity amount */
    @InvocableVariable(label='Amount' description='Opportunity amount')
    public Decimal amount;

    /** Opportunity close date */
    @InvocableVariable(label='Close Date' description='Opportunity close date')
    public Date closeDate;

    /** Opportunity stage name */
    @InvocableVariable(label='Stage Name' description='Opportunity stage name')
    public String stageName;

    /**
     * Constructs an OpportunityDetail with the given field values.
     * @param id Opportunity record Id
     * @param name Opportunity name
     * @param accountName Related Account name
     * @param amount Opportunity amount
     * @param closeDate Opportunity close date
     * @param stageName Opportunity stage name
     */
    public OpportunityDetail(
      String id,
      String name,
      String accountName,
      Decimal amount,
      Date closeDate,
      String stageName
    ) {
      this.id = id;
      this.name = name;
      this.accountName = accountName;
      this.amount = amount;
      this.closeDate = closeDate;
      this.stageName = stageName;
    }
  }
}

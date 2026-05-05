public with sharing class closedopportunityController {

    @InvocableMethod(label='Retrieve All Closed Opportunities' description='Fetches all opportunities where stage is Closed Won')
    public static List<OpportunityResponse> getClosedOpportunities(List<OpportunityRequest> requests) {
        List<OpportunityResponse> responses = new List<OpportunityResponse>();
        
        for (OpportunityRequest req : requests) {
            // Querying for 'Closed Won' as per your requirement
            List<Opportunity> oppList = [
                SELECT Id, Name, StageName, Amount, CloseDate, Account.Name 
                FROM Opportunity 
                WHERE StageName = 'Closed Won'
                ORDER BY CloseDate DESC
                LIMIT 50
            ];

            OpportunityResponse res = new OpportunityResponse();
            res.opportunityOptions = new List<OpportunityDetail>();

            for (Opportunity opp : oppList) {
                OpportunityDetail detail = new OpportunityDetail();
                detail.id = opp.Id;
                detail.name = opp.Name;
                detail.stage = opp.StageName;
                detail.amount = opp.Amount; // This is the 'Budget' field
                detail.closeDate = opp.CloseDate;
                detail.accountName = opp.Account.Name;
                res.opportunityOptions.add(detail);
            }
            responses.add(res);
        }
        return responses;
    }

    public class OpportunityRequest {
        @InvocableVariable(label='Opportunity Name' description='Unused filter for this version')
        public String opportunityName;
    }

    public class OpportunityResponse {
        @InvocableVariable(label='Opportunity Options' description='The list of closed won opportunities')
        public List<OpportunityDetail> opportunityOptions;
    }

    // This class is the one you will select in the "Custom Lightning Type" schema
    public class OpportunityDetail {
        @InvocableVariable public String id;
        @InvocableVariable public String name;
        @InvocableVariable public String stage;
        @InvocableVariable public Decimal amount;
        @InvocableVariable public Date closeDate;
        @InvocableVariable public String accountName;
    }
}
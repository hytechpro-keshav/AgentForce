public with sharing class OpenOpportunityController {

    @InvocableMethod(label='Retrieve All Open Opportunities' description='Fetches all opportunities where stage is not Closed Won')
    public static List<OpportunityResponse> getOpenOpportunities(List<OpportunityRequest> requests) {
        List<OpportunityResponse> responses = new List<OpportunityResponse>();
        
        for (OpportunityRequest req : requests) {
            // Logic to fetch all opportunities not in 'Closed Won' stage 
            List<Opportunity> oppList = [
                SELECT Id, Name, StageName, Amount, CloseDate, Account.Name 
                FROM Opportunity 
                WHERE StageName != 'Closed Won'
            ];

            OpportunityResponse res = new OpportunityResponse();
            res.opportunityOptions = new List<OpportunityDetail>();

            for (Opportunity opp : oppList) {
                OpportunityDetail detail = new OpportunityDetail();
                detail.id = opp.Id;
                detail.name = opp.Name;
                detail.stage = opp.StageName;
                detail.amount = opp.Amount;
                detail.closeDate = opp.CloseDate;
                detail.accountName = opp.Account.Name;
                res.opportunityOptions.add(detail);
            }
            responses.add(res);
        }
        return responses;
    }

    // Input class required for Agentforce actions [cite: 38, 83]
    public class OpportunityRequest {
        @InvocableVariable(label='Opportunity Name' description='Optional name filter (unused in this version)')
        public String opportunityName;
    }

    // Output class used to pass data back to the agent 
    public class OpportunityResponse {
        @InvocableVariable(label='Opportunity Options' description='The list of open opportunities returned')
        public List<OpportunityDetail> opportunityOptions;
    }

    // Individual data structure for opportunity fields [cite: 41]
    public class OpportunityDetail {
        @InvocableVariable public String id;
        @InvocableVariable public String name;
        @InvocableVariable public String stage;
        @InvocableVariable public Decimal amount;
        @InvocableVariable public Date closeDate;
        @InvocableVariable public String accountName;
    }
}
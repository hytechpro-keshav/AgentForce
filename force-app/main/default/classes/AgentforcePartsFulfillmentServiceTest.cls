/**
 * Tests for the Phase 4c parts fulfillment executor. Exercises the
 * transfer + backorder create paths, idempotency, graceful degradation,
 * and the REST entry point. Pure DML (no callouts) — the executor IS the
 * Salesforce-side writer.
 */
@IsTest
private class AgentforcePartsFulfillmentServiceTest {
  private static final String WORKFLOW_ID = 'wf-test-4c-0001';
  private static final String SOURCE_REF = 'WH-SJO-002';
  private static final String DEST_REF = 'WH-AUS-001';
  private static final String TRANSFER_PART = 'SP-BATT-15X';
  private static final String BACKORDER_PART = 'SP-TPAD-15X';

  @TestSetup
  static void setup() {
    Account account = new Account(Name = 'Aptivance Test');
    insert account;

    Case supportCase = new Case(
      AccountId = account.Id,
      Subject = 'Battery replacement',
      Status = 'New',
      Origin = 'Web'
    );
    insert supportCase;

    List<Schema.Location> locations = new List<Schema.Location>{
      new Schema.Location(
        Name = 'San Jose Depot',
        ExternalReference = SOURCE_REF,
        IsInventoryLocation = true
      ),
      new Schema.Location(
        Name = 'Austin Fulfillment',
        ExternalReference = DEST_REF,
        IsInventoryLocation = true
      )
    };
    insert locations;

    List<Product2> products = new List<Product2>{
      new Product2(
        Name = '6 Cell Battery Pack',
        ProductCode = TRANSFER_PART,
        IsActive = true
      ),
      new Product2(
        Name = 'Trackpad Module',
        ProductCode = BACKORDER_PART,
        IsActive = true
      )
    };
    insert products;

    Id sourceLocationId;
    for (Schema.Location loc : locations) {
      if (loc.ExternalReference == SOURCE_REF) {
        sourceLocationId = loc.Id;
      }
    }
    Id batteryId;
    for (Product2 product : products) {
      if (product.ProductCode == TRANSFER_PART) {
        batteryId = product.Id;
      }
    }
    insert new ProductItem(
      Product2Id = batteryId,
      LocationId = sourceLocationId,
      QuantityOnHand = 25,
      QuantityUnitOfMeasure = 'Each'
    );
  }

  private static AgentforcePartsFulfillmentService.FulfillmentRequest buildRequest() {
    Case supportCase = [SELECT Id FROM Case LIMIT 1];

    AgentforcePartsFulfillmentService.FulfillmentItem transferItem = new AgentforcePartsFulfillmentService.FulfillmentItem();
    transferItem.partNumber = TRANSFER_PART;
    transferItem.quantity = 1;
    transferItem.exceptionType = 'inter_warehouse_transfer';
    transferItem.fulfillmentWarehouseReference = DEST_REF;
    transferItem.sourceWarehouseReference = SOURCE_REF;
    transferItem.approvalReason = 'cross_region_transfer';

    AgentforcePartsFulfillmentService.FulfillmentItem backorderItem = new AgentforcePartsFulfillmentService.FulfillmentItem();
    backorderItem.partNumber = BACKORDER_PART;
    backorderItem.quantity = 2;
    backorderItem.exceptionType = 'backorder';
    backorderItem.fulfillmentWarehouseReference = DEST_REF;

    AgentforcePartsFulfillmentService.FulfillmentRequest request = new AgentforcePartsFulfillmentService.FulfillmentRequest();
    request.workflowId = WORKFLOW_ID;
    request.caseId = supportCase.Id;
    request.items = new List<AgentforcePartsFulfillmentService.FulfillmentItem>{
      transferItem,
      backorderItem
    };
    return request;
  }

  @IsTest
  static void createsTransferAndBackorderForApprovedPlans() {
    Test.startTest();
    AgentforcePartsFulfillmentService.FulfillmentResult result = AgentforcePartsFulfillmentService.apply(
      buildRequest()
    );
    Test.stopTest();

    System.assertEquals(true, result.applied, 'Expected writes to apply');
    System.assertEquals(2, result.items.size(), 'One result per item');

    Map<String, AgentforcePartsFulfillmentService.FulfillmentItemResult> byPart = byPart(
      result
    );
    System.assertEquals(
      'transfer_pending',
      byPart.get(TRANSFER_PART).reservationStatus
    );
    System.assertEquals(true, byPart.get(TRANSFER_PART).created);
    System.assertEquals(
      'ProductTransfer',
      byPart.get(TRANSFER_PART).recordType
    );
    System.assertEquals(
      'backorder_requested',
      byPart.get(BACKORDER_PART).reservationStatus
    );
    System.assertEquals(
      'ProductRequest',
      byPart.get(BACKORDER_PART).recordType
    );

    System.assertEquals(
      1,
      [
        SELECT COUNT()
        FROM ProductTransfer
        WHERE Orchestrator_Workflow_Id__c = :WORKFLOW_ID
      ]
    );
    System.assertEquals(
      1,
      [
        SELECT COUNT()
        FROM ProductRequestLineItem
        WHERE Orchestrator_Workflow_Id__c = :WORKFLOW_ID
      ]
    );

    Case updatedCase = [
      SELECT Parts_Fulfillment_Status__c
      FROM Case
      LIMIT 1
    ];
    System.assertEquals(
      'Backorder Requested',
      updatedCase.Parts_Fulfillment_Status__c
    );
  }

  @IsTest
  static void isIdempotentOnRepeatedApply() {
    AgentforcePartsFulfillmentService.apply(buildRequest());

    Test.startTest();
    AgentforcePartsFulfillmentService.FulfillmentResult second = AgentforcePartsFulfillmentService.apply(
      buildRequest()
    );
    Test.stopTest();

    Map<String, AgentforcePartsFulfillmentService.FulfillmentItemResult> byPart = byPart(
      second
    );
    System.assertEquals(true, byPart.get(TRANSFER_PART).idempotentSkip);
    System.assertEquals(true, byPart.get(BACKORDER_PART).idempotentSkip);

    // No duplicate records created on the second call.
    System.assertEquals(
      1,
      [
        SELECT COUNT()
        FROM ProductTransfer
        WHERE Orchestrator_Workflow_Id__c = :WORKFLOW_ID
      ]
    );
    System.assertEquals(
      1,
      [
        SELECT COUNT()
        FROM ProductRequest
        WHERE Orchestrator_Workflow_Id__c = :WORKFLOW_ID
      ]
    );
  }

  @IsTest
  static void degradesOnMissingCommand() {
    Test.startTest();
    AgentforcePartsFulfillmentService.FulfillmentResult result = AgentforcePartsFulfillmentService.apply(
      null
    );
    Test.stopTest();
    System.assertEquals(true, result.degraded);
    System.assertEquals(false, result.applied);
  }

  @IsTest
  static void leavesUnknownPartPlanned() {
    AgentforcePartsFulfillmentService.FulfillmentRequest request = buildRequest();
    request.items[0].partNumber = 'SP-DOES-NOT-EXIST';

    Test.startTest();
    AgentforcePartsFulfillmentService.FulfillmentResult result = AgentforcePartsFulfillmentService.apply(
      request
    );
    Test.stopTest();

    Map<String, AgentforcePartsFulfillmentService.FulfillmentItemResult> byPart = byPart(
      result
    );
    System.assertEquals(
      'planned',
      byPart.get('SP-DOES-NOT-EXIST').reservationStatus
    );
    System.assertEquals(false, byPart.get('SP-DOES-NOT-EXIST').created);
  }

  @IsTest
  static void restEndpointReturnsResult() {
    Case supportCase = [SELECT Id FROM Case LIMIT 1];
    String body =
      '{"workflowId":"' +
      WORKFLOW_ID +
      '","caseId":"' +
      supportCase.Id +
      '","items":[{"partNumber":"' +
      TRANSFER_PART +
      '","quantity":1,"exceptionType":"inter_warehouse_transfer","fulfillmentWarehouseReference":"' +
      DEST_REF +
      '","sourceWarehouseReference":"' +
      SOURCE_REF +
      '"}]}';

    RestRequest req = new RestRequest();
    req.requestUri = '/services/apexrest/agentforce/parts-fulfillment';
    req.httpMethod = 'POST';
    req.requestBody = Blob.valueOf(body);
    RestContext.request = req;
    RestContext.response = new RestResponse();

    Test.startTest();
    AgentforcePartsFulfillmentRest.post();
    Test.stopTest();

    System.assertEquals(200, RestContext.response.statusCode);
    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      RestContext.response.responseBody.toString()
    );
    System.assertEquals(true, parsed.get('applied'));
  }

  private static Map<String, AgentforcePartsFulfillmentService.FulfillmentItemResult> byPart(
    AgentforcePartsFulfillmentService.FulfillmentResult result
  ) {
    Map<String, AgentforcePartsFulfillmentService.FulfillmentItemResult> byPart = new Map<String, AgentforcePartsFulfillmentService.FulfillmentItemResult>();
    for (
      AgentforcePartsFulfillmentService.FulfillmentItemResult item : result.items
    ) {
      byPart.put(item.partNumber, item);
    }
    return byPart;
  }
}

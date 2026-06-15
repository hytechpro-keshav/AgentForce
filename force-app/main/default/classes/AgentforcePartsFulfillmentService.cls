/**
 * Node 4 — Phase 4c gated parts fulfillment executor.
 *
 * Creates the in-org fulfillment records for APPROVED part plans:
 *   - inter_warehouse_transfer -> ProductTransfer (source -> fulfillment WH)
 *   - backorder               -> ProductRequest + ProductRequestLineItem
 * and stamps the Case fulfillment status.
 *
 * Salesforce owns the write here (called by the NestJS orchestrator via
 * AgentforcePartsFulfillmentRest, or by an Agentforce genAiFunction /
 * Flow after the Node 6 approval). The class is:
 *   - with sharing + FLS/CRUD checked (Schema.sObjectType.*),
 *   - bulk-safe (set-based lookups, Database.insert(list, false)),
 *   - idempotent on Orchestrator_Workflow_Id__c + ProductCode so repeated
 *     deliveries of the same approved command never double-write.
 *
 * Keys are ALWAYS Product2.ProductCode + Location.ExternalReference,
 * never Product2.Id (duplicate catalog rows exist for the same code).
 */
public with sharing class AgentforcePartsFulfillmentService {
  private static final String STATUS_TRANSFER_PENDING = 'transfer_pending';
  private static final String STATUS_BACKORDER_REQUESTED = 'backorder_requested';
  private static final String STATUS_PLANNED = 'planned';
  private static final String TYPE_TRANSFER = 'ProductTransfer';
  private static final String TYPE_REQUEST = 'ProductRequest';

  @InvocableMethod(
    label='Create Parts Fulfillment'
    description='Creates ProductTransfer / ProductRequest records for approved Node 4 part plans. Idempotent on workflow id + part code.'
  )
  public static List<FulfillmentResult> createFulfillments(
    List<FulfillmentRequest> requests
  ) {
    List<FulfillmentResult> results = new List<FulfillmentResult>();
    if (requests == null) {
      return results;
    }
    for (FulfillmentRequest request : requests) {
      results.add(apply(request));
    }
    return results;
  }

  /**
   * Applies a single approved fulfillment command. Never throws — record
   * level failures degrade the affected item and leave it `planned`.
   */
  public static FulfillmentResult apply(FulfillmentRequest request) {
    FulfillmentResult result = new FulfillmentResult();
    result.applied = false;
    result.degraded = false;
    result.items = new List<FulfillmentItemResult>();

    if (
      request == null ||
      String.isBlank(request.workflowId) ||
      String.isBlank(request.caseId) ||
      request.items == null ||
      request.items.isEmpty()
    ) {
      result.degraded = true;
      return result;
    }

    if (
      !Schema.sObjectType.ProductRequest.isCreateable() ||
      !Schema.sObjectType.ProductTransfer.isCreateable()
    ) {
      result.degraded = true;
      for (FulfillmentItem item : request.items) {
        result.items.add(
          plannedItem(
            item,
            'Fulfillment writes are not permitted in this context.'
          )
        );
      }
      return result;
    }

    // ---- Resolve stable keys -> ids (bulk) ----
    Set<String> codes = new Set<String>();
    Set<String> warehouseRefs = new Set<String>();
    for (FulfillmentItem item : request.items) {
      if (String.isNotBlank(item.partNumber)) {
        codes.add(item.partNumber.toUpperCase());
      }
      if (String.isNotBlank(item.fulfillmentWarehouseReference)) {
        warehouseRefs.add(item.fulfillmentWarehouseReference);
      }
      if (String.isNotBlank(item.sourceWarehouseReference)) {
        warehouseRefs.add(item.sourceWarehouseReference);
      }
    }

    Map<String, Id> product2ByCode = resolveProducts(codes);
    Map<String, Id> locationByRef = resolveLocations(warehouseRefs);
    Map<String, Id> sourceItemByKey = resolveSourceItems(codes, warehouseRefs);

    // ---- Idempotency: what did this workflow already create? ----
    Set<String> existingTransferCodes = new Set<String>();
    Map<String, Id> existingTransferIdByCode = new Map<String, Id>();
    for (ProductTransfer transferRow : [
      SELECT Id, Product2.ProductCode
      FROM ProductTransfer
      WHERE Orchestrator_Workflow_Id__c = :request.workflowId
    ]) {
      String code = transferRow.Product2.ProductCode;
      if (String.isNotBlank(code)) {
        existingTransferCodes.add(code.toUpperCase());
        existingTransferIdByCode.put(code.toUpperCase(), transferRow.Id);
      }
    }

    Map<String, Id> existingRequestIdByCode = new Map<String, Id>();
    for (ProductRequestLineItem lineRow : [
      SELECT Id, ParentId, Product2.ProductCode
      FROM ProductRequestLineItem
      WHERE Orchestrator_Workflow_Id__c = :request.workflowId
    ]) {
      String code = lineRow.Product2.ProductCode;
      if (String.isNotBlank(code)) {
        existingRequestIdByCode.put(code.toUpperCase(), lineRow.ParentId);
      }
    }

    // Header-level idempotency: reuse an existing ProductRequest for this
    // workflow + destination so a retry never creates a duplicate header,
    // even if a prior line insert was gated/failed.
    Map<Id, Id> existingRequestByDestination = new Map<Id, Id>();
    for (ProductRequest headerRow : [
      SELECT Id, DestinationLocationId
      FROM ProductRequest
      WHERE Orchestrator_Workflow_Id__c = :request.workflowId
    ]) {
      if (headerRow.DestinationLocationId != null) {
        existingRequestByDestination.put(
          headerRow.DestinationLocationId,
          headerRow.Id
        );
      }
    }

    // ---- Stage inserts ----
    List<ProductTransfer> transfersToInsert = new List<ProductTransfer>();
    List<Integer> transferItemIndex = new List<Integer>();
    // One ProductRequest header per destination Location for this workflow.
    Map<Id, ProductRequest> requestByDestination = new Map<Id, ProductRequest>();

    // Pre-size the result list so each item keeps its slot.
    for (Integer i = 0; i < request.items.size(); i++) {
      result.items.add(null);
    }

    // Backorder lines are built after their headers are inserted.
    List<BackorderStage> backorders = new List<BackorderStage>();

    for (Integer i = 0; i < request.items.size(); i++) {
      FulfillmentItem item = request.items[i];
      String code = String.isBlank(item.partNumber)
        ? null
        : item.partNumber.toUpperCase();
      Integer quantity = item.quantity == null ||
        item.quantity < 1
        ? 1
        : item.quantity;

      if (code == null || !product2ByCode.containsKey(code)) {
        result.items[i] = plannedItem(item, 'Part not found in catalog.');
        continue;
      }

      if (item.exceptionType == 'inter_warehouse_transfer') {
        if (existingTransferCodes.contains(code)) {
          result.items[i] = doneItem(
            item,
            false,
            true,
            TYPE_TRANSFER,
            existingTransferIdByCode.get(code),
            STATUS_TRANSFER_PENDING,
            'Existing transfer reused (idempotent).'
          );
          continue;
        }
        Id destinationId = locationByRef.get(
          item.fulfillmentWarehouseReference
        );
        Id sourceId = locationByRef.get(item.sourceWarehouseReference);
        if (destinationId == null || sourceId == null) {
          result.items[i] = plannedItem(
            item,
            'Source or fulfillment warehouse not found.'
          );
          continue;
        }
        ProductTransfer transferRow = new ProductTransfer();
        transferRow.Product2Id = product2ByCode.get(code);
        transferRow.SourceLocationId = sourceId;
        transferRow.DestinationLocationId = destinationId;
        transferRow.QuantitySent = quantity;
        transferRow.Orchestrator_Workflow_Id__c = request.workflowId;
        Id sourceItemId = sourceItemByKey.get(
          code + '|' + item.sourceWarehouseReference
        );
        if (sourceItemId != null) {
          transferRow.SourceProductItemId = sourceItemId;
        }
        transfersToInsert.add(transferRow);
        transferItemIndex.add(i);
      } else if (item.exceptionType == 'backorder') {
        if (existingRequestIdByCode.containsKey(code)) {
          result.items[i] = doneItem(
            item,
            false,
            true,
            TYPE_REQUEST,
            existingRequestIdByCode.get(code),
            STATUS_BACKORDER_REQUESTED,
            'Existing backorder reused (idempotent).'
          );
          continue;
        }
        Id destinationId = locationByRef.get(
          item.fulfillmentWarehouseReference
        );
        if (destinationId == null) {
          result.items[i] = plannedItem(
            item,
            'Fulfillment warehouse not found.'
          );
          continue;
        }
        if (
          !requestByDestination.containsKey(destinationId) &&
          !existingRequestByDestination.containsKey(destinationId)
        ) {
          ProductRequest header = new ProductRequest();
          header.CaseId = request.caseId;
          header.DestinationLocationId = destinationId;
          header.Status = 'Draft';
          header.Orchestrator_Workflow_Id__c = request.workflowId;
          requestByDestination.put(destinationId, header);
        }
        backorders.add(
          new BackorderStage(i, item, code, quantity, destinationId)
        );
      } else {
        result.items[i] = plannedItem(
          item,
          'No write for this exception type.'
        );
      }
    }

    // ---- Insert transfers ----
    if (!transfersToInsert.isEmpty()) {
      Database.SaveResult[] saveResults = Database.insert(
        transfersToInsert,
        false
      );
      for (Integer r = 0; r < saveResults.size(); r++) {
        Integer itemIndex = transferItemIndex[r];
        FulfillmentItem item = request.items[itemIndex];
        if (saveResults[r].isSuccess()) {
          result.items[itemIndex] = doneItem(
            item,
            true,
            false,
            TYPE_TRANSFER,
            transfersToInsert[r].Id,
            STATUS_TRANSFER_PENDING,
            'Transfer created.'
          );
        } else {
          result.degraded = true;
          result.items[itemIndex] = plannedItem(
            item,
            'Transfer create failed: ' +
            String.valueOf(saveResults[r].getErrors()[0].getStatusCode())
          );
        }
      }
    }

    // ---- Insert backorder headers (new only), then lines ----
    if (!backorders.isEmpty()) {
      // Seed with reused headers; insert only the genuinely new ones.
      Map<Id, Id> requestIdByDestination = new Map<Id, Id>(
        existingRequestByDestination
      );
      if (!requestByDestination.isEmpty()) {
        List<ProductRequest> headers = new List<ProductRequest>(
          requestByDestination.values()
        );
        Database.SaveResult[] headerResults = Database.insert(headers, false);
        for (Integer h = 0; h < headerResults.size(); h++) {
          if (headerResults[h].isSuccess()) {
            requestIdByDestination.put(
              headers[h].DestinationLocationId,
              headers[h].Id
            );
          }
        }
      }

      List<ProductRequestLineItem> linesToInsert = new List<ProductRequestLineItem>();
      List<Integer> lineItemIndex = new List<Integer>();
      for (BackorderStage stage : backorders) {
        Id requestId = requestIdByDestination.get(stage.destinationId);
        if (requestId == null) {
          result.degraded = true;
          result.items[stage.itemIndex] = plannedItem(
            stage.item,
            'Backorder header create failed.'
          );
          continue;
        }
        ProductRequestLineItem line = new ProductRequestLineItem();
        line.ParentId = requestId;
        line.Product2Id = product2ByCode.get(stage.code);
        line.QuantityRequested = stage.quantity;
        line.Orchestrator_Workflow_Id__c = request.workflowId;
        if (
          Schema.sObjectType.ProductRequestLineItem.fields.Backorder_Reason__c.isCreateable()
        ) {
          line.Backorder_Reason__c = 'Network shortage';
        }
        linesToInsert.add(line);
        lineItemIndex.add(stage.itemIndex);
      }

      if (!linesToInsert.isEmpty()) {
        Database.SaveResult[] lineResults = Database.insert(
          linesToInsert,
          false
        );
        for (Integer l = 0; l < lineResults.size(); l++) {
          Integer itemIndex = lineItemIndex[l];
          FulfillmentItem item = request.items[itemIndex];
          if (lineResults[l].isSuccess()) {
            result.items[itemIndex] = doneItem(
              item,
              true,
              false,
              TYPE_REQUEST,
              linesToInsert[l].ParentId,
              STATUS_BACKORDER_REQUESTED,
              'Backorder requested.'
            );
          } else {
            result.degraded = true;
            result.items[itemIndex] = plannedItem(
              item,
              'Backorder line create failed: ' +
              String.valueOf(lineResults[l].getErrors()[0].getStatusCode())
            );
          }
        }
      }
    }

    // Backfill any item slots that were never written (defensive).
    for (Integer i = 0; i < result.items.size(); i++) {
      if (result.items[i] == null) {
        result.items[i] = plannedItem(request.items[i], 'No write applied.');
      }
    }

    result.applied = anyWritten(result.items);
    updateCaseStatus(request.caseId, result.items);
    return result;
  }

  // ---- Lookups ----

  private static Map<String, Id> resolveProducts(Set<String> codes) {
    Map<String, Id> byCode = new Map<String, Id>();
    if (codes.isEmpty() || !Schema.sObjectType.Product2.isAccessible()) {
      return byCode;
    }
    for (Product2 product : [
      SELECT Id, ProductCode
      FROM Product2
      WHERE ProductCode IN :codes AND IsActive = TRUE
    ]) {
      if (String.isNotBlank(product.ProductCode)) {
        byCode.put(product.ProductCode.toUpperCase(), product.Id);
      }
    }
    return byCode;
  }

  private static Map<String, Id> resolveLocations(Set<String> refs) {
    Map<String, Id> byRef = new Map<String, Id>();
    if (refs.isEmpty() || !Schema.sObjectType.Location.isAccessible()) {
      return byRef;
    }
    for (Schema.Location loc : [
      SELECT Id, ExternalReference
      FROM Location
      WHERE ExternalReference IN :refs
    ]) {
      if (String.isNotBlank(loc.ExternalReference)) {
        byRef.put(loc.ExternalReference, loc.Id);
      }
    }
    return byRef;
  }

  private static Map<String, Id> resolveSourceItems(
    Set<String> codes,
    Set<String> refs
  ) {
    Map<String, Id> byKey = new Map<String, Id>();
    if (
      codes.isEmpty() ||
      refs.isEmpty() ||
      !Schema.sObjectType.ProductItem.isAccessible()
    ) {
      return byKey;
    }
    for (ProductItem productItem : [
      SELECT Id, Product2.ProductCode, Location.ExternalReference
      FROM ProductItem
      WHERE
        Product2.ProductCode IN :codes
        AND Location.ExternalReference IN :refs
    ]) {
      String code = productItem.Product2.ProductCode;
      String ref = productItem.Location.ExternalReference;
      if (String.isNotBlank(code) && String.isNotBlank(ref)) {
        byKey.put(code.toUpperCase() + '|' + ref, productItem.Id);
      }
    }
    return byKey;
  }

  private static void updateCaseStatus(
    Id caseId,
    List<FulfillmentItemResult> items
  ) {
    if (
      !Schema.sObjectType.Case.fields.Parts_Fulfillment_Status__c.isUpdateable()
    ) {
      return;
    }
    Boolean anyBackorder = false;
    Boolean anyTransfer = false;
    for (FulfillmentItemResult item : items) {
      if (item.reservationStatus == STATUS_BACKORDER_REQUESTED) {
        anyBackorder = true;
      } else if (item.reservationStatus == STATUS_TRANSFER_PENDING) {
        anyTransfer = true;
      }
    }
    if (!anyBackorder && !anyTransfer) {
      return;
    }
    Case caseRow = new Case(Id = caseId);
    caseRow.Parts_Fulfillment_Status__c = anyBackorder
      ? 'Backorder Requested'
      : 'Transfer Pending';
    try {
      update caseRow;
    } catch (DmlException dmlError) {
      // Best-effort: status stamping must never fail the write.
    }
  }

  private static Boolean anyWritten(List<FulfillmentItemResult> items) {
    for (FulfillmentItemResult item : items) {
      if (item.created || item.idempotentSkip) {
        return true;
      }
    }
    return false;
  }

  private static FulfillmentItemResult plannedItem(
    FulfillmentItem item,
    String message
  ) {
    return doneItem(item, false, false, null, null, STATUS_PLANNED, message);
  }

  private static FulfillmentItemResult doneItem(
    FulfillmentItem item,
    Boolean created,
    Boolean idempotentSkip,
    String recordType,
    Id recordId,
    String reservationStatus,
    String message
  ) {
    FulfillmentItemResult out = new FulfillmentItemResult();
    out.partNumber = item == null ? null : item.partNumber;
    out.created = created;
    out.idempotentSkip = idempotentSkip;
    out.recordType = recordType;
    out.recordId = recordId == null ? null : String.valueOf(recordId);
    out.reservationStatus = reservationStatus;
    out.message = message;
    return out;
  }

  // ---- DTOs (mirror apps/ai-api/src/orchestrator/dto/parts-fulfillment.ts) ----

  private class BackorderStage {
    Integer itemIndex;
    FulfillmentItem item;
    String code;
    Integer quantity;
    Id destinationId;

    BackorderStage(
      Integer itemIndex,
      FulfillmentItem item,
      String code,
      Integer quantity,
      Id destinationId
    ) {
      this.itemIndex = itemIndex;
      this.item = item;
      this.code = code;
      this.quantity = quantity;
      this.destinationId = destinationId;
    }
  }

  public class FulfillmentRequest {
    @InvocableVariable(label='Workflow Id' required=true)
    public String workflowId;

    @InvocableVariable(label='Case Id' required=true)
    public String caseId;

    @InvocableVariable(label='Items')
    public List<FulfillmentItem> items;
  }

  public class FulfillmentItem {
    @InvocableVariable(label='Part Number')
    public String partNumber;

    @InvocableVariable(label='Quantity')
    public Integer quantity;

    @InvocableVariable(
      label='Exception Type'
      description='inter_warehouse_transfer or backorder.'
    )
    public String exceptionType;

    @InvocableVariable(label='Fulfillment Warehouse Reference')
    public String fulfillmentWarehouseReference;

    @InvocableVariable(label='Source Warehouse Reference')
    public String sourceWarehouseReference;

    @InvocableVariable(label='Approval Reason')
    public String approvalReason;
  }

  public class FulfillmentResult {
    @InvocableVariable(label='Applied')
    public Boolean applied;

    @InvocableVariable(label='Degraded')
    public Boolean degraded;

    @InvocableVariable(label='Items')
    public List<FulfillmentItemResult> items;
  }

  public class FulfillmentItemResult {
    @InvocableVariable(label='Part Number')
    public String partNumber;

    @InvocableVariable(label='Created')
    public Boolean created;

    @InvocableVariable(label='Idempotent Skip')
    public Boolean idempotentSkip;

    @InvocableVariable(label='Record Type')
    public String recordType;

    @InvocableVariable(label='Record Id')
    public String recordId;

    @InvocableVariable(label='Reservation Status')
    public String reservationStatus;

    @InvocableVariable(label='Message')
    public String message;
  }
}

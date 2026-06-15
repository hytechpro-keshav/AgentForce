/**
 * Node 4 — Phase 4c REST entry point for the NestJS orchestrator.
 *
 * The orchestrator POSTs the approved fulfillment command (after the
 * approval gate clears) to `/services/apexrest/agentforce/parts-fulfillment`.
 * This thin resource deserializes the safe command, delegates the DML +
 * idempotency to {@link AgentforcePartsFulfillmentService}, and returns
 * the JSON result the NestJS `SalesforceFulfillmentGateway` expects.
 *
 * The request/response JSON mirrors
 * `apps/ai-api/src/orchestrator/dto/parts-fulfillment.ts`.
 */
@RestResource(urlMapping='/agentforce/parts-fulfillment/*')
global with sharing class AgentforcePartsFulfillmentRest {
  @HttpPost
  global static void post() {
    RestRequest req = RestContext.request;
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    AgentforcePartsFulfillmentService.FulfillmentResult result;
    try {
      String body = req == null ||
        req.requestBody == null
        ? null
        : req.requestBody.toString();
      AgentforcePartsFulfillmentService.FulfillmentRequest command = parse(
        body
      );
      result = AgentforcePartsFulfillmentService.apply(command);
    } catch (Exception parseError) {
      res.statusCode = 400;
      res.responseBody = Blob.valueOf(
        JSON.serialize(degraded('Invalid fulfillment payload.'))
      );
      return;
    }

    res.statusCode = result != null && result.degraded == true ? 502 : 200;
    res.responseBody = Blob.valueOf(JSON.serialize(result));
  }

  private static AgentforcePartsFulfillmentService.FulfillmentRequest parse(
    String body
  ) {
    if (String.isBlank(body)) {
      return null;
    }
    return (AgentforcePartsFulfillmentService.FulfillmentRequest) JSON.deserialize(
      body,
      AgentforcePartsFulfillmentService.FulfillmentRequest.class
    );
  }

  private static AgentforcePartsFulfillmentService.FulfillmentResult degraded(
    String message
  ) {
    AgentforcePartsFulfillmentService.FulfillmentResult result = new AgentforcePartsFulfillmentService.FulfillmentResult();
    result.applied = false;
    result.degraded = true;
    result.items = new List<AgentforcePartsFulfillmentService.FulfillmentItemResult>();
    return result;
  }
}

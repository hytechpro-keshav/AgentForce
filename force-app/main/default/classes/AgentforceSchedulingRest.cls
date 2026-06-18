/**
 * Node 5 — Phase 5c REST entry point for the NestJS orchestrator.
 *
 * The orchestrator POSTs the approved scheduling command (after the Node 6
 * approval gate clears AND a write-time fresh parts/scheduling re-read) to
 * `/services/apexrest/agentforce/scheduling-appointment`. This thin
 * resource deserializes the safe command, delegates the
 * `ServiceAppointment` + `AssignedResource` DML + idempotency to
 * {@link AgentforceSchedulingService}, and returns the JSON result the
 * NestJS `SalesforceSchedulingWriteGateway` expects.
 *
 * The request/response JSON mirrors
 * `apps/ai-api/src/orchestrator/dto/scheduling-write.ts`.
 */
@RestResource(urlMapping='/agentforce/scheduling-appointment/*')
global with sharing class AgentforceSchedulingRest {
  @HttpPost
  global static void post() {
    RestRequest req = RestContext.request;
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    AgentforceSchedulingService.SchedulingResult result;
    try {
      String body = req == null ||
        req.requestBody == null
        ? null
        : req.requestBody.toString();
      AgentforceSchedulingService.SchedulingRequest command = parse(body);
      result = AgentforceSchedulingService.apply(command);
    } catch (Exception parseError) {
      res.statusCode = 400;
      res.responseBody = Blob.valueOf(
        JSON.serialize(degraded('Invalid scheduling payload.'))
      );
      return;
    }

    // Salesforce RestResponse does not support HTTP 502 — always return 200
    // and encode degradation in the JSON body for NestJS to interpret.
    res.statusCode = 200;
    res.responseBody = Blob.valueOf(JSON.serialize(result));
  }

  private static AgentforceSchedulingService.SchedulingRequest parse(
    String body
  ) {
    if (String.isBlank(body)) {
      return null;
    }
    return (AgentforceSchedulingService.SchedulingRequest) JSON.deserialize(
      body,
      AgentforceSchedulingService.SchedulingRequest.class
    );
  }

  private static AgentforceSchedulingService.SchedulingResult degraded(
    String message
  ) {
    AgentforceSchedulingService.SchedulingResult result = new AgentforceSchedulingService.SchedulingResult();
    result.applied = false;
    result.degraded = true;
    result.booked = false;
    result.idempotentSkip = false;
    result.appointmentStatus = 'none';
    result.message = message;
    return result;
  }
}

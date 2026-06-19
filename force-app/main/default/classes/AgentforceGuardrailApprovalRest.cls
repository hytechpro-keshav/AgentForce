/**
 * Node 6 — Phase 6b+ REST entry point for the NestJS orchestrator.
 *
 * The orchestrator POSTs the guardrail approval submit command (when the
 * compliance guardrail holds a Case for human approval) to
 * `/services/apexrest/agentforce/guardrail-approval/submit`. This thin
 * resource deserializes the safe command, delegates the Case stamp +
 * Approval Process submit to {@link AgentforceGuardrailApprovalService}, and
 * returns the JSON result the NestJS `SalesforceGuardrailApprovalGateway`
 * expects.
 *
 * The request/response JSON mirrors
 * `apps/ai-api/src/orchestrator/dto/guardrail.ts`.
 */
@RestResource(urlMapping='/agentforce/guardrail-approval/submit/*')
global with sharing class AgentforceGuardrailApprovalRest {
  @HttpPost
  global static void post() {
    RestRequest req = RestContext.request;
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    AgentforceGuardrailApprovalService.SubmitResult result;
    try {
      String body = req == null ||
        req.requestBody == null
        ? null
        : req.requestBody.toString();
      AgentforceGuardrailApprovalService.SubmitRequest command = parse(body);
      result = AgentforceGuardrailApprovalService.submit(command);
    } catch (Exception parseError) {
      res.statusCode = 400;
      res.responseBody = Blob.valueOf(JSON.serialize(degraded()));
      return;
    }

    // Always 200 — degradation is encoded in the JSON body for NestJS to
    // interpret (the gateway treats `degraded`/`!submitted` as a soft fail).
    res.statusCode = 200;
    res.responseBody = Blob.valueOf(JSON.serialize(result));
  }

  private static AgentforceGuardrailApprovalService.SubmitRequest parse(
    String body
  ) {
    if (String.isBlank(body)) {
      return null;
    }
    return (AgentforceGuardrailApprovalService.SubmitRequest) JSON.deserialize(
      body,
      AgentforceGuardrailApprovalService.SubmitRequest.class
    );
  }

  private static AgentforceGuardrailApprovalService.SubmitResult degraded() {
    AgentforceGuardrailApprovalService.SubmitResult result = new AgentforceGuardrailApprovalService.SubmitResult();
    result.submitted = false;
    result.degraded = true;
    return result;
  }
}

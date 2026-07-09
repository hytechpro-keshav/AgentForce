/**
 * REST entry point for chat-case customer notifications.
 *
 * The NestJS ai-api `SalesforceCaseNotifyGateway` POSTs to:
 *   /services/apexrest/agentforce/case-notify/confirmation
 *     -> CaseConfirmationService.send
 *
 * Mirrors AgentforceOtpRest: one urlMapping, branch on the request URI,
 * parse the JSON body into a typed DTO, and always return HTTP 200 with the
 * outcome encoded in the JSON body (400 only when the payload cannot be
 * parsed) so the ai-api gateway interprets status fields, not HTTP codes.
 */
@RestResource(urlMapping='/agentforce/case-notify/*')
global with sharing class AgentforceCaseNotifyRest {
  @HttpPost
  global static void post() {
    RestRequest req = RestContext.request;
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    String uri = req == null ||
      req.requestURI == null
      ? ''
      : req.requestURI.toLowerCase();
    String body = req == null ||
      req.requestBody == null
      ? null
      : req.requestBody.toString();

    try {
      if (uri.endsWith('/confirmation')) {
        CaseConfirmationService.ConfirmationRequest request = (CaseConfirmationService.ConfirmationRequest) JSON.deserialize(
          body,
          CaseConfirmationService.ConfirmationRequest.class
        );
        res.statusCode = 200;
        res.responseBody = Blob.valueOf(
          JSON.serialize(CaseConfirmationService.send(request))
        );
        return;
      }
    } catch (Exception parseError) {
      res.statusCode = 400;
      res.responseBody = Blob.valueOf(
        JSON.serialize(new Map<String, Object>{ 'error' => 'invalid_payload' })
      );
      return;
    }

    // Unknown sub-path.
    res.statusCode = 404;
    res.responseBody = Blob.valueOf(
      JSON.serialize(new Map<String, Object>{ 'error' => 'unknown_resource' })
    );
  }
}

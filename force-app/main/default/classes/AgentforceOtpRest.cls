/**
 * REST entry point for the customer-chat email OTP flow.
 *
 * The NestJS ai-api `SalesforceOtpGateway` POSTs to:
 *   /services/apexrest/agentforce/otp/generate  -> OtpService.generate
 *   /services/apexrest/agentforce/otp/verify    -> OtpService.verify
 *
 * Salesforce permits only one urlMapping per @RestResource, so this single
 * class is mapped to /agentforce/otp/* and branches on the request URI. It is
 * a thin resource: parse the JSON body into a typed DTO, delegate to
 * {@link OtpService}, and always return HTTP 200 with the outcome encoded in
 * the JSON body (400 only when the payload cannot be parsed). This mirrors the
 * degrade-not-throw contract of AgentforcePartsFulfillmentRest and lets the
 * ai-api gateway interpret status fields rather than HTTP codes.
 */
@RestResource(urlMapping='/agentforce/otp/*')
global with sharing class AgentforceOtpRest {
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
      if (uri.endsWith('/verify')) {
        OtpService.VerifyRequest request = (OtpService.VerifyRequest) JSON.deserialize(
          body,
          OtpService.VerifyRequest.class
        );
        res.statusCode = 200;
        res.responseBody = Blob.valueOf(
          JSON.serialize(OtpService.verify(request))
        );
        return;
      }
      if (uri.endsWith('/generate')) {
        OtpService.GenerateRequest request = (OtpService.GenerateRequest) JSON.deserialize(
          body,
          OtpService.GenerateRequest.class
        );
        res.statusCode = 200;
        res.responseBody = Blob.valueOf(
          JSON.serialize(OtpService.generate(request))
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

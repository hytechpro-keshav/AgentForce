/**
 * Safe, classified error for outbound Salesforce REST calls.
 *
 * The `kind` is deliberately coarse so it can be surfaced in
 * telemetry and the read-only UI without leaking endpoint details,
 * tokens, or Case content.
 */
export type SalesforceGatewayErrorKind =
  | "not_configured"
  | "auth"
  | "not_found"
  | "backend"
  | "network"
  | "timeout"
  | "malformed";

export class SalesforceGatewayError extends Error {
  constructor(
    readonly kind: SalesforceGatewayErrorKind,
    message: string
  ) {
    super(message);
    this.name = "SalesforceGatewayError";
  }
}

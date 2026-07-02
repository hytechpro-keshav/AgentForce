import { UnauthorizedException } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";

export interface IntakeIdentity {
  accountId: string;
  contactId: string;
  verifiedEmail?: string;
}

/**
 * Extracts and enforces the verified-intake identity carried in the JWT
 * (minted by IntakeSessionService at OTP verify). Every scoped read/write is
 * bound to these server-trusted claims, never to client-supplied ids.
 */
export function requireIntakeIdentity(
  principal: AuthPrincipal | undefined
): IntakeIdentity {
  const raw = principal?.raw ?? {};
  const accountId =
    typeof raw["accountId"] === "string"
      ? (raw["accountId"] as string)
      : undefined;
  const contactId =
    typeof raw["contactId"] === "string"
      ? (raw["contactId"] as string)
      : undefined;
  const verifiedEmail =
    typeof raw["verifiedEmail"] === "string"
      ? (raw["verifiedEmail"] as string)
      : undefined;

  if (!accountId || !contactId || raw["verified"] !== true) {
    throw new UnauthorizedException({
      error: "intake_identity_required",
      message: "A verified intake session is required."
    });
  }

  return { accountId, contactId, verifiedEmail };
}

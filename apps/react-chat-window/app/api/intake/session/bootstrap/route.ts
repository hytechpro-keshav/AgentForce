import { NextRequest, NextResponse } from "next/server";

import {
  clientForwardedFor,
  disabledResponse,
  intakeEnabled,
  intakeEmailVerificationEnabled,
  proxyIntake
} from "@/lib/intake-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public: mint a verified-intake JWT without OTP when email verification is
 * temporarily disabled server-side.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!intakeEnabled()) {
    return disabledResponse();
  }
  if (intakeEmailVerificationEnabled()) {
    return NextResponse.json(
      {
        error: "customer_intake_unavailable",
        message: "Email verification is required for intake."
      },
      { status: 404 }
    );
  }
  return proxyIntake("/intake/session/bootstrap", {
    method: "POST",
    forwardedFor: clientForwardedFor(request)
  });
}

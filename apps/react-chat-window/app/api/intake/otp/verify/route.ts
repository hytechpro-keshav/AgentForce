import { NextRequest, NextResponse } from "next/server";

import {
  clientForwardedFor,
  disabledResponse,
  intakeEnabled,
  proxyIntake,
  readJsonBody
} from "@/lib/intake-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: verify an OTP; the AI API returns the verified-intake JWT. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!intakeEnabled()) {
    return disabledResponse();
  }
  const parsed = await readJsonBody(request);
  if ("error" in parsed) {
    return parsed.error;
  }
  return proxyIntake("/intake/otp/verify", {
    method: "POST",
    body: parsed.body,
    forwardedFor: clientForwardedFor(request)
  });
}

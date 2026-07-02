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

/** Public: forward an OTP request to the AI API. Response is uniform upstream. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!intakeEnabled()) {
    return disabledResponse();
  }
  const parsed = await readJsonBody(request);
  if ("error" in parsed) {
    return parsed.error;
  }
  return proxyIntake("/intake/otp/request", {
    method: "POST",
    body: parsed.body,
    forwardedFor: clientForwardedFor(request)
  });
}

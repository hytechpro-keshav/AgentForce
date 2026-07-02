import { NextRequest, NextResponse } from "next/server";

import {
  disabledResponse,
  intakeEnabled,
  intakeEmailVerificationEnabled,
  proxyIntake
} from "@/lib/intake-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: intake feature flags for the client shell. */
export async function GET(): Promise<NextResponse> {
  if (!intakeEnabled()) {
    return disabledResponse();
  }
  try {
    const upstream = await proxyIntake("/intake/config", { method: "GET" });
    if (upstream.status === 200) {
      return upstream;
    }
  } catch {
    // Fall through to server-side env defaults.
  }
  return NextResponse.json({
    emailVerificationEnabled: intakeEmailVerificationEnabled(),
    bootstrapAvailable: !intakeEmailVerificationEnabled()
  });
}

import { NextRequest, NextResponse } from "next/server";

import {
  bearerHeader,
  disabledResponse,
  intakeEnabled,
  proxyIntake
} from "@/lib/intake-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated: live status of the verified customer's open cases. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!intakeEnabled()) {
    return disabledResponse();
  }
  const authorization = bearerHeader(request);
  if (!authorization) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return proxyIntake("/intake/cases", { method: "GET", authorization });
}

import { NextRequest, NextResponse } from "next/server";

import {
  bearerHeader,
  disabledResponse,
  intakeEnabled,
  proxyIntake
} from "@/lib/intake-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated: fetch the verified customer's intake context. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!intakeEnabled()) {
    return disabledResponse();
  }
  const authorization = bearerHeader(request);
  if (!authorization) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return proxyIntake("/intake/context", { method: "GET", authorization });
}

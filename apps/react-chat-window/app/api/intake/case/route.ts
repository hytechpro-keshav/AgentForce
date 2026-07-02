import { NextRequest, NextResponse } from "next/server";

import {
  bearerHeader,
  disabledResponse,
  intakeEnabled,
  proxyIntake,
  readJsonBody
} from "@/lib/intake-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated: create the Salesforce Case from the collected intake. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!intakeEnabled()) {
    return disabledResponse();
  }
  const authorization = bearerHeader(request);
  if (!authorization) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = await readJsonBody(request);
  if ("error" in parsed) {
    return parsed.error;
  }
  return proxyIntake("/intake/case", {
    method: "POST",
    authorization,
    body: parsed.body
  });
}

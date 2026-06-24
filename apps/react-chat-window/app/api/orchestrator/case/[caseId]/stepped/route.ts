import { NextRequest, NextResponse } from "next/server";

import { CASE_ID_PATTERN } from "@/lib/orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "orchestrator_session";

function aiApiBaseUrl(): string {
  const url = process.env.AI_API_BASE_URL?.trim();
  if (!url) {
    throw new Error(
      "AI_API_BASE_URL is not configured on the react-chat-window service."
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * Phase 2 — start a STEPPED run for a Case. The graph auto-runs Triage then
 * pauses; the operator advances one stage at a time via the `/advance` proxy.
 * Requires the operator session cookie (carries `agentforce:orchestrator-step`).
 * Returns 202 + `{ workflowId, status: "assigned" }` like the normal trigger.
 */
export async function POST(
  request: NextRequest,
  context: { params: { caseId: string } }
): Promise<NextResponse> {
  const { caseId } = context.params;
  if (!CASE_ID_PATTERN.test(caseId)) {
    return NextResponse.json({ error: "invalid_case_id" }, { status: 400 });
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value?.trim();
  if (!session) {
    return NextResponse.json(
      {
        error: "operator_session_required",
        message: "Sign in to start a stepped orchestration run."
      },
      { status: 401 }
    );
  }

  let bodyJson: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    bodyJson =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    bodyJson = {};
  }

  // Path is authoritative for the Case id; ensure body agrees.
  const bodyCaseId =
    typeof bodyJson.caseId === "string" ? bodyJson.caseId.trim() : "";
  if (bodyCaseId && !CASE_ID_PATTERN.test(bodyCaseId)) {
    return NextResponse.json({ error: "invalid_case_id_in_body" }, { status: 400 });
  }

  const upstreamBody = { ...bodyJson, caseId };

  let upstream: Response;
  try {
    upstream = await fetch(
      `${aiApiBaseUrl()}/orchestrator/case-triage/cases/${encodeURIComponent(
        caseId
      )}/stepped`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${session}`
        },
        body: JSON.stringify(upstreamBody),
        cache: "no-store"
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: "orchestration_stepped_unavailable",
        message: "Stepped orchestration is not available right now."
      },
      { status: 503 }
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json"
    }
  });
}

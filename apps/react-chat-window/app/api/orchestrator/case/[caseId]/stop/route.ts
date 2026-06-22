import { NextRequest, NextResponse } from "next/server";

import { CASE_ID_PATTERN } from "@/lib/orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** httpOnly cookie holding the operator session JWT (read + control scopes). */
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
 * RC-1b (Node 6 6c) — Stop-AI proxy. The ONLY console mutation. Reads the
 * operator session cookie server-side (NOT the read-only view token) and
 * attaches it as a bearer to the ai-api stop endpoint, which requires the
 * `agentforce:orchestrator-control` scope. A missing session returns 401 so
 * the UI can prompt for the operator access code.
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
        message: "Sign in to stop AI orchestration."
      },
      { status: 401 }
    );
  }

  let reason: string | undefined;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === "string" && body.reason.trim()) {
      reason = body.reason.slice(0, 200);
    }
  } catch {
    // No / invalid body → stop without a reason.
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${aiApiBaseUrl()}/orchestrator/case-triage/cases/${encodeURIComponent(
        caseId
      )}/stop`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${session}`
        },
        body: JSON.stringify(reason ? { reason } : {}),
        cache: "no-store"
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: "orchestration_stop_unavailable",
        message: "Stop AI is not available right now."
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

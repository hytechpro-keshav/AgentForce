import { NextRequest, NextResponse } from "next/server";

import { WORKFLOW_ID_PATTERN } from "@/lib/orchestration";

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
 * Phase 2 — advance a paused stepped workflow by exactly one stage. The
 * backend runs the next graph node synchronously and returns the updated
 * snapshot (either `awaiting_step` for more stages ahead, `waiting_approval`
 * if the guardrail interrupted, or a terminal status). Requires the operator
 * session cookie (carries `agentforce:orchestrator-step`).
 */
export async function POST(
  request: NextRequest,
  context: { params: { workflowId: string } }
): Promise<NextResponse> {
  const { workflowId } = context.params;
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    return NextResponse.json({ error: "invalid_workflow_id" }, { status: 400 });
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value?.trim();
  if (!session) {
    return NextResponse.json(
      {
        error: "operator_session_required",
        message: "Sign in to advance stepped orchestration."
      },
      { status: 401 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${aiApiBaseUrl()}/orchestrator/case-triage/${encodeURIComponent(
        workflowId
      )}/advance`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${session}`
        },
        cache: "no-store"
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: "orchestration_advance_unavailable",
        message: "Step advance is not available right now."
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

import { NextRequest, NextResponse } from "next/server";

import { WORKFLOW_ID_PATTERN } from "@/lib/orchestration";
import { resolveOrchestratorReadBearer } from "@/lib/orchestrator-proxy-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Read-only proxy for the Node 1 orchestration status feed.
 *
 * The operator session cookie (preferred) or read scope token
 * (`AI_API_ORCHESTRATOR_VIEW_TOKEN`) lives only on the Next.js server and is
 * attached here. The browser never sees
 * it and never talks to the NestJS orchestrator directly. This route
 * is GET-only: there is intentionally no proxy for the approval
 * resume endpoint, because approvals do not happen in this UI.
 */
export async function GET(
  request: NextRequest,
  context: { params: { workflowId: string } }
): Promise<NextResponse> {
  const { workflowId } = context.params;
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    return NextResponse.json({ error: "invalid_workflow_id" }, { status: 400 });
  }

  const viewToken = resolveOrchestratorReadBearer(request);
  if (!viewToken) {
    return NextResponse.json(
      {
        error: "orchestration_view_unavailable",
        message: "The orchestration view is not configured."
      },
      { status: 503 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${aiApiBaseUrl()}/orchestrator/case-triage/${encodeURIComponent(
        workflowId
      )}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${viewToken}`
        },
        cache: "no-store"
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: "orchestration_view_unavailable",
        message: "The orchestration view is not available right now."
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

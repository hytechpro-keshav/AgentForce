import { NextRequest, NextResponse } from "next/server";

import { CASE_ID_PATTERN } from "@/lib/orchestration";

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

export async function GET(
  _request: NextRequest,
  context: { params: { caseId: string } }
): Promise<NextResponse> {
  const { caseId } = context.params;
  if (!CASE_ID_PATTERN.test(caseId)) {
    return NextResponse.json({ error: "invalid_case_id" }, { status: 400 });
  }

  const viewToken = process.env.AI_API_ORCHESTRATOR_VIEW_TOKEN?.trim();
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
      `${aiApiBaseUrl()}/orchestrator/case-triage/cases/${encodeURIComponent(
        caseId
      )}/latest`,
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

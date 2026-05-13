import { NextRequest, NextResponse } from "next/server";

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
 * Proxies escalation requests to the NestJS AI API. The escalation
 * DTO is preserved exactly: reason, urgency, conversationSummary,
 * caseReference, locale, requestId.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in to request support." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${aiApiBaseUrl()}/chat/escalate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      {
        error: "network_error",
        message:
          "Could not reach the chat service. Please check your connection."
      },
      { status: 502 }
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

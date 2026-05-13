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
 * Proxies the customer-chat login request to the NestJS AI API.
 *
 * The access code is forwarded to the AI API which validates it
 * server-side and mints a short-lived `chat:write` JWT. The Next.js
 * server never logs the access code, never stores the JWT, and
 * never holds vendor SDK secrets.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
    upstream = await fetch(`${aiApiBaseUrl()}/auth/customer-chat/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for":
          request.headers.get("x-forwarded-for") ??
          request.headers.get("x-real-ip") ??
          ""
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      {
        error: "customer_chat_login_unavailable",
        message:
          "Chat login is not available right now. Please try again later."
      },
      { status: 503 }
    );
  }

  const text = await upstream.text();
  const headers: Record<string, string> = {
    "content-type": upstream.headers.get("content-type") ?? "application/json"
  };
  return new NextResponse(text, { status: upstream.status, headers });
}

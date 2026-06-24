import { NextRequest, NextResponse } from "next/server";

import {
  attachOperatorSessionCookie
} from "@/lib/orchestrator-operator-session";

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
 * RC-8a (Node 6 6c) — operator console login (BFF). Exchanges the operator
 * access code at the ai-api for a short-TTL read+control JWT, then stores it as
 * an httpOnly cookie so the Stop-AI proxy can attach it server-side. The token
 * never reaches client JS; the approval scope is never minted (Stop AI is not
 * approve/reject).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let accessCode: string | undefined;
  try {
    const body = (await request.json()) as { accessCode?: unknown };
    if (typeof body?.accessCode === "string") {
      accessCode = body.accessCode;
    }
  } catch {
    // fall through to the missing-code response
  }
  if (!accessCode || !accessCode.trim()) {
    return NextResponse.json(
      { error: "access_code_required" },
      { status: 400 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${aiApiBaseUrl()}/auth/operator-orchestration/session`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ accessCode }),
        cache: "no-store"
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: "operator_login_unavailable",
        message: "Operator login is not available right now."
      },
      { status: 503 }
    );
  }

  if (!upstream.ok) {
    // Pass through auth / unavailable; collapse everything else to 502. The
    // upstream error body (and any token) is never forwarded to the browser.
    const status =
      upstream.status === 401 ? 401 : upstream.status === 503 ? 503 : 502;
    return NextResponse.json({ error: "operator_login_failed" }, { status });
  }

  const data = (await upstream.json()) as {
    accessToken?: string;
    expiresInSeconds?: number;
    expiresAt?: string;
  };
  if (!data.accessToken) {
    return NextResponse.json(
      { error: "operator_login_failed" },
      { status: 502 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    expiresAt: data.expiresAt ?? null
  });
  attachOperatorSessionCookie(response, {
    accessToken: data.accessToken,
    maxAge:
      typeof data.expiresInSeconds === "number" && data.expiresInSeconds > 0
        ? data.expiresInSeconds
        : 3600
  });
  return response;
}

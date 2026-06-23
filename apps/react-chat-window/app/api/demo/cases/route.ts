import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = Number(
  process.env.DEMO_CASE_CREATE_RATE_LIMIT_WINDOW_MS ?? "60000"
);
const RATE_LIMIT_MAX_REQUESTS = Number(
  process.env.DEMO_CASE_CREATE_RATE_LIMIT_MAX_REQUESTS ?? "10"
);

const requestLog = new Map<string, number[]>();

function aiApiBaseUrl(): string {
  const url = process.env.AI_API_BASE_URL?.trim();
  if (!url) {
    throw new Error(
      "AI_API_BASE_URL is not configured on the react-chat-window service."
    );
  }
  return url.replace(/\/+$/, "");
}

function isFeatureEnabled(): boolean {
  return process.env.DEMO_CASE_CREATE_ENABLED?.trim() === "true";
}

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(key) ?? []).filter((ts) => ts > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isFeatureEnabled()) {
    return NextResponse.json(
      {
        error: "demo_create_disabled",
        message: "Demo Case create is disabled on this deployment."
      },
      { status: 403 }
    );
  }

  const createToken = process.env.AI_API_DEMO_CASE_CREATE_TOKEN?.trim();
  if (!createToken) {
    return NextResponse.json(
      {
        error: "demo_create_unavailable",
        message: "Demo Case create is not configured."
      },
      { status: 503 }
    );
  }

  const key = clientKey(request);
  if (isRateLimited(key)) {
    return NextResponse.json(
      {
        error: "demo_create_rate_limited",
        message: "Too many demo Case create requests. Try again shortly."
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Request body must be JSON." },
      { status: 400 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${aiApiBaseUrl()}/demo/cases`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${createToken}`
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      {
        error: "demo_create_unavailable",
        message: "Demo Case create is not available right now."
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

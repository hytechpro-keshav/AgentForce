import { NextRequest, NextResponse } from "next/server";

/**
 * Shared BFF helpers for the customer-intake proxy routes. The Next.js server
 * holds no vendor/Salesforce secrets and never mints tokens — it only relays
 * the customer's request (and, for authenticated routes, their bearer token)
 * to the NestJS AI API, returning the upstream body verbatim.
 */
export function intakeEnabled(): boolean {
  return process.env.CUSTOMER_INTAKE_ENABLED === "true";
}

export function intakeEmailVerificationEnabled(): boolean {
  return process.env.CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION !== "true";
}

function aiApiBaseUrl(): string {
  const url = process.env.AI_API_BASE_URL?.trim();
  if (!url) {
    throw new Error(
      "AI_API_BASE_URL is not configured on the react-chat-window service."
    );
  }
  return url.replace(/\/+$/, "");
}

export function disabledResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "customer_intake_unavailable",
      message: "Customer intake is not available."
    },
    { status: 404 }
  );
}

export function clientForwardedFor(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    ""
  );
}

/** Returns the full `Authorization` header when it is a bearer token, else null. */
export function bearerHeader(request: NextRequest): string | null {
  const raw = request.headers.get("authorization");
  if (!raw) {
    return null;
  }
  const [scheme, token] = raw.split(" ");
  if (!token || scheme?.toLowerCase() !== "bearer") {
    return null;
  }
  return raw;
}

interface ProxyInit {
  method: "GET" | "POST";
  authorization?: string;
  forwardedFor?: string;
  body?: string;
}

export async function proxyIntake(
  path: string,
  init: ProxyInit
): Promise<NextResponse> {
  let upstream: Response;
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (init.authorization) {
      headers["authorization"] = init.authorization;
    }
    if (init.forwardedFor) {
      headers["x-forwarded-for"] = init.forwardedFor;
    }
    upstream = await fetch(`${aiApiBaseUrl()}${path}`, {
      method: init.method,
      headers,
      body: init.body,
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      {
        error: "customer_intake_unavailable",
        message:
          "Customer intake is not available right now. Please try again later."
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

export async function readJsonBody(
  request: NextRequest
): Promise<{ body: string } | { error: NextResponse }> {
  try {
    const parsed = await request.json();
    return { body: JSON.stringify(parsed) };
  } catch {
    return {
      error: NextResponse.json(
        { error: "invalid_json", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    };
  }
}

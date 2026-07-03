import { NextRequest, NextResponse } from "next/server";

import {
  attachOperatorSessionCookie,
  mintOperatorSessionFromDemoToken,
  mintOperatorSessionFromEnv
} from "@/lib/orchestrator-operator-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Salesforce CaseNumber is always digits (e.g. "00001079"). */
const CASE_NUMBER_PATTERN = /^\d{1,20}$/;

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

function demoToken(): string | null {
  return process.env.AI_API_DEMO_CASE_CREATE_TOKEN?.trim() || null;
}

/**
 * Activate the stepped orchestrator for an existing Salesforce Case given its
 * human-readable CaseNumber (e.g. "00001079"). Resolves the 18-char record Id
 * from Salesforce, mints an operator session, and triggers the stepped workflow
 * — identical to the activate flow after demo case creation.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isFeatureEnabled()) {
    return NextResponse.json(
      {
        error: "demo_activate_disabled",
        message: "Demo activation is disabled on this deployment."
      },
      { status: 403 }
    );
  }

  const token = demoToken();
  if (!token) {
    return NextResponse.json(
      {
        error: "demo_activate_unavailable",
        message: "Demo activation is not configured."
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    body =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Request body must be JSON." },
      { status: 400 }
    );
  }

  const caseNumber =
    typeof body.caseNumber === "string" ? body.caseNumber.trim() : "";
  if (!caseNumber || !CASE_NUMBER_PATTERN.test(caseNumber)) {
    return NextResponse.json(
      {
        error: "invalid_case_number",
        message: "Provide a numeric Salesforce Case Number (e.g. 00001079)."
      },
      { status: 400 }
    );
  }

  // Step 1 — resolve CaseNumber → Salesforce record Id
  let lookupRes: Response;
  try {
    lookupRes = await fetch(
      `${aiApiBaseUrl()}/demo/cases/by-number/${encodeURIComponent(caseNumber)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`
        },
        cache: "no-store"
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: "lookup_unavailable",
        message: "Case lookup is not available right now."
      },
      { status: 503 }
    );
  }

  if (!lookupRes.ok) {
    const text = await lookupRes.text();
    return new NextResponse(text, {
      status: lookupRes.status,
      headers: {
        "content-type": lookupRes.headers.get("content-type") ?? "application/json"
      }
    });
  }

  const lookup = (await lookupRes.json()) as {
    caseId: string;
    caseNumber: string;
  };
  const { caseId, caseNumber: resolvedNumber } = lookup;

  // Step 2 — mint an operator session
  const session =
    (await mintOperatorSessionFromDemoToken()) ??
    (await mintOperatorSessionFromEnv());
  if (!session) {
    return NextResponse.json(
      {
        error: "session_unavailable",
        message: "Cannot mint an operator session."
      },
      { status: 503 }
    );
  }

  // Step 3 — trigger the stepped orchestrator
  let steppedRes: Response;
  try {
    steppedRes = await fetch(
      `${aiApiBaseUrl()}/orchestrator/case-triage/cases/${encodeURIComponent(
        caseId
      )}/stepped`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({ caseId, caseNumber: resolvedNumber }),
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

  const text = await steppedRes.text();

  if (!steppedRes.ok) {
    return new NextResponse(text, {
      status: steppedRes.status,
      headers: {
        "content-type": steppedRes.headers.get("content-type") ?? "application/json"
      }
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new NextResponse(text, {
      status: steppedRes.status,
      headers: {
        "content-type": steppedRes.headers.get("content-type") ?? "application/json"
      }
    });
  }

  const response = NextResponse.json(payload, { status: steppedRes.status });
  attachOperatorSessionCookie(response, session);
  return response;
}

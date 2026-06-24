import type { NextResponse } from "next/server";

/** httpOnly cookie holding the operator session JWT (read + control + step). */
export const ORCHESTRATOR_SESSION_COOKIE = "orchestrator_session";

export interface OperatorSessionMint {
  accessToken: string;
  maxAge: number;
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

/**
 * Mint an operator orchestration JWT using the server-only access code.
 * Used by the operator login BFF when no demo token is available.
 */
export async function mintOperatorSessionFromEnv(): Promise<OperatorSessionMint | null> {
  const accessCode = process.env.ORCHESTRATOR_OPERATOR_ACCESS_CODE?.trim();
  if (!accessCode) {
    return null;
  }

  try {
    const upstream = await fetch(
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
    if (!upstream.ok) {
      return null;
    }

    const data = (await upstream.json()) as {
      accessToken?: string;
      expiresInSeconds?: number;
    };
    if (!data.accessToken) {
      return null;
    }

    return {
      accessToken: data.accessToken,
      maxAge:
        typeof data.expiresInSeconds === "number" && data.expiresInSeconds > 0
          ? data.expiresInSeconds
          : 3600
    };
  } catch {
    return null;
  }
}

/**
 * Mint an operator session using the existing demo Case create bearer. This
 * avoids duplicating ORCHESTRATOR_OPERATOR_ACCESS_CODE on react-chat-window.
 */
export async function mintOperatorSessionFromDemoToken(): Promise<OperatorSessionMint | null> {
  const token = process.env.AI_API_DEMO_CASE_CREATE_TOKEN?.trim();
  if (!token) {
    return null;
  }

  try {
    const upstream = await fetch(
      `${aiApiBaseUrl()}/demo/orchestration-session`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`
        },
        cache: "no-store"
      }
    );
    if (!upstream.ok) {
      return null;
    }

    const data = (await upstream.json()) as {
      accessToken?: string;
      expiresInSeconds?: number;
    };
    if (!data.accessToken) {
      return null;
    }

    return {
      accessToken: data.accessToken,
      maxAge:
        typeof data.expiresInSeconds === "number" && data.expiresInSeconds > 0
          ? data.expiresInSeconds
          : 3600
    };
  } catch {
    return null;
  }
}

/** Start a stepped orchestration run for a Case (Phase 2). */
export async function triggerSteppedRun(
  caseId: string,
  bearer: string
): Promise<{ workflowId: string } | null> {
  try {
    const upstream = await fetch(
      `${aiApiBaseUrl()}/orchestrator/case-triage/cases/${encodeURIComponent(
        caseId
      )}/stepped`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`
        },
        body: JSON.stringify({ caseId }),
        cache: "no-store"
      }
    );
    if (!upstream.ok) {
      return null;
    }
    const data = (await upstream.json()) as { workflowId?: string };
    return data.workflowId ? { workflowId: data.workflowId } : null;
  } catch {
    return null;
  }
}

export function attachOperatorSessionCookie(
  response: NextResponse,
  session: OperatorSessionMint
): void {
  response.cookies.set(ORCHESTRATOR_SESSION_COOKIE, session.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge
  });
}

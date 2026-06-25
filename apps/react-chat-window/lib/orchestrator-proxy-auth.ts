import type { NextRequest } from "next/server";

import { ORCHESTRATOR_SESSION_COOKIE } from "@/lib/orchestrator-operator-session";

/**
 * Server-only bearer for orchestrator read proxies (static view JWT).
 * Demo Case create uses a separate token with `demo-case-create` scope only.
 */
export function resolveOrchestratorViewToken(): string | undefined {
  return process.env.AI_API_ORCHESTRATOR_VIEW_TOKEN?.trim() || undefined;
}

/**
 * Bearer for orchestrator read proxies. Prefers the operator session cookie
 * (minted by demo create or manual login; carries `orchestrator-read`), then
 * the static view token. Never uses the demo Case create token — it lacks read
 * scope and upstream answers 401.
 */
export function resolveOrchestratorReadBearer(
  request: NextRequest
): string | undefined {
  const session = request.cookies
    .get(ORCHESTRATOR_SESSION_COOKIE)
    ?.value?.trim();
  if (session) {
    return session;
  }
  return resolveOrchestratorViewToken();
}

/**
 * Server-only bearer for orchestrator read proxies.
 * Prefers the dedicated view JWT; falls back to the demo Case create token
 * so /demo/case-create → /orchestration works without a separate mint step.
 */
export function resolveOrchestratorViewToken(): string | undefined {
  const viewToken = process.env.AI_API_ORCHESTRATOR_VIEW_TOKEN?.trim();
  if (viewToken) {
    return viewToken;
  }
  return process.env.AI_API_DEMO_CASE_CREATE_TOKEN?.trim() || undefined;
}

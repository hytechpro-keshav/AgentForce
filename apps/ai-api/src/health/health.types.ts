export type HealthStatus = "ok" | "degraded";
export type DeferredPhase = "phase-2" | "phase-4" | "phase-5" | "phase-6";

export interface HealthLivenessResponse {
  status: "ok";
}

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  details?: string;
}

export interface HealthServiceContext {
  name: "ai-api";
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
}

export interface SalesforceBridgeContext {
  phase: "phase-1-external-bridge";
  namedCredential: "Agentforce_AI_API";
  apexAction: "AgentforceAiApiHealthCheck";
  endpoint: "/health";
}

export interface DeferredCapabilityContext {
  providerRouting: DeferredPhase;
  rag: DeferredPhase;
  openWebUi: DeferredPhase;
  reactChat: DeferredPhase;
}

export interface HealthContextResponse {
  status: HealthStatus;
  service: HealthServiceContext;
  salesforceBridge: SalesforceBridgeContext;
  deferredCapabilities: DeferredCapabilityContext;
  checks: HealthCheckResult[];
}

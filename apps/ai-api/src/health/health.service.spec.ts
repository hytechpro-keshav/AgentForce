import { HealthService } from "./health.service";
import type { AppConfigService } from "../config/app-config.service";

describe("HealthService", () => {
  it("returns the Phase 1 bridge health contract", () => {
    const response = new HealthService({
      isHealthBridgeKeyConfigured: true,
      nodeEnv: "test"
    } as AppConfigService).getHealth();

    expect(response.status).toBe("ok");
    expect(response.service.name).toBe("ai-api");
    expect(response.salesforceBridge).toEqual({
      phase: "phase-1-external-bridge",
      namedCredential: "Agentforce_AI_API",
      apexAction: "AgentforceAiApiHealthCheck",
      endpoint: "/health"
    });
    expect(response.deferredCapabilities).toEqual({
      providerRouting: "phase-2",
      rag: "phase-4",
      openWebUi: "phase-5",
      reactChat: "phase-6"
    });
    expect(response.checks).toContainEqual({
      name: "phase-1-configuration",
      status: "ok",
      details: "Phase 1 health bridge authentication is configured."
    });
  });

  it("returns a minimal liveness response", () => {
    const response = new HealthService({} as AppConfigService).getLiveness();

    expect(response).toEqual({ status: "ok" });
  });

  it("reports degraded configuration when the bridge key is missing", () => {
    const response = new HealthService({
      isHealthBridgeKeyConfigured: false,
      nodeEnv: "test"
    } as AppConfigService).getHealth();

    expect(response.status).toBe("degraded");
    expect(response.checks).toContainEqual({
      name: "phase-1-configuration",
      status: "degraded",
      details:
        "Phase 1 health bridge authentication is not configured for this non-production runtime."
    });
  });
});

import { AppConfigService } from "./app-config.service";

describe("AppConfigService", () => {
  it("defaults local development to port 3000", () => {
    expect(AppConfigService.load({}).port).toBe(3000);
  });

  it("normalizes blank health keys as missing", () => {
    const config = AppConfigService.load({ AGENTFORCE_HEALTH_API_KEY: "  " });

    expect(config.agentforceHealthApiKey).toBeUndefined();
  });

  it("rejects invalid ports", () => {
    expect(() => AppConfigService.load({ PORT: "not-a-port" })).toThrow(
      "PORT must be an integer from 1 to 65535."
    );
  });

  it("requires the health key for production-like deployments", () => {
    expect(() => AppConfigService.load({ NODE_ENV: "production" })).toThrow(
      "AGENTFORCE_HEALTH_API_KEY is required"
    );
    expect(() =>
      AppConfigService.load({ RAILWAY_ENVIRONMENT: "production" })
    ).toThrow("AGENTFORCE_HEALTH_API_KEY is required");
  });
});

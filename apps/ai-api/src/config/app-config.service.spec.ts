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

  it("loads OpenAI provider config when OPENAI_API_KEY is present", () => {
    const config = AppConfigService.load({
      OPENAI_API_KEY: "sk-test",
      OPENAI_DEFAULT_MODEL: "gpt-4o-mini"
    });
    expect(config.openAi).toEqual({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini"
    });
  });

  it("loads the OpenAI-compatible provider config when a base URL is present", () => {
    const config = AppConfigService.load({
      OPENAI_COMPAT_BASE_URL: "https://internal.test/v1",
      OPENAI_COMPAT_DEFAULT_MODEL: "local-llm"
    });
    expect(config.openAiCompatible).toEqual({
      apiKey: undefined,
      baseUrl: "https://internal.test/v1",
      defaultModel: "local-llm"
    });
  });

  it("requires the OpenAI key when openai is default in production-like deployments", () => {
    expect(() =>
      AppConfigService.load({
        NODE_ENV: "production",
        AGENTFORCE_HEALTH_API_KEY: "x",
        LLM_DEFAULT_PROVIDER: "openai"
      })
    ).toThrow("OPENAI_API_KEY is required");
  });

  it("allows Phase 1 health-only startup when Phase 2 provider config is absent", () => {
    const config = AppConfigService.load({
      NODE_ENV: "production",
      AGENTFORCE_HEALTH_API_KEY: "x"
    });

    expect(config.openAi).toBeUndefined();
    expect(config.jwt.secret).toBeUndefined();
    expect(config.defaultProvider).toBe("openai");
  });

  it("loads AI_API_JWT_SECRET when configured for protected Phase 2 routes", () => {
    const config = AppConfigService.load({
      NODE_ENV: "production",
      AGENTFORCE_HEALTH_API_KEY: "x",
      OPENAI_API_KEY: "sk",
      AI_API_JWT_SECRET: "jwt-secret"
    });

    expect(config.jwt.secret).toBe("jwt-secret");
    expect(config.jwt.disabled).toBe(false);
  });
});

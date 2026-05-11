import { TelemetryService } from "./telemetry.service";
import type { AppConfigService } from "../config/app-config.service";

function getLogger(service: TelemetryService): {
  log: (value: unknown) => void;
} {
  return (service as unknown as { logger: { log: (value: unknown) => void } })
    .logger;
}

describe("TelemetryService", () => {
  it("emits token and cost references for known priced models", () => {
    const service = new TelemetryService({
      telemetryEnabled: true
    } as AppConfigService);
    const logSpy = jest
      .spyOn(getLogger(service), "log")
      .mockImplementation(() => undefined);

    service.recordChatCompletion({
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 2773,
      inputTokens: 177,
      outputTokens: 36,
      totalTokens: 213,
      requestId: "sf-triage-1778511959312-0",
      fallbackUsed: false,
      attemptedProviders: ["openai"],
      outcome: "success"
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.system": "openai",
        "gen_ai.request.model": "gpt-4o-mini",
        "gen_ai.pricing.source": "static_openai_reference_2026_05",
        "gen_ai.pricing.input_usd_per_1m_tokens": 0.15,
        "gen_ai.pricing.output_usd_per_1m_tokens": 0.6,
        "gen_ai.usage.input_cost_usd_estimate": 0.00002655,
        "gen_ai.usage.output_cost_usd_estimate": 0.0000216,
        "gen_ai.usage.total_cost_usd_estimate": 0.00004815,
        request_id: "sf-triage-1778511959312-0"
      })
    );
  });

  it("keeps core telemetry when no pricing reference exists", () => {
    const service = new TelemetryService({
      telemetryEnabled: true
    } as AppConfigService);
    const logSpy = jest
      .spyOn(getLogger(service), "log")
      .mockImplementation(() => undefined);

    service.recordChatCompletion({
      provider: "openai",
      model: "unknown-model",
      latencyMs: 10,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      fallbackUsed: false,
      attemptedProviders: ["openai"],
      outcome: "success"
    });

    const event = logSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(event["gen_ai.usage.total_tokens"]).toBe(15);
    expect(event["gen_ai.usage.total_cost_usd_estimate"]).toBeUndefined();
    expect(event["gen_ai.pricing.source"]).toBeUndefined();
  });

  it("swallows logger failures", () => {
    const service = new TelemetryService({
      telemetryEnabled: true
    } as AppConfigService);
    jest.spyOn(getLogger(service), "log").mockImplementation(() => {
      throw new Error("logger failed");
    });

    expect(() =>
      service.recordChatCompletion({
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 1,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        fallbackUsed: false,
        attemptedProviders: ["openai"],
        outcome: "success"
      })
    ).not.toThrow();
  });

  it("does nothing when telemetry is disabled", () => {
    const service = new TelemetryService({
      telemetryEnabled: false
    } as AppConfigService);
    const logSpy = jest.spyOn(getLogger(service), "log");

    service.recordChatCompletion({
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      fallbackUsed: false,
      attemptedProviders: ["openai"],
      outcome: "success"
    });

    expect(logSpy).not.toHaveBeenCalled();
  });
});

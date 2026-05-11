import { Test } from "@nestjs/testing";

import { AppConfigService } from "../config/app-config.service";
import { TelemetryService } from "../observability/telemetry.service";
import { ModelRouter, LLM_PROVIDERS } from "./model-router";
import { LlmProviderError, type LlmProvider } from "./interfaces/llm-provider";
import type {
  LlmChatRequest,
  LlmChatResponse
} from "./interfaces/llm-contracts";

function makeProvider(
  name: string,
  impl: (req: LlmChatRequest) => Promise<LlmChatResponse>
): jest.Mocked<LlmProvider> {
  return {
    name,
    listModels: jest.fn(() => [{ id: `${name}-default`, provider: name }]),
    chat: jest.fn(impl)
  } as unknown as jest.Mocked<LlmProvider>;
}

function successResponse(provider: string, content = "ok"): LlmChatResponse {
  return {
    content,
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metadata: {
      provider,
      model: `${provider}-default`,
      latencyMs: 5,
      fallbackUsed: false,
      attemptedProviders: [provider]
    }
  };
}

async function buildRouter(
  providers: LlmProvider[],
  config: Partial<AppConfigService> = {}
): Promise<{ router: ModelRouter; telemetry: TelemetryService }> {
  const telemetry = {
    recordChatCompletion: jest.fn()
  } as unknown as TelemetryService;
  const moduleRef = await Test.createTestingModule({
    providers: [
      ModelRouter,
      { provide: LLM_PROVIDERS, useValue: providers },
      {
        provide: AppConfigService,
        useValue: {
          defaultProvider: "openai",
          fallbackProvider: undefined,
          telemetryEnabled: false,
          ...config
        }
      },
      { provide: TelemetryService, useValue: telemetry }
    ]
  }).compile();
  return { router: moduleRef.get(ModelRouter), telemetry };
}

describe("ModelRouter", () => {
  it("routes to the configured default provider", async () => {
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    const { router } = await buildRouter([openai]);

    const response = await router.chat({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.metadata.provider).toBe("openai");
    expect(response.metadata.fallbackUsed).toBe(false);
    expect(response.metadata.attemptedProviders).toEqual(["openai"]);
    expect(openai.chat).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit provider override", async () => {
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    const compat = makeProvider("openai-compatible", async () =>
      successResponse("openai-compatible")
    );
    const { router } = await buildRouter([openai, compat]);

    const response = await router.chat({
      provider: "openai-compatible",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.metadata.provider).toBe("openai-compatible");
    expect(openai.chat).not.toHaveBeenCalled();
    expect(compat.chat).toHaveBeenCalledTimes(1);
  });

  it("redacts sensitive message content before calling a provider", async () => {
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    const { router } = await buildRouter([openai]);

    await router.chat({
      messages: [
        {
          role: "user",
          content:
            "Customer name is Jane Doe, email jane@example.com, phone 415-555-1212, account number ACCT-123456, address 123 Main St, outage continues."
        }
      ]
    });

    const providerRequest = openai.chat.mock.calls[0][0];
    expect(providerRequest.messages[0].content).toContain("[redacted-name]");
    expect(providerRequest.messages[0].content).toContain("[redacted-email]");
    expect(providerRequest.messages[0].content).toContain("[redacted-phone]");
    expect(providerRequest.messages[0].content).toContain(
      "[redacted-identifier]"
    );
    expect(providerRequest.messages[0].content).toContain("[redacted-address]");
    expect(providerRequest.messages[0].content).toContain("outage continues");
    expect(providerRequest.messages[0].content).not.toContain("Jane Doe");
    expect(providerRequest.messages[0].content).not.toContain(
      "jane@example.com"
    );
    expect(providerRequest.messages[0].content).not.toContain("415-555-1212");
    expect(providerRequest.messages[0].content).not.toContain("ACCT-123456");
    expect(providerRequest.messages[0].content).not.toContain("123 Main St");
  });

  it("falls back to the configured fallback when primary is fallbackable", async () => {
    const openai = makeProvider("openai", async () => {
      throw new LlmProviderError("openai", "fallbackable", "boom");
    });
    const compat = makeProvider("openai-compatible", async () =>
      successResponse("openai-compatible")
    );
    const { router, telemetry } = await buildRouter([openai, compat], {
      fallbackProvider: "openai-compatible"
    });

    const response = await router.chat({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.metadata.provider).toBe("openai-compatible");
    expect(response.metadata.fallbackUsed).toBe(true);
    expect(response.metadata.attemptedProviders).toEqual([
      "openai",
      "openai-compatible"
    ]);
    expect(telemetry.recordChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("does not fall back on non-fallbackable errors", async () => {
    const openai = makeProvider("openai", async () => {
      throw new LlmProviderError("openai", "auth", "bad key");
    });
    const compat = makeProvider("openai-compatible", async () =>
      successResponse("openai-compatible")
    );
    const { router } = await buildRouter([openai, compat], {
      fallbackProvider: "openai-compatible"
    });

    await expect(
      router.chat({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject({ name: "LlmProviderError", kind: "auth" });
    expect(compat.chat).not.toHaveBeenCalled();
  });

  it("rejects when no providers are configured", async () => {
    const { router } = await buildRouter([]);
    await expect(
      router.chat({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject({
      name: "LlmProviderError",
      kind: "validation"
    });
  });

  it("rejects an explicit unknown provider with no fallback", async () => {
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    const { router } = await buildRouter([openai]);
    await expect(
      router.chat({
        provider: "anthropic",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("reports token usage in telemetry on success", async () => {
    const openai = makeProvider("openai", async () => ({
      content: "ok",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      metadata: {
        provider: "openai",
        model: "gpt-test",
        latencyMs: 42,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    }));
    const { router, telemetry } = await buildRouter([openai]);

    await router.chat({
      messages: [{ role: "user", content: "hi" }],
      requestId: "req-1"
    });

    expect(telemetry.recordChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-test",
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7,
        latencyMs: 42,
        requestId: "req-1",
        outcome: "success",
        fallbackUsed: false
      })
    );
  });
});

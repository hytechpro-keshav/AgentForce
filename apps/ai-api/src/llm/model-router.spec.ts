import { Test } from "@nestjs/testing";

import { AppConfigService } from "../config/app-config.service";
import { TelemetryService } from "../observability/telemetry.service";
import { ModelRoutingPolicyService } from "./model-routing-policy.service";
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

function successResponse(
  provider: string,
  content = "ok",
  model = `${provider}-default`
): LlmChatResponse {
  return {
    content,
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metadata: {
      provider,
      model,
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
  const env: NodeJS.ProcessEnv = {};
  if (config.defaultProvider) {
    env.LLM_DEFAULT_PROVIDER = config.defaultProvider;
  }
  if (config.fallbackProvider) {
    env.LLM_FALLBACK_PROVIDER = config.fallbackProvider;
  }
  const appConfig = {
    ...AppConfigService.load(env),
    ...config
  } as AppConfigService;
  const moduleRef = await Test.createTestingModule({
    providers: [
      ModelRoutingPolicyService,
      ModelRouter,
      { provide: LLM_PROVIDERS, useValue: providers },
      {
        provide: AppConfigService,
        useValue: appConfig
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

  it("reports fallback usage when the fallback provider also fails", async () => {
    const openai = makeProvider("openai", async () => {
      throw new LlmProviderError("openai", "fallbackable", "try another");
    });
    const compat = makeProvider("openai-compatible", async () => {
      throw new LlmProviderError("openai-compatible", "auth", "bad key");
    });
    const { router, telemetry } = await buildRouter([openai, compat], {
      fallbackProvider: "openai-compatible"
    });

    await expect(
      router.chat({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject({ provider: "openai-compatible", kind: "auth" });

    expect(telemetry.recordChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-compatible",
        fallbackUsed: true,
        attemptedProviders: ["openai", "openai-compatible"],
        outcome: "error",
        errorKind: "auth"
      })
    );
  });

  it("routes by use case through configured provider and model policy", async () => {
    const routingConfig = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          agentforce_case_analysis: {
            provider: "anthropic",
            model: "claude-route",
            fallbacks: [{ provider: "openai", model: "gpt-fallback" }]
          }
        }
      })
    }).modelRouting;
    const openai = makeProvider("openai", async (request) =>
      successResponse("openai", "ok", request.model)
    );
    const anthropic = makeProvider("anthropic", async (request) =>
      successResponse("anthropic", "ok", request.model)
    );
    const { router } = await buildRouter([openai, anthropic], {
      modelRouting: routingConfig
    });

    const response = await router.chat({
      useCase: "agentforce_case_analysis",
      messages: [{ role: "user", content: "summarize case" }]
    });

    expect(response.metadata.provider).toBe("anthropic");
    expect(response.metadata.model).toBe("claude-route");
    expect(response.metadata.useCase).toBe("agentforce_case_analysis");
    expect(response.metadata.routingRule).toBe(
      "agentforce_case_analysis:default"
    );
    expect(anthropic.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-route" })
    );
    expect(openai.chat).not.toHaveBeenCalled();
  });

  it("routes simple requests to the configured small model", async () => {
    const routingConfig = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          customer_chat: {
            provider: "openai",
            model: "gpt-large",
            smallModel: {
              provider: "openai",
              model: "gpt-small",
              maxInputTokens: 100,
              maxMessages: 4
            }
          }
        }
      })
    }).modelRouting;
    const openai = makeProvider("openai", async (request) =>
      successResponse("openai", "ok", request.model)
    );
    const { router } = await buildRouter([openai], {
      modelRouting: routingConfig
    });

    const response = await router.chat({
      useCase: "customer_chat",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.metadata.model).toBe("gpt-small");
    expect(response.metadata.modelTier).toBe("small");
    expect(openai.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-small" })
    );
  });

  it("rejects budget exhaustion without trying fallback providers", async () => {
    const routingConfig = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          customer_chat: {
            provider: "openai",
            fallbacks: [{ provider: "openai-compatible" }],
            budget: { maxInputTokensPerRequest: 1 }
          }
        }
      })
    }).modelRouting;
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    const compat = makeProvider("openai-compatible", async () =>
      successResponse("openai-compatible")
    );
    const { router, telemetry } = await buildRouter([openai, compat], {
      modelRouting: routingConfig
    });

    await expect(
      router.chat({
        useCase: "customer_chat",
        messages: [{ role: "user", content: "this is too long" }]
      })
    ).rejects.toMatchObject({ kind: "budget" });

    expect(openai.chat).not.toHaveBeenCalled();
    expect(compat.chat).not.toHaveBeenCalled();
    expect(telemetry.recordChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "model-router",
        useCase: "customer_chat",
        budgetOutcome: "rejected",
        outcome: "error",
        errorKind: "budget"
      })
    );
  });

  it("records route details when minute budget reservation is rejected", async () => {
    const routingConfig = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          customer_chat: {
            provider: "openai",
            model: "gpt-route",
            budget: {
              maxTokensPerMinute: 5,
              maxOutputTokensPerRequest: 4
            }
          }
        }
      })
    }).modelRouting;
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    const { router, telemetry } = await buildRouter([openai], {
      modelRouting: routingConfig
    });

    await expect(
      router.chat({
        useCase: "customer_chat",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toMatchObject({ provider: "model-router", kind: "budget" });

    expect(openai.chat).not.toHaveBeenCalled();
    expect(telemetry.recordChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "model-router",
        model: "gpt-route",
        useCase: "customer_chat",
        routingRule: "customer_chat:default",
        modelTier: "default",
        budgetOutcome: "rejected",
        outcome: "error",
        errorKind: "budget",
        estimatedInputTokens: expect.any(Number),
        reservedTokens: expect.any(Number),
        budgetKey: expect.any(String)
      })
    );
  });

  it("does not skip a missing primary provider to use fallback", async () => {
    const routingConfig = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          openwebui_rag: {
            provider: "gemini",
            fallbacks: [{ provider: "openai" }]
          }
        }
      })
    }).modelRouting;
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    const { router, telemetry } = await buildRouter([openai], {
      modelRouting: routingConfig
    });

    await expect(
      router.chat({
        useCase: "openwebui_rag",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toMatchObject({ provider: "gemini", kind: "validation" });
    expect(openai.chat).not.toHaveBeenCalled();
    expect(telemetry.recordChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gemini",
        useCase: "openwebui_rag",
        routingRule: "openwebui_rag:default",
        modelTier: "default",
        outcome: "error",
        errorKind: "validation"
      })
    );
  });

  it("does not silently skip a non-streaming primary provider", async () => {
    const routingConfig = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          customer_chat: {
            provider: "anthropic",
            fallbacks: [{ provider: "openai" }]
          }
        }
      })
    }).modelRouting;
    const anthropic = makeProvider("anthropic", async () =>
      successResponse("anthropic")
    );
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    openai.chatStream = jest.fn(async function* () {
      yield { kind: "text" as const, delta: "ok" };
    });
    const { router } = await buildRouter([anthropic, openai], {
      modelRouting: routingConfig
    });

    await expect(
      (async () => {
        for await (const _chunk of router.chatStream({
          useCase: "customer_chat",
          messages: [{ role: "user", content: "hi" }]
        })) {
          // drain
        }
      })()
    ).rejects.toMatchObject({ provider: "anthropic", kind: "validation" });
    expect(openai.chatStream).not.toHaveBeenCalled();
  });

  it("validates streaming providers before reserving minute budget", async () => {
    const routingConfig = AppConfigService.load({
      MODEL_ROUTING_CONFIG_JSON: JSON.stringify({
        routes: {
          customer_chat: {
            provider: "anthropic",
            budget: {
              maxTokensPerMinute: 9,
              maxOutputTokensPerRequest: 4
            }
          }
        }
      })
    }).modelRouting;
    const anthropic = makeProvider("anthropic", async () =>
      successResponse("anthropic")
    );
    const { router } = await buildRouter([anthropic], {
      modelRouting: routingConfig
    });

    await expect(
      (async () => {
        for await (const _chunk of router.chatStream({
          useCase: "customer_chat",
          messages: [{ role: "user", content: "hi" }]
        })) {
          // drain
        }
      })()
    ).rejects.toMatchObject({ provider: "anthropic", kind: "validation" });

    anthropic.chatStream = jest.fn(async function* () {
      yield {
        kind: "done" as const,
        finishReason: "stop" as const,
        usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 },
        metadata: {
          provider: "anthropic",
          model: "anthropic-default",
          latencyMs: 10,
          fallbackUsed: false,
          attemptedProviders: ["anthropic"]
        }
      };
    });

    const chunks: unknown[] = [];
    for await (const chunk of router.chatStream({
      useCase: "customer_chat",
      messages: [{ role: "user", content: "hi" }]
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([expect.objectContaining({ kind: "done" })]);
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

  it("records telemetry when a streaming response is abandoned", async () => {
    const openai = makeProvider("openai", async () =>
      successResponse("openai")
    );
    openai.chatStream = jest.fn(async function* () {
      yield { kind: "text" as const, delta: "partial" };
      yield {
        kind: "done" as const,
        finishReason: "stop" as const,
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        metadata: {
          provider: "openai",
          model: "gpt-stream",
          latencyMs: 25,
          fallbackUsed: false,
          attemptedProviders: ["openai"]
        }
      };
    });
    const { router, telemetry } = await buildRouter([openai]);

    const iterator = router
      .chatStream({
        messages: [{ role: "user", content: "hi" }],
        requestId: "stream-1"
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: "text", delta: "partial" },
      done: false
    });
    await iterator.return?.();

    expect(telemetry.recordChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        requestId: "stream-1",
        budgetOutcome: "allowed",
        outcome: "error",
        errorKind: "aborted"
      })
    );
  });
});

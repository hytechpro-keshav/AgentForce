import { OpenAiCompletionsProvider } from "./openai-completions.provider";
import { LlmProviderError } from "../interfaces/llm-provider";

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("OpenAiCompletionsProvider", () => {
  it("normalizes provider responses into shared contracts", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse({
        id: "chatcmpl-1",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "hello world" }
          }
        ],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 6,
          total_tokens: 10
        }
      })
    );

    const provider = new OpenAiCompletionsProvider({
      name: "openai",
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      defaultModel: "gpt-test",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    const response = await provider.chat({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.content).toBe("hello world");
    expect(response.usage).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10
    });
    expect(response.metadata.provider).toBe("openai");
    expect(response.metadata.model).toBe("gpt-test");
    expect(response.metadata.responseId).toBe("chatcmpl-1");
    expect(response.metadata.fallbackUsed).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toBe("https://example.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sk-test");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("classifies HTTP 401 as an auth error (not fallbackable)", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse({ error: "bad key" }, 401)
    );
    const provider = new OpenAiCompletionsProvider({
      name: "openai",
      apiKey: "sk-bad",
      baseUrl: "https://example.test/v1",
      defaultModel: "gpt-test",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject({
      name: "LlmProviderError",
      kind: "auth"
    });
  });

  it("classifies HTTP 500 as fallbackable", async () => {
    const fetchMock = jest.fn(async () => makeResponse({ error: "oops" }, 500));
    const provider = new OpenAiCompletionsProvider({
      name: "openai-compatible",
      apiKey: undefined,
      baseUrl: "https://example.test/v1",
      defaultModel: "local-default",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    try {
      await provider.chat({
        messages: [{ role: "user", content: "hi" }]
      });
      fail("expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      const error = err as LlmProviderError;
      expect(error.kind).toBe("fallbackable");
      expect(error.isFallbackable).toBe(true);
    }
  });

  it("omits Authorization header when no API key is configured", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse({
        choices: [{ message: { content: "ok" } }],
        usage: {}
      })
    );
    const provider = new OpenAiCompletionsProvider({
      name: "openai-compatible",
      baseUrl: "https://compat.test/v1",
      defaultModel: "local-default",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    await provider.chat({ messages: [{ role: "user", content: "hi" }] });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
  });

  it("supports Azure OpenAI deployment URLs and api-key auth", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse({
        id: "azure-chat-1",
        choices: [{ message: { content: "azure ok" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
      })
    );
    const provider = new OpenAiCompletionsProvider({
      name: "azure-openai",
      apiKey: "azure-key",
      baseUrl: "https://azure-openai.test",
      defaultModel: "support-deployment",
      authHeader: "api-key",
      chatCompletionsPath:
        "/openai/deployments/support-deployment/chat/completions",
      queryParams: { "api-version": "2024-10-21" },
      includeModelInBody: false,
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    const response = await provider.chat({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.metadata.provider).toBe("azure-openai");
    expect(response.metadata.model).toBe("support-deployment");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toBe(
      "https://azure-openai.test/openai/deployments/support-deployment/chat/completions?api-version=2024-10-21"
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("azure-key");
    expect(headers["authorization"]).toBeUndefined();
    expect(JSON.parse(init.body as string)).not.toHaveProperty("model");
  });
});

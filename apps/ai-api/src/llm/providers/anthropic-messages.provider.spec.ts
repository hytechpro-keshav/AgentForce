import { AnthropicMessagesProvider } from "./anthropic-messages.provider";

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("AnthropicMessagesProvider", () => {
  it("normalizes Anthropic messages responses into shared contracts", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse({
        id: "msg_1",
        content: [{ type: "text", text: "hello from claude" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 7, output_tokens: 11 }
      })
    );
    const provider = new AnthropicMessagesProvider({
      apiKey: "anthropic-key",
      baseUrl: "https://anthropic.test/v1",
      defaultModel: "claude-test",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    const response = await provider.chat({
      messages: [
        { role: "system", content: "Be terse" },
        { role: "user", content: "hi" }
      ],
      maxTokens: 64
    });

    expect(response).toMatchObject({
      content: "hello from claude",
      finishReason: "end_turn",
      usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
      metadata: { provider: "anthropic", model: "claude-test" }
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toBe("https://anthropic.test/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("anthropic-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "claude-test",
      max_tokens: 64,
      system: "Be terse",
      messages: [{ role: "user", content: "hi" }]
    });
  });

  it("classifies auth failures as non-fallbackable", async () => {
    const fetchMock = jest.fn(async () => makeResponse({ error: "bad" }, 401));
    const provider = new AnthropicMessagesProvider({
      apiKey: "bad-key",
      baseUrl: "https://anthropic.test/v1",
      defaultModel: "claude-test",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject({ kind: "auth", isFallbackable: false });
  });
});

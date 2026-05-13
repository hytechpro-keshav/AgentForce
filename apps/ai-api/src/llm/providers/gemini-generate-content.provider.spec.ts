import { GeminiGenerateContentProvider } from "./gemini-generate-content.provider";

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("GeminiGenerateContentProvider", () => {
  it("normalizes Gemini generateContent responses into shared contracts", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse({
        responseId: "gemini-1",
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "hello from gemini" }] }
          }
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 9,
          totalTokenCount: 14
        }
      })
    );
    const provider = new GeminiGenerateContentProvider({
      apiKey: "gemini-key",
      baseUrl: "https://gemini.test/v1beta",
      defaultModel: "gemini-test",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    const response = await provider.chat({
      messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "hi" }
      ],
      temperature: 0.2,
      maxTokens: 128
    });

    expect(response).toMatchObject({
      content: "hello from gemini",
      finishReason: "STOP",
      usage: { inputTokens: 5, outputTokens: 9, totalTokens: 14 },
      metadata: { provider: "gemini", model: "gemini-test" }
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toBe(
      "https://gemini.test/v1beta/models/gemini-test:generateContent"
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gemini-key");
    expect(JSON.parse(init.body as string)).toMatchObject({
      systemInstruction: { parts: [{ text: "Be helpful" }] },
      generationConfig: { temperature: 0.2, maxOutputTokens: 128 },
      contents: [{ role: "user", parts: [{ text: "hi" }] }]
    });
  });

  it("classifies quota-style rate limits as fallbackable", async () => {
    const fetchMock = jest.fn(async () => makeResponse({ error: "slow" }, 429));
    const provider = new GeminiGenerateContentProvider({
      apiKey: "gemini-key",
      baseUrl: "https://gemini.test/v1beta",
      defaultModel: "gemini-test",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject({ kind: "rate_limit", isFallbackable: true });
  });
});

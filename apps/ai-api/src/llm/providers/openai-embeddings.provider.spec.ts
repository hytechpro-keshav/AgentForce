import {
  DeterministicEmbeddingProvider,
  OpenAiEmbeddingsProvider
} from "./openai-embeddings.provider";

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("OpenAiEmbeddingsProvider", () => {
  it("normalizes OpenAI embedding responses", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
        usage: { prompt_tokens: 12, total_tokens: 12 }
      })
    );
    const provider = new OpenAiEmbeddingsProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.test/v1",
      model: "text-embedding-3-small",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    const response = await provider.embedDocuments({
      texts: ["alpha", "beta"]
    });

    expect(response.embeddings).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6]
    ]);
    expect(response.usage).toEqual({ inputTokens: 12, totalTokens: 12 });
    expect(response.metadata).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toBe("https://api.openai.test/v1/embeddings");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      model: "text-embedding-3-small",
      input: ["alpha", "beta"]
    });
  });

  it("classifies auth and shape failures", async () => {
    const authFetch = jest.fn(async () =>
      makeResponse({ error: "bad key" }, 401)
    );
    const provider = new OpenAiEmbeddingsProvider({
      apiKey: "sk-bad",
      baseUrl: "https://api.openai.test/v1",
      model: "text-embedding-3-small",
      http: { fetch: authFetch as unknown as typeof fetch }
    });

    await expect(
      provider.embedDocuments({ texts: ["alpha"] })
    ).rejects.toMatchObject({
      name: "EmbeddingProviderError",
      kind: "auth"
    });

    const shapeFetch = jest.fn(async () =>
      makeResponse({ data: [{ embedding: [] }] })
    );
    const shapeProvider = new OpenAiEmbeddingsProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.test/v1",
      model: "text-embedding-3-small",
      http: { fetch: shapeFetch as unknown as typeof fetch }
    });
    await expect(
      shapeProvider.embedDocuments({ texts: ["alpha"] })
    ).rejects.toMatchObject({
      name: "EmbeddingProviderError",
      kind: "unknown"
    });
  });

  it("classifies OpenAI model_not_found as validation", async () => {
    const fetchMock = jest.fn(async () =>
      makeResponse(
        { error: { type: "invalid_request_error", code: "model_not_found" } },
        403
      )
    );
    const provider = new OpenAiEmbeddingsProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.test/v1",
      model: "text-embedding-3-small",
      http: { fetch: fetchMock as unknown as typeof fetch }
    });

    await expect(
      provider.embedDocuments({ texts: ["alpha"] })
    ).rejects.toMatchObject({
      name: "EmbeddingProviderError",
      kind: "validation",
      message: "Embedding provider openai returned HTTP 403 (model_not_found)"
    });
  });
});

describe("DeterministicEmbeddingProvider", () => {
  it("returns stable local embeddings for deterministic tests", async () => {
    const provider = new DeterministicEmbeddingProvider();

    const first = await provider.embedDocuments({
      texts: ["reset gateway", "billing credit"]
    });
    const second = await provider.embedDocuments({ texts: ["reset gateway"] });

    expect(first.embeddings[0]).toEqual(second.embeddings[0]);
    expect(first.metadata).toMatchObject({
      provider: "deterministic",
      model: "deterministic-local-test",
      dimensions: 32
    });
    expect(first.usage?.inputTokens).toBeGreaterThan(0);
  });
});

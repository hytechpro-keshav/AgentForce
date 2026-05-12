import { QdrantVectorStore } from "./qdrant-vector-store";
import type { VectorDocument } from "./vector-db.types";

function buildDocument(): VectorDocument {
  return {
    id: "tenant-demo:customer-self-service:kb-1:chunk-1",
    text: "Approved troubleshooting content",
    embedding: [0.1, 0.2, 0.3],
    metadata: {
      sourceId: "kb-1",
      title: "Knowledge One",
      url: "https://help.example.invalid/kb-1",
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      documentVersion: "2026.05.11",
      access: {
        visibility: "restricted",
        allowedSubjects: ["agent-1"],
        allowedScopes: ["agentforce:knowledge-rag"],
        allowedRoles: ["support-agent"]
      },
      ingestedAt: "2026-05-11T00:00:00Z",
      stale: false,
      deleted: false,
      chunkId: "kb-1:2026.05.11:chunk-1",
      chunkIndex: 0,
      contentHash: "hash",
      language: "en-US",
      tags: ["troubleshooting"]
    }
  };
}

describe("QdrantVectorStore", () => {
  it("creates the collection when missing and upserts serialized payload", async () => {
    const fetchFn = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ result: true }))
      .mockResolvedValueOnce(jsonResponse({ result: true }));
    const store = buildStore(fetchFn);

    await store.upsert([buildDocument()]);

    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "https://qdrant.internal/collections/agentforce-knowledge-rag",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          vectors: { size: 1536, distance: "Cosine" }
        })
      })
    );
    const upsertBody = JSON.parse(
      String(fetchFn.mock.calls[2][1]?.body)
    ) as Record<string, Array<Record<string, unknown>>>;
    expect(upsertBody.points[0]).toMatchObject({
      vector: [0.1, 0.2, 0.3],
      payload: expect.objectContaining({
        vectorDocumentId: "tenant-demo:customer-self-service:kb-1:chunk-1",
        sourceId: "kb-1",
        tenantId: "tenant-demo",
        namespace: "customer-self-service",
        chunkText: "Approved troubleshooting content",
        accessVisibility: "restricted",
        accessAllowedRoles: ["support-agent"]
      })
    });
  });

  it("searches with tenant namespace and stale filters", async () => {
    const document = buildDocument();
    const fetchFn = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse({ result: { status: "green" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          result: [
            {
              id: "95e95734-a8b7-70bd-2b73-fb8ce0d290a8",
              score: 0.91,
              payload: {
                vectorDocumentId: document.id,
                sourceId: document.metadata.sourceId,
                title: document.metadata.title,
                url: document.metadata.url,
                tenantId: document.metadata.tenantId,
                namespace: document.metadata.namespace,
                documentVersion: document.metadata.documentVersion,
                ingestedAt: document.metadata.ingestedAt,
                stale: false,
                deleted: false,
                chunkId: document.metadata.chunkId,
                chunkIndex: 0,
                contentHash: document.metadata.contentHash,
                tags: document.metadata.tags,
                accessVisibility: "tenant",
                chunkText: document.text
              }
            }
          ]
        })
      );
    const store = buildStore(fetchFn);

    const matches = await store.search({
      embedding: [0.1, 0.2, 0.3],
      topK: 3,
      scoreThreshold: 0.8,
      filter: {
        tenantId: "tenant-demo",
        namespace: "customer-self-service",
        includeStale: false
      }
    });

    const searchBody = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(searchBody).toMatchObject({
      vector: [0.1, 0.2, 0.3],
      limit: 3,
      with_payload: true,
      score_threshold: 0.8,
      filter: {
        must: expect.arrayContaining([
          { key: "tenantId", match: { value: "tenant-demo" } },
          { key: "namespace", match: { value: "customer-self-service" } },
          { key: "deleted", match: { value: false } },
          { key: "stale", match: { value: false } }
        ])
      }
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: document.id,
      text: document.text,
      score: 0.91,
      metadata: { sourceId: "kb-1", title: "Knowledge One" }
    });
  });

  it("treats concurrent collection creation as ready", async () => {
    const fetchFn = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("already exists", { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ result: true }));
    const store = buildStore(fetchFn);

    await store.upsert([buildDocument()]);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn).toHaveBeenNthCalledWith(
      3,
      "https://qdrant.internal/collections/agentforce-knowledge-rag/points?wait=true",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("deletes by source with tenant and namespace filters", async () => {
    const fetchFn = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse({ result: { status: "green" } }))
      .mockResolvedValueOnce(jsonResponse({ result: true }));
    const store = buildStore(fetchFn);

    await store.deleteBySource({
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      sourceId: "kb-1"
    });

    expect(fetchFn).toHaveBeenLastCalledWith(
      "https://qdrant.internal/collections/agentforce-knowledge-rag/points/delete?wait=true",
      expect.objectContaining({ method: "POST" })
    );
    const deleteBody = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(deleteBody).toEqual({
      filter: {
        must: [
          { key: "tenantId", match: { value: "tenant-demo" } },
          { key: "namespace", match: { value: "customer-self-service" } },
          { key: "sourceId", match: { value: "kb-1" } }
        ]
      }
    });
  });
});

function buildStore(fetchFn: typeof fetch): QdrantVectorStore {
  return new QdrantVectorStore({
    url: "https://qdrant.internal",
    apiKey: "qd-test",
    collection: "agentforce-knowledge-rag",
    vectorSize: 1536,
    distance: "Cosine",
    fetchFn
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

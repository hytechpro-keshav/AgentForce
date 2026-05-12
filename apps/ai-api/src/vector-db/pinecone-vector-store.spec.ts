import { PineconeVectorStore } from "./pinecone-vector-store";
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

describe("PineconeVectorStore", () => {
  it("upserts serialized metadata and chunk text", async () => {
    const upsert = jest.fn<
      Promise<void>,
      [Array<{ metadata: Record<string, unknown> }>]
    >(async () => undefined);
    const namespace = {
      upsert,
      query: jest.fn(),
      deleteMany: jest.fn()
    };
    const client = {
      index: jest.fn(() => ({ namespace: jest.fn(() => namespace) }))
    };
    const store = new PineconeVectorStore({
      apiKey: "pc-test",
      indexName: "knowledge-index",
      client
    });

    await store.upsert([buildDocument()]);

    const records = upsert.mock.calls[0][0];
    expect(records[0].metadata).toMatchObject({
      sourceId: "kb-1",
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      chunkText: "Approved troubleshooting content",
      accessVisibility: "restricted",
      accessAllowedScopes: ["agentforce:knowledge-rag"]
    });
  });

  it("searches with tenant namespace and stale filters", async () => {
    const document = buildDocument();
    const namespace = {
      upsert: jest.fn(),
      query: jest.fn(async () => ({
        matches: [
          {
            id: document.id,
            score: 0.91,
            metadata: {
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
      })),
      deleteMany: jest.fn()
    };
    const client = {
      index: jest.fn(() => ({ namespace: jest.fn(() => namespace) }))
    };
    const store = new PineconeVectorStore({
      apiKey: "pc-test",
      indexName: "knowledge-index",
      client
    });

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

    expect(namespace.query).toHaveBeenCalledWith(
      expect.objectContaining({
        topK: 3,
        filter: expect.objectContaining({
          tenantId: { $eq: "tenant-demo" },
          namespace: { $eq: "customer-self-service" },
          deleted: { $eq: false },
          stale: { $eq: false }
        })
      })
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: document.id,
      text: document.text,
      score: 0.91,
      metadata: { sourceId: "kb-1", title: "Knowledge One" }
    });
  });

  it("deletes by source with tenant and namespace filters", async () => {
    const namespace = {
      upsert: jest.fn(),
      query: jest.fn(),
      deleteMany: jest.fn(async () => undefined)
    };
    const client = {
      index: jest.fn(() => ({ namespace: jest.fn(() => namespace) }))
    };
    const store = new PineconeVectorStore({
      apiKey: "pc-test",
      indexName: "knowledge-index",
      client
    });

    await store.deleteBySource({
      tenantId: "tenant-demo",
      namespace: "customer-self-service",
      sourceId: "kb-1"
    });

    expect(namespace.deleteMany).toHaveBeenCalledWith({
      tenantId: { $eq: "tenant-demo" },
      namespace: { $eq: "customer-self-service" },
      sourceId: { $eq: "kb-1" }
    });
  });
});

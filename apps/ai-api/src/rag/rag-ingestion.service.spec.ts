import { ForbiddenException } from "@nestjs/common";

import type { AppConfigService } from "../config/app-config.service";
import type { EmbeddingRouter } from "../llm/embedding-router";
import type { TelemetryService } from "../observability/telemetry.service";
import type { VectorStore } from "../vector-db/vector-db.types";
import { RagConfigurationError } from "./rag.errors";
import { RagIngestionService } from "./rag-ingestion.service";
import type { TrustedRagContext } from "./trusted-rag-context";

function context(): TrustedRagContext {
  return {
    tenantId: "tenant-demo",
    namespace: "phase4-test",
    subject: "agent-1",
    scopes: ["rag:ingest"],
    roles: ["support-agent"]
  };
}

function buildService(overrides: { enabled?: boolean } = {}): {
  service: RagIngestionService;
  embeddings: { embedDocuments: jest.Mock };
  vectorStore: { upsert: jest.Mock; deleteBySource: jest.Mock; name: string };
  telemetry: { recordRagWorkflow: jest.Mock };
} {
  const config = {
    rag: {
      enabled: overrides.enabled ?? true,
      chunkSize: 140,
      chunkOverlap: 20
    }
  } as AppConfigService;
  const embeddings = {
    embedDocuments: jest.fn(async ({ texts }: { texts: string[] }) => ({
      embeddings: texts.map(() => [1, 0, 0]),
      usage: { inputTokens: texts.length * 4, totalTokens: texts.length * 4 },
      metadata: {
        provider: "deterministic",
        model: "deterministic-local-test",
        dimensions: 3,
        latencyMs: 1
      }
    }))
  };
  const vectorStore = {
    name: "memory",
    upsert: jest.fn(async () => undefined),
    deleteBySource: jest.fn(async () => undefined)
  };
  const telemetry = { recordRagWorkflow: jest.fn() };
  return {
    service: new RagIngestionService(
      config,
      embeddings as unknown as EmbeddingRouter,
      telemetry as unknown as TelemetryService,
      vectorStore as unknown as VectorStore
    ),
    embeddings,
    vectorStore,
    telemetry
  };
}

describe("RagIngestionService", () => {
  it("chunks documents and preserves required metadata on every chunk", async () => {
    const { service, vectorStore, telemetry } = buildService();

    const response = await service.ingest(
      {
        requestId: "ingest-test",
        documents: [
          {
            sourceId: "kb-1",
            title: "Troubleshooting",
            url: "https://help.example.invalid/kb-1",
            documentVersion: "2026.05.11",
            access: {
              visibility: "restricted",
              allowedRoles: ["support-agent"]
            },
            content:
              "Approved troubleshooting content. ".repeat(20) +
              "Escalate if the issue remains unresolved after a gateway restart."
          }
        ]
      },
      context()
    );

    expect(response.status).toBe("INGESTED");
    expect(response.chunksIndexed).toBeGreaterThan(1);
    const documents = vectorStore.upsert.mock.calls[0][0] as Array<{
      text: string;
      metadata: Record<string, unknown>;
    }>;
    expect(documents.length).toBe(response.chunksIndexed);
    expect(vectorStore.deleteBySource).toHaveBeenCalledWith({
      tenantId: "tenant-demo",
      namespace: "phase4-test",
      sourceId: "kb-1"
    });
    for (const document of documents) {
      expect(document.metadata).toMatchObject({
        sourceId: "kb-1",
        title: "Troubleshooting",
        url: "https://help.example.invalid/kb-1",
        tenantId: "tenant-demo",
        namespace: "phase4-test",
        documentVersion: "2026.05.11",
        stale: false,
        deleted: false
      });
      expect(document.metadata["chunkId"]).toEqual(
        expect.stringContaining("kb-1")
      );
      expect(document.metadata["contentHash"]).toEqual(expect.any(String));
      expect(document.metadata["ingestedAt"]).toEqual(expect.any(String));
    }
    expect(telemetry.recordRagWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "ingest",
        requestId: "ingest-test",
        documentsReceived: 1,
        chunksIndexed: response.chunksIndexed,
        sourceIds: ["kb-1"],
        outcome: "success"
      })
    );
  });

  it("replaces existing source chunks with deterministic vector ids", async () => {
    const { service, vectorStore } = buildService();

    await service.ingest(
      {
        documents: [
          {
            sourceId: "kb-replace",
            title: "Replace",
            content: "first approved version",
            documentVersion: "v1"
          }
        ]
      },
      context()
    );

    const firstDocuments = vectorStore.upsert.mock.calls[0][0] as Array<{
      id: string;
      text: string;
    }>;

    await service.ingest(
      {
        documents: [
          {
            sourceId: "kb-replace",
            title: "Replace",
            content: "second approved version",
            documentVersion: "v1"
          }
        ]
      },
      context()
    );

    const secondDocuments = vectorStore.upsert.mock.calls[1][0] as Array<{
      id: string;
      text: string;
    }>;

    expect(vectorStore.deleteBySource).toHaveBeenCalledTimes(2);
    expect(firstDocuments[0].id).toBe(secondDocuments[0].id);
    expect(secondDocuments[0].text).toContain("second approved version");
  });

  it("rejects client-supplied tenant or namespace mismatches", async () => {
    const { service } = buildService();

    await expect(
      service.ingest(
        {
          documents: [
            {
              sourceId: "kb-tenant-mismatch",
              title: "Mismatch",
              content: "content",
              documentVersion: "v1",
              tenantId: "other-tenant"
            }
          ]
        },
        context()
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("fails clearly when RAG is disabled", async () => {
    const { service } = buildService({ enabled: false });

    await expect(
      service.ingest(
        {
          documents: [
            {
              sourceId: "kb-disabled",
              title: "Disabled",
              content: "content",
              documentVersion: "v1"
            }
          ]
        },
        context()
      )
    ).rejects.toBeInstanceOf(RagConfigurationError);
  });
});

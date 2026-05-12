import { Pinecone } from "@pinecone-database/pinecone";

import type {
  DeleteBySourceRequest,
  RagAccessMetadata,
  RagChunkMetadata,
  VectorDocument,
  VectorSearchMatch,
  VectorSearchRequest,
  VectorStore
} from "./vector-db.types";
import { VectorStoreError } from "./vector-db.types";

interface PineconeNamespaceLike {
  upsert(records: unknown[]): Promise<unknown>;
  query(
    request: Record<string, unknown>
  ): Promise<{ matches?: PineconeMatch[] }>;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
}

interface PineconeIndexLike {
  namespace(namespace: string): PineconeNamespaceLike;
}

interface PineconeClientLike {
  index(indexName: string): PineconeIndexLike;
}

interface PineconeMatch {
  id?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface PineconeVectorStoreOptions {
  apiKey: string;
  indexName: string;
  client?: PineconeClientLike;
}

export class PineconeVectorStore implements VectorStore {
  readonly name = "pinecone";
  private readonly indexName: string;
  private readonly client: PineconeClientLike;

  constructor(options: PineconeVectorStoreOptions) {
    this.indexName = options.indexName;
    this.client =
      options.client ??
      (new Pinecone({
        apiKey: options.apiKey
      }) as unknown as PineconeClientLike);
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    const byNamespace = new Map<string, VectorDocument[]>();
    for (const document of documents) {
      const items = byNamespace.get(document.metadata.namespace) ?? [];
      items.push(document);
      byNamespace.set(document.metadata.namespace, items);
    }

    try {
      for (const [namespace, items] of byNamespace.entries()) {
        await this.namespace(namespace).upsert(
          items.map((document) => ({
            id: document.id,
            values: document.embedding,
            metadata: PineconeVectorStore.serializeMetadata(
              document.metadata,
              document.text
            )
          }))
        );
      }
    } catch (cause) {
      throw new VectorStoreError(
        this.name,
        "upsert",
        "Pinecone upsert failed.",
        cause
      );
    }
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchMatch[]> {
    try {
      const response = await this.namespace(request.filter.namespace).query({
        vector: request.embedding,
        topK: request.topK,
        includeMetadata: true,
        filter: {
          tenantId: { $eq: request.filter.tenantId },
          namespace: { $eq: request.filter.namespace },
          deleted: { $eq: false },
          ...(request.filter.includeStale ? {} : { stale: { $eq: false } })
        }
      });
      return (response.matches ?? [])
        .map((match) => PineconeVectorStore.toMatch(match))
        .filter((match): match is VectorSearchMatch => Boolean(match))
        .filter((match) => match.score >= (request.scoreThreshold ?? 0));
    } catch (cause) {
      throw new VectorStoreError(
        this.name,
        "query",
        "Pinecone search failed.",
        cause
      );
    }
  }

  async deleteBySource(request: DeleteBySourceRequest): Promise<void> {
    try {
      await this.namespace(request.namespace).deleteMany({
        tenantId: { $eq: request.tenantId },
        namespace: { $eq: request.namespace },
        sourceId: { $eq: request.sourceId }
      });
    } catch (cause) {
      throw new VectorStoreError(
        this.name,
        "delete",
        "Pinecone delete failed.",
        cause
      );
    }
  }

  private namespace(namespace: string): PineconeNamespaceLike {
    return this.client.index(this.indexName).namespace(namespace);
  }

  private static serializeMetadata(
    metadata: RagChunkMetadata,
    text: string
  ): Record<string, string | number | boolean | string[]> {
    return {
      sourceId: metadata.sourceId,
      title: metadata.title,
      ...(metadata.url ? { url: metadata.url } : {}),
      ...(metadata.salesforceRecordRef
        ? { salesforceRecordRef: metadata.salesforceRecordRef }
        : {}),
      tenantId: metadata.tenantId,
      namespace: metadata.namespace,
      documentVersion: metadata.documentVersion,
      ingestedAt: metadata.ingestedAt,
      stale: metadata.stale,
      deleted: metadata.deleted,
      chunkId: metadata.chunkId,
      chunkIndex: metadata.chunkIndex,
      contentHash: metadata.contentHash,
      ...(metadata.language ? { language: metadata.language } : {}),
      tags: metadata.tags,
      accessVisibility: metadata.access.visibility,
      accessAllowedSubjects: metadata.access.allowedSubjects,
      accessAllowedScopes: metadata.access.allowedScopes,
      accessAllowedRoles: metadata.access.allowedRoles,
      chunkText: text
    };
  }

  private static toMatch(match: PineconeMatch): VectorSearchMatch | undefined {
    const metadata = match.metadata;
    if (!match.id || !metadata) {
      return undefined;
    }
    const chunkText = PineconeVectorStore.readString(metadata, "chunkText");
    const sourceId = PineconeVectorStore.readString(metadata, "sourceId");
    const title = PineconeVectorStore.readString(metadata, "title");
    const tenantId = PineconeVectorStore.readString(metadata, "tenantId");
    const namespace = PineconeVectorStore.readString(metadata, "namespace");
    const documentVersion = PineconeVectorStore.readString(
      metadata,
      "documentVersion"
    );
    const chunkId = PineconeVectorStore.readString(metadata, "chunkId");
    const ingestedAt = PineconeVectorStore.readString(metadata, "ingestedAt");
    if (
      !chunkText ||
      !sourceId ||
      !title ||
      !tenantId ||
      !namespace ||
      !documentVersion ||
      !chunkId ||
      !ingestedAt
    ) {
      return undefined;
    }

    return {
      id: match.id,
      text: chunkText,
      score: match.score ?? 0,
      metadata: {
        sourceId,
        title,
        url: PineconeVectorStore.readString(metadata, "url"),
        salesforceRecordRef: PineconeVectorStore.readString(
          metadata,
          "salesforceRecordRef"
        ),
        tenantId,
        namespace,
        documentVersion,
        access: PineconeVectorStore.readAccess(metadata),
        ingestedAt,
        stale: PineconeVectorStore.readBoolean(metadata, "stale"),
        deleted: PineconeVectorStore.readBoolean(metadata, "deleted"),
        chunkId,
        chunkIndex: PineconeVectorStore.readNumber(metadata, "chunkIndex"),
        contentHash:
          PineconeVectorStore.readString(metadata, "contentHash") ?? "",
        language: PineconeVectorStore.readString(metadata, "language"),
        tags: PineconeVectorStore.readStringArray(metadata, "tags")
      }
    };
  }

  private static readAccess(
    metadata: Record<string, unknown>
  ): RagAccessMetadata {
    const visibility = PineconeVectorStore.readString(
      metadata,
      "accessVisibility"
    );
    return {
      visibility:
        visibility === "public" ||
        visibility === "restricted" ||
        visibility === "tenant"
          ? visibility
          : "tenant",
      allowedSubjects: PineconeVectorStore.readStringArray(
        metadata,
        "accessAllowedSubjects"
      ),
      allowedScopes: PineconeVectorStore.readStringArray(
        metadata,
        "accessAllowedScopes"
      ),
      allowedRoles: PineconeVectorStore.readStringArray(
        metadata,
        "accessAllowedRoles"
      )
    };
  }

  private static readString(
    metadata: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private static readNumber(
    metadata: Record<string, unknown>,
    key: string
  ): number {
    const value = metadata[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private static readBoolean(
    metadata: Record<string, unknown>,
    key: string
  ): boolean {
    return metadata[key] === true;
  }

  private static readStringArray(
    metadata: Record<string, unknown>,
    key: string
  ): string[] {
    const value = metadata[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
}

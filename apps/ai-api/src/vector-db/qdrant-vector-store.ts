import { createHash } from "crypto";

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

interface QdrantVectorStoreOptions {
  url: string;
  apiKey?: string;
  collection: string;
  vectorSize: number;
  distance: "Cosine" | "Dot" | "Euclid";
  fetchFn?: typeof fetch;
}

interface QdrantSearchResponse {
  result?: QdrantPoint[];
}

interface QdrantPoint {
  id?: string | number;
  score?: number;
  payload?: Record<string, unknown>;
}

export class QdrantVectorStore implements VectorStore {
  readonly name = "qdrant";
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly vectorSize: number;
  private readonly distance: "Cosine" | "Dot" | "Euclid";
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;
  private collectionReady?: Promise<void>;

  constructor(options: QdrantVectorStoreOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.collection = options.collection;
    this.vectorSize = options.vectorSize;
    this.distance = options.distance;
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    await this.ensureCollection();
    try {
      await this.request(`/collections/${this.collection}/points?wait=true`, {
        method: "PUT",
        body: {
          points: documents.map((document) => ({
            id: stablePointId(document.id),
            vector: document.embedding,
            payload: QdrantVectorStore.serializePayload(
              document.metadata,
              document.text,
              document.id
            )
          }))
        }
      });
    } catch (cause) {
      throw new VectorStoreError(
        this.name,
        "upsert",
        "Qdrant upsert failed.",
        cause
      );
    }
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchMatch[]> {
    await this.ensureCollection();
    try {
      const response = await this.request<QdrantSearchResponse>(
        `/collections/${this.collection}/points/search`,
        {
          method: "POST",
          body: {
            vector: request.embedding,
            limit: request.topK,
            with_payload: true,
            ...(request.scoreThreshold
              ? { score_threshold: request.scoreThreshold }
              : {}),
            filter: {
              must: [
                { key: "tenantId", match: { value: request.filter.tenantId } },
                {
                  key: "namespace",
                  match: { value: request.filter.namespace }
                },
                { key: "deleted", match: { value: false } },
                ...(request.filter.includeStale
                  ? []
                  : [{ key: "stale", match: { value: false } }])
              ]
            }
          }
        }
      );
      return (response.result ?? [])
        .map((point) => QdrantVectorStore.toMatch(point))
        .filter((match): match is VectorSearchMatch => Boolean(match))
        .filter((match) => match.score >= (request.scoreThreshold ?? 0));
    } catch (cause) {
      throw new VectorStoreError(
        this.name,
        "query",
        "Qdrant search failed.",
        cause
      );
    }
  }

  async deleteBySource(request: DeleteBySourceRequest): Promise<void> {
    await this.ensureCollection();
    try {
      await this.request(
        `/collections/${this.collection}/points/delete?wait=true`,
        {
          method: "POST",
          body: {
            filter: {
              must: [
                { key: "tenantId", match: { value: request.tenantId } },
                { key: "namespace", match: { value: request.namespace } },
                { key: "sourceId", match: { value: request.sourceId } }
              ]
            }
          }
        }
      );
    } catch (cause) {
      throw new VectorStoreError(
        this.name,
        "delete",
        "Qdrant delete failed.",
        cause
      );
    }
  }

  private async ensureCollection(): Promise<void> {
    this.collectionReady ??= this.createCollectionIfMissing();
    return this.collectionReady;
  }

  private async createCollectionIfMissing(): Promise<void> {
    const response = await this.fetchFn(
      `${this.baseUrl}/collections/${encodeURIComponent(this.collection)}`,
      { headers: this.headers() }
    );
    if (response.ok) {
      return;
    }
    if (response.status !== 404) {
      throw new VectorStoreError(
        this.name,
        "configuration",
        "Qdrant collection check failed."
      );
    }
    const createResponse = await this.fetchFn(
      `${this.baseUrl}/collections/${encodeURIComponent(this.collection)}`,
      {
        method: "PUT",
        headers: this.headers(true),
        body: JSON.stringify({
          vectors: {
            size: this.vectorSize,
            distance: this.distance
          }
        })
      }
    );
    if (createResponse.ok || createResponse.status === 409) {
      return;
    }
    throw new VectorStoreError(
      this.name,
      "configuration",
      "Qdrant collection creation failed.",
      new Error(`Qdrant HTTP ${createResponse.status}`)
    );
  }

  private async request<T = unknown>(
    path: string,
    options: { method: "GET" | "POST" | "PUT"; body?: unknown }
  ): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: this.headers(Boolean(options.body)),
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) {
      throw new Error(`Qdrant HTTP ${response.status}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private headers(hasBody = false): Record<string, string> {
    return {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(this.apiKey ? { "api-key": this.apiKey } : {})
    };
  }

  private static serializePayload(
    metadata: RagChunkMetadata,
    text: string,
    vectorDocumentId: string
  ): Record<string, string | number | boolean | string[]> {
    return {
      vectorDocumentId,
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

  private static toMatch(point: QdrantPoint): VectorSearchMatch | undefined {
    const payload = point.payload;
    if (!payload) {
      return undefined;
    }
    const vectorDocumentId = QdrantVectorStore.readString(
      payload,
      "vectorDocumentId"
    );
    const chunkText = QdrantVectorStore.readString(payload, "chunkText");
    const sourceId = QdrantVectorStore.readString(payload, "sourceId");
    const title = QdrantVectorStore.readString(payload, "title");
    const tenantId = QdrantVectorStore.readString(payload, "tenantId");
    const namespace = QdrantVectorStore.readString(payload, "namespace");
    const documentVersion = QdrantVectorStore.readString(
      payload,
      "documentVersion"
    );
    const chunkId = QdrantVectorStore.readString(payload, "chunkId");
    const ingestedAt = QdrantVectorStore.readString(payload, "ingestedAt");
    if (
      !vectorDocumentId ||
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
      id: vectorDocumentId,
      text: chunkText,
      score: point.score ?? 0,
      metadata: {
        sourceId,
        title,
        url: QdrantVectorStore.readString(payload, "url"),
        salesforceRecordRef: QdrantVectorStore.readString(
          payload,
          "salesforceRecordRef"
        ),
        tenantId,
        namespace,
        documentVersion,
        access: QdrantVectorStore.readAccess(payload),
        ingestedAt,
        stale: QdrantVectorStore.readBoolean(payload, "stale"),
        deleted: QdrantVectorStore.readBoolean(payload, "deleted"),
        chunkId,
        chunkIndex: QdrantVectorStore.readNumber(payload, "chunkIndex"),
        contentHash: QdrantVectorStore.readString(payload, "contentHash") ?? "",
        language: QdrantVectorStore.readString(payload, "language"),
        tags: QdrantVectorStore.readStringArray(payload, "tags")
      }
    };
  }

  private static readAccess(
    payload: Record<string, unknown>
  ): RagAccessMetadata {
    const visibility = QdrantVectorStore.readString(
      payload,
      "accessVisibility"
    );
    return {
      visibility:
        visibility === "public" ||
        visibility === "restricted" ||
        visibility === "tenant"
          ? visibility
          : "tenant",
      allowedSubjects: QdrantVectorStore.readStringArray(
        payload,
        "accessAllowedSubjects"
      ),
      allowedScopes: QdrantVectorStore.readStringArray(
        payload,
        "accessAllowedScopes"
      ),
      allowedRoles: QdrantVectorStore.readStringArray(
        payload,
        "accessAllowedRoles"
      )
    };
  }

  private static readString(
    payload: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private static readNumber(
    payload: Record<string, unknown>,
    key: string
  ): number {
    const value = payload[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private static readBoolean(
    payload: Record<string, unknown>,
    key: string
  ): boolean {
    return payload[key] === true;
  }

  private static readStringArray(
    payload: Record<string, unknown>,
    key: string
  ): string[] {
    const value = payload[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
}

function stablePointId(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

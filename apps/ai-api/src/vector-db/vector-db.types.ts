export type RagSourceVisibility = "public" | "tenant" | "restricted";

export interface RagAccessMetadata {
  visibility: RagSourceVisibility;
  allowedSubjects: string[];
  allowedScopes: string[];
  allowedRoles: string[];
}

export interface RagChunkMetadata {
  sourceId: string;
  title: string;
  url?: string;
  salesforceRecordRef?: string;
  tenantId: string;
  namespace: string;
  documentVersion: string;
  access: RagAccessMetadata;
  ingestedAt: string;
  stale: boolean;
  deleted: boolean;
  chunkId: string;
  chunkIndex: number;
  contentHash: string;
  language?: string;
  tags: string[];
}

export interface VectorDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata: RagChunkMetadata;
}

export interface VectorSearchFilter {
  tenantId: string;
  namespace: string;
  includeStale: boolean;
}

export interface VectorSearchRequest {
  embedding: number[];
  topK: number;
  scoreThreshold?: number;
  filter: VectorSearchFilter;
}

export interface VectorSearchMatch {
  id: string;
  text: string;
  score: number;
  metadata: RagChunkMetadata;
}

export interface DeleteBySourceRequest {
  tenantId: string;
  namespace: string;
  sourceId: string;
}

export class VectorStoreError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: "configuration" | "query" | "upsert" | "delete" | "unknown",
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "VectorStoreError";
  }
}

export interface VectorStore {
  readonly name: string;
  upsert(documents: VectorDocument[]): Promise<void>;
  search(request: VectorSearchRequest): Promise<VectorSearchMatch[]>;
  deleteBySource(request: DeleteBySourceRequest): Promise<void>;
}

import type {
  DeleteBySourceRequest,
  VectorDocument,
  VectorSearchMatch,
  VectorSearchRequest,
  VectorStore
} from "./vector-db.types";

export class InMemoryVectorStore implements VectorStore {
  readonly name = "memory";
  private readonly documents = new Map<string, VectorDocument>();

  async upsert(documents: VectorDocument[]): Promise<void> {
    for (const document of documents) {
      this.documents.set(document.id, document);
    }
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchMatch[]> {
    return Array.from(this.documents.values())
      .filter((document) => this.matchesFilter(document, request))
      .map((document) => ({
        id: document.id,
        text: document.text,
        score: InMemoryVectorStore.cosineSimilarity(
          request.embedding,
          document.embedding
        ),
        metadata: document.metadata
      }))
      .filter((match) => match.score >= (request.scoreThreshold ?? 0))
      .sort((left, right) => right.score - left.score)
      .slice(0, request.topK);
  }

  async deleteBySource(request: DeleteBySourceRequest): Promise<void> {
    for (const [id, document] of this.documents.entries()) {
      if (
        document.metadata.tenantId === request.tenantId &&
        document.metadata.namespace === request.namespace &&
        document.metadata.sourceId === request.sourceId
      ) {
        this.documents.delete(id);
      }
    }
  }

  clear(): void {
    this.documents.clear();
  }

  get size(): number {
    return this.documents.size;
  }

  private matchesFilter(
    document: VectorDocument,
    request: VectorSearchRequest
  ): boolean {
    return (
      document.metadata.tenantId === request.filter.tenantId &&
      document.metadata.namespace === request.filter.namespace &&
      !document.metadata.deleted &&
      (request.filter.includeStale || !document.metadata.stale)
    );
  }

  private static cosineSimilarity(left: number[], right: number[]): number {
    const length = Math.min(left.length, right.length);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < length; index++) {
      dot += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }
    if (leftNorm === 0 || rightNorm === 0) {
      return 0;
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }
}

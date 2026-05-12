import { Module } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { InMemoryVectorStore } from "./in-memory-vector-store";
import { PineconeVectorStore } from "./pinecone-vector-store";
import { QdrantVectorStore } from "./qdrant-vector-store";
import { VectorStoreError, type VectorStore } from "./vector-db.types";

export const VECTOR_STORE = Symbol("VECTOR_STORE");

class DisabledVectorStore implements VectorStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly reason: string
  ) {
    this.name = name;
  }

  async upsert(): Promise<void> {
    throw new VectorStoreError(this.name, "configuration", this.reason);
  }

  async search(): Promise<never> {
    throw new VectorStoreError(this.name, "configuration", this.reason);
  }

  async deleteBySource(): Promise<void> {
    throw new VectorStoreError(this.name, "configuration", this.reason);
  }
}

@Module({
  providers: [
    {
      provide: VECTOR_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): VectorStore => {
        if (config.rag.vectorDbProvider === "memory") {
          return new InMemoryVectorStore();
        }
        if (config.rag.vectorDbProvider === "qdrant") {
          if (config.rag.qdrant) {
            return new QdrantVectorStore(config.rag.qdrant);
          }
          return new DisabledVectorStore(
            "qdrant",
            "Qdrant is not configured. Set RAG_ENABLED=true, VECTOR_DB_PROVIDER=qdrant, QDRANT_URL, and QDRANT_COLLECTION or VECTOR_DB_INDEX for RAG routes."
          );
        }
        if (config.rag.pinecone) {
          return new PineconeVectorStore({
            apiKey: config.rag.pinecone.apiKey,
            indexName: config.rag.pinecone.index
          });
        }
        return new DisabledVectorStore(
          "pinecone",
          "Pinecone is not configured. Set RAG_ENABLED=true, VECTOR_DB_PROVIDER=pinecone, VECTOR_DB_API_KEY, and VECTOR_DB_INDEX for RAG routes."
        );
      }
    }
  ],
  exports: [VECTOR_STORE]
})
export class VectorDbModule {}

export {
  InMemoryVectorStore,
  PineconeVectorStore,
  QdrantVectorStore,
  VectorStoreError
};
export type { VectorStore };

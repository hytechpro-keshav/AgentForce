import type { RagSourceDto } from "./dto/rag.dto";
import type { VectorSearchMatch } from "../vector-db/vector-db.types";

export function toRagSourceDto(
  match: VectorSearchMatch,
  retrievalId: string
): RagSourceDto {
  return {
    sourceId: match.metadata.sourceId,
    title: match.metadata.title,
    url: match.metadata.url,
    salesforceRecordRef: match.metadata.salesforceRecordRef,
    documentVersion: match.metadata.documentVersion,
    chunkId: match.metadata.chunkId,
    score: roundScore(match.score),
    retrievalId
  };
}

export function buildSourceFlatFields(sources: RagSourceDto[]): {
  sourceIds: string;
  sourceTitles: string;
  sourceUrls: string;
  sourceVersions: string;
  sourceChunkIds: string;
  retrievalIds: string;
  sourcesJson: string;
} {
  return {
    sourceIds: sources.map((source) => source.sourceId).join("; "),
    sourceTitles: sources.map((source) => source.title).join("; "),
    sourceUrls: sources
      .map((source) => source.url ?? source.salesforceRecordRef ?? "")
      .filter(Boolean)
      .join("; "),
    sourceVersions: sources.map((source) => source.documentVersion).join("; "),
    sourceChunkIds: sources.map((source) => source.chunkId).join("; "),
    retrievalIds: Array.from(
      new Set(sources.map((source) => source.retrievalId))
    ).join("; "),
    sourcesJson: JSON.stringify(sources)
  };
}

function roundScore(score: number): number {
  return Math.round(score * 10000) / 10000;
}

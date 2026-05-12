import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

import type { RagSourceVisibility } from "../../vector-db/vector-db.types";

export const RAG_SOURCE_VISIBILITIES = [
  "public",
  "tenant",
  "restricted"
] as const;
export const SAFE_RAG_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
export type RagAnswerStatus = "ANSWERED" | "NO_SOURCE";
export type RagSearchStatus = "FOUND" | "NO_AUTHORIZED_SOURCES";
export type RagIngestStatus = "INGESTED";

export class RagAccessDto {
  @IsOptional()
  @IsIn(RAG_SOURCE_VISIBILITIES)
  visibility?: RagSourceVisibility;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Matches(SAFE_RAG_ID_PATTERN, { each: true })
  @ArrayMaxSize(25)
  allowedSubjects?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Matches(SAFE_RAG_ID_PATTERN, { each: true })
  @ArrayMaxSize(25)
  allowedScopes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Matches(SAFE_RAG_ID_PATTERN, { each: true })
  @ArrayMaxSize(25)
  allowedRoles?: string[];
}

export class RagDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(SAFE_RAG_ID_PATTERN)
  sourceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  salesforceRecordRef?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  documentVersion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  tenantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  namespace?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RagAccessDto)
  access?: RagAccessDto;

  @IsOptional()
  @IsBoolean()
  stale?: boolean;

  @IsOptional()
  @IsBoolean()
  deleted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @Matches(SAFE_RAG_ID_PATTERN, { each: true })
  @ArrayMaxSize(20)
  tags?: string[];
}

export class RagIngestRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RagDocumentDto)
  documents!: RagDocumentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  namespace?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(100)
  @Max(4000)
  chunkSize?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  @Max(1000)
  chunkOverlap?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  requestId?: string;
}

export class RagSearchRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  query!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  namespace?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(20)
  topK?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  scoreThreshold?: number;

  @IsOptional()
  @IsBoolean()
  includeStale?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  requestId?: string;
}

export class KnowledgeAnswerRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contextSummary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  namespace?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(20)
  topK?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  scoreThreshold?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(SAFE_RAG_ID_PATTERN)
  requestId?: string;
}

export interface RagSourceDto {
  sourceId: string;
  title: string;
  url?: string;
  salesforceRecordRef?: string;
  documentVersion: string;
  chunkId: string;
  score: number;
  retrievalId: string;
}

export interface RagIngestResponseDto {
  status: RagIngestStatus;
  tenantId: string;
  namespace: string;
  documentsReceived: number;
  chunksIndexed: number;
  embeddingProvider: string;
  embeddingModel: string;
  vectorDbProvider: string;
  requestId?: string;
}

export interface RagSearchResponseDto {
  status: RagSearchStatus;
  tenantId: string;
  namespace: string;
  retrievalId: string;
  matches: RagSourceDto[];
  retrievedCount: number;
  returnedCount: number;
  accessFilteredCount: number;
  embeddingProvider: string;
  embeddingModel: string;
  vectorDbProvider: string;
  requestId?: string;
}

export interface KnowledgeAnswerResponseDto {
  answerStatus: RagAnswerStatus;
  safeMessage: string;
  answer: string;
  sourceCount: number;
  sources: RagSourceDto[];
  sourceIds: string;
  sourceTitles: string;
  sourceUrls: string;
  sourceVersions: string;
  sourceChunkIds: string;
  retrievalIds: string;
  sourcesJson?: string;
  provider?: string;
  model?: string;
  embeddingProvider: string;
  embeddingModel: string;
  vectorDbProvider: string;
  fallbackUsed: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  tenantId: string;
  namespace: string;
  requestId?: string;
}

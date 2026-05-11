import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator";

import { TRIAGE_PRIORITIES, type TriagePriorityDto } from "./triage-case.dto";

export const CASE_ANALYSIS_CATEGORIES = [
  "billing",
  "outage",
  "technical",
  "account",
  "other"
] as const;
export type CaseAnalysisCategoryDto = (typeof CASE_ANALYSIS_CATEGORIES)[number];

export const CASE_ANALYSIS_CONFIDENCES = ["low", "medium", "high"] as const;
export type CaseAnalysisConfidenceDto =
  (typeof CASE_ANALYSIS_CONFIDENCES)[number];

/**
 * Phase 3 Support Operations case-analysis request. The shape is
 * intentionally a superset of the Phase 2 triage request so that
 * the same masking + ModelRouter contract applies, with extra
 * Salesforce Case context fields the planner can pass through Apex.
 */
export class AnalyzeCaseRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  caseSubject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  caseDescription!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseOrigin?: string;

  @IsOptional()
  @IsIn(TRIAGE_PRIORITIES)
  reportedPriority?: TriagePriorityDto;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;
}

export interface AnalyzeCaseResponseDto {
  summary: string;
  category: CaseAnalysisCategoryDto;
  recommendedPriority: TriagePriorityDto;
  confidence: CaseAnalysisConfidenceDto;
  nextAction: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

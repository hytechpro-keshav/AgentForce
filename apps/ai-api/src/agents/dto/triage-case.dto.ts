import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

import { SAFE_CHAT_REQUEST_ID_PATTERN } from "../../chat/dto/chat-message.dto";
import type {
  BusinessRiskLevel,
  CustomerTier,
  SlaClass,
  WarrantyStatus
} from "../../orchestrator/dto/customer-context";

export const TRIAGE_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type TriagePriorityDto = (typeof TRIAGE_PRIORITIES)[number];

/**
 * Accepted vocabularies for the sanitized customer-signal block. These
 * mirror the `customer-context` finding value unions; `satisfies` keeps
 * them assignment-compatible so a drift in the source union surfaces at
 * compile time. They exist as runtime arrays only so `@IsIn` can validate
 * the (internally-populated, but still public-DTO-exposed) field.
 */
const CUSTOMER_TIERS = [
  "premium",
  "standard",
  "basic",
  "unknown"
] as const satisfies readonly CustomerTier[];
const SLA_CLASSES = [
  "premium",
  "standard",
  "none",
  "unknown"
] as const satisfies readonly SlaClass[];
const WARRANTY_STATUSES = [
  "covered",
  "expired",
  "rma_eligible",
  "unknown"
] as const satisfies readonly WarrantyStatus[];
const BUSINESS_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "unknown"
] as const satisfies readonly BusinessRiskLevel[];

/** Repeat-incident signal carried into triage (count + boolean only). */
export class TriageRepeatIncidentSignal {
  @IsBoolean()
  repeat!: boolean;

  @IsInt()
  @Min(0)
  count!: number;
}

/**
 * Flat, **sanitized** customer signals the merged Triage node derives from
 * the `customerContext` package and feeds to the triage LLM (Phase B). Values
 * only — never names, contact details, account ids, or raw records. Every
 * field is optional so the public `/agent/support/triage-case` contract and
 * existing callers stay valid without it; the triage model runs case-only
 * when it is absent.
 */
export class TriageCustomerSignals {
  @IsOptional()
  @IsIn(CUSTOMER_TIERS)
  customerTier?: CustomerTier;

  @IsOptional()
  @IsIn(SLA_CLASSES)
  slaClass?: SlaClass;

  @IsOptional()
  @IsIn(WARRANTY_STATUSES)
  warrantyStatus?: WarrantyStatus;

  @IsOptional()
  @IsBoolean()
  strategicAccount?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TriageRepeatIncidentSignal)
  repeatIncident?: TriageRepeatIncidentSignal;

  @IsOptional()
  @IsInt()
  @Min(0)
  openIncidentCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  escalationHistory?: number;

  @IsOptional()
  @IsIn(BUSINESS_RISK_LEVELS)
  businessRisk?: BusinessRiskLevel;

  /** Safe, non-PII model identifier (e.g. "VX-900"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  primaryModel?: string;

  /** True when the upstream customer read degraded; triage stays conservative. */
  @IsOptional()
  @IsBoolean()
  degraded?: boolean;
}

export class TriageCaseRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

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
  @Matches(SAFE_CHAT_REQUEST_ID_PATTERN)
  requestId?: string;

  /**
   * Sanitized customer signals for context-informed triage (Phase B).
   * Optional: absent for standalone API callers; populated internally by the
   * merged Triage graph node from the `customerContext` package.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => TriageCustomerSignals)
  customerSignals?: TriageCustomerSignals;
}

/** AI-assigned relative influence factor for priority (weights sum to 100). */
export interface TriagePriorityFactor {
  id: string;
  label: string;
  weight: number;
}

export interface TriageCaseResponseDto {
  recommendedPriority: TriagePriorityDto;
  summary: string;
  suggestedNextStep: string;
  /** Plain-English why this priority (from the same triage LLM call). */
  priorityRationale?: string;
  /** Optional factor mix for operator insight charts; omitted when invalid. */
  priorityFactors?: TriagePriorityFactor[];
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

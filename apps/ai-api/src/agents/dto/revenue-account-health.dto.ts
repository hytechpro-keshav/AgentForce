import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsInt,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

export const REVENUE_HEALTH_BANDS = [
  "excellent",
  "healthy",
  "watch",
  "at_risk",
  "critical",
  "unknown"
] as const;
export type RevenueHealthBandDto = (typeof REVENUE_HEALTH_BANDS)[number];

export const REVENUE_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
  "unknown"
] as const;
export type RevenueRiskLevelDto = (typeof REVENUE_RISK_LEVELS)[number];

export const REVENUE_OPPORTUNITY_LEVELS = [
  "low",
  "medium",
  "high",
  "unknown"
] as const;
export type RevenueOpportunityLevelDto =
  (typeof REVENUE_OPPORTUNITY_LEVELS)[number];

export const REVENUE_ENGAGEMENT_LEVELS = [
  "strong",
  "steady",
  "weak",
  "unknown"
] as const;
export type RevenueEngagementLevelDto =
  (typeof REVENUE_ENGAGEMENT_LEVELS)[number];

export const REVENUE_CONFIDENCES = ["low", "medium", "high"] as const;
export type RevenueConfidenceDto = (typeof REVENUE_CONFIDENCES)[number];

export const REVENUE_ACCOUNT_ANALYSIS_INTENTS = [
  "general",
  "qbr_preparation",
  "renewal_readiness",
  "churn_risk",
  "expansion_upside",
  "future_revenue",
  "risk_severity",
  "next_action"
] as const;
export type RevenueAccountAnalysisIntentDto =
  (typeof REVENUE_ACCOUNT_ANALYSIS_INTENTS)[number];

export const REVENUE_PORTFOLIO_STATUSES = [
  "STABLE",
  "WATCH",
  "ATTENTION_REQUIRED",
  "CRITICAL",
  "INSUFFICIENT_DATA"
] as const;
export type RevenuePortfolioStatusDto =
  (typeof REVENUE_PORTFOLIO_STATUSES)[number];

export const REVENUE_PORTFOLIO_FOCUS_VALUES = [
  "general",
  "risk",
  "expansion",
  "churn",
  "weekly_plan"
] as const;
export type RevenuePortfolioFocusDto =
  (typeof REVENUE_PORTFOLIO_FOCUS_VALUES)[number];

const SAFE_REVENUE_REQUEST_ID_PATTERN =
  /^(?![A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$)[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_REVENUE_ACCOUNT_REFERENCE_PATTERN = /^account-[1-9][0-9]{0,2}$/;

export class RevenueAccountHealthRequestDto {
  @IsOptional()
  @IsIn([...REVENUE_ACCOUNT_ANALYSIS_INTENTS])
  analysisIntent?: RevenueAccountAnalysisIntentDto;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountIndustry?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  annualRevenue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  employeeCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(36500)
  accountAgeDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  openOpportunityCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  openOpportunityAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weightedPipelineAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-3650)
  @Max(3650)
  daysToNextCloseDate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  wonOpportunityCountLast180Days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lostOpportunityCountLast180Days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  renewalOpportunityCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  renewalOpportunityAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expansionOpportunityCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expansionOpportunityAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  openCaseCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  escalatedCaseCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  highPriorityCaseCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  oldestOpenCaseAgeDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  activityCountLast30Days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  daysSinceLastActivity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  executiveActivityCountLast90Days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  activeProjectCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  atRiskProjectCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lateMilestoneCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  openResourceRequestCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  avgProjectMarginPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalProjectRemainingAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  overdueInvoiceCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overdueInvoiceAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  averagePaymentDelayDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  marginPressureAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  productActiveUserCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  productUsageTrendPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  featureAdoptionPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceSystems?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(SAFE_REVENUE_REQUEST_ID_PATTERN)
  requestId?: string;
}

export class RevenuePortfolioAccountFactsDto extends RevenueAccountHealthRequestDto {
  @IsString()
  @MaxLength(64)
  @Matches(SAFE_REVENUE_ACCOUNT_REFERENCE_PATTERN)
  accountReference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountSegment?: string;
}

export class RevenuePortfolioIntelligenceRequestDto {
  @IsOptional()
  @IsIn([...REVENUE_PORTFOLIO_FOCUS_VALUES])
  analysisFocus?: RevenuePortfolioFocusDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => RevenuePortfolioAccountFactsDto)
  accounts?: RevenuePortfolioAccountFactsDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceSystems?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(SAFE_REVENUE_REQUEST_ID_PATTERN)
  requestId?: string;
}

export interface RevenuePortfolioRankedAccountDto {
  accountReference: string;
  rank: number;
  score: number | null;
  level: string;
  reason: string;
  supportingSignals: string[];
  recommendedAction: string;
}

export interface RevenuePortfolioWatchlistDto {
  name: string;
  accountReferences: string[];
  rationale: string;
}

export interface RevenuePortfolioTrendDto {
  trend: string;
  direction: string;
  severity: string;
  rationale: string;
}

export interface RevenuePortfolioRecommendedActionDto {
  priority: string;
  action: string;
  accountReferences: string[];
  rationale: string;
}

export interface RevenuePortfolioWeeklyPlanDayDto {
  day: string;
  actions: string[];
}

export interface RevenuePortfolioIntelligenceResponseDto {
  portfolioStatus: RevenuePortfolioStatusDto;
  summary: string;
  topRiskAccounts: RevenuePortfolioRankedAccountDto[];
  topExpansionAccounts: RevenuePortfolioRankedAccountDto[];
  urgentRenewals: RevenuePortfolioRankedAccountDto[];
  escalationAccounts: RevenuePortfolioRankedAccountDto[];
  silentAccounts: RevenuePortfolioRankedAccountDto[];
  portfolioWatchlists: RevenuePortfolioWatchlistDto[];
  portfolioTrends: RevenuePortfolioTrendDto[];
  recommendedActions: RevenuePortfolioRecommendedActionDto[];
  weeklyExecutionPlan: RevenuePortfolioWeeklyPlanDayDto[];
  provider: string;
  model: string;
  fallbackUsed: boolean;
  decisionFallbackUsed: boolean;
  latencyMs: number;
}

export interface RevenueAccountHealthResponseDto {
  accountHealthScore: number | null;
  accountHealthBand: RevenueHealthBandDto;
  churnRiskScore: number | null;
  churnRiskLevel: RevenueRiskLevelDto;
  expansionScore: number | null;
  expansionLevel: RevenueOpportunityLevelDto;
  deliveryRiskLevel: RevenueRiskLevelDto;
  financialRiskLevel: RevenueRiskLevelDto;
  supportRiskLevel: RevenueRiskLevelDto;
  executiveEngagementLevel: RevenueEngagementLevelDto;
  primaryDecision: string;
  summary: string;
  decisionRationale: string;
  revenueImpact: string;
  operationalBlockers: string;
  recommendedActions: string;
  confidence: RevenueConfidenceDto;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

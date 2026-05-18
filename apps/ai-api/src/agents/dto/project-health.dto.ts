import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min
} from "class-validator";

export const PROJECT_HEALTH_STATUSES = ["green", "yellow", "red"] as const;
export type ProjectHealthStatusDto = (typeof PROJECT_HEALTH_STATUSES)[number];

const SAFE_PROJECT_HEALTH_REQUEST_ID_PATTERN =
  /^(?![A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$)[A-Za-z0-9_.:-]{1,64}$/;

export const PROJECT_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical"
] as const;
export type ProjectRiskLevelDto = (typeof PROJECT_RISK_LEVELS)[number];

export const PROJECT_HEALTH_CONFIDENCES = ["low", "medium", "high"] as const;
export type ProjectHealthConfidenceDto =
  (typeof PROJECT_HEALTH_CONFIDENCES)[number];

export class ProjectHealthRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  projectReference?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value
  )
  @IsIn(PROJECT_HEALTH_STATUSES)
  projectStatus?: ProjectHealthStatusDto;

  @IsOptional()
  @IsISO8601({ strict: true })
  projectStartDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  projectEndDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-3650)
  @Max(3650)
  daysUntilEnd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percentHoursComplete?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  plannedHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimatedHoursAtCompletion?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  remainingAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  marginPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  assignmentCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  activeAssignmentCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  assignmentAtRiskCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  avgAssignmentAllocationPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  milestoneCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lateMilestoneCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  completedMilestoneCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timecardHeaderCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  submittedTimecardCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rejectedTimecardCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  approvedTimecardCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalTimecardHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  projectTaskCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  openProjectTaskCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  overdueProjectTaskCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  resourceRequestCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  openResourceRequestCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  closeToStartResourceRequestCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetConsumedAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budgetRemainingAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(SAFE_PROJECT_HEALTH_REQUEST_ID_PATTERN)
  requestId?: string;
}

export interface ProjectHealthResponseDto {
  healthStatus: ProjectHealthStatusDto;
  riskLevel: ProjectRiskLevelDto;
  scheduleStatus: ProjectHealthStatusDto;
  budgetStatus: ProjectHealthStatusDto;
  staffingStatus: ProjectHealthStatusDto;
  summary: string;
  riskDrivers: string;
  recommendedActions: string;
  confidence: ProjectHealthConfidenceDto;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

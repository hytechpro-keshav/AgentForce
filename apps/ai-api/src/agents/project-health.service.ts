import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { ModelRouter } from "../llm/model-router";
import { TelemetryService } from "../observability/telemetry.service";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import {
  PROJECT_HEALTH_CONFIDENCES,
  PROJECT_HEALTH_STATUSES,
  type ProjectHealthConfidenceDto,
  type ProjectHealthRequestDto,
  type ProjectHealthResponseDto,
  type ProjectHealthStatusDto,
  type ProjectRiskLevelDto
} from "./dto/project-health.dto";

const PROJECT_HEALTH_SYSTEM_PROMPT = [
  "You are a services delivery health analyst for Salesforce Agentforce.",
  "You receive only sanitized aggregate Certinia PSA facts from Apex.",
  "Return ONLY a single JSON object with keys: summary, riskDrivers,",
  "recommendedActions, confidence. Keep summary <=220 chars, riskDrivers",
  "<=300 chars, recommendedActions <=300 chars. Use semicolon-separated",
  "phrases for riskDrivers and recommendedActions. Do not include customer",
  "names, account names, project names, raw Salesforce ids, notes, prompts,",
  "credentials, or markdown. The deterministic status fields are provided",
  "by the service and must not be contradicted."
].join(" ");

interface DeterministicAssessment {
  healthStatus: ProjectHealthStatusDto;
  riskLevel: ProjectRiskLevelDto;
  scheduleStatus: ProjectHealthStatusDto;
  budgetStatus: ProjectHealthStatusDto;
  staffingStatus: ProjectHealthStatusDto;
  summary: string;
  riskDrivers: string;
  recommendedActions: string;
  confidence: ProjectHealthConfidenceDto;
}

interface ProjectHealthNarrative {
  summary?: string;
  riskDrivers?: string;
  recommendedActions?: string;
  confidence?: ProjectHealthConfidenceDto;
}

@Injectable()
export class ProjectHealthService {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly telemetry: TelemetryService
  ) {}

  async summarize(
    request: ProjectHealthRequestDto,
    principal?: AuthPrincipal
  ): Promise<ProjectHealthResponseDto> {
    const startedAt = Date.now();
    const deterministic = ProjectHealthService.assess(request);
    const llmRequest: LlmChatRequest = {
      requestId: request.requestId,
      useCase: "agentforce_services_project_health",
      tenantId: principal?.tenantId,
      clientId: principal?.tenantId ?? principal?.subject,
      surface: "agentforce",
      complexity: "standard",
      maxTokens: 320,
      temperature: 0,
      messages: [
        { role: "system", content: PROJECT_HEALTH_SYSTEM_PROMPT },
        {
          role: "user",
          content: ProjectHealthService.buildPromptFacts(request, deterministic)
        }
      ]
    };

    try {
      const response = await this.modelRouter.chat(llmRequest);
      const narrative = ProjectHealthService.parseNarrative(response.content);
      const narrativeFallbackUsed =
        !narrative.summary ||
        !narrative.riskDrivers ||
        !narrative.recommendedActions;
      const result: ProjectHealthResponseDto = {
        healthStatus: deterministic.healthStatus,
        riskLevel: deterministic.riskLevel,
        scheduleStatus: deterministic.scheduleStatus,
        budgetStatus: deterministic.budgetStatus,
        staffingStatus: deterministic.staffingStatus,
        summary: ProjectHealthService.safeNarrativeText(
          narrative.summary,
          deterministic.summary,
          220
        ),
        riskDrivers: ProjectHealthService.safeNarrativeText(
          narrative.riskDrivers,
          deterministic.riskDrivers,
          300
        ),
        recommendedActions: ProjectHealthService.safeNarrativeText(
          narrative.recommendedActions,
          deterministic.recommendedActions,
          300
        ),
        confidence: narrative.confidence ?? deterministic.confidence,
        provider: response.metadata.provider,
        model: response.metadata.model,
        fallbackUsed: response.metadata.fallbackUsed,
        latencyMs: response.metadata.latencyMs
      };

      this.telemetry.recordAgentWorkflow({
        operation: "services.project_health",
        requestId: request.requestId,
        tenantId: principal?.tenantId,
        useCase: "agentforce_services_project_health",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackUsed: result.fallbackUsed,
        narrativeFallbackUsed,
        healthStatus: result.healthStatus,
        riskLevel: result.riskLevel,
        outcome: "success",
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens
      });

      return result;
    } catch (err) {
      this.telemetry.recordAgentWorkflow({
        operation: "services.project_health",
        requestId: request.requestId,
        tenantId: principal?.tenantId,
        useCase: "agentforce_services_project_health",
        latencyMs: Date.now() - startedAt,
        outcome: "error",
        errorKind: ProjectHealthService.errorKind(err)
      });
      throw err;
    }
  }

  private static assess(
    request: ProjectHealthRequestDto
  ): DeterministicAssessment {
    const drivers: string[] = [];
    const actions: string[] = [];
    const projectStatus = ProjectHealthService.normalizeStatus(
      request.projectStatus
    );
    let scheduleScore = ProjectHealthService.statusScore(projectStatus);
    let budgetScore = 0;
    let staffingScore = 0;

    if ((request.lateMilestoneCount ?? 0) >= 3) {
      scheduleScore += 3;
      drivers.push(`${request.lateMilestoneCount} late milestones`);
      actions.push("rebaseline milestone owners and recovery dates");
    } else if ((request.lateMilestoneCount ?? 0) > 0) {
      scheduleScore += 2;
      drivers.push(`${request.lateMilestoneCount} late milestones`);
      actions.push("review late milestones with the project manager");
    }

    if ((request.overdueProjectTaskCount ?? 0) > 0) {
      scheduleScore += 1;
      drivers.push(`${request.overdueProjectTaskCount} overdue project tasks`);
      actions.push("clear overdue task blockers");
    }

    if (
      request.daysUntilEnd !== undefined &&
      request.daysUntilEnd < 0 &&
      (request.percentHoursComplete ?? 0) < 95
    ) {
      scheduleScore += 2;
      drivers.push("project end date has passed before completion");
      actions.push("confirm revised delivery date and customer communication");
    }

    if ((request.rejectedTimecardCount ?? 0) > 0) {
      scheduleScore += 1;
      drivers.push(`${request.rejectedTimecardCount} rejected timecards`);
      actions.push("resolve rejected timecards before delivery review");
    }

    if ((request.submittedTimecardCount ?? 0) > 0) {
      drivers.push(
        `${request.submittedTimecardCount} submitted timecards awaiting approval`
      );
      actions.push("review submitted timecards for approval exceptions");
    }

    const plannedHours = request.plannedHours ?? 0;
    const eacHours = request.estimatedHoursAtCompletion ?? 0;
    if (plannedHours > 0 && eacHours > plannedHours * 1.2) {
      budgetScore += 3;
      drivers.push(
        "estimated hours exceed planned hours by more than 20 percent"
      );
      actions.push("review scope, burn, and change order options");
    } else if (plannedHours > 0 && eacHours > plannedHours * 1.05) {
      budgetScore += 1;
      drivers.push("estimated hours are trending above plan");
      actions.push("monitor forecasted hours against remaining work");
    }

    if ((request.remainingAmount ?? 0) < 0) {
      budgetScore += 3;
      drivers.push("project remaining amount is negative");
      actions.push("review budget consumption and revenue impact");
    }

    if ((request.budgetRemainingAmount ?? 0) < 0) {
      budgetScore += 3;
      drivers.push("budget remaining amount is negative");
      actions.push("review budget records for over-consumption");
    }

    if ((request.marginPercent ?? 100) < 0) {
      budgetScore += 3;
      drivers.push("project margin is negative");
      actions.push("review margin drivers with delivery leadership");
    } else if ((request.marginPercent ?? 100) < 15) {
      budgetScore += 1;
      drivers.push("project margin is below 15 percent");
      actions.push("monitor margin and staffing mix");
    }

    if ((request.openResourceRequestCount ?? 0) > 0) {
      staffingScore += 2;
      drivers.push(
        `${request.openResourceRequestCount} open resource requests`
      );
      actions.push("prioritize open staffing demand");
    }

    if ((request.closeToStartResourceRequestCount ?? 0) > 0) {
      staffingScore += 1;
      drivers.push("resource requests are close to start date");
      actions.push("confirm staffing coverage for near-term work");
    }

    if ((request.assignmentAtRiskCount ?? 0) > 0) {
      staffingScore += 2;
      drivers.push(
        `${request.assignmentAtRiskCount} assignments need attention`
      );
      actions.push("review assignment end dates and remaining effort");
    }

    if (
      (request.assignmentCount ?? 0) === 0 &&
      (request.plannedHours ?? 0) > 0
    ) {
      staffingScore += 2;
      drivers.push("planned hours exist without assignments");
      actions.push("create or confirm delivery assignments");
    }

    if (drivers.length === 0) {
      drivers.push("no major deterministic risk drivers detected");
      actions.push("continue normal project health monitoring");
    }

    const scheduleStatus = ProjectHealthService.scoreToStatus(scheduleScore);
    const budgetStatus = ProjectHealthService.scoreToStatus(budgetScore);
    const staffingStatus = ProjectHealthService.scoreToStatus(staffingScore);
    const healthStatus = ProjectHealthService.worstStatus([
      scheduleStatus,
      budgetStatus,
      staffingStatus,
      projectStatus ?? "green"
    ]);
    const totalScore = scheduleScore + budgetScore + staffingScore;
    const riskLevel = ProjectHealthService.scoreToRiskLevel(
      totalScore,
      healthStatus
    );
    const confidence = ProjectHealthService.estimateConfidence(request);

    return {
      healthStatus,
      riskLevel,
      scheduleStatus,
      budgetStatus,
      staffingStatus,
      summary: ProjectHealthService.defaultSummary(
        healthStatus,
        riskLevel,
        scheduleStatus,
        budgetStatus,
        staffingStatus
      ),
      riskDrivers: ProjectHealthService.uniqueList(drivers).join("; "),
      recommendedActions: ProjectHealthService.uniqueList(actions).join("; "),
      confidence
    };
  }

  private static buildPromptFacts(
    request: ProjectHealthRequestDto,
    assessment: DeterministicAssessment
  ): string {
    const facts = [
      `Deterministic healthStatus: ${assessment.healthStatus}`,
      `Deterministic riskLevel: ${assessment.riskLevel}`,
      `Deterministic scheduleStatus: ${assessment.scheduleStatus}`,
      `Deterministic budgetStatus: ${assessment.budgetStatus}`,
      `Deterministic staffingStatus: ${assessment.staffingStatus}`,
      `Project status: ${ProjectHealthService.safeMetric(request.projectStatus)}`,
      `Days until end: ${ProjectHealthService.safeMetric(request.daysUntilEnd)}`,
      `Percent hours complete: ${ProjectHealthService.safeMetric(
        request.percentHoursComplete
      )}`,
      `Planned hours: ${ProjectHealthService.safeMetric(request.plannedHours)}`,
      `Estimated hours at completion: ${ProjectHealthService.safeMetric(
        request.estimatedHoursAtCompletion
      )}`,
      `Remaining amount: ${ProjectHealthService.safeMetric(request.remainingAmount)}`,
      `Margin percent: ${ProjectHealthService.safeMetric(request.marginPercent)}`,
      `Assignments: total=${ProjectHealthService.safeMetric(
        request.assignmentCount
      )}, active=${ProjectHealthService.safeMetric(
        request.activeAssignmentCount
      )}, atRisk=${ProjectHealthService.safeMetric(request.assignmentAtRiskCount)}`,
      `Milestones: total=${ProjectHealthService.safeMetric(
        request.milestoneCount
      )}, late=${ProjectHealthService.safeMetric(
        request.lateMilestoneCount
      )}, completed=${ProjectHealthService.safeMetric(
        request.completedMilestoneCount
      )}`,
      `Timecards: total=${ProjectHealthService.safeMetric(
        request.timecardHeaderCount
      )}, submitted=${ProjectHealthService.safeMetric(
        request.submittedTimecardCount
      )}, rejected=${ProjectHealthService.safeMetric(
        request.rejectedTimecardCount
      )}, approved=${ProjectHealthService.safeMetric(
        request.approvedTimecardCount
      )}, hours=${ProjectHealthService.safeMetric(request.totalTimecardHours)}`,
      `Tasks: total=${ProjectHealthService.safeMetric(
        request.projectTaskCount
      )}, open=${ProjectHealthService.safeMetric(
        request.openProjectTaskCount
      )}, overdue=${ProjectHealthService.safeMetric(request.overdueProjectTaskCount)}`,
      `Resource requests: total=${ProjectHealthService.safeMetric(
        request.resourceRequestCount
      )}, open=${ProjectHealthService.safeMetric(
        request.openResourceRequestCount
      )}, closeToStart=${ProjectHealthService.safeMetric(
        request.closeToStartResourceRequestCount
      )}`,
      `Budgets: count=${ProjectHealthService.safeMetric(
        request.budgetCount
      )}, amount=${ProjectHealthService.safeMetric(
        request.budgetAmount
      )}, consumed=${ProjectHealthService.safeMetric(
        request.budgetConsumedAmount
      )}, remaining=${ProjectHealthService.safeMetric(
        request.budgetRemainingAmount
      )}`,
      `Deterministic riskDrivers: ${assessment.riskDrivers}`,
      `Deterministic recommendedActions: ${assessment.recommendedActions}`
    ];
    return facts.join("\n");
  }

  private static parseNarrative(content: string): ProjectHealthNarrative {
    const trimmed = content.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      const jsonSlice =
        start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
      const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;
      const confidenceRaw =
        typeof parsed["confidence"] === "string"
          ? (parsed["confidence"] as string).toLowerCase()
          : undefined;
      const confidence = PROJECT_HEALTH_CONFIDENCES.includes(
        confidenceRaw as ProjectHealthConfidenceDto
      )
        ? (confidenceRaw as ProjectHealthConfidenceDto)
        : undefined;
      return {
        summary: ProjectHealthService.optionalNarrativeString(
          parsed["summary"]
        ),
        riskDrivers: ProjectHealthService.optionalNarrativeString(
          parsed["riskDrivers"]
        ),
        recommendedActions: ProjectHealthService.optionalNarrativeString(
          parsed["recommendedActions"]
        ),
        confidence
      };
    } catch {
      return {};
    }
  }

  private static defaultSummary(
    healthStatus: ProjectHealthStatusDto,
    riskLevel: ProjectRiskLevelDto,
    scheduleStatus: ProjectHealthStatusDto,
    budgetStatus: ProjectHealthStatusDto,
    staffingStatus: ProjectHealthStatusDto
  ): string {
    return `Project health is ${healthStatus} with ${riskLevel} delivery risk; schedule is ${scheduleStatus}, budget is ${budgetStatus}, and staffing is ${staffingStatus}.`;
  }

  private static normalizeStatus(
    status: string | undefined
  ): ProjectHealthStatusDto | undefined {
    const normalized = status?.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    return PROJECT_HEALTH_STATUSES.includes(
      normalized as ProjectHealthStatusDto
    )
      ? (normalized as ProjectHealthStatusDto)
      : undefined;
  }

  private static statusScore(
    status: ProjectHealthStatusDto | undefined
  ): number {
    if (status === "red") return 3;
    if (status === "yellow") return 1;
    return 0;
  }

  private static scoreToStatus(score: number): ProjectHealthStatusDto {
    if (score >= 3) return "red";
    if (score >= 1) return "yellow";
    return "green";
  }

  private static worstStatus(
    statuses: ProjectHealthStatusDto[]
  ): ProjectHealthStatusDto {
    if (statuses.includes("red")) return "red";
    if (statuses.includes("yellow")) return "yellow";
    return "green";
  }

  private static scoreToRiskLevel(
    score: number,
    healthStatus: ProjectHealthStatusDto
  ): ProjectRiskLevelDto {
    if (healthStatus === "red" && score >= 7) return "critical";
    if (healthStatus === "red" || score >= 5) return "high";
    if (healthStatus === "yellow" || score >= 2) return "medium";
    return "low";
  }

  private static estimateConfidence(
    request: ProjectHealthRequestDto
  ): ProjectHealthConfidenceDto {
    const populatedSignals = [
      request.projectStatus,
      request.percentHoursComplete,
      request.plannedHours,
      request.estimatedHoursAtCompletion,
      request.remainingAmount,
      request.marginPercent,
      request.assignmentCount,
      request.milestoneCount,
      request.timecardHeaderCount,
      request.projectTaskCount,
      request.resourceRequestCount,
      request.budgetCount
    ].filter((value) => value !== undefined && value !== null).length;
    if (populatedSignals >= 7) return "high";
    if (populatedSignals >= 3) return "medium";
    return "low";
  }

  private static safeMetric(value: string | number | undefined): string {
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "unknown";
    }
    if (typeof value === "string" && value.trim()) {
      return redactSensitiveText(value.trim()).slice(0, 80);
    }
    return "unknown";
  }

  private static safeText(value: string, maxLength: number): string {
    const redacted = redactSensitiveText(value).replace(/\s+/g, " ").trim();
    return redacted.slice(0, maxLength);
  }

  private static optionalNarrativeString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private static safeNarrativeText(
    value: string | undefined,
    fallback: string,
    maxLength: number
  ): string {
    const safeValue = value
      ? ProjectHealthService.safeText(value, maxLength)
      : "";
    return safeValue || ProjectHealthService.safeText(fallback, maxLength);
  }

  private static errorKind(err: unknown): string {
    if (err instanceof LlmProviderError) {
      return err.kind;
    }
    return err instanceof Error ? err.name : "unknown";
  }

  private static uniqueList(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()))).filter(
      Boolean
    );
  }
}

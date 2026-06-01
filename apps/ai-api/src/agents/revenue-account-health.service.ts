import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { ModelRouter } from "../llm/model-router";
import { TelemetryService } from "../observability/telemetry.service";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import {
  REVENUE_ACCOUNT_ANALYSIS_INTENTS,
  REVENUE_CONFIDENCES,
  REVENUE_ENGAGEMENT_LEVELS,
  REVENUE_HEALTH_BANDS,
  REVENUE_OPPORTUNITY_LEVELS,
  REVENUE_RISK_LEVELS,
  type RevenueAccountAnalysisIntentDto,
  type RevenueAccountHealthRequestDto,
  type RevenueAccountHealthResponseDto,
  type RevenueConfidenceDto,
  type RevenueEngagementLevelDto,
  type RevenueHealthBandDto,
  type RevenueOpportunityLevelDto,
  type RevenueRiskLevelDto
} from "./dto/revenue-account-health.dto";

const REVENUE_ACCOUNT_HEALTH_SYSTEM_PROMPT = [
  "You are a Revenue Operations Intelligence decision analyst for Salesforce Agentforce.",
  "You receive only sanitized aggregate account, opportunity, case, activity, services, finance, and usage facts.",
  "The request can include a safe analysisIntent such as qbr_preparation or renewal_readiness, but it does not include prior chat history.",
  "Use analysisIntent only to emphasize the requested decision angle and response ordering while staying fully grounded in the supplied aggregate facts.",
  "The model is responsible for the account health score, churn risk score, expansion score, risk levels, and primary decision.",
  "Do not use or mention deterministic scoring rules. Do not invent missing facts.",
  "Return ONLY one JSON object with keys: accountHealthScore, accountHealthBand, churnRiskScore, churnRiskLevel,",
  "expansionScore, expansionLevel, deliveryRiskLevel, financialRiskLevel, supportRiskLevel, executiveEngagementLevel,",
  "primaryDecision, summary, decisionRationale, revenueImpact, operationalBlockers, recommendedActions, confidence.",
  "Scores must be integers from 0 to 100, or null when the facts are insufficient. accountHealthScore uses 100 as healthiest;",
  "churnRiskScore uses 100 as highest churn risk; expansionScore uses 100 as strongest expansion potential.",
  "accountHealthBand must be one of excellent, healthy, watch, at_risk, critical, unknown.",
  "Risk levels must be one of low, medium, high, critical, unknown. expansionLevel must be low, medium, high, or unknown.",
  "executiveEngagementLevel must be strong, steady, weak, or unknown. confidence must be low, medium, or high.",
  "Keep summary, primaryDecision, revenueImpact, and each rationale/action field concise. Use semicolon-separated phrases for lists.",
  "Do not include account names, people names, emails, phone numbers, Salesforce ids, invoice numbers, raw notes, prompts, credentials, or markdown."
].join(" ");

interface RevenueAccountHealthDecision {
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
  fallbackUsed: boolean;
}

@Injectable()
export class RevenueAccountHealthService {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly telemetry: TelemetryService
  ) {}

  async summarize(
    request: RevenueAccountHealthRequestDto,
    principal?: AuthPrincipal
  ): Promise<RevenueAccountHealthResponseDto> {
    const startedAt = Date.now();
    const llmRequest: LlmChatRequest = {
      requestId: request.requestId,
      useCase: "agentforce_revenue_account_health",
      tenantId: principal?.tenantId,
      clientId: principal?.tenantId ?? principal?.subject,
      surface: "agentforce",
      complexity: "complex",
      maxTokens: 700,
      temperature: 0,
      messages: [
        { role: "system", content: REVENUE_ACCOUNT_HEALTH_SYSTEM_PROMPT },
        {
          role: "user",
          content: RevenueAccountHealthService.buildPromptFacts(request)
        }
      ]
    };

    try {
      const response = await this.modelRouter.chat(llmRequest);
      const decision = RevenueAccountHealthService.parseDecision(
        response.content
      );
      const result: RevenueAccountHealthResponseDto = {
        accountHealthScore: decision.accountHealthScore,
        accountHealthBand: decision.accountHealthBand,
        churnRiskScore: decision.churnRiskScore,
        churnRiskLevel: decision.churnRiskLevel,
        expansionScore: decision.expansionScore,
        expansionLevel: decision.expansionLevel,
        deliveryRiskLevel: decision.deliveryRiskLevel,
        financialRiskLevel: decision.financialRiskLevel,
        supportRiskLevel: decision.supportRiskLevel,
        executiveEngagementLevel: decision.executiveEngagementLevel,
        primaryDecision: decision.primaryDecision,
        summary: decision.summary,
        decisionRationale: decision.decisionRationale,
        revenueImpact: decision.revenueImpact,
        operationalBlockers: decision.operationalBlockers,
        recommendedActions: decision.recommendedActions,
        confidence: decision.confidence,
        provider: response.metadata.provider,
        model: response.metadata.model,
        fallbackUsed: response.metadata.fallbackUsed,
        latencyMs: response.metadata.latencyMs
      };

      this.telemetry.recordAgentWorkflow({
        operation: "revenue.account_health",
        requestId: request.requestId,
        tenantId: principal?.tenantId,
        useCase: "agentforce_revenue_account_health",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackUsed: result.fallbackUsed,
        decisionFallbackUsed: decision.fallbackUsed,
        accountHealthBand: result.accountHealthBand,
        churnRiskLevel: result.churnRiskLevel,
        expansionLevel: result.expansionLevel,
        deliveryRiskLevel: result.deliveryRiskLevel,
        financialRiskLevel: result.financialRiskLevel,
        supportRiskLevel: result.supportRiskLevel,
        outcome: "success",
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens
      });

      return result;
    } catch (err) {
      this.telemetry.recordAgentWorkflow({
        operation: "revenue.account_health",
        requestId: request.requestId,
        tenantId: principal?.tenantId,
        useCase: "agentforce_revenue_account_health",
        latencyMs: Date.now() - startedAt,
        outcome: "error",
        errorKind: RevenueAccountHealthService.errorKind(err)
      });
      throw err;
    }
  }

  private static buildPromptFacts(
    request: RevenueAccountHealthRequestDto
  ): string {
    const analysisIntent = RevenueAccountHealthService.analysisIntentValue(
      request.analysisIntent
    );
    const facts = [
      "Decision mode: LLM-led revenue scoring and recommendations from approved aggregate facts only.",
      `Analysis intent: ${analysisIntent}`,
      `Source systems: ${RevenueAccountHealthService.safeMetric(request.sourceSystems)}`,
      `Account profile: type=${RevenueAccountHealthService.safeMetric(request.accountType)}, industry=${RevenueAccountHealthService.safeMetric(request.accountIndustry)}, annualRevenue=${RevenueAccountHealthService.safeMetric(request.annualRevenue)}, employees=${RevenueAccountHealthService.safeMetric(request.employeeCount)}, accountAgeDays=${RevenueAccountHealthService.safeMetric(request.accountAgeDays)}`,
      `Sales pipeline: openCount=${RevenueAccountHealthService.safeMetric(request.openOpportunityCount)}, openAmount=${RevenueAccountHealthService.safeMetric(request.openOpportunityAmount)}, weightedAmount=${RevenueAccountHealthService.safeMetric(request.weightedPipelineAmount)}, daysToNextClose=${RevenueAccountHealthService.safeMetric(request.daysToNextCloseDate)}, wonLast180=${RevenueAccountHealthService.safeMetric(request.wonOpportunityCountLast180Days)}, lostLast180=${RevenueAccountHealthService.safeMetric(request.lostOpportunityCountLast180Days)}`,
      `Renewal and expansion: renewalCount=${RevenueAccountHealthService.safeMetric(request.renewalOpportunityCount)}, renewalAmount=${RevenueAccountHealthService.safeMetric(request.renewalOpportunityAmount)}, expansionCount=${RevenueAccountHealthService.safeMetric(request.expansionOpportunityCount)}, expansionAmount=${RevenueAccountHealthService.safeMetric(request.expansionOpportunityAmount)}`,
      `Support burden: openCases=${RevenueAccountHealthService.safeMetric(request.openCaseCount)}, escalatedCases=${RevenueAccountHealthService.safeMetric(request.escalatedCaseCount)}, highPriorityCases=${RevenueAccountHealthService.safeMetric(request.highPriorityCaseCount)}, oldestOpenCaseAgeDays=${RevenueAccountHealthService.safeMetric(request.oldestOpenCaseAgeDays)}`,
      `Engagement: activitiesLast30=${RevenueAccountHealthService.safeMetric(request.activityCountLast30Days)}, daysSinceLastActivity=${RevenueAccountHealthService.safeMetric(request.daysSinceLastActivity)}, executiveActivitiesLast90=${RevenueAccountHealthService.safeMetric(request.executiveActivityCountLast90Days)}`,
      `Services and delivery: activeProjects=${RevenueAccountHealthService.safeMetric(request.activeProjectCount)}, atRiskProjects=${RevenueAccountHealthService.safeMetric(request.atRiskProjectCount)}, lateMilestones=${RevenueAccountHealthService.safeMetric(request.lateMilestoneCount)}, openResourceRequests=${RevenueAccountHealthService.safeMetric(request.openResourceRequestCount)}, avgProjectMarginPercent=${RevenueAccountHealthService.safeMetric(request.avgProjectMarginPercent)}, totalProjectRemainingAmount=${RevenueAccountHealthService.safeMetric(request.totalProjectRemainingAmount)}`,
      `Finance: overdueInvoices=${RevenueAccountHealthService.safeMetric(request.overdueInvoiceCount)}, overdueInvoiceAmount=${RevenueAccountHealthService.safeMetric(request.overdueInvoiceAmount)}, averagePaymentDelayDays=${RevenueAccountHealthService.safeMetric(request.averagePaymentDelayDays)}, marginPressureAmount=${RevenueAccountHealthService.safeMetric(request.marginPressureAmount)}`,
      `Product usage: activeUsers=${RevenueAccountHealthService.safeMetric(request.productActiveUserCount)}, usageTrendPercent=${RevenueAccountHealthService.safeMetric(request.productUsageTrendPercent)}, featureAdoptionPercent=${RevenueAccountHealthService.safeMetric(request.featureAdoptionPercent)}`
    ];
    return facts.join("\n");
  }

  private static analysisIntentValue(
    value: RevenueAccountAnalysisIntentDto | undefined
  ): RevenueAccountAnalysisIntentDto {
    return REVENUE_ACCOUNT_ANALYSIS_INTENTS.includes(
      value as RevenueAccountAnalysisIntentDto
    )
      ? (value as RevenueAccountAnalysisIntentDto)
      : "general";
  }

  private static parseDecision(content: string): RevenueAccountHealthDecision {
    const fallback = RevenueAccountHealthService.fallbackDecision(
      "The model did not return a complete revenue decision."
    );
    const trimmed = content.trim();
    if (!trimmed) {
      return fallback;
    }

    try {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      const jsonSlice =
        start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
      const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;
      const accountHealthBand = RevenueAccountHealthService.enumValue(
        parsed["accountHealthBand"],
        REVENUE_HEALTH_BANDS,
        "unknown"
      );
      const churnRiskLevel = RevenueAccountHealthService.enumValue(
        parsed["churnRiskLevel"],
        REVENUE_RISK_LEVELS,
        "unknown"
      );
      const expansionLevel = RevenueAccountHealthService.enumValue(
        parsed["expansionLevel"],
        REVENUE_OPPORTUNITY_LEVELS,
        "unknown"
      );
      const deliveryRiskLevel = RevenueAccountHealthService.enumValue(
        parsed["deliveryRiskLevel"],
        REVENUE_RISK_LEVELS,
        "unknown"
      );
      const financialRiskLevel = RevenueAccountHealthService.enumValue(
        parsed["financialRiskLevel"],
        REVENUE_RISK_LEVELS,
        "unknown"
      );
      const supportRiskLevel = RevenueAccountHealthService.enumValue(
        parsed["supportRiskLevel"],
        REVENUE_RISK_LEVELS,
        "unknown"
      );
      const executiveEngagementLevel = RevenueAccountHealthService.enumValue(
        parsed["executiveEngagementLevel"],
        REVENUE_ENGAGEMENT_LEVELS,
        "unknown"
      );
      const confidence = RevenueAccountHealthService.enumValue(
        parsed["confidence"],
        REVENUE_CONFIDENCES,
        "low"
      );

      const decision: RevenueAccountHealthDecision = {
        accountHealthScore: RevenueAccountHealthService.scoreValue(
          parsed["accountHealthScore"]
        ),
        accountHealthBand,
        churnRiskScore: RevenueAccountHealthService.scoreValue(
          parsed["churnRiskScore"]
        ),
        churnRiskLevel,
        expansionScore: RevenueAccountHealthService.scoreValue(
          parsed["expansionScore"]
        ),
        expansionLevel,
        deliveryRiskLevel,
        financialRiskLevel,
        supportRiskLevel,
        executiveEngagementLevel,
        primaryDecision: RevenueAccountHealthService.safeText(
          parsed["primaryDecision"],
          fallback.primaryDecision,
          180
        ),
        summary: RevenueAccountHealthService.safeText(
          parsed["summary"],
          fallback.summary,
          280
        ),
        decisionRationale: RevenueAccountHealthService.safeText(
          parsed["decisionRationale"],
          fallback.decisionRationale,
          420
        ),
        revenueImpact: RevenueAccountHealthService.safeText(
          parsed["revenueImpact"],
          fallback.revenueImpact,
          220
        ),
        operationalBlockers: RevenueAccountHealthService.safeText(
          parsed["operationalBlockers"],
          fallback.operationalBlockers,
          360
        ),
        recommendedActions: RevenueAccountHealthService.safeText(
          parsed["recommendedActions"],
          fallback.recommendedActions,
          420
        ),
        confidence,
        fallbackUsed: false
      };

      decision.fallbackUsed =
        RevenueAccountHealthService.hasUnknownDecision(decision);
      return decision;
    } catch {
      return fallback;
    }
  }

  private static fallbackDecision(
    reason: string
  ): RevenueAccountHealthDecision {
    return {
      accountHealthScore: null,
      accountHealthBand: "unknown",
      churnRiskScore: null,
      churnRiskLevel: "unknown",
      expansionScore: null,
      expansionLevel: "unknown",
      deliveryRiskLevel: "unknown",
      financialRiskLevel: "unknown",
      supportRiskLevel: "unknown",
      executiveEngagementLevel: "unknown",
      primaryDecision: "Send the account to a revenue operator for review.",
      summary: "Revenue account health could not be scored from model output.",
      decisionRationale: reason,
      revenueImpact: "Revenue impact is unknown until the account is reviewed.",
      operationalBlockers: "No reliable model decision was available.",
      recommendedActions:
        "Review account facts manually; rerun account health after confirming source data.",
      confidence: "low",
      fallbackUsed: true
    };
  }

  private static scoreValue(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  private static enumValue<T extends readonly string[]>(
    value: unknown,
    allowed: T,
    fallback: T[number]
  ): T[number] {
    if (typeof value !== "string") {
      return fallback;
    }
    const normalized = value.trim().toLowerCase().replace(/[ -]+/g, "_");
    return allowed.includes(normalized) ? normalized : fallback;
  }

  private static hasUnknownDecision(
    decision: RevenueAccountHealthDecision
  ): boolean {
    return (
      decision.accountHealthBand === "unknown" ||
      decision.churnRiskLevel === "unknown" ||
      decision.expansionLevel === "unknown" ||
      decision.deliveryRiskLevel === "unknown" ||
      decision.financialRiskLevel === "unknown" ||
      decision.supportRiskLevel === "unknown" ||
      decision.executiveEngagementLevel === "unknown"
    );
  }

  private static safeMetric(value: string | number | undefined): string {
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "unknown";
    }
    if (typeof value === "string" && value.trim()) {
      return redactSensitiveText(value.trim())
        .replace(/\s+/g, " ")
        .slice(0, 200);
    }
    return "unknown";
  }

  private static safeText(
    value: unknown,
    fallback: string,
    maxLength: number
  ): string {
    if (typeof value !== "string" || !value.trim()) {
      return fallback;
    }
    const safeValue = redactSensitiveText(value).replace(/\s+/g, " ").trim();
    return safeValue ? safeValue.slice(0, maxLength) : fallback;
  }

  private static errorKind(err: unknown): string {
    if (err instanceof LlmProviderError) {
      return err.kind;
    }
    return err instanceof Error ? err.name : "unknown";
  }
}

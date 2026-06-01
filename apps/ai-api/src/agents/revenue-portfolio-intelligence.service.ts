import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import { ModelRouter } from "../llm/model-router";
import { TelemetryService } from "../observability/telemetry.service";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import {
  REVENUE_PORTFOLIO_STATUSES,
  type RevenuePortfolioAccountFactsDto,
  type RevenuePortfolioIntelligenceRequestDto,
  type RevenuePortfolioIntelligenceResponseDto,
  type RevenuePortfolioRankedAccountDto,
  type RevenuePortfolioRecommendedActionDto,
  type RevenuePortfolioStatusDto,
  type RevenuePortfolioTrendDto,
  type RevenuePortfolioWatchlistDto,
  type RevenuePortfolioWeeklyPlanDayDto
} from "./dto/revenue-account-health.dto";

const REVENUE_PORTFOLIO_SYSTEM_PROMPT = [
  "You are a Revenue Operations Intelligence portfolio analyst for Salesforce Agentforce.",
  "You receive only sanitized aggregate account facts keyed by accountReference values such as account-1.",
  "The backend supplies deterministic signal tags and rough pre-scores; use them as evidence, but the model owns portfolio status, ranking, trends, watchlists, and execution planning.",
  "Do not invent missing facts, do not mention deterministic formulas, and do not output account names, Salesforce ids, people names, emails, phone numbers, invoice numbers, prompts, credentials, or markdown.",
  "Return ONLY one JSON object with keys: portfolioStatus, summary, topRiskAccounts, topExpansionAccounts, urgentRenewals, escalationAccounts, silentAccounts, portfolioWatchlists, portfolioTrends, recommendedActions, weeklyExecutionPlan.",
  "portfolioStatus must be STABLE, WATCH, ATTENTION_REQUIRED, CRITICAL, or INSUFFICIENT_DATA.",
  "Ranked account arrays contain objects with accountReference, rank, score, level, reason, supportingSignals, recommendedAction.",
  "portfolioWatchlists contain name, accountReferences, rationale. portfolioTrends contain trend, direction, severity, rationale.",
  "recommendedActions contain priority, action, accountReferences, rationale. weeklyExecutionPlan contains day and actions.",
  "Keep each string concise, enterprise-safe, and grounded in the provided accountReference facts."
].join(" ");

const PORTFOLIO_MODEL_TIMEOUT_MS = 18_000;

class RevenuePortfolioModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Revenue portfolio model timed out after ${timeoutMs}ms.`);
    this.name = "RevenuePortfolioModelTimeoutError";
  }
}

interface ScoredPortfolioAccount {
  account: RevenuePortfolioAccountFactsDto;
  accountReference: string;
  riskScore: number;
  expansionScore: number;
  renewalUrgent: boolean;
  escalation: boolean;
  silent: boolean;
  churnSignal: boolean;
  riskSignals: string[];
  expansionSignals: string[];
}

interface PortfolioDecision {
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
  fallbackUsed: boolean;
}

@Injectable()
export class RevenuePortfolioIntelligenceService {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly telemetry: TelemetryService
  ) {}

  async analyze(
    request: RevenuePortfolioIntelligenceRequestDto,
    principal?: AuthPrincipal
  ): Promise<RevenuePortfolioIntelligenceResponseDto> {
    const startedAt = Date.now();
    const accounts = RevenuePortfolioIntelligenceService.normalizeAccounts(
      request.accounts
    );

    if (accounts.length === 0) {
      const result = RevenuePortfolioIntelligenceService.noDataResponse(
        Date.now() - startedAt
      );
      this.telemetry.recordAgentWorkflow({
        operation: "revenue.portfolio_intelligence",
        requestId: request.requestId,
        tenantId: principal?.tenantId,
        useCase: "agentforce_revenue_portfolio_intelligence",
        latencyMs: result.latencyMs,
        portfolioStatus: result.portfolioStatus,
        portfolioAccountCount: 0,
        outcome: "success"
      });
      return result;
    }

    const llmRequest: LlmChatRequest = {
      requestId: request.requestId,
      useCase: "agentforce_revenue_portfolio_intelligence",
      tenantId: principal?.tenantId,
      clientId: principal?.tenantId ?? principal?.subject,
      surface: "agentforce",
      complexity: "complex",
      maxTokens: 1100,
      temperature: 0,
      messages: [
        { role: "system", content: REVENUE_PORTFOLIO_SYSTEM_PROMPT },
        {
          role: "user",
          content: RevenuePortfolioIntelligenceService.buildPromptFacts(
            request,
            accounts
          )
        }
      ]
    };

    try {
      const response = await RevenuePortfolioIntelligenceService.withTimeout(
        this.modelRouter.chat(llmRequest),
        PORTFOLIO_MODEL_TIMEOUT_MS
      );
      const decision = RevenuePortfolioIntelligenceService.parseDecision(
        response.content,
        accounts
      );
      const result: RevenuePortfolioIntelligenceResponseDto = {
        portfolioStatus: decision.portfolioStatus,
        summary: decision.summary,
        topRiskAccounts: decision.topRiskAccounts,
        topExpansionAccounts: decision.topExpansionAccounts,
        urgentRenewals: decision.urgentRenewals,
        escalationAccounts: decision.escalationAccounts,
        silentAccounts: decision.silentAccounts,
        portfolioWatchlists: decision.portfolioWatchlists,
        portfolioTrends: decision.portfolioTrends,
        recommendedActions: decision.recommendedActions,
        weeklyExecutionPlan: decision.weeklyExecutionPlan,
        provider: response.metadata.provider,
        model: response.metadata.model,
        fallbackUsed: response.metadata.fallbackUsed,
        decisionFallbackUsed: decision.fallbackUsed,
        latencyMs: response.metadata.latencyMs
      };

      this.telemetry.recordAgentWorkflow({
        operation: "revenue.portfolio_intelligence",
        requestId: request.requestId,
        tenantId: principal?.tenantId,
        useCase: "agentforce_revenue_portfolio_intelligence",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackUsed: result.fallbackUsed,
        decisionFallbackUsed: result.decisionFallbackUsed,
        portfolioStatus: result.portfolioStatus,
        portfolioAccountCount: accounts.length,
        topRiskAccountCount: result.topRiskAccounts.length,
        watchlistCount: result.portfolioWatchlists.length,
        outcome: "success",
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens
      });

      return result;
    } catch (err) {
      if (err instanceof RevenuePortfolioModelTimeoutError) {
        const decision = RevenuePortfolioIntelligenceService.fallbackDecision(
          accounts,
          err.message
        );
        const result: RevenuePortfolioIntelligenceResponseDto = {
          portfolioStatus: decision.portfolioStatus,
          summary: decision.summary,
          topRiskAccounts: decision.topRiskAccounts,
          topExpansionAccounts: decision.topExpansionAccounts,
          urgentRenewals: decision.urgentRenewals,
          escalationAccounts: decision.escalationAccounts,
          silentAccounts: decision.silentAccounts,
          portfolioWatchlists: decision.portfolioWatchlists,
          portfolioTrends: decision.portfolioTrends,
          recommendedActions: decision.recommendedActions,
          weeklyExecutionPlan: decision.weeklyExecutionPlan,
          provider: "deterministic-fallback",
          model: "revenue-portfolio-signals-v1",
          fallbackUsed: true,
          decisionFallbackUsed: true,
          latencyMs: Date.now() - startedAt
        };

        this.telemetry.recordAgentWorkflow({
          operation: "revenue.portfolio_intelligence",
          requestId: request.requestId,
          tenantId: principal?.tenantId,
          useCase: "agentforce_revenue_portfolio_intelligence",
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          fallbackUsed: result.fallbackUsed,
          decisionFallbackUsed: result.decisionFallbackUsed,
          portfolioStatus: result.portfolioStatus,
          portfolioAccountCount: accounts.length,
          topRiskAccountCount: result.topRiskAccounts.length,
          watchlistCount: result.portfolioWatchlists.length,
          outcome: "success",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        });

        return result;
      }

      this.telemetry.recordAgentWorkflow({
        operation: "revenue.portfolio_intelligence",
        requestId: request.requestId,
        tenantId: principal?.tenantId,
        useCase: "agentforce_revenue_portfolio_intelligence",
        latencyMs: Date.now() - startedAt,
        outcome: "error",
        errorKind: RevenuePortfolioIntelligenceService.errorKind(err)
      });
      throw err;
    }
  }

  private static async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new RevenuePortfolioModelTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    });
  }

  private static normalizeAccounts(
    accounts: RevenuePortfolioAccountFactsDto[] | undefined
  ): RevenuePortfolioAccountFactsDto[] {
    const seen = new Set<string>();
    const normalized: RevenuePortfolioAccountFactsDto[] = [];
    for (const account of accounts ?? []) {
      const accountReference =
        typeof account.accountReference === "string"
          ? account.accountReference.trim()
          : "";
      if (
        !RevenuePortfolioIntelligenceService.isSafeAccountReference(
          accountReference
        ) ||
        seen.has(accountReference)
      ) {
        continue;
      }
      seen.add(accountReference);
      normalized.push({ ...account, accountReference });
      if (normalized.length >= 25) {
        break;
      }
    }
    return normalized;
  }

  private static buildPromptFacts(
    request: RevenuePortfolioIntelligenceRequestDto,
    accounts: RevenuePortfolioAccountFactsDto[]
  ): string {
    const scoredAccounts =
      RevenuePortfolioIntelligenceService.scoreAccounts(accounts);
    const urgentRenewals = scoredAccounts.filter(
      (account) => account.renewalUrgent
    ).length;
    const escalationAccounts = scoredAccounts.filter(
      (account) => account.escalation
    ).length;
    const silentAccounts = scoredAccounts.filter(
      (account) => account.silent
    ).length;
    const expansionAccounts = scoredAccounts.filter(
      (account) => account.expansionScore > 0
    ).length;

    const facts = [
      "Decision mode: portfolio-level LLM reasoning from approved aggregate facts only.",
      `Analysis focus: ${RevenuePortfolioIntelligenceService.safeMetric(request.analysisFocus ?? "general")}`,
      `Source systems: ${RevenuePortfolioIntelligenceService.safeMetric(request.sourceSystems)}`,
      `Portfolio aggregate: accounts=${accounts.length}, urgentRenewals=${urgentRenewals}, escalationAccounts=${escalationAccounts}, silentAccounts=${silentAccounts}, expansionSignalAccounts=${expansionAccounts}.`,
      "Accounts:"
    ];

    for (const scored of scoredAccounts) {
      const account = scored.account;
      facts.push(
        [
          `- accountReference=${scored.accountReference}`,
          `segment=${RevenuePortfolioIntelligenceService.safeMetric(account.accountSegment)}`,
          `profile(type=${RevenuePortfolioIntelligenceService.safeMetric(account.accountType)}, industry=${RevenuePortfolioIntelligenceService.safeMetric(account.accountIndustry)}, annualRevenue=${RevenuePortfolioIntelligenceService.safeMetric(account.annualRevenue)}, employees=${RevenuePortfolioIntelligenceService.safeMetric(account.employeeCount)}, ageDays=${RevenuePortfolioIntelligenceService.safeMetric(account.accountAgeDays)})`,
          `pipeline(openCount=${RevenuePortfolioIntelligenceService.safeMetric(account.openOpportunityCount)}, openAmount=${RevenuePortfolioIntelligenceService.safeMetric(account.openOpportunityAmount)}, weighted=${RevenuePortfolioIntelligenceService.safeMetric(account.weightedPipelineAmount)}, daysToNextClose=${RevenuePortfolioIntelligenceService.safeMetric(account.daysToNextCloseDate)}, won180=${RevenuePortfolioIntelligenceService.safeMetric(account.wonOpportunityCountLast180Days)}, lost180=${RevenuePortfolioIntelligenceService.safeMetric(account.lostOpportunityCountLast180Days)})`,
          `renewalExpansion(renewalCount=${RevenuePortfolioIntelligenceService.safeMetric(account.renewalOpportunityCount)}, renewalAmount=${RevenuePortfolioIntelligenceService.safeMetric(account.renewalOpportunityAmount)}, expansionCount=${RevenuePortfolioIntelligenceService.safeMetric(account.expansionOpportunityCount)}, expansionAmount=${RevenuePortfolioIntelligenceService.safeMetric(account.expansionOpportunityAmount)})`,
          `support(openCases=${RevenuePortfolioIntelligenceService.safeMetric(account.openCaseCount)}, escalated=${RevenuePortfolioIntelligenceService.safeMetric(account.escalatedCaseCount)}, highPriority=${RevenuePortfolioIntelligenceService.safeMetric(account.highPriorityCaseCount)}, oldestAgeDays=${RevenuePortfolioIntelligenceService.safeMetric(account.oldestOpenCaseAgeDays)})`,
          `engagement(activities30=${RevenuePortfolioIntelligenceService.safeMetric(account.activityCountLast30Days)}, daysSinceLastActivity=${RevenuePortfolioIntelligenceService.safeMetric(account.daysSinceLastActivity)}, executiveActivities90=${RevenuePortfolioIntelligenceService.safeMetric(account.executiveActivityCountLast90Days)})`,
          `services(activeProjects=${RevenuePortfolioIntelligenceService.safeMetric(account.activeProjectCount)}, atRiskProjects=${RevenuePortfolioIntelligenceService.safeMetric(account.atRiskProjectCount)}, lateMilestones=${RevenuePortfolioIntelligenceService.safeMetric(account.lateMilestoneCount)}, openResourceRequests=${RevenuePortfolioIntelligenceService.safeMetric(account.openResourceRequestCount)}, avgMargin=${RevenuePortfolioIntelligenceService.safeMetric(account.avgProjectMarginPercent)})`,
          `finance(overdueInvoices=${RevenuePortfolioIntelligenceService.safeMetric(account.overdueInvoiceCount)}, overdueAmount=${RevenuePortfolioIntelligenceService.safeMetric(account.overdueInvoiceAmount)}, paymentDelayDays=${RevenuePortfolioIntelligenceService.safeMetric(account.averagePaymentDelayDays)}, marginPressure=${RevenuePortfolioIntelligenceService.safeMetric(account.marginPressureAmount)})`,
          `usage(activeUsers=${RevenuePortfolioIntelligenceService.safeMetric(account.productActiveUserCount)}, usageTrendPercent=${RevenuePortfolioIntelligenceService.safeMetric(account.productUsageTrendPercent)}, featureAdoptionPercent=${RevenuePortfolioIntelligenceService.safeMetric(account.featureAdoptionPercent)})`,
          `deterministicSignals(riskPreScore=${scored.riskScore}, expansionPreScore=${scored.expansionScore}, riskSignals=${scored.riskSignals.join("; ") || "none"}, expansionSignals=${scored.expansionSignals.join("; ") || "none"})`
        ].join("; ")
      );
    }

    return facts.join("\n");
  }

  private static parseDecision(
    content: string,
    accounts: RevenuePortfolioAccountFactsDto[]
  ): PortfolioDecision {
    const fallback = RevenuePortfolioIntelligenceService.fallbackDecision(
      accounts,
      "The model did not return a complete portfolio decision."
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
      const validReferences = new Set(
        accounts.map((account) => account.accountReference)
      );
      const portfolioStatus =
        RevenuePortfolioIntelligenceService.portfolioStatus(
          parsed["portfolioStatus"],
          fallback.portfolioStatus
        );
      const portfolioArrays = [
        "topRiskAccounts",
        "topExpansionAccounts",
        "urgentRenewals",
        "escalationAccounts",
        "silentAccounts",
        "portfolioWatchlists",
        "portfolioTrends",
        "recommendedActions",
        "weeklyExecutionPlan"
      ];
      const partialFallbackUsed = portfolioArrays.some(
        (fieldName) => !Array.isArray(parsed[fieldName])
      );

      const decision: PortfolioDecision = {
        portfolioStatus,
        summary: RevenuePortfolioIntelligenceService.safeText(
          parsed["summary"],
          fallback.summary,
          360
        ),
        topRiskAccounts:
          RevenuePortfolioIntelligenceService.parseRankedAccounts(
            parsed["topRiskAccounts"],
            validReferences,
            fallback.topRiskAccounts
          ),
        topExpansionAccounts:
          RevenuePortfolioIntelligenceService.parseRankedAccounts(
            parsed["topExpansionAccounts"],
            validReferences,
            fallback.topExpansionAccounts
          ),
        urgentRenewals: RevenuePortfolioIntelligenceService.parseRankedAccounts(
          parsed["urgentRenewals"],
          validReferences,
          fallback.urgentRenewals
        ),
        escalationAccounts:
          RevenuePortfolioIntelligenceService.parseRankedAccounts(
            parsed["escalationAccounts"],
            validReferences,
            fallback.escalationAccounts
          ),
        silentAccounts: RevenuePortfolioIntelligenceService.parseRankedAccounts(
          parsed["silentAccounts"],
          validReferences,
          fallback.silentAccounts
        ),
        portfolioWatchlists:
          RevenuePortfolioIntelligenceService.parseWatchlists(
            parsed["portfolioWatchlists"],
            validReferences,
            fallback.portfolioWatchlists
          ),
        portfolioTrends: RevenuePortfolioIntelligenceService.parseTrends(
          parsed["portfolioTrends"],
          fallback.portfolioTrends
        ),
        recommendedActions: RevenuePortfolioIntelligenceService.parseActions(
          parsed["recommendedActions"],
          validReferences,
          fallback.recommendedActions
        ),
        weeklyExecutionPlan: RevenuePortfolioIntelligenceService.parsePlan(
          parsed["weeklyExecutionPlan"],
          fallback.weeklyExecutionPlan
        ),
        fallbackUsed: false
      };
      decision.fallbackUsed =
        portfolioStatus !== parsed["portfolioStatus"] ||
        !RevenuePortfolioIntelligenceService.isNonBlankString(
          parsed["summary"]
        ) ||
        partialFallbackUsed;
      return decision;
    } catch {
      return fallback;
    }
  }

  private static fallbackDecision(
    accounts: RevenuePortfolioAccountFactsDto[],
    reason: string
  ): PortfolioDecision {
    const scoredAccounts =
      RevenuePortfolioIntelligenceService.scoreAccounts(accounts);
    const topRiskAccounts =
      RevenuePortfolioIntelligenceService.toRankedAccounts(
        scoredAccounts
          .filter((account) => account.riskScore > 0)
          .sort((left, right) => right.riskScore - left.riskScore)
          .slice(0, 5),
        "risk"
      );
    const topExpansionAccounts =
      RevenuePortfolioIntelligenceService.toRankedAccounts(
        scoredAccounts
          .filter((account) => account.expansionScore > 0)
          .sort((left, right) => right.expansionScore - left.expansionScore)
          .slice(0, 5),
        "expansion"
      );
    const urgentRenewals = RevenuePortfolioIntelligenceService.toRankedAccounts(
      scoredAccounts
        .filter((account) => account.renewalUrgent)
        .sort((left, right) => right.riskScore - left.riskScore)
        .slice(0, 5),
      "risk"
    );
    const escalationAccounts =
      RevenuePortfolioIntelligenceService.toRankedAccounts(
        scoredAccounts
          .filter((account) => account.escalation)
          .sort((left, right) => right.riskScore - left.riskScore)
          .slice(0, 5),
        "risk"
      );
    const silentAccounts = RevenuePortfolioIntelligenceService.toRankedAccounts(
      scoredAccounts
        .filter((account) => account.silent)
        .sort((left, right) => right.riskScore - left.riskScore)
        .slice(0, 5),
      "risk"
    );
    const portfolioStatus =
      RevenuePortfolioIntelligenceService.statusFromScores(scoredAccounts);

    return {
      portfolioStatus,
      summary:
        accounts.length === 0
          ? "No assigned accounts were available for portfolio intelligence."
          : "Portfolio review found account attention signals from approved aggregate facts and prioritized follow-up actions.",
      topRiskAccounts,
      topExpansionAccounts,
      urgentRenewals,
      escalationAccounts,
      silentAccounts,
      portfolioWatchlists: RevenuePortfolioIntelligenceService.buildWatchlists(
        urgentRenewals,
        escalationAccounts,
        silentAccounts,
        topRiskAccounts
      ),
      portfolioTrends:
        RevenuePortfolioIntelligenceService.buildTrends(scoredAccounts),
      recommendedActions: RevenuePortfolioIntelligenceService.buildActions(
        topRiskAccounts,
        topExpansionAccounts,
        urgentRenewals,
        escalationAccounts,
        silentAccounts
      ),
      weeklyExecutionPlan: RevenuePortfolioIntelligenceService.buildPlan(
        topRiskAccounts,
        topExpansionAccounts,
        urgentRenewals,
        escalationAccounts,
        silentAccounts
      ),
      fallbackUsed: true
    };
  }

  private static noDataResponse(
    latencyMs: number
  ): RevenuePortfolioIntelligenceResponseDto {
    const decision = RevenuePortfolioIntelligenceService.fallbackDecision(
      [],
      "No portfolio account facts were supplied."
    );
    return {
      portfolioStatus: "INSUFFICIENT_DATA",
      summary: decision.summary,
      topRiskAccounts: [],
      topExpansionAccounts: [],
      urgentRenewals: [],
      escalationAccounts: [],
      silentAccounts: [],
      portfolioWatchlists: [],
      portfolioTrends: [
        {
          trend: "No portfolio facts supplied",
          direction: "unknown",
          severity: "unknown",
          rationale:
            "The request did not include assigned account facts for analysis."
        }
      ],
      recommendedActions: [
        {
          priority: "medium",
          action:
            "Refresh the Account Manager account directory and rerun portfolio intelligence.",
          accountReferences: [],
          rationale: "Portfolio analysis needs at least one visible account."
        }
      ],
      weeklyExecutionPlan: [
        {
          day: "Monday",
          actions: [
            "Refresh assigned-account visibility and rerun portfolio intelligence."
          ]
        }
      ],
      provider: "not-called",
      model: "not-called",
      fallbackUsed: false,
      decisionFallbackUsed: true,
      latencyMs
    };
  }

  private static scoreAccounts(
    accounts: RevenuePortfolioAccountFactsDto[]
  ): ScoredPortfolioAccount[] {
    return accounts.map((account) => {
      const riskSignals: string[] = [];
      const expansionSignals: string[] = [];
      let riskScore = 0;
      let expansionScore = 0;

      const openCases = RevenuePortfolioIntelligenceService.numberValue(
        account.openCaseCount
      );
      const escalatedCases = RevenuePortfolioIntelligenceService.numberValue(
        account.escalatedCaseCount
      );
      const highPriorityCases = RevenuePortfolioIntelligenceService.numberValue(
        account.highPriorityCaseCount
      );
      const renewalCount = RevenuePortfolioIntelligenceService.numberValue(
        account.renewalOpportunityCount
      );
      const expansionCount = RevenuePortfolioIntelligenceService.numberValue(
        account.expansionOpportunityCount
      );
      const daysToClose = RevenuePortfolioIntelligenceService.numberValue(
        account.daysToNextCloseDate
      );
      const daysSinceActivity = account.daysSinceLastActivity;
      const atRiskProjects = RevenuePortfolioIntelligenceService.numberValue(
        account.atRiskProjectCount
      );
      const overdueInvoices = RevenuePortfolioIntelligenceService.numberValue(
        account.overdueInvoiceCount
      );
      const usageTrend = RevenuePortfolioIntelligenceService.numberValue(
        account.productUsageTrendPercent
      );
      const wonLast180 = RevenuePortfolioIntelligenceService.numberValue(
        account.wonOpportunityCountLast180Days
      );
      const lostLast180 = RevenuePortfolioIntelligenceService.numberValue(
        account.lostOpportunityCountLast180Days
      );

      if (escalatedCases > 0) {
        riskScore += Math.min(escalatedCases * 22, 44);
        riskSignals.push("open escalations");
      }
      if (highPriorityCases > 0) {
        riskScore += Math.min(highPriorityCases * 8, 24);
        riskSignals.push("high priority support load");
      }
      if (openCases >= 5) {
        riskScore += 10;
        riskSignals.push("support volume concentration");
      }
      const renewalUrgent =
        renewalCount > 0 && daysToClose >= 0 && daysToClose <= 60;
      if (renewalUrgent) {
        riskScore += daysToClose <= 30 ? 20 : 12;
        riskSignals.push("renewal proximity");
      }
      if (daysToClose < -7) {
        riskScore += 12;
        riskSignals.push("stalled close date");
      }
      const silent = daysSinceActivity === undefined || daysSinceActivity >= 30;
      if (silent) {
        riskScore +=
          daysSinceActivity === undefined || daysSinceActivity >= 45 ? 12 : 8;
        riskSignals.push("account inactivity window");
      }
      if (atRiskProjects > 0) {
        riskScore += Math.min(atRiskProjects * 12, 24);
        riskSignals.push("delivery risk pressure");
      }
      if (overdueInvoices > 0) {
        riskScore += 12;
        riskSignals.push("finance risk indicator");
      }
      if (usageTrend <= -10) {
        riskScore += Math.min(Math.abs(usageTrend), 24);
        riskSignals.push("usage decline");
      }
      if (lostLast180 > wonLast180 && lostLast180 > 0) {
        riskScore += 8;
        riskSignals.push("recent lost opportunity pressure");
      }

      if (expansionCount > 0) {
        expansionScore += Math.min(expansionCount * 18, 36);
        expansionSignals.push("expansion opportunity present");
      }
      if (
        RevenuePortfolioIntelligenceService.numberValue(
          account.expansionOpportunityAmount
        ) > 0
      ) {
        expansionScore += 14;
        expansionSignals.push("expansion pipeline amount");
      }
      if (
        RevenuePortfolioIntelligenceService.numberValue(
          account.weightedPipelineAmount
        ) > 0
      ) {
        expansionScore += 10;
        expansionSignals.push("weighted pipeline coverage");
      }
      if (wonLast180 > 0) {
        expansionScore += Math.min(wonLast180 * 8, 16);
        expansionSignals.push("recent won momentum");
      }
      if (usageTrend >= 10) {
        expansionScore += Math.min(usageTrend, 20);
        expansionSignals.push("usage growth momentum");
      }
      if (riskScore >= 70) {
        expansionScore = Math.max(0, expansionScore - 15);
      }

      return {
        account,
        accountReference: account.accountReference,
        riskScore: Math.min(100, Math.max(0, Math.round(riskScore))),
        expansionScore: Math.min(100, Math.max(0, Math.round(expansionScore))),
        renewalUrgent,
        escalation: escalatedCases > 0 || highPriorityCases > 0,
        silent,
        churnSignal: riskScore >= 45 || usageTrend <= -10,
        riskSignals,
        expansionSignals
      };
    });
  }

  private static toRankedAccounts(
    accounts: ScoredPortfolioAccount[],
    mode: "risk" | "expansion"
  ): RevenuePortfolioRankedAccountDto[] {
    return accounts.map((account, index) => ({
      accountReference: account.accountReference,
      rank: index + 1,
      score: mode === "risk" ? account.riskScore : account.expansionScore,
      level: RevenuePortfolioIntelligenceService.levelForScore(
        mode === "risk" ? account.riskScore : account.expansionScore
      ),
      reason:
        mode === "risk"
          ? RevenuePortfolioIntelligenceService.reasonFromSignals(
              account.riskSignals,
              "No urgent risk signal detected."
            )
          : RevenuePortfolioIntelligenceService.reasonFromSignals(
              account.expansionSignals,
              "Expansion signal is present but limited."
            ),
      supportingSignals:
        mode === "risk" ? account.riskSignals : account.expansionSignals,
      recommendedAction:
        mode === "risk"
          ? RevenuePortfolioIntelligenceService.riskAction(account)
          : RevenuePortfolioIntelligenceService.expansionAction(account)
    }));
  }

  private static buildWatchlists(
    urgentRenewals: RevenuePortfolioRankedAccountDto[],
    escalationAccounts: RevenuePortfolioRankedAccountDto[],
    silentAccounts: RevenuePortfolioRankedAccountDto[],
    topRiskAccounts: RevenuePortfolioRankedAccountDto[]
  ): RevenuePortfolioWatchlistDto[] {
    const watchlists: RevenuePortfolioWatchlistDto[] = [];
    if (topRiskAccounts.length) {
      watchlists.push({
        name: "Churn risk watchlist",
        accountReferences: topRiskAccounts.map(
          (account) => account.accountReference
        ),
        rationale:
          "Accounts combine renewal, support, inactivity, delivery, usage, or finance pressure."
      });
    }
    if (urgentRenewals.length) {
      watchlists.push({
        name: "Urgent renewals",
        accountReferences: urgentRenewals.map(
          (account) => account.accountReference
        ),
        rationale:
          "Renewal opportunities are inside the near-term close window."
      });
    }
    if (escalationAccounts.length) {
      watchlists.push({
        name: "Support escalation accounts",
        accountReferences: escalationAccounts.map(
          (account) => account.accountReference
        ),
        rationale:
          "Open escalations or high-priority cases need coordinated follow-up."
      });
    }
    if (silentAccounts.length) {
      watchlists.push({
        name: "Silent accounts",
        accountReferences: silentAccounts.map(
          (account) => account.accountReference
        ),
        rationale:
          "Recent completed activity is missing or outside the target engagement window."
      });
    }
    return watchlists;
  }

  private static buildTrends(
    accounts: ScoredPortfolioAccount[]
  ): RevenuePortfolioTrendDto[] {
    if (accounts.length === 0) {
      return [];
    }
    const trends: RevenuePortfolioTrendDto[] = [];
    const escalationCount = accounts.filter(
      (account) => account.escalation
    ).length;
    const silentCount = accounts.filter((account) => account.silent).length;
    const urgentRenewalCount = accounts.filter(
      (account) => account.renewalUrgent
    ).length;
    const expansionCount = accounts.filter(
      (account) => account.expansionScore > 0
    ).length;

    if (escalationCount > 0) {
      trends.push({
        trend: "Escalation concentration",
        direction: "increasing_attention",
        severity: escalationCount >= 3 ? "high" : "medium",
        rationale: `${escalationCount} account(s) show open escalation or high-priority support pressure.`
      });
    }
    if (urgentRenewalCount > 0) {
      trends.push({
        trend: "Renewal risk concentration",
        direction: "near_term",
        severity: urgentRenewalCount >= 3 ? "high" : "medium",
        rationale: `${urgentRenewalCount} account(s) have renewal opportunities near close.`
      });
    }
    if (silentCount > 0) {
      trends.push({
        trend: "Engagement gap",
        direction: "attention_needed",
        severity: silentCount >= 3 ? "high" : "medium",
        rationale: `${silentCount} account(s) lack recent completed activity.`
      });
    }
    if (expansionCount > 0) {
      trends.push({
        trend: "Expansion momentum",
        direction: "positive",
        severity: expansionCount >= 3 ? "high" : "medium",
        rationale: `${expansionCount} account(s) show expansion or pipeline upside.`
      });
    }
    if (trends.length === 0) {
      trends.push({
        trend: "No material portfolio trend detected",
        direction: "stable",
        severity: "low",
        rationale:
          "The supplied aggregate facts do not show concentrated risk or expansion movement."
      });
    }
    return trends;
  }

  private static buildActions(
    topRiskAccounts: RevenuePortfolioRankedAccountDto[],
    topExpansionAccounts: RevenuePortfolioRankedAccountDto[],
    urgentRenewals: RevenuePortfolioRankedAccountDto[],
    escalationAccounts: RevenuePortfolioRankedAccountDto[],
    silentAccounts: RevenuePortfolioRankedAccountDto[]
  ): RevenuePortfolioRecommendedActionDto[] {
    const actions: RevenuePortfolioRecommendedActionDto[] = [];
    if (topRiskAccounts.length) {
      actions.push({
        priority: "high",
        action:
          "Start executive outreach for the highest-risk accounts and confirm owner, date, and intervention path.",
        accountReferences: topRiskAccounts
          .slice(0, 3)
          .map((account) => account.accountReference),
        rationale: "These accounts carry the strongest combined risk signals."
      });
    }
    if (urgentRenewals.length) {
      actions.push({
        priority: "high",
        action:
          "Run renewal intervention reviews before the next close window.",
        accountReferences: urgentRenewals
          .slice(0, 3)
          .map((account) => account.accountReference),
        rationale: "Near-term renewals need proactive risk removal."
      });
    }
    if (escalationAccounts.length) {
      actions.push({
        priority: "medium",
        action: "Hold a support review and remove escalation blockers.",
        accountReferences: escalationAccounts
          .slice(0, 3)
          .map((account) => account.accountReference),
        rationale: "Support burden can block retention and expansion."
      });
    }
    if (topExpansionAccounts.length) {
      actions.push({
        priority: "medium",
        action:
          "Sequence expansion outreach after confirming account health and stakeholder coverage.",
        accountReferences: topExpansionAccounts
          .slice(0, 3)
          .map((account) => account.accountReference),
        rationale:
          "Expansion accounts have upside but should be pursued with risk context."
      });
    }
    if (silentAccounts.length) {
      actions.push({
        priority: "medium",
        action:
          "Schedule customer-success syncs for accounts without recent activity.",
        accountReferences: silentAccounts
          .slice(0, 3)
          .map((account) => account.accountReference),
        rationale:
          "Inactivity creates preventable churn and surprise renewal risk."
      });
    }
    return actions;
  }

  private static buildPlan(
    topRiskAccounts: RevenuePortfolioRankedAccountDto[],
    topExpansionAccounts: RevenuePortfolioRankedAccountDto[],
    urgentRenewals: RevenuePortfolioRankedAccountDto[],
    escalationAccounts: RevenuePortfolioRankedAccountDto[],
    silentAccounts: RevenuePortfolioRankedAccountDto[]
  ): RevenuePortfolioWeeklyPlanDayDto[] {
    return [
      {
        day: "Monday",
        actions: topRiskAccounts.length
          ? topRiskAccounts
              .slice(0, 2)
              .map(
                (account) =>
                  `Open executive risk review for ${account.accountReference}.`
              )
          : ["Review portfolio status and confirm account data freshness."]
      },
      {
        day: "Tuesday",
        actions: urgentRenewals.length
          ? urgentRenewals
              .slice(0, 2)
              .map(
                (account) =>
                  `Clear renewal blockers for ${account.accountReference}.`
              )
          : ["Confirm renewal pipeline dates and ownership."]
      },
      {
        day: "Wednesday",
        actions: escalationAccounts.length
          ? escalationAccounts
              .slice(0, 2)
              .map(
                (account) =>
                  `Run support escalation review for ${account.accountReference}.`
              )
          : ["Check support queue for new portfolio escalations."]
      },
      {
        day: "Thursday",
        actions: topExpansionAccounts.length
          ? topExpansionAccounts
              .slice(0, 2)
              .map(
                (account) =>
                  `Sequence expansion outreach for ${account.accountReference}.`
              )
          : ["Refresh expansion whitespace and pipeline coverage."]
      },
      {
        day: "Friday",
        actions: silentAccounts.length
          ? silentAccounts
              .slice(0, 2)
              .map(
                (account) =>
                  `Schedule customer-success sync for ${account.accountReference}.`
              )
          : ["Document portfolio follow-ups and next week owners."]
      }
    ];
  }

  private static parseRankedAccounts(
    value: unknown,
    validReferences: Set<string>,
    fallback: RevenuePortfolioRankedAccountDto[]
  ): RevenuePortfolioRankedAccountDto[] {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const results: RevenuePortfolioRankedAccountDto[] = [];
    for (const item of value) {
      if (!RevenuePortfolioIntelligenceService.isRecord(item)) {
        continue;
      }
      const accountReference =
        RevenuePortfolioIntelligenceService.accountReference(
          item["accountReference"],
          validReferences
        );
      if (!accountReference) {
        continue;
      }
      results.push({
        accountReference,
        rank: RevenuePortfolioIntelligenceService.integerValue(
          item["rank"],
          results.length + 1,
          1,
          25
        ),
        score: RevenuePortfolioIntelligenceService.scoreValue(item["score"]),
        level: RevenuePortfolioIntelligenceService.safeText(
          item["level"],
          "unknown",
          40
        ),
        reason: RevenuePortfolioIntelligenceService.safeText(
          item["reason"],
          "No rationale provided.",
          220
        ),
        supportingSignals: RevenuePortfolioIntelligenceService.stringArray(
          item["supportingSignals"],
          5,
          90
        ),
        recommendedAction: RevenuePortfolioIntelligenceService.safeText(
          item["recommendedAction"],
          "Review this account with the revenue team.",
          180
        )
      });
      if (results.length >= 5) {
        break;
      }
    }
    return results;
  }

  private static parseWatchlists(
    value: unknown,
    validReferences: Set<string>,
    fallback: RevenuePortfolioWatchlistDto[]
  ): RevenuePortfolioWatchlistDto[] {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const results: RevenuePortfolioWatchlistDto[] = [];
    for (const item of value) {
      if (!RevenuePortfolioIntelligenceService.isRecord(item)) {
        continue;
      }
      const accountReferences =
        RevenuePortfolioIntelligenceService.referenceArray(
          item["accountReferences"],
          validReferences,
          10
        );
      results.push({
        name: RevenuePortfolioIntelligenceService.safeText(
          item["name"],
          "Portfolio watchlist",
          80
        ),
        accountReferences,
        rationale: RevenuePortfolioIntelligenceService.safeText(
          item["rationale"],
          "Grouped from portfolio account signals.",
          220
        )
      });
      if (results.length >= 8) {
        break;
      }
    }
    return results;
  }

  private static parseTrends(
    value: unknown,
    fallback: RevenuePortfolioTrendDto[]
  ): RevenuePortfolioTrendDto[] {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const results: RevenuePortfolioTrendDto[] = [];
    for (const item of value) {
      if (!RevenuePortfolioIntelligenceService.isRecord(item)) {
        continue;
      }
      results.push({
        trend: RevenuePortfolioIntelligenceService.safeText(
          item["trend"],
          "Portfolio trend",
          90
        ),
        direction: RevenuePortfolioIntelligenceService.safeText(
          item["direction"],
          "unknown",
          60
        ),
        severity: RevenuePortfolioIntelligenceService.safeText(
          item["severity"],
          "unknown",
          40
        ),
        rationale: RevenuePortfolioIntelligenceService.safeText(
          item["rationale"],
          "Trend derived from portfolio signals.",
          240
        )
      });
      if (results.length >= 8) {
        break;
      }
    }
    return results;
  }

  private static parseActions(
    value: unknown,
    validReferences: Set<string>,
    fallback: RevenuePortfolioRecommendedActionDto[]
  ): RevenuePortfolioRecommendedActionDto[] {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const results: RevenuePortfolioRecommendedActionDto[] = [];
    for (const item of value) {
      if (!RevenuePortfolioIntelligenceService.isRecord(item)) {
        continue;
      }
      results.push({
        priority: RevenuePortfolioIntelligenceService.safeText(
          item["priority"],
          "medium",
          40
        ),
        action: RevenuePortfolioIntelligenceService.safeText(
          item["action"],
          "Review portfolio accounts with the revenue team.",
          220
        ),
        accountReferences: RevenuePortfolioIntelligenceService.referenceArray(
          item["accountReferences"],
          validReferences,
          10
        ),
        rationale: RevenuePortfolioIntelligenceService.safeText(
          item["rationale"],
          "Action is grounded in portfolio signals.",
          220
        )
      });
      if (results.length >= 8) {
        break;
      }
    }
    return results;
  }

  private static parsePlan(
    value: unknown,
    fallback: RevenuePortfolioWeeklyPlanDayDto[]
  ): RevenuePortfolioWeeklyPlanDayDto[] {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const results: RevenuePortfolioWeeklyPlanDayDto[] = [];
    for (const item of value) {
      if (!RevenuePortfolioIntelligenceService.isRecord(item)) {
        continue;
      }
      const actions = RevenuePortfolioIntelligenceService.stringArray(
        item["actions"],
        8,
        180
      );
      results.push({
        day: RevenuePortfolioIntelligenceService.safeText(
          item["day"],
          "Next business day",
          40
        ),
        actions: actions.length
          ? actions
          : ["Review portfolio follow-up tasks."]
      });
      if (results.length >= 7) {
        break;
      }
    }
    return results;
  }

  private static referenceArray(
    value: unknown,
    validReferences: Set<string>,
    maxItems: number
  ): string[] {
    const rawValues = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[;,]/)
        : [];
    const results: string[] = [];
    for (const rawValue of rawValues) {
      const reference = RevenuePortfolioIntelligenceService.accountReference(
        rawValue,
        validReferences
      );
      if (reference && !results.includes(reference)) {
        results.push(reference);
      }
      if (results.length >= maxItems) {
        break;
      }
    }
    return results;
  }

  private static stringArray(
    value: unknown,
    maxItems: number,
    maxLength: number
  ): string[] {
    const rawValues = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[;,]/)
        : [];
    const results: string[] = [];
    for (const rawValue of rawValues) {
      const text = RevenuePortfolioIntelligenceService.safeText(
        rawValue,
        "",
        maxLength
      );
      if (text) {
        results.push(text);
      }
      if (results.length >= maxItems) {
        break;
      }
    }
    return results;
  }

  private static portfolioStatus(
    value: unknown,
    fallback: RevenuePortfolioStatusDto
  ): RevenuePortfolioStatusDto {
    if (typeof value !== "string") {
      return fallback;
    }
    const normalized = value.trim().toUpperCase().replace(/[ -]+/g, "_");
    return REVENUE_PORTFOLIO_STATUSES.includes(
      normalized as RevenuePortfolioStatusDto
    )
      ? (normalized as RevenuePortfolioStatusDto)
      : fallback;
  }

  private static accountReference(
    value: unknown,
    validReferences: Set<string>
  ): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return validReferences.has(normalized) ? normalized : undefined;
  }

  private static isSafeAccountReference(value: string): boolean {
    return /^account-[1-9][0-9]{0,2}$/.test(value);
  }

  private static isNonBlankString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  private static statusFromScores(
    accounts: ScoredPortfolioAccount[]
  ): RevenuePortfolioStatusDto {
    if (accounts.length === 0) {
      return "INSUFFICIENT_DATA";
    }
    const maxRisk = Math.max(...accounts.map((account) => account.riskScore));
    if (maxRisk >= 80) {
      return "CRITICAL";
    }
    if (maxRisk >= 45) {
      return "ATTENTION_REQUIRED";
    }
    if (maxRisk >= 20) {
      return "WATCH";
    }
    return "STABLE";
  }

  private static levelForScore(score: number): string {
    if (score >= 80) {
      return "critical";
    }
    if (score >= 60) {
      return "high";
    }
    if (score >= 30) {
      return "medium";
    }
    if (score > 0) {
      return "low";
    }
    return "unknown";
  }

  private static reasonFromSignals(
    signals: string[],
    fallback: string
  ): string {
    return signals.length ? signals.slice(0, 4).join("; ") : fallback;
  }

  private static riskAction(account: ScoredPortfolioAccount): string {
    if (account.renewalUrgent) {
      return "Run renewal intervention and executive outreach.";
    }
    if (account.escalation) {
      return "Hold support review and remove escalation blockers.";
    }
    if (account.silent) {
      return "Schedule customer-success sync and rebuild stakeholder coverage.";
    }
    return "Review revenue risk signals and assign an accountable owner.";
  }

  private static expansionAction(account: ScoredPortfolioAccount): string {
    if (account.riskScore >= 60) {
      return "Confirm health recovery before sequencing expansion outreach.";
    }
    return "Sequence expansion outreach with stakeholder mapping and value hypothesis.";
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

  private static integerValue(
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(numeric)));
  }

  private static numberValue(value: number | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private static errorKind(err: unknown): string {
    if (err instanceof LlmProviderError) {
      return err.kind;
    }
    return err instanceof Error ? err.name : "unknown";
  }
}

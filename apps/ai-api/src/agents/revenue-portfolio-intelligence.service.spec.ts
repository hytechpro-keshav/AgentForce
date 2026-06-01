import type { ModelRouter } from "../llm/model-router";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import type { TelemetryService } from "../observability/telemetry.service";
import type { RevenuePortfolioIntelligenceRequestDto } from "./dto/revenue-account-health.dto";
import { RevenuePortfolioIntelligenceService } from "./revenue-portfolio-intelligence.service";

describe("RevenuePortfolioIntelligenceService", () => {
  function buildRequest(
    overrides: Partial<RevenuePortfolioIntelligenceRequestDto> = {}
  ): RevenuePortfolioIntelligenceRequestDto {
    return {
      analysisFocus: "risk",
      sourceSystems: "Salesforce Account, Opportunity, Case, Task aggregates",
      requestId: "portfolio-req-1",
      accounts: [
        {
          accountReference: "account-1",
          accountType: "Customer",
          accountIndustry: "Software",
          annualRevenue: 2500000,
          openOpportunityCount: 4,
          weightedPipelineAmount: 220000,
          daysToNextCloseDate: 21,
          renewalOpportunityCount: 1,
          renewalOpportunityAmount: 180000,
          expansionOpportunityCount: 2,
          expansionOpportunityAmount: 280000,
          openCaseCount: 7,
          escalatedCaseCount: 2,
          highPriorityCaseCount: 3,
          activityCountLast30Days: 1,
          daysSinceLastActivity: 37,
          atRiskProjectCount: 1,
          overdueInvoiceCount: 2,
          productUsageTrendPercent: -22
        },
        {
          accountReference: "account-2",
          accountType: "Customer",
          accountIndustry: "Manufacturing",
          openOpportunityCount: 3,
          weightedPipelineAmount: 175000,
          daysToNextCloseDate: 90,
          expansionOpportunityCount: 2,
          expansionOpportunityAmount: 300000,
          openCaseCount: 0,
          escalatedCaseCount: 0,
          highPriorityCaseCount: 0,
          activityCountLast30Days: 5,
          daysSinceLastActivity: 8,
          wonOpportunityCountLast180Days: 2,
          productUsageTrendPercent: 18
        }
      ],
      ...overrides
    };
  }

  function buildService(content: string): {
    service: RevenuePortfolioIntelligenceService;
    chat: jest.Mock;
    telemetry: { recordAgentWorkflow: jest.Mock };
  } {
    const chat = jest.fn().mockResolvedValue({
      content,
      finishReason: "stop",
      usage: { inputTokens: 180, outputTokens: 95, totalTokens: 275 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 121,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });
    const telemetry = { recordAgentWorkflow: jest.fn() };
    const service = new RevenuePortfolioIntelligenceService(
      { chat } as unknown as ModelRouter,
      telemetry as unknown as TelemetryService
    );
    return { service, chat, telemetry };
  }

  it("returns LLM-owned portfolio rankings, watchlists, and execution plan", async () => {
    const { service, chat, telemetry } = buildService(
      JSON.stringify({
        portfolioStatus: "ATTENTION_REQUIRED",
        summary: "Portfolio needs retention focus before broad expansion.",
        topRiskAccounts: [
          {
            accountReference: "account-1",
            rank: 1,
            score: 88,
            level: "high",
            reason:
              "Escalations, renewal proximity, inactivity, and usage decline.",
            supportingSignals: ["open escalations", "renewal proximity"],
            recommendedAction: "Run executive save plan."
          }
        ],
        topExpansionAccounts: [
          {
            accountReference: "account-2",
            rank: 1,
            score: 76,
            level: "high",
            reason: "Expansion pipeline and usage momentum.",
            supportingSignals: ["expansion pipeline", "usage growth"],
            recommendedAction: "Sequence expansion outreach."
          }
        ],
        urgentRenewals: [
          {
            accountReference: "account-1",
            rank: 1,
            score: 80,
            level: "high",
            reason: "Renewal is near close.",
            supportingSignals: ["renewal proximity"],
            recommendedAction: "Review renewal blockers."
          }
        ],
        escalationAccounts: [],
        silentAccounts: [],
        portfolioWatchlists: [
          {
            name: "Churn risk watchlist",
            accountReferences: ["account-1"],
            rationale: "Retention pressure is concentrated."
          }
        ],
        portfolioTrends: [
          {
            trend: "Renewal risk concentration",
            direction: "near_term",
            severity: "high",
            rationale: "One high-risk renewal is close."
          }
        ],
        recommendedActions: [
          {
            priority: "high",
            action: "Run executive outreach.",
            accountReferences: ["account-1"],
            rationale: "Risk is urgent."
          }
        ],
        weeklyExecutionPlan: [
          {
            day: "Monday",
            actions: ["Call account-1 renewal team"]
          }
        ]
      })
    );

    const result = await service.analyze(buildRequest(), {
      subject: "agentforce-runtime",
      scopes: ["agentforce:revenue-portfolio-intelligence"],
      tenantId: "tenant-revenue",
      raw: {}
    });

    expect(result).toMatchObject({
      portfolioStatus: "ATTENTION_REQUIRED",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      decisionFallbackUsed: false,
      latencyMs: 121
    });
    expect(result.topRiskAccounts[0]).toMatchObject({
      accountReference: "account-1",
      score: 88,
      recommendedAction: "Run executive save plan."
    });
    expect(result.topExpansionAccounts[0].accountReference).toBe("account-2");
    expect(result.weeklyExecutionPlan[0].actions).toContain(
      "Call account-1 renewal team"
    );

    const llmRequest = chat.mock.calls[0][0];
    expect(llmRequest).toMatchObject({
      requestId: "portfolio-req-1",
      useCase: "agentforce_revenue_portfolio_intelligence",
      tenantId: "tenant-revenue",
      surface: "agentforce",
      complexity: "complex",
      temperature: 0,
      maxTokens: 1100
    });
    expect(llmRequest.messages[0].content).toContain(
      "portfolioStatus must be STABLE"
    );
    expect(llmRequest.messages[1].content).toContain(
      "accountReference=account-1"
    );
    expect(llmRequest.messages[1].content).toContain("deterministicSignals");
    expect(llmRequest.messages[1].content).not.toContain(
      "Salesforce Account ID"
    );
    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "revenue.portfolio_intelligence",
        useCase: "agentforce_revenue_portfolio_intelligence",
        tenantId: "tenant-revenue",
        portfolioStatus: "ATTENTION_REQUIRED",
        portfolioAccountCount: 2,
        topRiskAccountCount: 1,
        watchlistCount: 1,
        outcome: "success",
        inputTokens: 180,
        outputTokens: 95,
        totalTokens: 275
      })
    );
  });

  it("falls back to deterministic portfolio grouping for malformed output", async () => {
    const { service, telemetry } = buildService("not json");

    const result = await service.analyze(buildRequest());

    expect(result.portfolioStatus).toBe("CRITICAL");
    expect(result.decisionFallbackUsed).toBe(true);
    expect(result.topRiskAccounts[0].accountReference).toBe("account-1");
    expect(
      result.portfolioWatchlists.map((watchlist) => watchlist.name)
    ).toContain("Churn risk watchlist");
    expect(result.weeklyExecutionPlan.length).toBe(5);
    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionFallbackUsed: true,
        portfolioStatus: "CRITICAL",
        outcome: "success"
      })
    );
  });

  it("marks decision fallback when valid JSON omits portfolio families", async () => {
    const { service, telemetry } = buildService(
      JSON.stringify({
        portfolioStatus: "ATTENTION_REQUIRED",
        summary: "The portfolio needs attention."
      })
    );

    const result = await service.analyze(buildRequest());

    expect(result.portfolioStatus).toBe("ATTENTION_REQUIRED");
    expect(result.decisionFallbackUsed).toBe(true);
    expect(result.topRiskAccounts[0].accountReference).toBe("account-1");
    expect(result.portfolioWatchlists.length).toBeGreaterThan(0);
    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionFallbackUsed: true,
        portfolioStatus: "ATTENTION_REQUIRED",
        outcome: "success"
      })
    );
  });

  it("returns deterministic portfolio fallback when the model is slow", async () => {
    jest.useFakeTimers();
    const chat = jest.fn().mockImplementation(() => new Promise(() => {}));
    const telemetry = { recordAgentWorkflow: jest.fn() };
    const service = new RevenuePortfolioIntelligenceService(
      { chat } as unknown as ModelRouter,
      telemetry as unknown as TelemetryService
    );

    try {
      const resultPromise = service.analyze(buildRequest());
      await jest.advanceTimersByTimeAsync(18_000);
      const result = await resultPromise;

      expect(result).toMatchObject({
        portfolioStatus: "CRITICAL",
        provider: "deterministic-fallback",
        model: "revenue-portfolio-signals-v1",
        fallbackUsed: true,
        decisionFallbackUsed: true
      });
      expect(result.topRiskAccounts[0].accountReference).toBe("account-1");
      expect(result.weeklyExecutionPlan.length).toBeGreaterThan(0);
      expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "revenue.portfolio_intelligence",
          outcome: "success",
          provider: "deterministic-fallback",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns an insufficient-data contract without calling the model", async () => {
    const { service, chat } = buildService("{}");

    const result = await service.analyze(
      buildRequest({ accounts: [], analysisFocus: "weekly_plan" })
    );

    expect(result).toMatchObject({
      portfolioStatus: "INSUFFICIENT_DATA",
      provider: "not-called",
      model: "not-called",
      decisionFallbackUsed: true
    });
    expect(result.recommendedActions[0].action).toContain(
      "Refresh the Account Manager account directory"
    );
    expect(chat).not.toHaveBeenCalled();
  });

  it("redacts sensitive provider text and drops unknown account references", async () => {
    const { service } = buildService(
      JSON.stringify({
        portfolioStatus: "WATCH",
        summary: "Call jane@example.com at 415-555-1212.",
        topRiskAccounts: [
          {
            accountReference: "001000000000001AAA",
            rank: 1,
            score: 99,
            level: "critical",
            reason: "Should be dropped.",
            supportingSignals: [],
            recommendedAction: "Ignore."
          },
          {
            accountReference: "account-1",
            rank: 1,
            score: 64,
            level: "medium",
            reason: "Invoice number INV-123456 pressure.",
            supportingSignals: ["Contact Jane Doe"],
            recommendedAction: "Email jane@example.com."
          }
        ],
        topExpansionAccounts: [],
        urgentRenewals: [],
        escalationAccounts: [],
        silentAccounts: [],
        portfolioWatchlists: [],
        portfolioTrends: [],
        recommendedActions: [],
        weeklyExecutionPlan: []
      })
    );

    const result = await service.analyze(buildRequest());

    expect(result.summary).toContain("[redacted-email]");
    expect(result.summary).toContain("[redacted-phone]");
    expect(result.topRiskAccounts).toHaveLength(1);
    expect(result.topRiskAccounts[0].accountReference).toBe("account-1");
    expect(result.topRiskAccounts[0].reason).toContain("[redacted-identifier]");
    expect(result.topRiskAccounts[0].recommendedAction).toContain(
      "[redacted-email]"
    );
  });

  it("records workflow error telemetry when the model router fails", async () => {
    const chat = jest
      .fn()
      .mockRejectedValue(
        new LlmProviderError("model-router", "validation", "No providers")
      );
    const telemetry = { recordAgentWorkflow: jest.fn() };
    const service = new RevenuePortfolioIntelligenceService(
      { chat } as unknown as ModelRouter,
      telemetry as unknown as TelemetryService
    );

    await expect(service.analyze(buildRequest())).rejects.toThrow(
      LlmProviderError
    );

    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "revenue.portfolio_intelligence",
        useCase: "agentforce_revenue_portfolio_intelligence",
        outcome: "error",
        errorKind: "validation"
      })
    );
  });
});

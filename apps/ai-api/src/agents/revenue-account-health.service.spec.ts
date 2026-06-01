import type { ModelRouter } from "../llm/model-router";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import type { TelemetryService } from "../observability/telemetry.service";
import type { RevenueAccountHealthRequestDto } from "./dto/revenue-account-health.dto";
import { RevenueAccountHealthService } from "./revenue-account-health.service";

describe("RevenueAccountHealthService", () => {
  function buildRequest(
    overrides: Partial<RevenueAccountHealthRequestDto> = {}
  ): RevenueAccountHealthRequestDto {
    return {
      accountType: "Customer",
      accountIndustry: "Software",
      annualRevenue: 2500000,
      employeeCount: 850,
      accountAgeDays: 1400,
      openOpportunityCount: 4,
      openOpportunityAmount: 460000,
      weightedPipelineAmount: 220000,
      daysToNextCloseDate: 21,
      wonOpportunityCountLast180Days: 2,
      lostOpportunityCountLast180Days: 1,
      renewalOpportunityCount: 1,
      renewalOpportunityAmount: 180000,
      expansionOpportunityCount: 2,
      expansionOpportunityAmount: 280000,
      openCaseCount: 7,
      escalatedCaseCount: 2,
      highPriorityCaseCount: 3,
      oldestOpenCaseAgeDays: 42,
      activityCountLast30Days: 1,
      daysSinceLastActivity: 37,
      executiveActivityCountLast90Days: 0,
      activeProjectCount: 2,
      atRiskProjectCount: 1,
      lateMilestoneCount: 3,
      openResourceRequestCount: 1,
      avgProjectMarginPercent: 12,
      totalProjectRemainingAmount: -15000,
      overdueInvoiceCount: 2,
      overdueInvoiceAmount: 42000,
      averagePaymentDelayDays: 18,
      marginPressureAmount: 31000,
      productActiveUserCount: 120,
      productUsageTrendPercent: -22,
      featureAdoptionPercent: 41,
      sourceSystems: "Salesforce CRM aggregates; Certinia PSA aggregates",
      requestId: "revenue-health-req-1",
      ...overrides
    };
  }

  function buildService(content: string): {
    service: RevenueAccountHealthService;
    chat: jest.Mock;
    telemetry: { recordAgentWorkflow: jest.Mock };
  } {
    const chat = jest.fn().mockResolvedValue({
      content,
      finishReason: "stop",
      usage: { inputTokens: 80, outputTokens: 55, totalTokens: 135 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 91,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });
    const telemetry = { recordAgentWorkflow: jest.fn() };
    const service = new RevenueAccountHealthService(
      { chat } as unknown as ModelRouter,
      telemetry as unknown as TelemetryService
    );
    return { service, chat, telemetry };
  }

  it("returns LLM-owned revenue scores and decisions", async () => {
    const { service, chat, telemetry } = buildService(
      '{"accountHealthScore":42,"accountHealthBand":"at_risk","churnRiskScore":78,"churnRiskLevel":"high","expansionScore":68,"expansionLevel":"medium","deliveryRiskLevel":"high","financialRiskLevel":"medium","supportRiskLevel":"high","executiveEngagementLevel":"weak","primaryDecision":"Prioritize retention before expansion.","summary":"Revenue outlook is pressured by support load, delivery risk, and weak engagement despite active expansion pipeline.","decisionRationale":"Escalated cases; late milestones; overdue invoices; low recent activity; expansion pipeline exists but risk is material","revenueImpact":"Renewal and expansion revenue could be delayed without intervention.","operationalBlockers":"Support escalations; delivery milestones; overdue invoices","recommendedActions":"Schedule executive save plan; assign delivery recovery owner; clear escalated support cases; review renewal and expansion timing","confidence":"high"}'
    );

    const result = await service.summarize(buildRequest(), {
      subject: "agentforce-runtime",
      scopes: ["agentforce:revenue-account-health"],
      tenantId: "tenant-revenue",
      raw: {}
    });

    expect(result).toMatchObject({
      accountHealthScore: 42,
      accountHealthBand: "at_risk",
      churnRiskScore: 78,
      churnRiskLevel: "high",
      expansionScore: 68,
      expansionLevel: "medium",
      deliveryRiskLevel: "high",
      financialRiskLevel: "medium",
      supportRiskLevel: "high",
      executiveEngagementLevel: "weak",
      confidence: "high",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 91
    });
    expect(result.primaryDecision).toBe(
      "Prioritize retention before expansion."
    );
    expect(result.recommendedActions).toContain("executive save plan");

    const llmRequest = chat.mock.calls[0][0];
    expect(llmRequest).toMatchObject({
      requestId: "revenue-health-req-1",
      useCase: "agentforce_revenue_account_health",
      tenantId: "tenant-revenue",
      surface: "agentforce",
      complexity: "complex",
      temperature: 0,
      maxTokens: 700
    });
    expect(llmRequest.messages[0].content).toContain(
      "The model is responsible for the account health score"
    );
    expect(llmRequest.messages[1].content).toContain("Decision mode: LLM-led");
    expect(llmRequest.messages[1].content).not.toContain("Deterministic");
    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "revenue.account_health",
        useCase: "agentforce_revenue_account_health",
        tenantId: "tenant-revenue",
        accountHealthBand: "at_risk",
        churnRiskLevel: "high",
        expansionLevel: "medium",
        outcome: "success",
        inputTokens: 80,
        outputTokens: 55,
        totalTokens: 135
      })
    );
  });

  it("passes analysis intent as a safe prompt hint instead of relying on chat history", async () => {
    const { service, chat } = buildService(
      '{"accountHealthScore":45,"accountHealthBand":"watch","churnRiskScore":61,"churnRiskLevel":"medium","expansionScore":34,"expansionLevel":"low","deliveryRiskLevel":"medium","financialRiskLevel":"low","supportRiskLevel":"medium","executiveEngagementLevel":"steady","primaryDecision":"Prepare the account narrative before the executive review.","summary":"The account needs a focused executive narrative around current risk and recovery steps.","decisionRationale":"Support burden; limited recent engagement; renewal timing pressure","revenueImpact":"Revenue is exposed unless engagement and execution improve.","operationalBlockers":"Recent inactivity; support burden","recommendedActions":"Build QBR storyline; align executive outreach; review renewal posture","confidence":"medium"}'
    );

    await service.summarize(
      buildRequest({ analysisIntent: "qbr_preparation" })
    );

    const llmRequest = chat.mock.calls[0][0];
    expect(llmRequest.messages[0].content).toContain(
      "does not include prior chat history"
    );
    expect(llmRequest.messages[1].content).toContain(
      "Analysis intent: qbr_preparation"
    );
  });

  it("falls back to unknown decisions for malformed model output", async () => {
    const { service, telemetry } = buildService("not json at all");

    const result = await service.summarize(buildRequest());

    expect(result).toMatchObject({
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
      confidence: "low"
    });
    expect(result.summary).toBe(
      "Revenue account health could not be scored from model output."
    );
    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionFallbackUsed: true,
        accountHealthBand: "unknown",
        outcome: "success"
      })
    );
  });

  it("redacts sensitive text returned by a provider", async () => {
    const { service } = buildService(
      '{"accountHealthScore":55,"accountHealthBand":"watch","churnRiskScore":60,"churnRiskLevel":"medium","expansionScore":45,"expansionLevel":"low","deliveryRiskLevel":"medium","financialRiskLevel":"low","supportRiskLevel":"medium","executiveEngagementLevel":"steady","primaryDecision":"Call jane@example.com at 415-555-1212","summary":"Account number ACCT-123456 needs review","decisionRationale":"Use 123 Main St notes","revenueImpact":"Invoice number INV-123456 may slip","operationalBlockers":"Contact Jane Doe","recommendedActions":"Email jane@example.com","confidence":"medium"}'
    );

    const result = await service.summarize(buildRequest());

    expect(result.primaryDecision).toContain("[redacted-email]");
    expect(result.primaryDecision).toContain("[redacted-phone]");
    expect(result.summary).toContain("[redacted-identifier]");
    expect(result.decisionRationale).toContain("[redacted-address]");
    expect(result.recommendedActions).toContain("[redacted-email]");
  });

  it("records workflow error telemetry when the model router fails", async () => {
    const chat = jest
      .fn()
      .mockRejectedValue(
        new LlmProviderError("model-router", "validation", "No providers")
      );
    const telemetry = { recordAgentWorkflow: jest.fn() };
    const service = new RevenueAccountHealthService(
      { chat } as unknown as ModelRouter,
      telemetry as unknown as TelemetryService
    );

    await expect(service.summarize(buildRequest())).rejects.toThrow(
      LlmProviderError
    );

    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "revenue.account_health",
        useCase: "agentforce_revenue_account_health",
        outcome: "error",
        errorKind: "validation"
      })
    );
  });
});

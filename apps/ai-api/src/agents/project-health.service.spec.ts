import { ProjectHealthService } from "./project-health.service";
import type { ProjectHealthRequestDto } from "./dto/project-health.dto";
import { LlmProviderError } from "../llm/interfaces/llm-provider";
import type { ModelRouter } from "../llm/model-router";
import type { TelemetryService } from "../observability/telemetry.service";

describe("ProjectHealthService", () => {
  function buildRequest(
    overrides: Partial<ProjectHealthRequestDto> = {}
  ): ProjectHealthRequestDto {
    return {
      projectStatus: "yellow",
      daysUntilEnd: 14,
      percentHoursComplete: 68,
      plannedHours: 1000,
      estimatedHoursAtCompletion: 1260,
      remainingAmount: 2000,
      marginPercent: 12,
      assignmentCount: 5,
      activeAssignmentCount: 4,
      assignmentAtRiskCount: 1,
      milestoneCount: 8,
      lateMilestoneCount: 2,
      completedMilestoneCount: 3,
      timecardHeaderCount: 20,
      submittedTimecardCount: 2,
      rejectedTimecardCount: 1,
      approvedTimecardCount: 17,
      totalTimecardHours: 320,
      projectTaskCount: 24,
      openProjectTaskCount: 12,
      overdueProjectTaskCount: 3,
      resourceRequestCount: 2,
      openResourceRequestCount: 1,
      closeToStartResourceRequestCount: 1,
      budgetCount: 1,
      budgetAmount: 100000,
      budgetConsumedAmount: 90000,
      budgetRemainingAmount: 10000,
      requestId: "project-health-req-1",
      ...overrides
    };
  }

  function buildService(content: string): {
    service: ProjectHealthService;
    chat: jest.Mock;
    telemetry: { recordAgentWorkflow: jest.Mock };
  } {
    const chat = jest.fn().mockResolvedValue({
      content,
      finishReason: "stop",
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 88,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });
    const telemetry = { recordAgentWorkflow: jest.fn() };
    const service = new ProjectHealthService(
      { chat } as unknown as ModelRouter,
      telemetry as unknown as TelemetryService
    );
    return { service, chat, telemetry };
  }

  it("combines deterministic health signals with model narrative", async () => {
    const { service, chat, telemetry } = buildService(
      '{"summary":"Delivery is at risk from late milestones and staffing gaps.","riskDrivers":"late milestones; open resource request; hour forecast over plan","recommendedActions":"rebaseline milestones; staff the open role; review scope controls","confidence":"high"}'
    );

    const result = await service.summarize(buildRequest(), {
      subject: "agentforce-runtime",
      scopes: ["agentforce:services-project-health"],
      tenantId: "tenant-services",
      raw: {}
    });

    expect(result).toMatchObject({
      healthStatus: "red",
      riskLevel: "critical",
      scheduleStatus: "red",
      budgetStatus: "red",
      staffingStatus: "red",
      summary: "Delivery is at risk from late milestones and staffing gaps.",
      confidence: "high",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 88
    });
    expect(result.riskDrivers).toContain("late milestones");
    expect(result.recommendedActions).toContain("staff the open role");

    const llmRequest = chat.mock.calls[0][0];
    expect(llmRequest).toMatchObject({
      requestId: "project-health-req-1",
      useCase: "agentforce_services_project_health",
      tenantId: "tenant-services",
      surface: "agentforce",
      temperature: 0
    });
    expect(llmRequest.messages[1].content).toContain(
      "Deterministic healthStatus: red"
    );
    expect(llmRequest.messages[1].content).not.toContain("Project Name");
    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "services.project_health",
        healthStatus: "red",
        riskLevel: "critical",
        useCase: "agentforce_services_project_health",
        tenantId: "tenant-services",
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70
      })
    );
  });

  it("falls back to deterministic narrative for malformed model output", async () => {
    const { service, telemetry } = buildService("not json at all");

    const result = await service.summarize(
      buildRequest({
        projectStatus: "green",
        lateMilestoneCount: 0,
        overdueProjectTaskCount: 0,
        rejectedTimecardCount: 0,
        submittedTimecardCount: 0,
        estimatedHoursAtCompletion: 900,
        marginPercent: 30,
        assignmentAtRiskCount: 0,
        openResourceRequestCount: 0,
        closeToStartResourceRequestCount: 0
      })
    );

    expect(result.healthStatus).toBe("green");
    expect(result.riskLevel).toBe("low");
    expect(result.summary).toBe(
      "Project health is green with low delivery risk; schedule is green, budget is green, and staffing is green."
    );
    expect(result.riskDrivers).toBe(
      "no major deterministic risk drivers detected"
    );
    expect(result.recommendedActions).toBe(
      "continue normal project health monitoring"
    );
    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "success",
        narrativeFallbackUsed: true
      })
    );
  });

  it("falls back when the model returns blank narrative fields", async () => {
    const { service } = buildService(
      '{"summary":"  ","riskDrivers":"","recommendedActions":"\n","confidence":"high"}'
    );

    const result = await service.summarize(
      buildRequest({
        projectStatus: "green",
        lateMilestoneCount: 0,
        overdueProjectTaskCount: 0,
        rejectedTimecardCount: 0,
        submittedTimecardCount: 0,
        estimatedHoursAtCompletion: 900,
        marginPercent: 30,
        assignmentAtRiskCount: 0,
        openResourceRequestCount: 0,
        closeToStartResourceRequestCount: 0
      })
    );

    expect(result.summary).toBe(
      "Project health is green with low delivery risk; schedule is green, budget is green, and staffing is green."
    );
    expect(result.riskDrivers).toBe(
      "no major deterministic risk drivers detected"
    );
    expect(result.recommendedActions).toBe(
      "continue normal project health monitoring"
    );
  });

  it("redacts sensitive text if a provider echoes it in narrative fields", async () => {
    const { service } = buildService(
      '{"summary":"Project for jane@example.com needs review","riskDrivers":"Call 415-555-1212; account number ACCT-123456","recommendedActions":"Do not mention 123 Main St","confidence":"medium"}'
    );

    const result = await service.summarize(buildRequest());

    expect(result.summary).toContain("[redacted-email]");
    expect(result.riskDrivers).toContain("[redacted-phone]");
    expect(result.riskDrivers).toContain("[redacted-identifier]");
    expect(result.recommendedActions).toContain("[redacted-address]");
  });

  it("records workflow error telemetry when the model router fails", async () => {
    const chat = jest
      .fn()
      .mockRejectedValue(
        new LlmProviderError("model-router", "validation", "No providers")
      );
    const telemetry = { recordAgentWorkflow: jest.fn() };
    const service = new ProjectHealthService(
      { chat } as unknown as ModelRouter,
      telemetry as unknown as TelemetryService
    );

    await expect(service.summarize(buildRequest())).rejects.toThrow(
      LlmProviderError
    );

    expect(telemetry.recordAgentWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "services.project_health",
        useCase: "agentforce_services_project_health",
        outcome: "error",
        errorKind: "validation"
      })
    );
  });
});

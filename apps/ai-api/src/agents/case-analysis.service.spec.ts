import { CaseAnalysisService } from "./case-analysis.service";
import type { ModelRouter } from "../llm/model-router";
import type { AnalyzeCaseRequestDto } from "./dto/case-analysis.dto";

describe("CaseAnalysisService", () => {
  function buildRequest(
    overrides: Partial<AnalyzeCaseRequestDto> = {}
  ): AnalyzeCaseRequestDto {
    return {
      caseSubject: "Outage report",
      caseDescription:
        "Customer name is Jane Doe. Email jane@example.com, phone 415-555-1212, account number ACCT-123456. No service since 9 AM.",
      caseStatus: "Working",
      caseType: "Outage",
      caseOrigin: "Web",
      reportedPriority: "high",
      caseId: "5000xyz",
      requestId: "test-analysis-req",
      ...overrides
    };
  }

  function buildRouter(content: string): {
    router: ModelRouter;
    chat: jest.Mock;
  } {
    const chat = jest.fn().mockResolvedValue({
      content,
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 12, totalTokens: 22 },
      metadata: {
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 42,
        fallbackUsed: false,
        attemptedProviders: ["openai"]
      }
    });
    return { router: { chat } as unknown as ModelRouter, chat };
  }

  it("parses a well-formed JSON envelope into the structured response", async () => {
    const { router } = buildRouter(
      '{"summary":"Outage reported, awaiting field check","category":"outage","priority":"high","confidence":"high","nextAction":"Dispatch field technician within SLA window"}'
    );
    const service = new CaseAnalysisService(router);

    const result = await service.analyze(buildRequest());

    expect(result).toMatchObject({
      summary: "Outage reported, awaiting field check",
      category: "outage",
      recommendedPriority: "high",
      confidence: "high",
      nextAction: "Dispatch field technician within SLA window",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 42
    });
  });

  it("masks sensitive identifiers in the prompt sent to the router", async () => {
    const { router, chat } = buildRouter(
      '{"summary":"safe","category":"outage","priority":"high","confidence":"medium","nextAction":"safe"}'
    );
    const service = new CaseAnalysisService(router);

    await service.analyze(buildRequest());

    const sent = chat.mock.calls[0][0] as { messages: { content: string }[] };
    const userMessage = sent.messages[1].content;
    expect(userMessage).not.toContain("Jane Doe");
    expect(userMessage).not.toContain("jane@example.com");
    expect(userMessage).not.toContain("415-555-1212");
    expect(userMessage).not.toContain("ACCT-123456");
    expect(userMessage).toContain("[redacted-email]");
    expect(userMessage).toContain("[redacted-phone]");
    expect(userMessage).toContain("[redacted-identifier]");
  });

  it("falls back to safe defaults for unknown category/confidence/priority", async () => {
    const { router } = buildRouter(
      '{"summary":"unknown shape","category":"weather","priority":"urgent","confidence":"unsure","nextAction":"observe"}'
    );
    const service = new CaseAnalysisService(router);

    const result = await service.analyze(
      buildRequest({ reportedPriority: "normal" })
    );

    expect(result.category).toBe("other");
    expect(result.recommendedPriority).toBe("normal");
    expect(result.confidence).toBe("low");
  });

  it("recovers from non-JSON model output without throwing", async () => {
    const { router } = buildRouter("not json at all");
    const service = new CaseAnalysisService(router);

    const result = await service.analyze(
      buildRequest({ reportedPriority: "high" })
    );

    expect(result.summary).toBe("Model output was not valid JSON.");
    expect(result.category).toBe("other");
    expect(result.recommendedPriority).toBe("high");
    expect(result.confidence).toBe("low");
  });

  it("redacts sensitive content found inside the model response", async () => {
    const { router } = buildRouter(
      '{"summary":"Caller jane@example.com reports outage","category":"outage","priority":"high","confidence":"high","nextAction":"Call 415-555-1212 to confirm"}'
    );
    const service = new CaseAnalysisService(router);

    const result = await service.analyze(buildRequest());

    expect(result.summary).toContain("[redacted-email]");
    expect(result.nextAction).toContain("[redacted-phone]");
  });
});

import { SupportTriageService } from "./support-triage.service";
import type { ModelRouter } from "../llm/model-router";
import type {
  TriageCaseRequestDto,
  TriageCustomerSignals
} from "./dto/triage-case.dto";

interface Harness {
  service: SupportTriageService;
  chat: jest.Mock;
}

function buildHarness(): Harness {
  const chat = jest.fn();
  const modelRouter = { chat } as unknown as ModelRouter;
  return { service: new SupportTriageService(modelRouter), chat };
}

function modelReply(body: string) {
  return {
    content: body,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metadata: {
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 5,
      attemptedProviders: ["openai"]
    }
  };
}

const triageJson = (priority: string) =>
  `{"priority":"${priority}","summary":"Issue plus customer stakes.","nextStep":"Route to senior tech."}`;

function buildSignals(
  overrides: Partial<TriageCustomerSignals> = {}
): TriageCustomerSignals {
  return {
    customerTier: "premium",
    slaClass: "premium",
    warrantyStatus: "covered",
    strategicAccount: true,
    repeatIncident: { repeat: true, count: 2 },
    openIncidentCount: 1,
    escalationHistory: 1,
    businessRisk: "high",
    primaryModel: "VX-900",
    degraded: false,
    ...overrides
  };
}

function buildRequest(
  overrides: Partial<TriageCaseRequestDto> = {}
): TriageCaseRequestDto {
  return {
    subject: "Recurring outage on production line",
    description: "The unit keeps failing every few days.",
    reportedPriority: "normal",
    requestId: "wf-triage-1",
    ...overrides
  };
}

/** The model's user-content message is the second message in the request. */
function userContent(chat: jest.Mock): string {
  return chat.mock.calls[0][0].messages[1].content as string;
}

describe("SupportTriageService — Phase B context-informed triage", () => {
  it("appends a sanitized customer-context block when signals are present", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply(triageJson("high")));

    await h.service.triage(buildRequest({ customerSignals: buildSignals() }));

    const content = userContent(h.chat);
    expect(content).toContain("Customer context (sanitized");
    // Sanitized signal values are present...
    expect(content).toContain("premium");
    expect(content).toContain('"businessRisk":"high"');
    expect(content).toContain("VX-900");
    // ...and the single ModelRouter.chat() seam is used exactly once.
    expect(h.chat).toHaveBeenCalledTimes(1);
  });

  it("sends a case-only message when no customer signals are present", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply(triageJson("normal")));

    await h.service.triage(buildRequest());

    const content = userContent(h.chat);
    expect(content).not.toContain("Customer context");
    expect(content).toContain("Subject:");
    expect(content).toContain("Reported priority: normal");
  });

  it("forwards the degraded flag inside the signal block", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply(triageJson("normal")));

    await h.service.triage(
      buildRequest({ customerSignals: buildSignals({ degraded: true }) })
    );

    expect(userContent(h.chat)).toContain('"degraded":true');
  });

  it("raises priority when the model returns a higher level from the signals", async () => {
    const h = buildHarness();
    // Reported normal; strategic + repeat-failure signals → model returns high.
    h.chat.mockResolvedValue(modelReply(triageJson("high")));

    const result = await h.service.triage(
      buildRequest({
        reportedPriority: "normal",
        customerSignals: buildSignals()
      })
    );

    expect(result.recommendedPriority).toBe("high");
  });

  it("falls back to the reported priority when the model output is unparseable", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply("not json at all"));

    const result = await h.service.triage(
      buildRequest({
        reportedPriority: "normal",
        customerSignals: buildSignals({ degraded: true })
      })
    );

    expect(result.recommendedPriority).toBe("normal");
  });

  it("does not leak raw signal objects into the returned summary", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply(triageJson("high")));

    const result = await h.service.triage(
      buildRequest({ customerSignals: buildSignals() })
    );

    expect(result.summary.length).toBeLessThanOrEqual(160);
    expect(result.suggestedNextStep.length).toBeLessThanOrEqual(160);
  });
});

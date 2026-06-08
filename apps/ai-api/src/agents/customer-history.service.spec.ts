import { CustomerHistorySynthesisService } from "./customer-history.service";
import type { ModelRouter } from "../llm/model-router";
import type { CustomerReadBundle } from "../orchestrator/dto/customer-context";

interface Harness {
  service: CustomerHistorySynthesisService;
  chat: jest.Mock;
}

function buildHarness(): Harness {
  const chat = jest.fn();
  const modelRouter = { chat } as unknown as ModelRouter;
  return { service: new CustomerHistorySynthesisService(modelRouter), chat };
}

function modelReply(risk: string) {
  return {
    content: `{"risk":"${risk}"}`,
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

const fullBundle: CustomerReadBundle = {
  source: "soql",
  accountProfile: { tier: "premium", strategic: true },
  entitlement: { hasEntitlement: true, slaClass: "premium" },
  warranty: { status: "covered" },
  installedAssets: { totalAssets: 420, modelCount: 1, primaryModel: "VX-900" },
  serviceHistory: {
    priorCaseCount: 5,
    repeatIncidentCount: 2,
    repeatWindowDays: 30,
    priorEscalations: 1,
    openIncidentCount: 1
  },
  missingSources: []
};

describe("CustomerHistorySynthesisService", () => {
  it("asserts findings from explicit sources", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply("high"));

    const result = await h.service.synthesize({ bundle: fullBundle });

    expect(result.package.customerTier.value).toBe("premium");
    expect(result.package.customerTier.assertedVsInferred).toBe("asserted");
    expect(result.package.customerTier.notEvidenced).toBeUndefined();
    expect(result.package.strategicAccount.value).toBe(true);
    expect(result.package.warrantyStatus.value).toBe("covered");
    expect(result.package.repeatIncident.value.repeat).toBe(true);
  });

  it("abstains on missing sources without fabricating a confident value", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply("medium"));

    // No account profile, no warranty, no assets — but evidenced history
    // and an evidenced (absent) entitlement.
    const bundle: CustomerReadBundle = {
      source: "soql",
      entitlement: { hasEntitlement: false, slaClass: "none" },
      serviceHistory: {
        priorCaseCount: 3,
        repeatIncidentCount: 2,
        repeatWindowDays: 30,
        priorEscalations: 0,
        openIncidentCount: 1
      },
      missingSources: ["account", "warranty", "installed_assets"]
    };

    const result = await h.service.synthesize({ bundle });

    // Strategic importance must NEVER be inferred to true without a flag.
    expect(result.package.strategicAccount.notEvidenced).toBe(true);
    expect(result.package.strategicAccount.value).toBe(false);
    expect(result.package.strategicAccount.confidence).toBe("low");

    // Tier and warranty abstain (low confidence + not evidenced).
    expect(result.package.customerTier.notEvidenced).toBe(true);
    expect(result.package.customerTier.value).toBe("unknown");
    expect(result.package.warrantyStatus.notEvidenced).toBe(true);

    // Evidenced absence is still asserted, not abstained.
    expect(result.package.slaClass.value).toBe("none");
    expect(result.package.slaClass.notEvidenced).toBeUndefined();
  });

  it("grades risk via the model from non-PII signals only", async () => {
    const h = buildHarness();
    h.chat.mockResolvedValue(modelReply("high"));

    const result = await h.service.synthesize({
      bundle: fullBundle,
      triagePriority: "critical"
    });

    expect(result.package.businessRisk.value).toBe("high");
    expect(result.package.businessRisk.assertedVsInferred).toBe("inferred");
    expect(result.fallbackUsed).toBe(false);
    expect(result.provider).toBe("openai");

    const request = h.chat.mock.calls[0][0];
    expect(request.useCase).toBe("agentforce_customer_history");
    const payload = request.messages[1].content as string;
    // Safe signals only — no account ids, names, or raw records.
    expect(payload).toContain("tier");
    expect(payload).not.toContain("accountId");
    expect(payload).not.toContain("001000000000001");
  });

  it("falls back to a deterministic grade when the model fails", async () => {
    const h = buildHarness();
    h.chat.mockRejectedValue(new Error("model down"));

    const result = await h.service.synthesize({ bundle: fullBundle });

    // strategic + repeat + premium -> deterministic high.
    expect(result.package.businessRisk.value).toBe("high");
    expect(result.package.businessRisk.provenance).toBe(
      "Deterministic fallback"
    );
    expect(result.fallbackUsed).toBe(true);
  });

  it("does not call the model when there is no evidence at all", async () => {
    const h = buildHarness();

    const bundle: CustomerReadBundle = {
      source: "none",
      missingSources: [
        "account",
        "entitlement",
        "warranty",
        "installed_assets",
        "service_history"
      ]
    };
    const result = await h.service.synthesize({ bundle });

    expect(h.chat).not.toHaveBeenCalled();
    expect(result.package.businessRisk.notEvidenced).toBe(true);
    expect(result.package.businessRisk.value).toBe("unknown");
    expect(result.fallbackUsed).toBe(false);
  });
});

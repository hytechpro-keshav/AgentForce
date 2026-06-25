import { customerContextToTriageSignals } from "./customer-context-to-triage-signals";
import type {
  CustomerContextChannel,
  CustomerContextPackage
} from "./dto/customer-context";

function finding<T>(value: T, notEvidenced = false) {
  return {
    value,
    confidence: "high" as const,
    provenance: "Salesforce",
    evidenceBasis: "evidenced",
    assertedVsInferred: "asserted" as const,
    ...(notEvidenced ? { notEvidenced: true } : {})
  };
}

function buildPackage(
  overrides: Partial<CustomerContextPackage> = {}
): CustomerContextPackage {
  return {
    customerTier: finding("premium" as const),
    slaClass: finding("premium" as const),
    warrantyStatus: finding("covered" as const),
    repeatIncident: finding({ repeat: true, count: 2, windowDays: 30 }),
    strategicAccount: finding(true),
    installedAssets: finding({
      totalAssets: 420,
      modelCount: 1,
      primaryModel: "VX-900"
    }),
    openIncidentCount: finding(1),
    escalationHistory: finding(1),
    businessRisk: finding("high" as const),
    ...overrides
  };
}

function buildChannel(
  overrides: Partial<CustomerContextChannel> = {}
): CustomerContextChannel {
  return {
    eligible: true,
    degraded: false,
    package: buildPackage(),
    provider: "openai",
    model: "gpt-4o-mini",
    fallbackUsed: false,
    latencyMs: 12,
    ...overrides
  };
}

describe("customerContextToTriageSignals", () => {
  it("maps a populated package to flat sanitized signals", () => {
    const signals = customerContextToTriageSignals(buildChannel());

    expect(signals).toEqual({
      customerTier: "premium",
      slaClass: "premium",
      warrantyStatus: "covered",
      strategicAccount: true,
      repeatIncident: { repeat: true, count: 2 },
      openIncidentCount: 1,
      escalationHistory: 1,
      businessRisk: "high",
      primaryModel: "VX-900",
      degraded: false
    });
  });

  it("returns undefined when the channel is absent", () => {
    expect(customerContextToTriageSignals(undefined)).toBeUndefined();
  });

  it("returns undefined when the channel is ineligible (present-but-skipped)", () => {
    const channel: CustomerContextChannel = {
      eligible: false,
      eligibilityReason: "priority=low below threshold",
      degraded: false
    };
    expect(customerContextToTriageSignals(channel)).toBeUndefined();
  });

  it("returns undefined when eligible but no package was synthesized", () => {
    expect(
      customerContextToTriageSignals(
        buildChannel({ eligible: true, package: undefined })
      )
    ).toBeUndefined();
  });

  it("omits strategicAccount when the finding was not evidenced", () => {
    const signals = customerContextToTriageSignals(
      buildChannel({
        package: buildPackage({ strategicAccount: finding(false, true) })
      })
    );

    expect(signals).toBeDefined();
    expect(signals).not.toHaveProperty("strategicAccount");
  });

  it("forwards the channel degraded flag onto the signals", () => {
    const signals = customerContextToTriageSignals(
      buildChannel({ degraded: true })
    );

    expect(signals?.degraded).toBe(true);
  });

  it("passes through an absent primaryModel as undefined", () => {
    const signals = customerContextToTriageSignals(
      buildChannel({
        package: buildPackage({
          installedAssets: finding({ totalAssets: 0, modelCount: 0 })
        })
      })
    );

    expect(signals?.primaryModel).toBeUndefined();
  });
});

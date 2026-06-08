import { evaluateCustomerHistoryEligibility } from "./customer-history.eligibility";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";

function context(
  overrides: Partial<SalesforceCaseContext> = {}
): SalesforceCaseContext {
  return {
    caseId: "500000000000001",
    subject: "Outage",
    description: "No service",
    origin: "Web",
    reportedPriority: "high",
    ...overrides
  };
}

describe("evaluateCustomerHistoryEligibility", () => {
  it("is permissive by default (empty policy)", () => {
    const result = evaluateCustomerHistoryEligibility(context(), "high", {});
    expect(result.eligible).toBe(true);
  });

  it("rejects an origin outside the eligible set", () => {
    const result = evaluateCustomerHistoryEligibility(
      context({ origin: "Email" }),
      "high",
      { eligibleOrigins: ["Web", "API"] }
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("origin=Email");
  });

  it("accepts an origin inside the eligible set", () => {
    const result = evaluateCustomerHistoryEligibility(
      context({ origin: "Web" }),
      "low",
      { eligibleOrigins: ["Web"] }
    );
    expect(result.eligible).toBe(true);
  });

  it("uses the triage priority when present", () => {
    const result = evaluateCustomerHistoryEligibility(context(), "critical", {
      eligiblePriorities: ["high", "critical"]
    });
    expect(result.eligible).toBe(true);
  });

  it("falls back to the reported priority when triage is absent", () => {
    const result = evaluateCustomerHistoryEligibility(
      context({ reportedPriority: "low" }),
      undefined,
      { eligiblePriorities: ["high", "critical"] }
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("priority=low");
  });
});

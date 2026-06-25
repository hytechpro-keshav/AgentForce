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

  it("account-linked Case is eligible regardless of eligiblePriorities (pre-triage gate bypass)", () => {
    // A Case with accountId + low reportedPriority must still be eligible
    // when eligiblePriorities is [high, critical] — the accountId gate
    // supersedes the priority gate so context-informed triage can run.
    const result = evaluateCustomerHistoryEligibility(
      context({ accountId: "001000000000001", reportedPriority: "low" }),
      undefined,
      { eligiblePriorities: ["high", "critical"] }
    );
    expect(result.eligible).toBe(true);
  });

  it("no-account Case with low priority remains ineligible when eligiblePriorities is set", () => {
    const result = evaluateCustomerHistoryEligibility(
      context({ reportedPriority: "low" }),
      undefined,
      { eligiblePriorities: ["high", "critical"] }
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("priority=low");
  });
});

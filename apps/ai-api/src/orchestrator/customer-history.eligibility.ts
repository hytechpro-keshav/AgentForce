import type { TriagePriorityDto } from "../agents/dto/triage-case.dto";
import type {
  CustomerHistoryEligibilityPolicy,
  CustomerHistoryEligibilityResult
} from "./dto/customer-context";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";

/**
 * Cheap, config-driven eligibility check for Node 2 — the analogue of
 * Service Assistant's "Check Service Plan Eligibility" autolaunched
 * flow. It runs BEFORE any customer read or model call so low-value
 * Cases skip the expensive work. The decision is purely a function of
 * non-PII Case criteria (origin, priority) plus the optional triage
 * hint, so it is trivially testable and never touches Salesforce.
 *
 * Default policy (no config) is permissive: every Case is eligible.
 * Tightening it is a config change, not a code change.
 */
export function evaluateCustomerHistoryEligibility(
  context: SalesforceCaseContext,
  triagePriority: TriagePriorityDto | undefined,
  policy: CustomerHistoryEligibilityPolicy
): CustomerHistoryEligibilityResult {
  if (policy.eligibleOrigins && policy.eligibleOrigins.length > 0) {
    const origin = context.origin?.trim();
    if (!origin || !policy.eligibleOrigins.includes(origin)) {
      return {
        eligible: false,
        reason: `origin=${origin ?? "none"} not in eligible origins`
      };
    }
  }

  if (policy.eligiblePriorities && policy.eligiblePriorities.length > 0) {
    // When an Account is linked, customer read must run regardless of
    // priority — eligiblePriorities cannot block pre-triage context reads
    // (the account gate supersedes it; origin gate still applies above).
    if (context.accountId) {
      return { eligible: true, reason: "eligible" };
    }
    // No account: fall back to priority gate using the supplied hint
    // (reported priority or triage recommendation).
    const priority = triagePriority ?? context.reportedPriority;
    if (!priority || !policy.eligiblePriorities.includes(priority)) {
      return {
        eligible: false,
        reason: `priority=${priority ?? "none"} below eligibility threshold`
      };
    }
  }

  return { eligible: true, reason: "eligible" };
}

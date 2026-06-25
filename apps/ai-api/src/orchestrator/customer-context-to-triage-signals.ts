import type { TriageCustomerSignals } from "../agents/dto/triage-case.dto";
import type { CustomerContextChannel } from "./dto/customer-context";

/**
 * Phase B — derive the flat, sanitized {@link TriageCustomerSignals} the
 * context-informed triage LLM consumes from the structured
 * `customerContext` package.
 *
 * Pure and side-effect free so it is unit-testable with no Nest coupling.
 * Returns `undefined` (triage runs case-only) when the channel is absent,
 * ineligible, or has no synthesized package — the degrade-safe path. Only
 * finding `.value`s cross the boundary; the raw `CustomerContextPackage`
 * (with provenance/evidence prose) never reaches the model.
 *
 * Evidence-or-abstain is preserved: `strategicAccount` is omitted when the
 * finding was not evidenced, so the model never sees a fabricated `false`.
 */
export function customerContextToTriageSignals(
  channel: CustomerContextChannel | undefined
): TriageCustomerSignals | undefined {
  const pkg = channel?.package;
  if (!channel || !channel.eligible || !pkg) {
    return undefined;
  }

  const signals: TriageCustomerSignals = {
    customerTier: pkg.customerTier.value,
    slaClass: pkg.slaClass.value,
    warrantyStatus: pkg.warrantyStatus.value,
    repeatIncident: {
      repeat: pkg.repeatIncident.value.repeat,
      count: pkg.repeatIncident.value.count
    },
    openIncidentCount: pkg.openIncidentCount.value,
    escalationHistory: pkg.escalationHistory.value,
    businessRisk: pkg.businessRisk.value,
    primaryModel: pkg.installedAssets.value.primaryModel,
    degraded: channel.degraded
  };

  // Evidence-honest: only assert strategic importance when it was actually
  // evidenced — never surface a fabricated `false` to the model.
  if (!pkg.strategicAccount.notEvidenced) {
    signals.strategicAccount = pkg.strategicAccount.value;
  }

  return signals;
}

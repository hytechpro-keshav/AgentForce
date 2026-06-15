/**
 * Phase 4b — KB warehouse cross-check (audit-only, pure).
 *
 * Annotates each part plan with whether its chosen fulfillment warehouse
 * matches the warehouses the knowledge base documents for the part, and
 * rolls the per-part outcomes into a channel-level summary. This is an
 * observability signal: it NEVER changes availability, readiness, ETA,
 * approval, or confidence — those remain owned by the planner.
 */

import type {
  KbWarehouseAlignment,
  PartLogisticsPlan,
  PartsKbCrossCheck
} from "./dto/parts-logistics";
import { kbDocumentedWarehousesFor } from "./parts-kb-location-references";

export interface KbCrossCheckResult {
  /** Plans with `kbDocumentedWarehouses` / `kbWarehouseAlignment` filled in. */
  annotated: PartLogisticsPlan[];
  /** Aggregate rollup, or undefined when there is nothing to cross-check. */
  summary: PartsKbCrossCheck | undefined;
}

/**
 * Cross-checks each plan's fulfillment warehouse against the KB-documented
 * locations for the part. Returns annotated copies plus the rollup.
 */
export function crossCheckKbWarehouses(
  plans: PartLogisticsPlan[]
): KbCrossCheckResult {
  if (plans.length === 0) {
    return { annotated: plans, summary: undefined };
  }

  let alignedCount = 0;
  let divergentCount = 0;
  let undocumentedCount = 0;

  const annotated = plans.map((plan) => {
    const documented = kbDocumentedWarehousesFor(plan.partNumber);
    const chosen = plan.fulfillmentWarehouseReference;
    const { alignment, note } = classify(documented, chosen);

    if (alignment === "aligned") {
      alignedCount += 1;
    } else if (alignment === "divergent") {
      divergentCount += 1;
    } else {
      undocumentedCount += 1;
    }

    return {
      ...plan,
      kbDocumentedWarehouses: documented,
      kbWarehouseAlignment: alignment,
      kbCrossCheckNote: note
    };
  });

  const status: PartsKbCrossCheck["status"] =
    divergentCount > 0
      ? "DIVERGENT"
      : alignedCount > 0
        ? "ALIGNED"
        : "UNDOCUMENTED";

  return {
    annotated,
    summary: { status, alignedCount, divergentCount, undocumentedCount }
  };
}

function classify(
  documented: string[],
  chosen: string | undefined
): { alignment: KbWarehouseAlignment; note: string } {
  if (documented.length === 0) {
    return {
      alignment: "unknown",
      note: "No KB location references documented for this part."
    };
  }
  if (!chosen) {
    return {
      alignment: "unknown",
      note: `KB documents ${documented.join(", ")}; no fulfillment warehouse was selected.`
    };
  }
  if (documented.includes(chosen)) {
    return {
      alignment: "aligned",
      note: `Fulfillment warehouse ${chosen} is documented in the KB for this part.`
    };
  }
  return {
    alignment: "divergent",
    note: `Fulfillment warehouse ${chosen} is not in the KB-documented set (${documented.join(", ")}); review routing.`
  };
}

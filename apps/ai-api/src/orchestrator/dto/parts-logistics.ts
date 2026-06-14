/**
 * Node 4 — Parts & Logistics contracts (Phase 4a, read/plan only).
 *
 * Node 4 is READ-ONLY to Salesforce and NON-interrupting. It reads the
 * Case asset + ship-to, the upstream knowledge guidance, and live
 * ProductItem inventory, then writes ONLY its own `partsLogistics`
 * channel. Every value surfaced here is a sanitized, non-PII fact:
 * part numbers, warehouse reference codes, ETA windows, exception and
 * approval reasons — never asset serial numbers, account ids, customer
 * names, or raw inventory payloads.
 *
 * Phase 4a writes no Salesforce records: `reservationStatus` stops at
 * `planned`. Inventory keys are ALWAYS `Product2.ProductCode` and
 * `Location.ExternalReference` — never `Product2.Id` (duplicate catalog
 * rows exist for the same ProductCode).
 */

import type { EvidenceConfidence } from "./customer-context";

export type { EvidenceConfidence } from "./customer-context";

/** Overall fulfillment outcome for the Case's requested parts. */
export type FulfillmentReadiness = "ready" | "partial" | "blocked" | "unknown";

/** Per-part stock availability at the selected fulfillment warehouse. */
export type PartAvailability =
  | "available"
  | "limited"
  | "unavailable"
  | "unknown";

/**
 * Lifecycle of a parts reservation. Phase 4a only ever sets `planned`;
 * the remaining values are Phase 4c (post Node 6 approval) territory.
 */
export type ReservationStatus =
  | "none"
  | "planned"
  | "reserved"
  | "transfer_pending"
  | "backorder_requested";

/** Why a part plan needs handling beyond a straight pick-and-ship. */
export type PartsExceptionType =
  | "none"
  | "inter_warehouse_transfer"
  | "backorder"
  | "incompatible_part"
  | "catalog_gap";

/** Machine-readable reason a plan requires Node 6 approval. */
export type PartsApprovalReason =
  | "none"
  | "cross_region_transfer"
  | "backorder"
  | "high_value"
  | "expedite";

/** A single auditable leg of the multi-segment ETA. */
export type EtaSegmentKind =
  | "source_processing"
  | "inter_warehouse_transit"
  | "destination_processing"
  | "last_mile"
  | "replenishment";

export interface EtaSegment {
  segment: EtaSegmentKind;
  hoursMin: number;
  hoursMax: number;
  /** Safe, non-PII descriptor, e.g. "WH-FRA-004 → WH-AUS-001". */
  description?: string;
}

/** Where part candidates came from (audit only). */
export type PartCandidateSource = "knowledge" | "case_text" | "manual";

/**
 * Deterministic fulfillment plan for one requested part. Built by the
 * fulfillment-location-first planner from live inventory + transit
 * rules. No raw inventory rows or serial numbers cross into this shape.
 */
export interface PartLogisticsPlan {
  partNumber: string;
  partName?: string;
  requestedQuantity: number;

  compatibility: "confirmed" | "universal" | "unknown" | "incompatible";
  /** Safe, non-PII basis for the compatibility decision. */
  compatibilityEvidence: string;

  availability: PartAvailability;
  quantityOnHand?: number;

  /** Warehouse the part must reach before last-mile dispatch (§6.6). */
  fulfillmentWarehouseReference?: string;
  fulfillmentWarehouseName?: string;
  fulfillmentWarehouseRegion?: string;

  /** Source WH when a transfer is required; undefined when stock is local. */
  sourceWarehouseReference?: string;
  sourceWarehouseName?: string;
  transferRequired?: boolean;

  exceptionType: PartsExceptionType;

  /** Phase 4a: always `planned` (or `none` when nothing to plan). */
  reservationStatus: ReservationStatus;

  estimatedDispatchHoursMin?: number;
  estimatedDispatchHoursMax?: number;
  /** Human window, e.g. "42–74 hours (cross-region transfer)". */
  estimatedArrivalWindow?: string;
  /** Auditable per-leg ETA breakdown. */
  etaSegments?: EtaSegment[];

  confidence: EvidenceConfidence;
  requiredApproval: boolean;
  approvalReason?: PartsApprovalReason;
  /** Safe, non-PII rationale; never raw chunk text or chain-of-thought. */
  rationale: string;
}

/**
 * The Node 4 state channel and the read model surfaced to the read-only
 * UI. Self-contained and sanitized so the whole channel is safe to
 * persist and render.
 */
export interface PartsLogisticsChannel {
  /** Whether the eligibility gate allowed Node 4 to run. */
  eligible: boolean;
  /** Safe reason string (e.g., "Parts logistics disabled by config"). */
  eligibilityReason?: string;
  /** True when an inventory read or transit-rule source was unavailable. */
  degraded: boolean;
  /** Names only of unavailable sources (e.g., ["salesforce_inventory"]). */
  degradedSources?: string[];

  /**
   * Outcome of the plan. Present when eligible=true and at least one
   * part candidate was found.
   * - PLANNED: all parts ready/plannable at the fulfillment WH.
   * - PARTIAL: a mix of ready, transfer, or blocked parts.
   * - UNAVAILABLE: no part can be fulfilled (backorder/incompatible).
   * - SKIPPED: eligible but no part candidates to plan.
   */
  status?: "PLANNED" | "PARTIAL" | "UNAVAILABLE" | "SKIPPED";
  partPlans?: PartLogisticsPlan[];
  fulfillmentReadiness?: FulfillmentReadiness;
  fulfillmentConfidence?: EvidenceConfidence;

  /** Where the planned part candidates were sourced from (audit). */
  candidateSources?: PartCandidateSource[];

  provider?: string;
  latencyMs?: number;
}

/**
 * Config-driven, cheap eligibility policy result for Node 4. Mirrors
 * {@link KnowledgeEligibilityResult}: pure, no Salesforce access.
 */
export interface PartsLogisticsEligibilityResult {
  eligible: boolean;
  /** Safe, non-PII reason string for why eligible=true/false. */
  reason: string;
}

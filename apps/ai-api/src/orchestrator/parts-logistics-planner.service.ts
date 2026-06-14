import { Injectable } from "@nestjs/common";

import type {
  InventoryReadResult,
  InventoryStockRow
} from "../salesforce/salesforce-inventory.gateway";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type {
  EtaSegment,
  PartCandidateSource,
  PartLogisticsPlan,
  PartsLogisticsChannel
} from "./dto/parts-logistics";
import type { EvidenceConfidence } from "./dto/customer-context";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import {
  DESTINATION_PROCESSING_HOURS,
  REPLENISHMENT_HOURS_MAX,
  REPLENISHMENT_HOURS_MIN,
  destinationRegionForCountry,
  fulfillmentRankingForRegion,
  interWarehouseWindow,
  lastMileWindow,
  lowStockThreshold,
  priorityModifier,
  type WarehouseRegion
} from "./parts-logistics-transit-rules";

/** A part code matched from case text or knowledge guidance. */
const PART_CODE_PATTERN = /\b(SP-[A-Z0-9][A-Z0-9-]{0,30})\b/gi;

/** Parts that always require manager approval regardless of stock (§7.5). */
const HIGH_VALUE_PARTS = new Set(["SP-MB-15X"]);

export interface PartsLogisticsCandidates {
  codes: string[];
  sources: PartCandidateSource[];
}

export interface PartsLogisticsPlanInput {
  context: SalesforceCaseContext;
  candidates: PartsLogisticsCandidates;
  inventory: InventoryReadResult;
  triagePriority?: string;
}

/**
 * Deterministic, fulfillment-location-first parts planner (no LLM).
 *
 * For each requested part it: (1) selects the fulfillment warehouse from
 * the Case ship-to region BEFORE any stock check (§6.6), (2) checks
 * compatibility against the installed asset's product code, (3) resolves
 * availability and the exception type from live stock, and (4) builds a
 * multi-segment ETA for Scenario A (local stock), B (inter-warehouse
 * transfer), or C (backorder) per §6.5. It never throws and never writes
 * to Salesforce — `reservationStatus` stops at `planned`.
 */
@Injectable()
export class PartsLogisticsPlannerService {
  /**
   * Collects candidate part codes in priority order: knowledge
   * suggestions first, then a Case subject/description regex fallback
   * used ONLY when knowledge produced none. Records the source of the
   * candidates for audit.
   */
  collectCandidates(
    context: SalesforceCaseContext,
    knowledgeGuidance: KnowledgeGuidanceChannel | undefined
  ): PartsLogisticsCandidates {
    const codes: string[] = [];
    const sources = new Set<PartCandidateSource>();
    const seen = new Set<string>();

    const add = (raw: string | undefined, source: PartCandidateSource) => {
      if (!raw) return;
      const code = raw.trim().toUpperCase();
      if (!/^SP-[A-Z0-9][A-Z0-9-]{0,30}$/.test(code) || seen.has(code)) {
        return;
      }
      seen.add(code);
      codes.push(code);
      sources.add(source);
    };

    for (const part of knowledgeGuidance?.answer?.suggestedParts ?? []) {
      add(part.partNumber, "knowledge");
    }

    // Case-text fallback only when knowledge surfaced no parts (§Part
    // candidate sources). Keeps the planner useful when Node 3 is
    // skipped, degraded, or returns no typed parts.
    if (codes.length === 0) {
      const haystack = `${context.subject ?? ""} ${context.description ?? ""}`;
      for (const match of haystack.matchAll(PART_CODE_PATTERN)) {
        add(match[1], "case_text");
      }
    }

    return { codes: codes.slice(0, 10), sources: Array.from(sources) };
  }

  /**
   * Builds the parts-logistics channel for the collected candidates.
   * Pure over its inputs and safe to call with a degraded inventory
   * read.
   */
  plan(input: PartsLogisticsPlanInput): PartsLogisticsChannel {
    const { context, candidates, inventory, triagePriority } = input;
    const region = destinationRegionForCountry(context.serviceShipToCountry);
    const fulfillmentRef = fulfillmentRankingForRegion(region)[0];

    // Degraded inventory read: surface the candidates we know about but
    // claim no availability — never invent a backorder from a failed
    // read (B7 / §7.4).
    if (inventory.degraded) {
      return {
        eligible: true,
        degraded: true,
        degradedSources: ["salesforce_inventory"],
        fulfillmentReadiness: "unknown",
        fulfillmentConfidence: "low",
        candidateSources: candidates.sources,
        provider: "deterministic",
        partPlans: candidates.codes.map((code) =>
          this.unknownPlan(code, fulfillmentRef, region)
        )
      };
    }

    const partPlans = candidates.codes.map((code) =>
      this.planPart(
        code,
        context,
        inventory.rows,
        region,
        fulfillmentRef,
        triagePriority
      )
    );

    const fulfillmentReadiness =
      PartsLogisticsPlannerService.aggregateReadiness(partPlans);
    const status = PartsLogisticsPlannerService.statusFor(fulfillmentReadiness);
    const fulfillmentConfidence =
      PartsLogisticsPlannerService.aggregateConfidence(partPlans);

    return {
      eligible: true,
      degraded: false,
      status,
      partPlans,
      fulfillmentReadiness,
      fulfillmentConfidence,
      candidateSources: candidates.sources,
      provider: "deterministic"
    };
  }

  private planPart(
    partNumber: string,
    context: SalesforceCaseContext,
    rows: InventoryStockRow[],
    region: WarehouseRegion,
    fulfillmentRef: string | undefined,
    triagePriority: string | undefined
  ): PartLogisticsPlan {
    const partRows = rows.filter((r) => r.productCode === partNumber);
    const partName = partRows[0]?.productName;
    const modifier = priorityModifier(triagePriority);

    const fulfillmentRow = partRows.find(
      (r) => r.warehouseReference === fulfillmentRef && r.quantityOnHand >= 1
    );
    const fulfillmentName =
      fulfillmentRow?.warehouseName ??
      partRows.find((r) => r.warehouseReference === fulfillmentRef)
        ?.warehouseName;

    // Compatibility uses the typed Product2 fields only — never parsed
    // from a description (§5.1 / safety rules).
    const compatibility = PartsLogisticsPlannerService.resolveCompatibility(
      partRows[0],
      context.assetProductCode
    );

    const base: PartLogisticsPlan = {
      partNumber,
      partName,
      requestedQuantity: 1,
      compatibility: compatibility.kind,
      compatibilityEvidence: compatibility.evidence,
      availability: "unknown",
      fulfillmentWarehouseReference: fulfillmentRef,
      fulfillmentWarehouseName: fulfillmentName,
      fulfillmentWarehouseRegion: region,
      exceptionType: "none",
      reservationStatus: "planned",
      confidence: "medium",
      requiredApproval: false,
      rationale: ""
    };

    // Wrong part for the installed asset — stop before any stock math.
    if (compatibility.kind === "incompatible") {
      return {
        ...base,
        availability: "unavailable",
        exceptionType: "incompatible_part",
        reservationStatus: "none",
        confidence: "high",
        rationale: `${partNumber} is not compatible with installed asset ${
          context.assetProductCode ?? "(unknown)"
        }; routing to human review.`
      };
    }

    // Scenario A — stock at the fulfillment warehouse.
    if (fulfillmentRow) {
      const threshold = lowStockThreshold(partNumber);
      const limited =
        threshold > 0 && fulfillmentRow.quantityOnHand <= threshold;
      const highValue = HIGH_VALUE_PARTS.has(partNumber);
      const segments: EtaSegment[] = [
        PartsLogisticsPlannerService.processingSegment(fulfillmentRow),
        PartsLogisticsPlannerService.lastMileSegment(
          fulfillmentRow.warehouseReference,
          region
        )
      ];
      const eta = PartsLogisticsPlannerService.totalEta(segments, modifier);
      const approvalReason = highValue
        ? "high_value"
        : limited
          ? "high_value"
          : "none";
      return {
        ...base,
        availability: limited ? "limited" : "available",
        quantityOnHand: fulfillmentRow.quantityOnHand,
        transferRequired: false,
        exceptionType: "none",
        estimatedDispatchHoursMin: eta.min,
        estimatedDispatchHoursMax: eta.max,
        estimatedArrivalWindow: `${eta.min}–${eta.max} hours`,
        etaSegments: segments,
        confidence: "high",
        requiredApproval: limited || highValue,
        approvalReason: limited || highValue ? approvalReason : "none",
        rationale: limited
          ? `${fulfillmentRow.quantityOnHand} in stock at ${fulfillmentRow.warehouseReference} (at or below low-stock threshold of ${threshold}); recommend approval before reserving.`
          : `${fulfillmentRow.quantityOnHand} in stock at fulfillment warehouse ${fulfillmentRow.warehouseReference}; ready to reserve.`
      };
    }

    // Scenario B — remote stock requires an inter-warehouse transfer.
    const remoteRow = PartsLogisticsPlannerService.selectSource(
      partRows.filter((r) => r.quantityOnHand >= 1),
      region,
      fulfillmentRef
    );
    if (remoteRow && fulfillmentRef) {
      const interWh = interWarehouseWindow(
        remoteRow.warehouseReference,
        fulfillmentRef
      );
      const crossRegion =
        interWh.crossRegion ||
        (remoteRow.warehouseRegion !== undefined &&
          remoteRow.warehouseRegion !== region);
      const segments: EtaSegment[] = [
        PartsLogisticsPlannerService.processingSegment(remoteRow),
        {
          segment: "inter_warehouse_transit",
          hoursMin: interWh.hoursMin,
          hoursMax: interWh.hoursMax,
          description: `${remoteRow.warehouseReference} → ${fulfillmentRef}`
        },
        {
          segment: "destination_processing",
          hoursMin: DESTINATION_PROCESSING_HOURS,
          hoursMax: DESTINATION_PROCESSING_HOURS,
          description: fulfillmentRef
        },
        PartsLogisticsPlannerService.lastMileSegment(fulfillmentRef, region)
      ];
      const eta = PartsLogisticsPlannerService.totalEta(segments, modifier);
      const highValue = HIGH_VALUE_PARTS.has(partNumber);
      return {
        ...base,
        // Remote stock is NOT "available" — it requires a transfer (B9).
        availability: "unavailable",
        quantityOnHand: remoteRow.quantityOnHand,
        sourceWarehouseReference: remoteRow.warehouseReference,
        sourceWarehouseName: remoteRow.warehouseName,
        transferRequired: true,
        exceptionType: "inter_warehouse_transfer",
        estimatedDispatchHoursMin: eta.min,
        estimatedDispatchHoursMax: eta.max,
        estimatedArrivalWindow: `${eta.min}–${eta.max} hours${
          crossRegion
            ? " (cross-region transfer)"
            : " (inter-warehouse transfer)"
        }`,
        etaSegments: segments,
        confidence: "high",
        requiredApproval: crossRegion || highValue,
        approvalReason: crossRegion
          ? "cross_region_transfer"
          : highValue
            ? "high_value"
            : "none",
        rationale: `No stock at fulfillment warehouse ${fulfillmentRef}; ${remoteRow.quantityOnHand} available at ${remoteRow.warehouseReference}. Plan ${
          crossRegion ? "cross-region" : "in-region"
        } transfer ${remoteRow.warehouseReference} → ${fulfillmentRef}.`
      };
    }

    // Scenario C — no stock anywhere in the network: backorder.
    const segments: EtaSegment[] = [
      {
        segment: "replenishment",
        hoursMin: REPLENISHMENT_HOURS_MIN,
        hoursMax: REPLENISHMENT_HOURS_MAX,
        description: `Vendor → ${fulfillmentRef ?? "fulfillment WH"}`
      },
      {
        segment: "destination_processing",
        hoursMin: DESTINATION_PROCESSING_HOURS,
        hoursMax: DESTINATION_PROCESSING_HOURS,
        description: fulfillmentRef
      },
      ...(fulfillmentRef
        ? [PartsLogisticsPlannerService.lastMileSegment(fulfillmentRef, region)]
        : [])
    ];
    const eta = PartsLogisticsPlannerService.totalEta(segments, modifier);
    return {
      ...base,
      availability: "unavailable",
      quantityOnHand: 0,
      transferRequired: false,
      exceptionType: "backorder",
      estimatedDispatchHoursMin: eta.min,
      estimatedDispatchHoursMax: eta.max,
      estimatedArrivalWindow: `${eta.min}–${eta.max} hours (backorder)`,
      etaSegments: segments,
      confidence: partRows.length > 0 ? "medium" : "low",
      requiredApproval: true,
      approvalReason: "backorder",
      rationale:
        partRows.length > 0
          ? `${partNumber} is out of stock across all inventory locations; backorder requires approval.`
          : `${partNumber} returned no live inventory rows; treating as backorder pending catalog confirmation.`
    };
  }

  private unknownPlan(
    partNumber: string,
    fulfillmentRef: string | undefined,
    region: WarehouseRegion
  ): PartLogisticsPlan {
    return {
      partNumber,
      requestedQuantity: 1,
      compatibility: "unknown",
      compatibilityEvidence:
        "Inventory read unavailable; compatibility not verified.",
      availability: "unknown",
      fulfillmentWarehouseReference: fulfillmentRef,
      fulfillmentWarehouseRegion: region,
      exceptionType: "none",
      reservationStatus: "none",
      confidence: "low",
      requiredApproval: false,
      rationale: "Live inventory was unavailable; parts plan is degraded."
    };
  }

  private static processingSegment(row: InventoryStockRow): EtaSegment {
    const hours = row.outboundLeadTimeHours ?? 4;
    return {
      segment: "source_processing",
      hoursMin: hours,
      hoursMax: hours,
      description: row.warehouseReference
    };
  }

  private static lastMileSegment(
    warehouseRef: string,
    region: WarehouseRegion
  ): EtaSegment {
    const win = lastMileWindow(warehouseRef, region);
    return {
      segment: "last_mile",
      hoursMin: win.hoursMin,
      hoursMax: win.hoursMax,
      description: `${warehouseRef} → ${region}`
    };
  }

  private static totalEta(
    segments: EtaSegment[],
    modifier: number
  ): { min: number; max: number } {
    const min = segments.reduce((sum, s) => sum + s.hoursMin, 0);
    const max = segments.reduce((sum, s) => sum + s.hoursMax, 0);
    return {
      min: Math.round(min * modifier),
      max: Math.round(max * modifier)
    };
  }

  /**
   * Picks the best transfer source: prefer a same-region warehouse, then
   * the shortest inter-warehouse transit to the fulfillment WH.
   */
  private static selectSource(
    rows: InventoryStockRow[],
    region: WarehouseRegion,
    fulfillmentRef: string | undefined
  ): InventoryStockRow | undefined {
    if (rows.length === 0 || !fulfillmentRef) {
      return rows[0];
    }
    const ranked = [...rows].sort((a, b) => {
      const aSame = a.warehouseRegion === region ? 0 : 1;
      const bSame = b.warehouseRegion === region ? 0 : 1;
      if (aSame !== bSame) {
        return aSame - bSame;
      }
      const aWin = interWarehouseWindow(a.warehouseReference, fulfillmentRef);
      const bWin = interWarehouseWindow(b.warehouseReference, fulfillmentRef);
      return aWin.hoursMax - bWin.hoursMax;
    });
    return ranked[0];
  }

  private static resolveCompatibility(
    row: InventoryStockRow | undefined,
    assetProductCode: string | undefined
  ): { kind: PartLogisticsPlan["compatibility"]; evidence: string } {
    if (!row) {
      return {
        kind: "unknown",
        evidence: "No catalog row found for this part code."
      };
    }
    if (row.isUniversalPart || row.compatibleProductCode === "ALL") {
      return {
        kind: "universal",
        evidence:
          "Product2.Is_Universal_Part__c / Compatible_Product_Code__c = ALL."
      };
    }
    if (!assetProductCode) {
      return {
        kind: "unknown",
        evidence: "Case has no installed asset product code to match against."
      };
    }
    if (row.compatibleProductCode === assetProductCode) {
      return {
        kind: "confirmed",
        evidence: `Compatible_Product_Code__c (${row.compatibleProductCode}) matches asset ${assetProductCode}.`
      };
    }
    return {
      kind: "incompatible",
      evidence: `Compatible_Product_Code__c (${
        row.compatibleProductCode ?? "none"
      }) does not match asset ${assetProductCode}.`
    };
  }

  private static aggregateReadiness(
    plans: PartLogisticsPlan[]
  ): PartsLogisticsChannel["fulfillmentReadiness"] {
    if (plans.length === 0) {
      return "unknown";
    }
    const isReady = (p: PartLogisticsPlan) =>
      p.exceptionType === "none" && p.availability === "available";
    const isBlocked = (p: PartLogisticsPlan) =>
      p.exceptionType === "backorder" ||
      p.exceptionType === "incompatible_part";
    if (plans.every(isReady)) {
      return "ready";
    }
    if (plans.every(isBlocked)) {
      return "blocked";
    }
    return "partial";
  }

  private static statusFor(
    readiness: PartsLogisticsChannel["fulfillmentReadiness"]
  ): PartsLogisticsChannel["status"] {
    switch (readiness) {
      case "ready":
        return "PLANNED";
      case "blocked":
        return "UNAVAILABLE";
      case "partial":
        return "PARTIAL";
      default:
        return "PARTIAL";
    }
  }

  private static aggregateConfidence(
    plans: PartLogisticsPlan[]
  ): EvidenceConfidence {
    if (plans.length === 0) {
      return "low";
    }
    const order: Record<EvidenceConfidence, number> = {
      low: 0,
      medium: 1,
      high: 2
    };
    return plans.reduce<EvidenceConfidence>((lowest, p) => {
      return order[p.confidence] < order[lowest] ? p.confidence : lowest;
    }, "high");
  }
}

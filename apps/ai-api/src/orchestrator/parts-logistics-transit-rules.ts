/**
 * Node 4 transit-rule lookups for multi-segment ETA (§6.3, §6.5).
 *
 * These constants MIRROR `data/warehouse-transit-rules.json` and are
 * embedded here so the planner stays deterministic and dependency-free
 * (no runtime filesystem reads on Railway). Keep the two in sync; the
 * JSON file remains the human-facing source of truth and the Phase 4c
 * CMT (`Warehouse_Transit_Rule__mdt`) seed reference.
 */

export type WarehouseRegion = "North America" | "Europe";

interface LastMileRule {
  sourceWarehouseRef: string;
  destinationRegion: WarehouseRegion;
  transitHoursMin: number;
  transitHoursMax: number;
  crossRegion: boolean;
}

interface InterWarehouseRule {
  sourceWarehouseRef: string;
  destinationWarehouseRef: string;
  transitHoursMin: number;
  transitHoursMax: number;
  crossRegion: boolean;
}

export interface HoursWindow {
  hoursMin: number;
  hoursMax: number;
  crossRegion: boolean;
}

const DESTINATION_REGION_RULES: Record<string, WarehouseRegion> = {
  US: "North America",
  CA: "North America",
  MX: "North America",
  DE: "Europe",
  FR: "Europe",
  GB: "Europe"
};

/** Priority ETA multipliers (critical ships faster than low). */
const PRIORITY_MODIFIERS: Record<string, number> = {
  critical: 0.75,
  high: 0.9,
  normal: 1.0,
  low: 1.15
};

const LOW_STOCK_THRESHOLDS: Record<string, number> = {
  "SP-MB-15X": 10,
  "SP-DISP-15X-FHD": 5
};

/** Static fulfillment-warehouse ranking by destination region (§6.6). */
const FULFILLMENT_RANKING: Record<WarehouseRegion, string[]> = {
  "North America": ["WH-AUS-001", "WH-JCY-003", "WH-SJO-002"],
  Europe: ["WH-FRA-004"]
};

const LAST_MILE_RULES: LastMileRule[] = [
  {
    sourceWarehouseRef: "WH-SJO-002",
    destinationRegion: "North America",
    transitHoursMin: 4,
    transitHoursMax: 8,
    crossRegion: false
  },
  {
    sourceWarehouseRef: "WH-JCY-003",
    destinationRegion: "North America",
    transitHoursMin: 6,
    transitHoursMax: 12,
    crossRegion: false
  },
  {
    sourceWarehouseRef: "WH-AUS-001",
    destinationRegion: "North America",
    transitHoursMin: 8,
    transitHoursMax: 16,
    crossRegion: false
  },
  {
    sourceWarehouseRef: "WH-FRA-004",
    destinationRegion: "North America",
    transitHoursMin: 24,
    transitHoursMax: 48,
    crossRegion: true
  },
  {
    sourceWarehouseRef: "WH-FRA-004",
    destinationRegion: "Europe",
    transitHoursMin: 4,
    transitHoursMax: 8,
    crossRegion: false
  },
  {
    sourceWarehouseRef: "WH-SJO-002",
    destinationRegion: "Europe",
    transitHoursMin: 24,
    transitHoursMax: 48,
    crossRegion: true
  }
];

const INTER_WAREHOUSE_RULES: InterWarehouseRule[] = [
  {
    sourceWarehouseRef: "WH-FRA-004",
    destinationWarehouseRef: "WH-AUS-001",
    transitHoursMin: 24,
    transitHoursMax: 48,
    crossRegion: true
  },
  {
    sourceWarehouseRef: "WH-FRA-004",
    destinationWarehouseRef: "WH-JCY-003",
    transitHoursMin: 24,
    transitHoursMax: 48,
    crossRegion: true
  },
  {
    sourceWarehouseRef: "WH-SJO-002",
    destinationWarehouseRef: "WH-JCY-003",
    transitHoursMin: 8,
    transitHoursMax: 16,
    crossRegion: false
  },
  {
    sourceWarehouseRef: "WH-SJO-002",
    destinationWarehouseRef: "WH-AUS-001",
    transitHoursMin: 12,
    transitHoursMax: 24,
    crossRegion: false
  },
  {
    sourceWarehouseRef: "WH-JCY-003",
    destinationWarehouseRef: "WH-AUS-001",
    transitHoursMin: 10,
    transitHoursMax: 20,
    crossRegion: false
  }
];

const DEFAULT_LAST_MILE: HoursWindow = {
  hoursMin: 24,
  hoursMax: 48,
  crossRegion: true
};

const DEFAULT_INTER_WAREHOUSE: HoursWindow = {
  hoursMin: 24,
  hoursMax: 48,
  crossRegion: true
};

export const DESTINATION_PROCESSING_HOURS = 4;
export const REPLENISHMENT_HOURS_MIN = 72;
export const REPLENISHMENT_HOURS_MAX = 120;

/** Map a Case ship-to country (ISO-ish) to a fulfillment region. */
export function destinationRegionForCountry(
  country: string | undefined
): WarehouseRegion {
  if (!country) {
    return "North America";
  }
  const key = country.trim().toUpperCase();
  return DESTINATION_REGION_RULES[key] ?? "North America";
}

/** Ranked fulfillment warehouses for a region (most-preferred first). */
export function fulfillmentRankingForRegion(region: WarehouseRegion): string[] {
  return FULFILLMENT_RANKING[region] ?? [];
}

/** Last-mile transit from a warehouse to the destination region. */
export function lastMileWindow(
  sourceWarehouseRef: string,
  region: WarehouseRegion
): HoursWindow {
  const rule = LAST_MILE_RULES.find(
    (r) =>
      r.sourceWarehouseRef === sourceWarehouseRef &&
      r.destinationRegion === region
  );
  if (!rule) {
    return { ...DEFAULT_LAST_MILE };
  }
  return {
    hoursMin: rule.transitHoursMin,
    hoursMax: rule.transitHoursMax,
    crossRegion: rule.crossRegion
  };
}

/** Inter-warehouse transit from a source WH to the fulfillment WH. */
export function interWarehouseWindow(
  sourceWarehouseRef: string,
  destinationWarehouseRef: string
): HoursWindow {
  const rule = INTER_WAREHOUSE_RULES.find(
    (r) =>
      r.sourceWarehouseRef === sourceWarehouseRef &&
      r.destinationWarehouseRef === destinationWarehouseRef
  );
  if (!rule) {
    return { ...DEFAULT_INTER_WAREHOUSE };
  }
  return {
    hoursMin: rule.transitHoursMin,
    hoursMax: rule.transitHoursMax,
    crossRegion: rule.crossRegion
  };
}

/** ETA multiplier for a triage priority (defaults to 1.0). */
export function priorityModifier(priority: string | undefined): number {
  if (!priority) {
    return 1.0;
  }
  return PRIORITY_MODIFIERS[priority.toLowerCase()] ?? 1.0;
}

/**
 * Low-stock threshold for a part: `quantityOnHand` at or below this
 * (but > 0) is `limited` and recommends approval. Default 0 means a
 * part is only unavailable when truly out of stock.
 */
export function lowStockThreshold(productCode: string): number {
  return LOW_STOCK_THRESHOLDS[productCode] ?? 0;
}

/**
 * Phase 4b — KB-documented warehouse references per part.
 *
 * This map MIRRORS the `locationReferences` documented in the laptop KB
 * corpus (`apps/ai-api/data/knowledge/kb_part{1,2,3}.json`). For each
 * spare-part code it is the union of `locationReferences` across every
 * KB article that lists the part in `inventoryReferences`.
 *
 * It is embedded here (rather than read at runtime) for the same reason
 * as `parts-logistics-transit-rules.ts`: the Node 4 planner stays
 * deterministic and dependency-free (no filesystem reads on Railway).
 * The corpus JSON remains the human-facing source of truth — regenerate
 * this map if the corpus `locationReferences` change.
 *
 * Used ONLY for the audit-only cross-check (§6.6 step 3 reference data):
 * comparing the planner's chosen fulfillment warehouse against where the
 * KB documents the part. It never drives fulfillment selection or ETA.
 */

const KB_DOCUMENTED_WAREHOUSES: Record<string, readonly string[]> = {
  "SP-BATT-15X": ["WH-AUS-001", "WH-FRA-004", "WH-JCY-003", "WH-SJO-002"],
  "SP-CHG-65W": ["WH-AUS-001", "WH-FRA-004", "WH-JCY-003", "WH-SJO-002"],
  "SP-DISP-15X-FHD": ["WH-AUS-001", "WH-FRA-004", "WH-JCY-003", "WH-SJO-002"],
  "SP-FAN-15X": ["WH-AUS-001", "WH-FRA-004", "WH-JCY-003", "WH-SJO-002"],
  "SP-HEAT-15X": ["WH-AUS-001", "WH-FRA-004", "WH-SJO-002"],
  "SP-HINGE-15X": ["WH-FRA-004", "WH-SJO-002"],
  "SP-KBD-15X": ["WH-AUS-001", "WH-SJO-002"],
  "SP-MB-15X": ["WH-AUS-001", "WH-FRA-004", "WH-JCY-003", "WH-SJO-002"],
  "SP-RAM-16-DDR5": ["WH-AUS-001", "WH-FRA-004", "WH-JCY-003", "WH-SJO-002"],
  "SP-SSD-1TB-NVME": ["WH-AUS-001", "WH-FRA-004", "WH-SJO-002"],
  "SP-TPAD-15X": ["WH-SJO-002"]
};

/**
 * Warehouse references the KB documents for a part, or `[]` when the
 * part is not documented in the corpus.
 */
export function kbDocumentedWarehousesFor(productCode: string): string[] {
  return [...(KB_DOCUMENTED_WAREHOUSES[productCode.toUpperCase()] ?? [])];
}

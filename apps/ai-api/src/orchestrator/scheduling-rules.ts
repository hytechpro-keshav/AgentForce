/**
 * Node 5 scheduling rules — deterministic, config-grade lookups (no LLM).
 *
 * These constants align Node 5 technician selection with Node 4 parts
 * fulfillment: the same Case ship-to region drives both the fulfillment
 * warehouse (Node 4) and the service territory (Node 5), so a part
 * arriving at WH-AUS-001 is matched to a technician serving the North
 * America territory (§2.5). Keep the region map in sync with
 * `parts-logistics-transit-rules.ts`.
 *
 * v1 uses a deterministic planner over operating hours / time slots, not
 * the Field Service `AppointmentCandidates` API (§8.4 / R2).
 */

import {
  destinationRegionForCountry,
  type WarehouseRegion
} from "./parts-logistics-transit-rules";

export type { WarehouseRegion } from "./parts-logistics-transit-rules";

/** Base laptop skill every laptop service visit requires. */
export const BASE_LAPTOP_SKILL = "Laptop Hardware";

/** Service territory name per fulfillment region (matches 5-Pre seed). */
const REGION_TERRITORY: Record<WarehouseRegion, string> = {
  "North America": "North America",
  Europe: "Europe"
};

/**
 * Part-code prefix → specialist skill. The base laptop skill is always
 * required; a matched part adds its specialist skill so the planner can
 * rank "best technician by skill" (§8.4 step 1).
 */
const PART_PREFIX_SKILL: Array<{ test: RegExp; skill: string }> = [
  { test: /^SP-BATT/i, skill: "Battery/Power" },
  { test: /^SP-DISP/i, skill: "Display" },
  { test: /^SP-MB/i, skill: "Motherboard" },
  { test: /^SP-(FAN|THERM|COOL)/i, skill: "Thermal/Cooling" }
];

/** Case-text keyword → specialist skill (fallback when no part matched). */
const KEYWORD_SKILL: Array<{ test: RegExp; skill: string }> = [
  { test: /\b(battery|power|charg)/i, skill: "Battery/Power" },
  { test: /\b(display|screen|lcd|panel)/i, skill: "Display" },
  { test: /\b(motherboard|mainboard|logic board)/i, skill: "Motherboard" },
  { test: /\b(thermal|overheat|fan|cooling)/i, skill: "Thermal/Cooling" }
];

/** WorkType estimated duration (minutes) by required specialist skill. */
const SKILL_DURATION_MINUTES: Record<string, number> = {
  "Battery/Power": 60, // Laptop Battery Replacement (1h)
  Display: 120,
  Motherboard: 120,
  "Thermal/Cooling": 90
};

/** Default onsite repair duration when no specialist skill is matched. */
export const DEFAULT_DURATION_MINUTES = 120; // Laptop Onsite Repair (2h)

/**
 * SLA soft response targets in hours by SLA class + priority. These are a
 * preference, not a hard floor (§3.5): they influence ranking and the
 * `sla_breach_risk` approval surface but never push a window earlier than
 * parts can arrive.
 */
const SLA_RESPONSE_HOURS: Record<string, number> = {
  premium: 8,
  standard: 24,
  none: 72,
  unknown: 48
};

const PRIORITY_SLA_HOURS: Record<string, number> = {
  critical: 8,
  high: 24,
  normal: 48,
  low: 72
};

/** Composite rank weights — skill dominates, then availability, then territory. */
export const RANK_WEIGHTS = {
  skill: 0.5,
  availability: 0.3,
  territory: 0.2
} as const;

/** Territory-fit score by membership type in the target territory. */
export const TERRITORY_FIT_SCORE = {
  primary: 1,
  secondary: 0.7
} as const;

/** Map a Case ship-to country to the fulfillment region (Node 4 parity). */
export function regionForShipTo(country: string | undefined): WarehouseRegion {
  return destinationRegionForCountry(country);
}

/** Service territory name for a fulfillment region. */
export function territoryForRegion(region: WarehouseRegion): string {
  return REGION_TERRITORY[region] ?? REGION_TERRITORY["North America"];
}

/**
 * Required skills for a Case: always the base laptop skill, plus a
 * specialist skill derived from the planned part codes (preferred) or the
 * Case subject/description keywords (fallback). Deterministic and
 * de-duplicated; the base skill is always first.
 */
export function requiredSkillsForCase(input: {
  partNumbers?: string[];
  caseText?: string;
}): string[] {
  const skills = new Set<string>([BASE_LAPTOP_SKILL]);
  for (const code of input.partNumbers ?? []) {
    const match = PART_PREFIX_SKILL.find((rule) => rule.test.test(code));
    if (match) {
      skills.add(match.skill);
    }
  }
  // Keyword fallback only when no part surfaced a specialist skill.
  if (skills.size === 1 && input.caseText) {
    for (const rule of KEYWORD_SKILL) {
      if (rule.test.test(input.caseText)) {
        skills.add(rule.skill);
        break;
      }
    }
  }
  return Array.from(skills);
}

/** Estimated WorkType duration (minutes) for the matched required skills. */
export function durationMinutesForSkills(requiredSkills: string[]): number {
  for (const skill of requiredSkills) {
    const minutes = SKILL_DURATION_MINUTES[skill];
    if (minutes !== undefined) {
      return minutes;
    }
  }
  return DEFAULT_DURATION_MINUTES;
}

/** Soft SLA response target in hours from SLA class + triage priority. */
export function slaResponseHours(
  slaClass: string | undefined,
  priority: string | undefined
): number {
  const slaHours = SLA_RESPONSE_HOURS[slaClass ?? "unknown"] ?? 48;
  const priorityHours = priority
    ? (PRIORITY_SLA_HOURS[priority.toLowerCase()] ?? slaHours)
    : slaHours;
  // The tighter of the two governs the soft target.
  return Math.min(slaHours, priorityHours);
}

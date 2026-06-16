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

import type { DurationSource } from "./dto/scheduling";
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
 * Territory-local IANA timezone per fulfillment region (5b). The gateway
 * prefers the live `OperatingHours.TimeZone`; this is the fallback when the
 * operating-hours read is missing or omits a zone. North America aligns to
 * Austin (Central); Europe aligns to the Frankfurt warehouse hub.
 */
const REGION_TIME_ZONE: Record<WarehouseRegion, string> = {
  "North America": "America/Chicago",
  Europe: "Europe/Berlin"
};

/** Minimum / maximum sane appointment duration — guards bad source data. */
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 480;

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

/** Territory-local IANA timezone fallback for a region (5b). */
export function timeZoneForRegion(region: WarehouseRegion): string {
  return REGION_TIME_ZONE[region] ?? REGION_TIME_ZONE["North America"];
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

/**
 * Cross-checks the appointment duration across its three sources (5b) and
 * returns the minutes to plan plus which source won, for verdict
 * explainability:
 *
 * - `WorkType.EstimatedDuration` (the Salesforce system of record) wins
 *   when present.
 * - A knowledge-guidance repair-effort hint that is materially LONGER than
 *   the WorkType widens the window — under-booking a repair is worse than a
 *   slightly long slot — and is reported as `reconciled`.
 * - With no WorkType, the longer of the KB hint and the per-skill default
 *   governs.
 * - With neither, the per-skill default (`skill_default`) governs.
 *
 * All inputs are sanity-clamped to [15, 480] minutes so a bad WorkType or
 * KB value can never produce an absurd window.
 */
export function reconcileDuration(input: {
  skillDerivedMinutes: number;
  workTypeMinutes?: number;
  kbMinutes?: number;
}): { minutes: number; source: DurationSource } {
  const skill = clampDuration(input.skillDerivedMinutes);
  const workType = saneDuration(input.workTypeMinutes);
  const kb = saneDuration(input.kbMinutes);

  if (workType !== undefined) {
    if (kb !== undefined && kb > workType) {
      return { minutes: kb, source: "reconciled" };
    }
    return { minutes: workType, source: "worktype" };
  }
  if (kb !== undefined) {
    return kb >= skill
      ? { minutes: kb, source: "kb" }
      : { minutes: skill, source: "reconciled" };
  }
  return { minutes: skill, source: "skill_default" };
}

/**
 * Largest typed repair-effort hint (minutes) across knowledge actions, or
 * `undefined` when none carry one. Reads the typed `estimatedEffortMinutes`
 * only — never parses `safeSummary` (DTO contract).
 */
export function kbDurationHintMinutes(
  actions: Array<{ estimatedEffortMinutes?: number }> | undefined
): number | undefined {
  if (!actions?.length) {
    return undefined;
  }
  let max: number | undefined;
  for (const action of actions) {
    const value = action.estimatedEffortMinutes;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      max = max === undefined ? value : Math.max(max, value);
    }
  }
  return max;
}

function saneDuration(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return clampDuration(value);
}

function clampDuration(value: number): number {
  return Math.min(
    MAX_DURATION_MINUTES,
    Math.max(MIN_DURATION_MINUTES, Math.round(value))
  );
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

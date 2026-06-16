/**
 * Pure timezone helpers for Node 5 availability projection (Phase 5b).
 *
 * Salesforce operating hours (`OperatingHours.TimeZone` + `TimeSlot`
 * Start/End) are wall-clock times in the TERRITORY-LOCAL timezone, not
 * UTC. Phase 5a projected them as UTC; 5b interprets them in the territory
 * zone so a "09:00–17:00" window in Austin means 09:00 Central — 14:00 or
 * 15:00 UTC depending on daylight saving.
 *
 * Built on the platform `Intl.DateTimeFormat` (ICU) — no external date
 * library. Helpers are pure and deterministic for a given (zone, instant)
 * and DEGRADE TO UTC when the zone is missing/invalid, so a bad TimeZone
 * value can never throw inside the planner (the 5a behavior is preserved
 * exactly when no zone is supplied).
 */

const MS_PER_MINUTE = 60_000;

export interface ZonedParts {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, in the target zone. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat | null>();
const ABBR_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat | null>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (PARTS_FORMATTER_CACHE.has(timeZone)) {
    return PARTS_FORMATTER_CACHE.get(timeZone) ?? null;
  }
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short"
    });
  } catch {
    formatter = null;
  }
  PARTS_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

/** True when the runtime recognizes the timezone id (and it is non-empty). */
export function isValidTimeZone(timeZone: string | undefined): boolean {
  if (!timeZone) {
    return false;
  }
  return partsFormatter(timeZone) !== null;
}

/**
 * Wall-clock parts of an instant in the target zone. Falls back to UTC
 * parts when the zone is missing/invalid (5a parity).
 */
export function utcMsToZonedParts(
  timeZone: string | undefined,
  ms: number
): ZonedParts {
  const formatter = timeZone ? partsFormatter(timeZone) : null;
  if (!formatter) {
    const date = new Date(ms);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      weekday: date.getUTCDay()
    };
  }
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday] ?? new Date(ms).getUTCDay()
  };
}

/**
 * Offset (ms) to ADD to a UTC instant to get the local wall clock, i.e.
 * `localWallAsUtc - utcMs`. America/Chicago in summer (CDT, UTC−5) → −5h.
 */
function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = utcMsToZonedParts(timeZone, utcMs);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wallAsUtc - utcMs;
}

/**
 * UTC instant (ms) for a wall-clock local time on a calendar date in the
 * zone. When the zone is missing/invalid the wall time is treated as UTC
 * (5a parity). DST is resolved by computing the zone offset at the guessed
 * instant and correcting once — robust for business-hours windows, which
 * never fall on the brief DST-transition gap.
 */
export function zonedWallTimeToUtcMs(
  timeZone: string | undefined,
  year: number,
  month: number,
  day: number,
  minutes: number
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day) + minutes * MS_PER_MINUTE;
  if (!timeZone || !isValidTimeZone(timeZone)) {
    return wallAsUtc;
  }
  const guessOffset = zoneOffsetMs(timeZone, wallAsUtc);
  let utc = wallAsUtc - guessOffset;
  const correctedOffset = zoneOffsetMs(timeZone, utc);
  if (correctedOffset !== guessOffset) {
    utc = wallAsUtc - correctedOffset;
  }
  return utc;
}

/** `HH:MM` of an instant in the target zone (UTC when zone missing/invalid). */
export function hhmmInZone(timeZone: string | undefined, ms: number): string {
  const parts = utcMsToZonedParts(timeZone, ms);
  const hours = String(parts.hour).padStart(2, "0");
  const minutes = String(parts.minute).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Short timezone label for display (e.g. "CDT", "CST"). Returns "UTC" when
 * the zone is missing/invalid so the display string stays well-formed.
 */
export function tzAbbreviation(
  timeZone: string | undefined,
  ms: number
): string {
  if (!timeZone) {
    return "UTC";
  }
  let formatter = ABBR_FORMATTER_CACHE.get(timeZone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "short",
        hour: "2-digit"
      });
    } catch {
      formatter = null;
    }
    ABBR_FORMATTER_CACHE.set(timeZone, formatter);
  }
  if (!formatter) {
    return "UTC";
  }
  const part = formatter
    .formatToParts(new Date(ms))
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "UTC";
}

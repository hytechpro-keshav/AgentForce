/**
 * Node 5 deterministic availability projection (v1).
 *
 * Projects a technician's territory operating hours forward from the
 * gated earliest-start floor and returns the first business-hours slot
 * that fits the WorkType duration without colliding with an existing
 * appointment or absence. Pure and fully testable — the gateway supplies
 * the weekly operating windows and busy intervals, the planner supplies
 * the floor, duration, and clock.
 *
 * Phase 5b: operating-hours windows are interpreted in the TERRITORY-LOCAL
 * timezone (`OperatingHours.TimeZone`) when one is supplied — a
 * "09:00–17:00" window in Austin projects to 09:00 Central, not 09:00 UTC.
 * When no `timeZone` is supplied the projection stays in UTC, preserving
 * the 5a behavior byte-for-byte.
 */

import { utcMsToZonedParts, zonedWallTimeToUtcMs } from "./scheduling-timezone";

const MS_PER_MINUTE = 60_000;

/** A weekly-recurring operating-hours window (from OperatingHours/TimeSlot). */
export interface BusinessWindow {
  /**
   * 0 = Sunday … 6 = Saturday. Matches the LOCAL weekday in the territory
   * timezone (UTC weekday when no timezone is supplied).
   */
  dayOfWeek: number;
  /** Minutes from local midnight (UTC midnight when no timezone supplied). */
  openMinutes: number;
  closeMinutes: number;
}

/** A busy interval (existing ServiceAppointment or ResourceAbsence). */
export interface BusyInterval {
  startMs: number;
  endMs: number;
}

export interface EarliestSlot {
  startMs: number;
  endMs: number;
}

export interface FindSlotInput {
  businessWindows: BusinessWindow[];
  busyIntervals: BusyInterval[];
  /** Gated floor: max(partsEtaFloor, now). */
  earliestStartMs: number;
  durationMinutes: number;
  maxLookaheadDays?: number;
  /**
   * IANA timezone for the operating-hours wall clock (5b, e.g.
   * "America/Chicago"). When omitted, windows are projected in UTC.
   */
  timeZone?: string;
}

/**
 * First fitting business-hours slot at or after `earliestStartMs`. Returns
 * `undefined` when no slot fits within the look-ahead horizon, or when no
 * operating windows were supplied (the planner degrades in that case).
 *
 * The day-by-day projection iterates LOCAL calendar days in `timeZone`
 * (territory-local business days) and converts each day's open/close wall
 * times to absolute UTC instants. With no `timeZone` the local zone is UTC,
 * which reproduces the 5a projection exactly.
 */
export function findEarliestSlot(
  input: FindSlotInput
): EarliestSlot | undefined {
  const {
    businessWindows,
    busyIntervals,
    earliestStartMs,
    durationMinutes,
    timeZone
  } = input;
  if (businessWindows.length === 0 || durationMinutes <= 0) {
    return undefined;
  }
  const durationMs = durationMinutes * MS_PER_MINUTE;
  const lookahead = input.maxLookaheadDays ?? 14;
  const busy = [...busyIntervals].sort((a, b) => a.startMs - b.startMs);

  // Anchor on the LOCAL calendar day of the floor so we project the
  // territory's business days, not UTC days.
  const anchor = utcMsToZonedParts(timeZone, earliestStartMs);

  for (let day = 0; day <= lookahead; day += 1) {
    // Calendar add in the local zone — UTC math on the date-only value is a
    // pure, safe way to roll over month/year boundaries.
    const calendar = new Date(
      Date.UTC(anchor.year, anchor.month - 1, anchor.day + day)
    );
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const dayOfMonth = calendar.getUTCDate();
    const weekday = calendar.getUTCDay();

    const windows = businessWindows
      .filter((w) => w.dayOfWeek === weekday && w.closeMinutes > w.openMinutes)
      .sort((a, b) => a.openMinutes - b.openMinutes);

    for (const window of windows) {
      const windowStart = zonedWallTimeToUtcMs(
        timeZone,
        year,
        month,
        dayOfMonth,
        window.openMinutes
      );
      const windowEnd = zonedWallTimeToUtcMs(
        timeZone,
        year,
        month,
        dayOfMonth,
        window.closeMinutes
      );
      let cursor = Math.max(earliestStartMs, windowStart);

      // Sweep the window, skipping past any colliding busy interval.
      while (cursor + durationMs <= windowEnd) {
        const collision = busy.find(
          (b) => b.startMs < cursor + durationMs && b.endMs > cursor
        );
        if (!collision) {
          return { startMs: cursor, endMs: cursor + durationMs };
        }
        cursor = Math.max(cursor, collision.endMs);
      }
    }
  }
  return undefined;
}

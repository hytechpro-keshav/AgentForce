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
 * v1 simplification: times are interpreted in UTC. Territory-local
 * timezone handling is deferred to Phase 5b (it does not change the
 * parts-ETA gating discipline this slice proves).
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** A weekly-recurring operating-hours window (from OperatingHours/TimeSlot). */
export interface BusinessWindow {
  /** 0 = Sunday … 6 = Saturday (matches Date.getUTCDay). */
  dayOfWeek: number;
  /** Minutes from midnight UTC. */
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
}

/**
 * First fitting business-hours slot at or after `earliestStartMs`. Returns
 * `undefined` when no slot fits within the look-ahead horizon, or when no
 * operating windows were supplied (the planner degrades in that case).
 */
export function findEarliestSlot(
  input: FindSlotInput
): EarliestSlot | undefined {
  const { businessWindows, busyIntervals, earliestStartMs, durationMinutes } =
    input;
  if (businessWindows.length === 0 || durationMinutes <= 0) {
    return undefined;
  }
  const durationMs = durationMinutes * MS_PER_MINUTE;
  const lookahead = input.maxLookaheadDays ?? 14;
  const busy = [...busyIntervals].sort((a, b) => a.startMs - b.startMs);
  const dayStart = utcMidnight(earliestStartMs);

  for (let day = 0; day <= lookahead; day += 1) {
    const midnight = dayStart + day * MS_PER_DAY;
    const weekday = new Date(midnight).getUTCDay();
    const windows = businessWindows
      .filter((w) => w.dayOfWeek === weekday && w.closeMinutes > w.openMinutes)
      .sort((a, b) => a.openMinutes - b.openMinutes);

    for (const window of windows) {
      const windowStart = midnight + window.openMinutes * MS_PER_MINUTE;
      const windowEnd = midnight + window.closeMinutes * MS_PER_MINUTE;
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

function utcMidnight(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

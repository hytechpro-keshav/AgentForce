import {
  findEarliestSlot,
  type BusinessWindow
} from "./scheduling-availability";

/** Mon–Sun 09:00–17:00 (local minutes-from-midnight). */
const ALL_DAY: BusinessWindow[] = Array.from({ length: 7 }, (_, day) => ({
  dayOfWeek: day,
  openMinutes: 9 * 60,
  closeMinutes: 17 * 60
}));

const MONDAY_ONLY: BusinessWindow[] = [
  { dayOfWeek: 1, openMinutes: 9 * 60, closeMinutes: 17 * 60 }
];

describe("findEarliestSlot", () => {
  it("projects windows in UTC when no timezone is supplied (5a parity)", () => {
    const slot = findEarliestSlot({
      businessWindows: ALL_DAY,
      busyIntervals: [],
      earliestStartMs: Date.parse("2026-06-15T08:00:00.000Z"),
      durationMinutes: 120
    });
    expect(slot?.startMs).toBe(Date.parse("2026-06-15T09:00:00.000Z"));
  });

  it("projects operating hours in the territory zone (5b)", () => {
    // 09:00 Central on 2026-06-15 (CDT, UTC−5) === 14:00 UTC.
    const slot = findEarliestSlot({
      businessWindows: ALL_DAY,
      busyIntervals: [],
      earliestStartMs: Date.parse("2026-06-15T08:00:00.000Z"),
      durationMinutes: 120,
      timeZone: "America/Chicago"
    });
    expect(slot?.startMs).toBe(Date.parse("2026-06-15T14:00:00.000Z"));
  });

  it("iterates LOCAL calendar days, not UTC days", () => {
    // 2026-06-15T03:00Z is Sunday 22:00 in Chicago; the next local business
    // day (Monday) opens 09:00 CDT === 2026-06-15T14:00Z.
    const floor = Date.parse("2026-06-15T03:00:00.000Z");
    const local = findEarliestSlot({
      businessWindows: MONDAY_ONLY,
      busyIntervals: [],
      earliestStartMs: floor,
      durationMinutes: 120,
      timeZone: "America/Chicago"
    });
    expect(local?.startMs).toBe(Date.parse("2026-06-15T14:00:00.000Z"));

    // In UTC the same instant is already Monday, so the slot is 09:00 UTC.
    const utc = findEarliestSlot({
      businessWindows: MONDAY_ONLY,
      busyIntervals: [],
      earliestStartMs: floor,
      durationMinutes: 120
    });
    expect(utc?.startMs).toBe(Date.parse("2026-06-15T09:00:00.000Z"));
  });

  it("sweeps past a colliding busy interval inside a zoned window", () => {
    // Busy 14:00–15:30 UTC (09:00–10:30 CDT) pushes the 2h slot to 15:30 UTC.
    const slot = findEarliestSlot({
      businessWindows: ALL_DAY,
      busyIntervals: [
        {
          startMs: Date.parse("2026-06-15T14:00:00.000Z"),
          endMs: Date.parse("2026-06-15T15:30:00.000Z")
        }
      ],
      earliestStartMs: Date.parse("2026-06-15T08:00:00.000Z"),
      durationMinutes: 120,
      timeZone: "America/Chicago"
    });
    expect(slot?.startMs).toBe(Date.parse("2026-06-15T15:30:00.000Z"));
  });

  it("returns undefined when there are no operating windows", () => {
    expect(
      findEarliestSlot({
        businessWindows: [],
        busyIntervals: [],
        earliestStartMs: Date.parse("2026-06-15T08:00:00.000Z"),
        durationMinutes: 120,
        timeZone: "America/Chicago"
      })
    ).toBeUndefined();
  });
});

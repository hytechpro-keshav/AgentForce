import {
  hhmmInZone,
  isValidTimeZone,
  tzAbbreviation,
  utcMsToZonedParts,
  zonedWallTimeToUtcMs
} from "./scheduling-timezone";

describe("scheduling-timezone", () => {
  describe("zonedWallTimeToUtcMs", () => {
    it("resolves a summer (DST) wall time to the correct UTC instant", () => {
      // 09:00 in Austin on 2026-06-15 is CDT (UTC−5) → 14:00 UTC.
      expect(zonedWallTimeToUtcMs("America/Chicago", 2026, 6, 15, 9 * 60)).toBe(
        Date.parse("2026-06-15T14:00:00.000Z")
      );
    });

    it("resolves a winter (standard time) wall time correctly", () => {
      // 09:00 in Austin on 2026-01-15 is CST (UTC−6) → 15:00 UTC.
      expect(zonedWallTimeToUtcMs("America/Chicago", 2026, 1, 15, 9 * 60)).toBe(
        Date.parse("2026-01-15T15:00:00.000Z")
      );
    });

    it("resolves a European zone wall time", () => {
      // 09:00 in Frankfurt on 2026-06-15 is CEST (UTC+2) → 07:00 UTC.
      expect(zonedWallTimeToUtcMs("Europe/Berlin", 2026, 6, 15, 9 * 60)).toBe(
        Date.parse("2026-06-15T07:00:00.000Z")
      );
    });

    it("treats the wall time as UTC when the zone is missing/invalid", () => {
      const expected = Date.parse("2026-06-15T09:00:00.000Z");
      expect(zonedWallTimeToUtcMs(undefined, 2026, 6, 15, 9 * 60)).toBe(
        expected
      );
      expect(zonedWallTimeToUtcMs("Mars/Phobos", 2026, 6, 15, 9 * 60)).toBe(
        expected
      );
    });
  });

  describe("utcMsToZonedParts", () => {
    it("returns local wall-clock parts and weekday in the zone", () => {
      const parts = utcMsToZonedParts(
        "America/Chicago",
        Date.parse("2026-06-15T14:00:00.000Z")
      );
      expect(parts.hour).toBe(9);
      expect(parts.minute).toBe(0);
      expect(parts.weekday).toBe(1); // Monday
      expect(parts.day).toBe(15);
    });

    it("falls back to UTC parts when no zone is supplied", () => {
      const parts = utcMsToZonedParts(
        undefined,
        Date.parse("2026-06-15T14:00:00.000Z")
      );
      expect(parts.hour).toBe(14);
      expect(parts.weekday).toBe(1);
    });
  });

  describe("hhmmInZone / tzAbbreviation", () => {
    it("formats the local wall clock and zone label", () => {
      const ms = Date.parse("2026-06-15T14:00:00.000Z");
      expect(hhmmInZone("America/Chicago", ms)).toBe("09:00");
      expect(tzAbbreviation("America/Chicago", ms)).toBe("CDT");
    });

    it("uses the standard-time label in winter", () => {
      const ms = Date.parse("2026-01-15T15:00:00.000Z");
      expect(tzAbbreviation("America/Chicago", ms)).toBe("CST");
    });

    it("falls back to UTC formatting with no zone", () => {
      const ms = Date.parse("2026-06-15T14:00:00.000Z");
      expect(hhmmInZone(undefined, ms)).toBe("14:00");
      expect(tzAbbreviation(undefined, ms)).toBe("UTC");
    });
  });

  describe("isValidTimeZone", () => {
    it("accepts known zones and rejects unknown/empty", () => {
      expect(isValidTimeZone("America/Chicago")).toBe(true);
      expect(isValidTimeZone("Europe/Berlin")).toBe(true);
      expect(isValidTimeZone("Mars/Phobos")).toBe(false);
      expect(isValidTimeZone("")).toBe(false);
      expect(isValidTimeZone(undefined)).toBe(false);
    });
  });
});

import {
  kbDurationHintMinutes,
  reconcileDuration,
  territoryForRegion,
  timeZoneForRegion
} from "./scheduling-rules";

describe("scheduling-rules — 5b", () => {
  describe("timeZoneForRegion", () => {
    it("maps regions to their territory-local zone", () => {
      expect(timeZoneForRegion("North America")).toBe("America/Chicago");
      expect(timeZoneForRegion("Europe")).toBe("Europe/Berlin");
    });

    it("stays aligned with the territory map", () => {
      expect(territoryForRegion("North America")).toBe("North America");
    });
  });

  describe("reconcileDuration", () => {
    it("prefers the WorkType duration (system of record)", () => {
      expect(
        reconcileDuration({ skillDerivedMinutes: 120, workTypeMinutes: 90 })
      ).toEqual({ minutes: 90, source: "worktype" });
    });

    it("widens to a longer KB hint over the WorkType (reconciled)", () => {
      expect(
        reconcileDuration({
          skillDerivedMinutes: 120,
          workTypeMinutes: 90,
          kbMinutes: 150
        })
      ).toEqual({ minutes: 150, source: "reconciled" });
    });

    it("keeps the WorkType when the KB hint is shorter", () => {
      expect(
        reconcileDuration({
          skillDerivedMinutes: 120,
          workTypeMinutes: 120,
          kbMinutes: 60
        })
      ).toEqual({ minutes: 120, source: "worktype" });
    });

    it("uses the KB hint when no WorkType and it meets/exceeds the default", () => {
      expect(
        reconcileDuration({ skillDerivedMinutes: 60, kbMinutes: 90 })
      ).toEqual({ minutes: 90, source: "kb" });
    });

    it("keeps the per-skill default when the KB hint is shorter", () => {
      expect(
        reconcileDuration({ skillDerivedMinutes: 120, kbMinutes: 30 })
      ).toEqual({ minutes: 120, source: "reconciled" });
    });

    it("falls back to the per-skill default with no other source", () => {
      expect(reconcileDuration({ skillDerivedMinutes: 120 })).toEqual({
        minutes: 120,
        source: "skill_default"
      });
    });

    it("clamps absurd source data into a sane range", () => {
      expect(
        reconcileDuration({ skillDerivedMinutes: 120, workTypeMinutes: 100000 })
          .minutes
      ).toBe(480);
      // A non-positive WorkType is ignored, not treated as a zero window.
      expect(
        reconcileDuration({ skillDerivedMinutes: 120, workTypeMinutes: 0 })
      ).toEqual({ minutes: 120, source: "skill_default" });
    });
  });

  describe("kbDurationHintMinutes", () => {
    it("returns the largest typed repair-effort hint", () => {
      expect(
        kbDurationHintMinutes([
          { estimatedEffortMinutes: 45 },
          { estimatedEffortMinutes: 90 },
          {}
        ])
      ).toBe(90);
    });

    it("returns undefined when no action carries a hint", () => {
      expect(kbDurationHintMinutes([{}, {}])).toBeUndefined();
      expect(kbDurationHintMinutes(undefined)).toBeUndefined();
      expect(kbDurationHintMinutes([])).toBeUndefined();
    });

    it("ignores non-positive / non-finite hints", () => {
      expect(
        kbDurationHintMinutes([
          { estimatedEffortMinutes: 0 },
          { estimatedEffortMinutes: -30 }
        ])
      ).toBeUndefined();
    });
  });
});

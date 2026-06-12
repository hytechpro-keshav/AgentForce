import { deriveGuidanceConfidence } from "./knowledge-confidence";

describe("deriveGuidanceConfidence", () => {
  it("grades high when the top score is >= 0.8", () => {
    expect(deriveGuidanceConfidence([0.4, 0.91, 0.2])).toBe("high");
  });

  it("grades medium when the top score is between 0.55 and 0.8", () => {
    expect(deriveGuidanceConfidence([0.55, 0.3])).toBe("medium");
    expect(deriveGuidanceConfidence([0.79])).toBe("medium");
  });

  it("grades low when the top score is below 0.55 or absent", () => {
    expect(deriveGuidanceConfidence([0.4, 0.1])).toBe("low");
    expect(deriveGuidanceConfidence([])).toBe("low");
    expect(deriveGuidanceConfidence([null, undefined])).toBe("low");
  });
});

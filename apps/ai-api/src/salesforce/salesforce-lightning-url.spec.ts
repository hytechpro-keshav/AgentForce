import { buildSalesforceCaseRecordUrl } from "./salesforce-lightning-url";

describe("buildSalesforceCaseRecordUrl", () => {
  it("builds a Lightning Case record URL from the case id", () => {
    expect(buildSalesforceCaseRecordUrl("500000000000001ABC")).toBe(
      "https://orgfarm-d96842e593-dev-ed.develop.lightning.force.com/lightning/r/Case/500000000000001ABC/view"
    );
  });
});

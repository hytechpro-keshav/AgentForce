import type { PartLogisticsPlan } from "./dto/parts-logistics";
import { crossCheckKbWarehouses } from "./parts-kb-crosscheck";

function plan(overrides: Partial<PartLogisticsPlan> = {}): PartLogisticsPlan {
  return {
    partNumber: "SP-BATT-15X",
    requestedQuantity: 1,
    compatibility: "confirmed",
    compatibilityEvidence: "matches asset",
    availability: "available",
    fulfillmentWarehouseReference: "WH-AUS-001",
    exceptionType: "none",
    reservationStatus: "planned",
    confidence: "high",
    requiredApproval: false,
    rationale: "ready",
    ...overrides
  };
}

describe("crossCheckKbWarehouses", () => {
  it("returns no summary for an empty plan list", () => {
    const result = crossCheckKbWarehouses([]);
    expect(result.summary).toBeUndefined();
    expect(result.annotated).toEqual([]);
  });

  it("marks a KB-documented fulfillment WH as aligned", () => {
    const { annotated, summary } = crossCheckKbWarehouses([plan()]);
    expect(annotated[0].kbWarehouseAlignment).toBe("aligned");
    expect(annotated[0].kbDocumentedWarehouses).toContain("WH-AUS-001");
    expect(summary).toEqual({
      status: "ALIGNED",
      alignedCount: 1,
      divergentCount: 0,
      undocumentedCount: 0
    });
  });

  it("marks a non-documented fulfillment WH as divergent", () => {
    const { annotated, summary } = crossCheckKbWarehouses([
      plan({
        partNumber: "SP-TPAD-15X",
        fulfillmentWarehouseReference: "WH-AUS-001"
      })
    ]);
    expect(annotated[0].kbWarehouseAlignment).toBe("divergent");
    expect(annotated[0].kbDocumentedWarehouses).toEqual(["WH-SJO-002"]);
    expect(summary?.status).toBe("DIVERGENT");
    expect(summary?.divergentCount).toBe(1);
  });

  it("marks an undocumented part as unknown", () => {
    const { annotated, summary } = crossCheckKbWarehouses([
      plan({ partNumber: "SP-NOT-REAL" })
    ]);
    expect(annotated[0].kbWarehouseAlignment).toBe("unknown");
    expect(summary?.status).toBe("UNDOCUMENTED");
    expect(summary?.undocumentedCount).toBe(1);
  });

  it("treats a missing fulfillment WH as unknown, not divergent", () => {
    const { annotated } = crossCheckKbWarehouses([
      plan({ fulfillmentWarehouseReference: undefined })
    ]);
    expect(annotated[0].kbWarehouseAlignment).toBe("unknown");
  });

  it("reports DIVERGENT when any plan diverges in a mixed set", () => {
    const { summary } = crossCheckKbWarehouses([
      plan(),
      plan({
        partNumber: "SP-TPAD-15X",
        fulfillmentWarehouseReference: "WH-AUS-001"
      })
    ]);
    expect(summary?.status).toBe("DIVERGENT");
    expect(summary?.alignedCount).toBe(1);
    expect(summary?.divergentCount).toBe(1);
  });

  it("never mutates the input plans", () => {
    const input = plan();
    crossCheckKbWarehouses([input]);
    expect(input.kbWarehouseAlignment).toBeUndefined();
  });
});

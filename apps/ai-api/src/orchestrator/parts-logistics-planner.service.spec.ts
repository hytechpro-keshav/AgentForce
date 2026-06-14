import type { InventoryStockRow } from "../salesforce/salesforce-inventory.gateway";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import { PartsLogisticsPlannerService } from "./parts-logistics-planner.service";

function context(
  overrides: Partial<SalesforceCaseContext> = {}
): SalesforceCaseContext {
  return {
    caseId: "500000000000001",
    subject: "Battery not charging",
    description: "AeroVolt ProBook 15X battery issue",
    assetProductCode: "AV-LP-15X-PRO",
    serviceShipToCity: "Austin",
    serviceShipToState: "TX",
    serviceShipToCountry: "US",
    ...overrides
  };
}

function row(overrides: Partial<InventoryStockRow>): InventoryStockRow {
  return {
    productCode: "SP-BATT-15X",
    productName: "6 Cell Battery Pack",
    compatibleProductCode: "AV-LP-15X-PRO",
    isUniversalPart: false,
    quantityOnHand: 10,
    warehouseReference: "WH-AUS-001",
    warehouseName: "Austin Fulfillment Center",
    warehouseRegion: "North America",
    outboundLeadTimeHours: 4,
    supportsExpedite: true,
    ...overrides
  };
}

describe("PartsLogisticsPlannerService", () => {
  const planner = new PartsLogisticsPlannerService();

  describe("collectCandidates", () => {
    it("prefers knowledge-suggested parts", () => {
      const knowledge: KnowledgeGuidanceChannel = {
        eligible: true,
        degraded: false,
        status: "ANSWERED",
        answer: {
          safeSummary: "x",
          sources: [],
          suggestedParts: [
            { partNumber: "SP-BATT-15X", confidence: "high" },
            { partNumber: "SP-CHG-65W", confidence: "medium" }
          ]
        }
      };
      const result = planner.collectCandidates(context(), knowledge);
      expect(result.codes).toEqual(["SP-BATT-15X", "SP-CHG-65W"]);
      expect(result.sources).toEqual(["knowledge"]);
    });

    it("falls back to case text only when knowledge has no parts", () => {
      const result = planner.collectCandidates(
        context({
          subject: "Need SP-BATT-15X replacement",
          description: "Also SP-CHG-65W maybe"
        }),
        undefined
      );
      expect(result.codes).toEqual(["SP-BATT-15X", "SP-CHG-65W"]);
      expect(result.sources).toEqual(["case_text"]);
    });
  });

  describe("plan", () => {
    const candidates = {
      codes: ["SP-BATT-15X"],
      sources: ["knowledge" as const]
    };

    it("B4: Scenario A when stock is at the fulfillment warehouse", () => {
      const channel = planner.plan({
        context: context(),
        candidates,
        inventory: {
          source: "soql",
          degraded: false,
          rows: [row({ warehouseReference: "WH-AUS-001", quantityOnHand: 25 })]
        }
      });
      const plan = channel.partPlans![0];
      expect(plan.availability).toBe("available");
      expect(plan.exceptionType).toBe("none");
      expect(plan.transferRequired).toBe(false);
      // Only source-processing + last-mile legs (no transfer).
      expect(plan.etaSegments?.map((s) => s.segment)).toEqual([
        "source_processing",
        "last_mile"
      ]);
      expect(channel.fulfillmentReadiness).toBe("ready");
      expect(channel.status).toBe("PLANNED");
    });

    it("B8: selects the fulfillment warehouse from ship-to region before stock check", () => {
      const channel = planner.plan({
        context: context({
          serviceShipToCountry: "DE",
          serviceShipToState: undefined
        }),
        candidates,
        inventory: {
          source: "soql",
          degraded: false,
          rows: [row({ warehouseReference: "WH-SJO-002", quantityOnHand: 75 })]
        }
      });
      // EU ship-to -> fulfillment WH-FRA-004 regardless of where stock sits.
      expect(channel.partPlans![0].fulfillmentWarehouseReference).toBe(
        "WH-FRA-004"
      );
    });

    it("B5 + B9: remote stock is a transfer, never 'available'; cross-region needs approval", () => {
      // SP-BATT-15X only in Frankfurt; Austin Case -> cross-region transfer.
      const channel = planner.plan({
        context: context(),
        candidates,
        inventory: {
          source: "soql",
          degraded: false,
          rows: [
            row({
              warehouseReference: "WH-FRA-004",
              warehouseName: "Frankfurt",
              warehouseRegion: "Europe",
              outboundLeadTimeHours: 6,
              quantityOnHand: 10
            })
          ]
        }
      });
      const plan = channel.partPlans![0];
      expect(plan.availability).not.toBe("available");
      expect(plan.transferRequired).toBe(true);
      expect(plan.exceptionType).toBe("inter_warehouse_transfer");
      expect(plan.sourceWarehouseReference).toBe("WH-FRA-004");
      expect(plan.requiredApproval).toBe(true);
      expect(plan.approvalReason).toBe("cross_region_transfer");
      // 4 legs: source, inter-warehouse, destination, last-mile.
      expect(plan.etaSegments?.map((s) => s.segment)).toEqual([
        "source_processing",
        "inter_warehouse_transit",
        "destination_processing",
        "last_mile"
      ]);
      // FRA->AUS (24-48) + AUS last mile (8-16) + processing (6+4) -> wide window.
      expect(plan.estimatedDispatchHoursMax).toBeGreaterThanOrEqual(42);
    });

    it("same-region transfer requires no cross-region approval", () => {
      // Live Austin battery: stock at SJO (NA) -> in-region transfer to AUS.
      const channel = planner.plan({
        context: context(),
        candidates,
        inventory: {
          source: "soql",
          degraded: false,
          rows: [
            row({
              warehouseReference: "WH-SJO-002",
              warehouseRegion: "North America",
              outboundLeadTimeHours: 2,
              quantityOnHand: 75
            })
          ]
        }
      });
      const plan = channel.partPlans![0];
      expect(plan.exceptionType).toBe("inter_warehouse_transfer");
      expect(plan.transferRequired).toBe(true);
      expect(plan.approvalReason ?? "none").toBe("none");
      expect(plan.requiredApproval).toBe(false);
      expect(channel.fulfillmentReadiness).toBe("partial");
    });

    it("B6: out-of-stock part is a backorder, blocked, without throwing", () => {
      const channel = planner.plan({
        context: context(),
        candidates: { codes: ["SP-TEST-OOS"], sources: ["manual"] },
        inventory: { source: "soql", degraded: false, rows: [] }
      });
      const plan = channel.partPlans![0];
      expect(plan.exceptionType).toBe("backorder");
      expect(plan.availability).toBe("unavailable");
      expect(plan.requiredApproval).toBe(true);
      expect(plan.approvalReason).toBe("backorder");
      expect(channel.fulfillmentReadiness).toBe("blocked");
      expect(channel.status).toBe("UNAVAILABLE");
    });

    it("flags an incompatible part for human review", () => {
      const channel = planner.plan({
        context: context({ assetProductCode: "AV-LP-13A-STRAT" }),
        candidates: { codes: ["SP-KBD-15X"], sources: ["case_text"] },
        inventory: {
          source: "soql",
          degraded: false,
          rows: [
            row({
              productCode: "SP-KBD-15X",
              compatibleProductCode: "AV-LP-15X-PRO",
              warehouseReference: "WH-AUS-001",
              quantityOnHand: 5
            })
          ]
        }
      });
      const plan = channel.partPlans![0];
      expect(plan.compatibility).toBe("incompatible");
      expect(plan.exceptionType).toBe("incompatible_part");
    });

    it("treats a universal part as compatible regardless of asset", () => {
      const channel = planner.plan({
        context: context({ assetProductCode: undefined }),
        candidates: { codes: ["SP-CHG-65W"], sources: ["knowledge"] },
        inventory: {
          source: "soql",
          degraded: false,
          rows: [
            row({
              productCode: "SP-CHG-65W",
              compatibleProductCode: "ALL",
              isUniversalPart: true,
              warehouseReference: "WH-AUS-001",
              quantityOnHand: 100
            })
          ]
        }
      });
      expect(channel.partPlans![0].compatibility).toBe("universal");
    });

    it("low-stock motherboard at the fulfillment WH recommends approval", () => {
      const channel = planner.plan({
        context: context(),
        candidates: { codes: ["SP-MB-15X"], sources: ["knowledge"] },
        inventory: {
          source: "soql",
          degraded: false,
          rows: [
            row({
              productCode: "SP-MB-15X",
              warehouseReference: "WH-AUS-001",
              quantityOnHand: 8
            })
          ]
        }
      });
      const plan = channel.partPlans![0];
      expect(plan.availability).toBe("limited");
      expect(plan.requiredApproval).toBe(true);
    });

    it("B7: a degraded inventory read degrades the channel, never a backorder", () => {
      const channel = planner.plan({
        context: context(),
        candidates,
        inventory: { source: "none", degraded: true, rows: [] }
      });
      expect(channel.degraded).toBe(true);
      expect(channel.degradedSources).toContain("salesforce_inventory");
      expect(channel.fulfillmentReadiness).toBe("unknown");
      expect(channel.partPlans![0].exceptionType).not.toBe("backorder");
      expect(channel.partPlans![0].availability).toBe("unknown");
    });

    it("§14 demo matrix: Austin battery Case over the LIVE inventory snapshot", () => {
      // Exact rows read from org `Agent` on 2026-06-14 via the gateway SOQL:
      //   SP-BATT-15X qty 75 @ WH-SJO-002 (NA, outbound 2h)
      //   SP-CHG-65W  qty 200 @ WH-JCY-003 (NA, outbound 3h, universal)
      const channel = planner.plan({
        context: context(),
        candidates: {
          codes: ["SP-BATT-15X", "SP-CHG-65W"],
          sources: ["knowledge"]
        },
        triagePriority: "normal",
        inventory: {
          source: "soql",
          degraded: false,
          rows: [
            row({
              productCode: "SP-BATT-15X",
              productName: "6 Cell Battery Pack",
              compatibleProductCode: "AV-LP-15X-PRO",
              isUniversalPart: false,
              warehouseReference: "WH-SJO-002",
              warehouseName: "San Jose Spare Parts & Warranty Depot",
              warehouseRegion: "North America",
              outboundLeadTimeHours: 2,
              quantityOnHand: 75
            }),
            row({
              productCode: "SP-CHG-65W",
              productName: "65W USB-C Power Adapter",
              compatibleProductCode: "ALL",
              isUniversalPart: true,
              warehouseReference: "WH-JCY-003",
              warehouseName: "Jersey City Distribution Hub",
              warehouseRegion: "North America",
              outboundLeadTimeHours: 3,
              quantityOnHand: 200
            })
          ]
        }
      });

      // Fulfillment WH selected from Austin/US BEFORE stock check.
      const battery = channel.partPlans!.find(
        (p) => p.partNumber === "SP-BATT-15X"
      )!;
      const charger = channel.partPlans!.find(
        (p) => p.partNumber === "SP-CHG-65W"
      )!;
      expect(battery.fulfillmentWarehouseReference).toBe("WH-AUS-001");

      // Battery: stock at SJO (same region) -> in-region transfer, no approval.
      expect(battery.compatibility).toBe("confirmed");
      expect(battery.exceptionType).toBe("inter_warehouse_transfer");
      expect(battery.sourceWarehouseReference).toBe("WH-SJO-002");
      expect(battery.transferRequired).toBe(true);
      expect(battery.requiredApproval).toBe(false);
      // 2 + (12-24) + 4 + (8-16) = 26-46 hours.
      expect(battery.estimatedDispatchHoursMin).toBe(26);
      expect(battery.estimatedDispatchHoursMax).toBe(46);

      // Charger: universal, stock at JCY (same region) -> in-region transfer.
      expect(charger.compatibility).toBe("universal");
      expect(charger.exceptionType).toBe("inter_warehouse_transfer");
      expect(charger.sourceWarehouseReference).toBe("WH-JCY-003");
      expect(charger.requiredApproval).toBe(false);

      expect(channel.fulfillmentReadiness).toBe("partial");
      expect(channel.status).toBe("PARTIAL");

      // eslint-disable-next-line no-console
      console.log(
        "[LIVE PROOF] Austin battery Case plan:\n" +
          JSON.stringify(channel, null, 2)
      );
    });

    it("never surfaces the asset serial number in the channel", () => {
      const channel = planner.plan({
        context: context({ assetSerialNumber: "SN-PRO15X-2026-0041A" }),
        candidates,
        inventory: {
          source: "soql",
          degraded: false,
          rows: [row({ warehouseReference: "WH-AUS-001", quantityOnHand: 9 })]
        }
      });
      expect(JSON.stringify(channel)).not.toContain("SN-PRO15X-2026-0041A");
    });
  });
});

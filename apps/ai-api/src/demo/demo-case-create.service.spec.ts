import { BadRequestException, NotFoundException } from "@nestjs/common";

import { DemoCaseCreateService } from "./demo-case-create.service";
import type { SalesforceCaseWriteGateway } from "../salesforce/salesforce-case-write.gateway";

jest.mock("./demo-case-catalog", () => ({
  findScenarioById: jest.fn((id: string) =>
    id === "same-day-battery-fix"
      ? {
          id,
          form: {
            subject: "Battery",
            description: "SP-BATT-15X",
            status: "New",
            origin: "Web",
            priority: "High",
            accountLookup: { name: "University of Arizona" },
            contactLookup: { email: "jane_gray@uoa.edu" },
            assetLookup: { serialNumber: "SN-PRO15X-2026-0041A" },
            shipTo: { city: "Austin", state: "TX", country: "US" }
          }
        }
      : undefined
  ),
  loadDemoCaseScenarioCatalog: jest.fn(() => ({ scenarios: [] }))
}));

describe("DemoCaseCreateService", () => {
  const gateway = {
    isConfigured: () => true,
    resolveAccountByName: jest.fn(),
    resolveContactByEmail: jest.fn(),
    resolveAssetBySerial: jest.fn(),
    createCase: jest.fn()
  } as unknown as SalesforceCaseWriteGateway;

  const orchestrator = {
    triggerStepped: jest.fn()
  };

  const service = new DemoCaseCreateService(
    gateway,
    orchestrator as never
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (orchestrator.triggerStepped as jest.Mock).mockResolvedValue({
      workflowId: "wf-demo-stepped",
      caseId: "500000000000001ABC",
      status: "assigned",
      acceptedAt: "2026-06-24T12:00:00.000Z"
    });
    (gateway.resolveAccountByName as jest.Mock).mockResolvedValue(
      "001000000000001"
    );
    (gateway.resolveAssetBySerial as jest.Mock).mockResolvedValue({
      assetId: "02i000000000001"
    });
    (gateway.resolveContactByEmail as jest.Mock).mockResolvedValue(
      "003000000000001"
    );
    (gateway.createCase as jest.Mock).mockResolvedValue({
      caseId: "500000000000001ABC",
      caseNumber: "00001234"
    });
  });

  it("creates a Case from a known scenarioId", async () => {
    const principal = {
      subject: "demo-case-create",
      scopes: ["agentforce:demo-case-create"],
      tenantId: "tenant-demo",
      raw: {}
    };
    const result = await service.create(
      { scenarioId: "same-day-battery-fix" },
      principal
    );
    expect(result.caseId).toBe("500000000000001ABC");
    expect(result.orchestrationUrl).toContain("500000000000001ABC");
    expect(result.steppedWorkflowId).toBe("wf-demo-stepped");
    expect(result.steppedOrchestrationUrl).toContain(
      "/orchestration/stepped?workflowId=wf-demo-stepped"
    );
    expect(gateway.createCase).toHaveBeenCalled();
    expect(orchestrator.triggerStepped).toHaveBeenCalledWith(
      {
        caseId: "500000000000001ABC",
        caseNumber: "00001234"
      },
      principal
    );
  });

  it("throws invalid_scenario for unknown scenarioId", async () => {
    await expect(
      service.create({ scenarioId: "missing-scenario" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws lookup_not_found when Account is missing", async () => {
    (gateway.resolveAccountByName as jest.Mock).mockResolvedValue(undefined);
    await expect(
      service.create({ scenarioId: "same-day-battery-fix" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws lookup_not_found when Asset is missing", async () => {
    (gateway.resolveAssetBySerial as jest.Mock).mockResolvedValue(undefined);
    await expect(
      service.create({ scenarioId: "same-day-battery-fix" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

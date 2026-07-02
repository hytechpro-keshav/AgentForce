import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceCaseWriteGateway } from "../salesforce/salesforce-case-write.gateway";
import { SalesforceGatewayError } from "../salesforce/salesforce-gateway.error";
import { IntakeService } from "./intake.service";

const ACCOUNT_ID = "001000000000001";
const CONTACT_ID = "003000000000001";
const ASSET_ID = "02i000000000001";

function principal(overrides: Record<string, unknown> = {}): AuthPrincipal {
  return {
    subject: "customer-chat:x",
    scopes: ["chat:intake", "chat:write"],
    tenantId: "tenant-demo",
    raw: {
      verified: true,
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      verifiedEmail: "user@example.com",
      ...overrides
    }
  } as AuthPrincipal;
}

interface Harness {
  service: IntakeService;
  gateway: {
    isConfigured: jest.Mock;
    readContactSummary: jest.Mock;
    readAccountContext: jest.Mock;
    listAccountAssets: jest.Mock;
    assetBelongsToAccount: jest.Mock;
    createChatCase: jest.Mock;
  };
}

function buildHarness(enabled = true): Harness {
  const gateway = {
    isConfigured: jest.fn().mockReturnValue(true),
    readContactSummary: jest
      .fn()
      .mockResolvedValue({ name: "Ada Lovelace", email: "ada@corp.com" }),
    readAccountContext: jest.fn().mockResolvedValue({
      accountName: "Analytical Engines Ltd",
      shipToCity: "London",
      shipToState: "LDN",
      shipToCountry: "UK"
    }),
    listAccountAssets: jest.fn().mockResolvedValue([
      {
        assetId: ASSET_ID,
        label: "ThinkPad X1",
        product: "ThinkPad",
        serialNumber: "SN-SECRET-123"
      }
    ]),
    assetBelongsToAccount: jest.fn().mockResolvedValue(true),
    createChatCase: jest
      .fn()
      .mockResolvedValue({ caseId: "500000000000001", caseNumber: "00001234" })
  };
  const config = {
    customerIntake: { enabled }
  } as unknown as AppConfigService;
  return {
    service: new IntakeService(
      gateway as unknown as SalesforceCaseWriteGateway,
      config
    ),
    gateway
  };
}

describe("IntakeService.getContext", () => {
  it("returns display name, devices, and ship-to but never serial numbers", async () => {
    const h = buildHarness();
    const context = await h.service.getContext(principal());

    expect(context.displayName).toBe("Ada Lovelace");
    expect(context.accountName).toBe("Analytical Engines Ltd");
    expect(context.devices).toEqual([
      { assetId: ASSET_ID, label: "ThinkPad X1", product: "ThinkPad" }
    ]);
    expect(JSON.stringify(context)).not.toContain("SN-SECRET-123");
    expect(context.shipTo).toEqual({
      city: "London",
      state: "LDN",
      country: "UK"
    });
  });

  it("rejects a session without verified identity claims", async () => {
    const h = buildHarness();
    await expect(
      h.service.getContext(principal({ verified: false }))
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("is unavailable when the feature is disabled", async () => {
    const h = buildHarness(false);
    await expect(h.service.getContext(principal())).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it("degrades a failed asset read to an empty device list", async () => {
    const h = buildHarness();
    h.gateway.listAccountAssets.mockRejectedValueOnce(
      new SalesforceGatewayError("backend", "boom")
    );
    const context = await h.service.getContext(principal());
    expect(context.devices).toEqual([]);
    expect(context.displayName).toBe("Ada Lovelace");
  });
});

describe("IntakeService.createCase", () => {
  it("creates a Case scoped to the verified account with derived defaults", async () => {
    const h = buildHarness();
    const result = await h.service.createCase(principal(), {
      issueDescription: "Screen flickers on startup and then goes black.",
      assetId: ASSET_ID
    });

    expect(h.gateway.assetBelongsToAccount).toHaveBeenCalledWith(
      ASSET_ID,
      ACCOUNT_ID
    );
    const fields = h.gateway.createChatCase.mock.calls[0][0];
    expect(fields.accountId).toBe(ACCOUNT_ID);
    expect(fields.contactId).toBe(CONTACT_ID);
    expect(fields.assetId).toBe(ASSET_ID);
    expect(fields.priority).toBe("Medium");
    expect(fields.subject).toBe(
      "Screen flickers on startup and then goes black."
    );
    expect(fields.suppliedEmail).toBe("user@example.com");
    expect(fields.serviceShipToCity).toBe("London");
    expect(result.caseNumber).toBe("00001234");
  });

  it("prefers explicit subject/priority/ship-to overrides", async () => {
    const h = buildHarness();
    await h.service.createCase(principal(), {
      issueDescription: "Battery drains fast",
      subject: "Battery issue",
      priority: "High",
      shipTo: { city: "Paris", state: "IDF", country: "FR" }
    });
    const fields = h.gateway.createChatCase.mock.calls[0][0];
    expect(fields.subject).toBe("Battery issue");
    expect(fields.priority).toBe("High");
    expect(fields.serviceShipToCity).toBe("Paris");
    expect(fields.assetId).toBeUndefined();
  });

  it("rejects a device that does not belong to the account", async () => {
    const h = buildHarness();
    h.gateway.assetBelongsToAccount.mockResolvedValueOnce(false);
    await expect(
      h.service.createCase(principal(), {
        issueDescription: "Won't boot",
        assetId: ASSET_ID
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.gateway.createChatCase).not.toHaveBeenCalled();
  });

  it("maps a not_found gateway error to 404", async () => {
    const h = buildHarness();
    h.gateway.createChatCase.mockRejectedValueOnce(
      new SalesforceGatewayError("not_found", "missing")
    );
    await expect(
      h.service.createCase(principal(), { issueDescription: "Won't boot" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps other gateway errors to 502", async () => {
    const h = buildHarness();
    h.gateway.createChatCase.mockRejectedValueOnce(
      new SalesforceGatewayError("backend", "boom")
    );
    await expect(
      h.service.createCase(principal(), { issueDescription: "Won't boot" })
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceCaseNotifyGateway } from "../salesforce/salesforce-case-notify.gateway";
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
    listOpenCasesForContact: jest.Mock;
    assetBelongsToAccount: jest.Mock;
    createChatCase: jest.Mock;
  };
  notify: { sendCaseConfirmation: jest.Mock };
}

function buildHarness(
  enabled = true,
  confirmationEmailEnabled = true
): Harness {
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
    listOpenCasesForContact: jest.fn().mockResolvedValue([
      {
        caseNumber: "00001202",
        subject: "Laptop running slow",
        status: "New",
        priority: "High",
        createdDate: "2026-07-06T10:00:00.000Z",
        latestUpdate: {
          body: "Agent 4 – Scheduling: Technician visit planned for the earliest available window.",
          createdDate: "2026-07-07T09:00:00.000Z"
        }
      }
    ]),
    assetBelongsToAccount: jest.fn().mockResolvedValue(true),
    createChatCase: jest
      .fn()
      .mockResolvedValue({ caseId: "500000000000001", caseNumber: "00001234" })
  };
  const notify = {
    sendCaseConfirmation: jest
      .fn()
      .mockResolvedValue({ sent: true, status: "SENT" })
  };
  const config = {
    customerIntake: { enabled, confirmationEmailEnabled }
  } as unknown as AppConfigService;
  return {
    service: new IntakeService(
      gateway as unknown as SalesforceCaseWriteGateway,
      notify as unknown as SalesforceCaseNotifyGateway,
      config
    ),
    gateway,
    notify
  };
}

describe("IntakeService.getContext", () => {
  it("returns display name, devices, and ship-to but never serial numbers", async () => {
    const h = buildHarness();
    const context = await h.service.getContext(principal());

    expect(context.displayName).toBe("Ada Lovelace");
    expect(context.accountName).toBe("Analytical Engines Ltd");
    expect(context.contactEmail).toBe("user@example.com");
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

  it("flags multiple service locations when billing differs from shipping", async () => {
    const h = buildHarness();
    h.gateway.readAccountContext.mockResolvedValueOnce({
      accountName: "Analytical Engines Ltd",
      shipToCity: "London",
      shipToState: "LDN",
      shipToCountry: "UK",
      billingCity: "Paris",
      billingState: "IDF",
      billingCountry: "FR"
    });
    const context = await h.service.getContext(principal());
    expect(context.hasMultipleServiceLocations).toBe(true);
    expect(context.billingLocation).toEqual({
      city: "Paris",
      state: "IDF",
      country: "FR"
    });
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

  it("includes the contact's open cases (number/subject/status only)", async () => {
    const h = buildHarness();
    const context = await h.service.getContext(principal());
    expect(h.gateway.listOpenCasesForContact).toHaveBeenCalledWith(
      ACCOUNT_ID,
      CONTACT_ID
    );
    expect(context.openCases).toEqual([
      {
        caseNumber: "00001202",
        subject: "Laptop running slow",
        status: "New",
        latestUpdate: {
          body: "Agent 4 – Scheduling: Technician visit planned for the earliest available window.",
          createdDate: "2026-07-07T09:00:00.000Z"
        }
      }
    ]);
  });

  it("degrades a failed open-case read to an empty list", async () => {
    const h = buildHarness();
    h.gateway.listOpenCasesForContact.mockRejectedValueOnce(
      new SalesforceGatewayError("backend", "boom")
    );
    const context = await h.service.getContext(principal());
    expect(context.openCases).toEqual([]);
  });
});

describe("IntakeService.listOpenCases", () => {
  it("returns the verified contact's open cases with live status", async () => {
    const h = buildHarness();
    const result = await h.service.listOpenCases(principal());
    expect(h.gateway.listOpenCasesForContact).toHaveBeenCalledWith(
      ACCOUNT_ID,
      CONTACT_ID
    );
    expect(result.cases).toEqual([
      {
        caseNumber: "00001202",
        subject: "Laptop running slow",
        status: "New",
        priority: "High",
        createdDate: "2026-07-06T10:00:00.000Z",
        latestUpdate: {
          body: "Agent 4 – Scheduling: Technician visit planned for the earliest available window.",
          createdDate: "2026-07-07T09:00:00.000Z"
        }
      }
    ]);
  });

  it("rejects a session without verified identity claims", async () => {
    const h = buildHarness();
    await expect(
      h.service.listOpenCases(principal({ verified: false }))
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("degrades a gateway failure to an empty case list", async () => {
    const h = buildHarness();
    h.gateway.listOpenCasesForContact.mockRejectedValueOnce(
      new SalesforceGatewayError("backend", "boom")
    );
    const result = await h.service.listOpenCases(principal());
    expect(result.cases).toEqual([]);
  });

  it("is unavailable when the feature is disabled", async () => {
    const h = buildHarness(false);
    await expect(h.service.listOpenCases(principal())).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
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
    h.gateway.listAccountAssets.mockResolvedValueOnce([]);
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

  it("applies chat-provided contact and service-address overrides", async () => {
    const h = buildHarness();
    await h.service.createCase(principal(), {
      issueDescription: "Won't boot",
      assetId: ASSET_ID,
      contactEmail: "jason.alt@corp.com",
      contactPhone: "+1 512 555 0100",
      serviceAddress: "Aptivance Dallas office, 400 Main St, Dallas TX"
    });
    const fields = h.gateway.createChatCase.mock.calls[0][0];
    // customer's case-specific contact wins over the verified/contact email
    expect(fields.suppliedEmail).toBe("jason.alt@corp.com");
    expect(fields.suppliedPhone).toBe("+1 512 555 0100");
    // free-text address rides in the description for the service team
    expect(fields.description).toContain(
      "Service address (customer provided): Aptivance Dallas office, 400 Main St, Dallas TX"
    );
    // structured ship-to stays on the account default
    expect(fields.serviceShipToCity).toBe("London");
  });

  it("keeps identity email and omits phone when no overrides are given", async () => {
    const h = buildHarness();
    await h.service.createCase(principal(), {
      issueDescription: "Won't boot",
      assetId: ASSET_ID
    });
    const fields = h.gateway.createChatCase.mock.calls[0][0];
    expect(fields.suppliedEmail).toBe("user@example.com");
    expect(fields.suppliedPhone).toBeUndefined();
    expect(fields.description).not.toContain("Service address");
  });

  it("auto-attaches the only registered device when assetId is omitted", async () => {
    const h = buildHarness();
    await h.service.createCase(principal(), {
      issueDescription: "Won't boot"
    });
    const fields = h.gateway.createChatCase.mock.calls[0][0];
    expect(fields.assetId).toBe(ASSET_ID);
  });

  it("resolves the asset from deviceLabel when assetId is omitted", async () => {
    const h = buildHarness();
    h.gateway.listAccountAssets.mockResolvedValueOnce([
      {
        assetId: ASSET_ID,
        label: "ThinkPad X1",
        product: "ThinkPad",
        serialNumber: "SN-SECRET-123"
      },
      {
        assetId: "02i000000000002",
        label: "MacBook Pro",
        product: "MacBook",
        serialNumber: "SN-SECRET-456"
      }
    ]);
    await h.service.createCase(principal(), {
      issueDescription: "Keyboard sticks",
      deviceLabel: "MacBook Pro"
    });
    const fields = h.gateway.createChatCase.mock.calls[0][0];
    expect(fields.assetId).toBe("02i000000000002");
  });

  it("requires a device when multiple assets are on file and none is selected", async () => {
    const h = buildHarness();
    h.gateway.listAccountAssets.mockResolvedValueOnce([
      {
        assetId: ASSET_ID,
        label: "ThinkPad X1",
        product: "ThinkPad",
        serialNumber: "SN-1"
      },
      {
        assetId: "02i000000000002",
        label: "MacBook Pro",
        product: "MacBook",
        serialNumber: "SN-2"
      }
    ]);
    await expect(
      h.service.createCase(principal(), {
        issueDescription: "Screen flickers"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.gateway.createChatCase).not.toHaveBeenCalled();
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
    h.gateway.listAccountAssets.mockResolvedValueOnce([]);
    h.gateway.createChatCase.mockRejectedValueOnce(
      new SalesforceGatewayError("not_found", "missing")
    );
    await expect(
      h.service.createCase(principal(), { issueDescription: "Won't boot" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps other gateway errors to 502", async () => {
    const h = buildHarness();
    h.gateway.listAccountAssets.mockResolvedValueOnce([]);
    h.gateway.createChatCase.mockRejectedValueOnce(
      new SalesforceGatewayError("backend", "boom")
    );
    await expect(
      h.service.createCase(principal(), { issueDescription: "Won't boot" })
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("fires the confirmation email with the case number and supplied email", async () => {
    const h = buildHarness();
    await h.service.createCase(principal(), {
      issueDescription: "Won't boot",
      assetId: ASSET_ID
    });
    expect(h.notify.sendCaseConfirmation).toHaveBeenCalledWith({
      email: "user@example.com",
      caseNumber: "00001234",
      customerName: "Ada Lovelace",
      subject: "Won't boot"
    });
  });

  it("sends the confirmation to a chat-provided override email", async () => {
    const h = buildHarness();
    await h.service.createCase(principal(), {
      issueDescription: "Won't boot",
      assetId: ASSET_ID,
      contactEmail: "jason.alt@corp.com"
    });
    expect(h.notify.sendCaseConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jason.alt@corp.com" })
    );
  });

  it("skips the confirmation email when disabled by config", async () => {
    const h = buildHarness(true, false);
    await h.service.createCase(principal(), {
      issueDescription: "Won't boot",
      assetId: ASSET_ID
    });
    expect(h.notify.sendCaseConfirmation).not.toHaveBeenCalled();
  });

  it("still returns the created case when the confirmation degrades", async () => {
    const h = buildHarness();
    h.notify.sendCaseConfirmation.mockResolvedValueOnce({
      sent: false,
      status: "DEGRADED"
    });
    const result = await h.service.createCase(principal(), {
      issueDescription: "Won't boot",
      assetId: ASSET_ID
    });
    expect(result.caseNumber).toBe("00001234");
  });
});

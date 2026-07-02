import {
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";

import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceCaseWriteGateway } from "../salesforce/salesforce-case-write.gateway";
import type { SalesforceOtpGateway } from "../salesforce/salesforce-otp.gateway";
import { IntakeOtpService } from "./intake-otp.service";
import type { IntakeSessionService } from "./intake-session.service";

interface Harness {
  service: IntakeOtpService;
  generate: jest.Mock;
  verify: jest.Mock;
  resolve: jest.Mock;
  mint: jest.Mock;
}

function buildHarness(overrides?: {
  enabled?: boolean;
  configured?: boolean;
}): Harness {
  const generate = jest
    .fn()
    .mockResolvedValue({ status: "SENT", expiresInSeconds: 600 });
  const verify = jest
    .fn()
    .mockResolvedValue({ valid: true, status: "VERIFIED" });
  const resolve = jest.fn().mockResolvedValue({
    status: "found",
    contactId: "003000000000001",
    accountId: "001000000000001",
    name: "Ada Lovelace"
  });
  const mint = jest.fn().mockReturnValue({
    accessToken: "jwt-token",
    tokenType: "Bearer",
    expiresAt: "2026-01-01T00:00:00.000Z",
    expiresInSeconds: 7200,
    subject: "customer-chat:uuid"
  });

  const otpGateway = {
    isConfigured: () => overrides?.configured ?? true,
    generate,
    verify
  } as unknown as SalesforceOtpGateway;
  const caseWriteGateway = {
    resolveContactByEmailGlobal: resolve
  } as unknown as SalesforceCaseWriteGateway;
  const sessions = { mint } as unknown as IntakeSessionService;
  const config = {
    customerIntake: { enabled: overrides?.enabled ?? true }
  } as unknown as AppConfigService;

  return {
    service: new IntakeOtpService(
      otpGateway,
      caseWriteGateway,
      sessions,
      config
    ),
    generate,
    verify,
    resolve,
    mint
  };
}

describe("IntakeOtpService", () => {
  describe("requestOtp", () => {
    it("sends a code for a known Contact and returns a uniform response", async () => {
      const h = buildHarness();
      const result = await h.service.requestOtp({ email: "User@Example.com" });

      expect(h.resolve).toHaveBeenCalledWith("user@example.com");
      expect(h.generate).toHaveBeenCalledWith("user@example.com", undefined);
      expect(result.status).toBe("sent");
    });

    it("does NOT send a code for an unknown email but stays uniform", async () => {
      const h = buildHarness();
      h.resolve.mockResolvedValueOnce({ status: "not_found" });

      const result = await h.service.requestOtp({ email: "ghost@example.com" });

      expect(h.generate).not.toHaveBeenCalled();
      expect(result.status).toBe("sent");
    });

    it("does NOT send a code for an ambiguous email", async () => {
      const h = buildHarness();
      h.resolve.mockResolvedValueOnce({ status: "ambiguous" });

      const result = await h.service.requestOtp({ email: "dup@example.com" });

      expect(h.generate).not.toHaveBeenCalled();
      expect(result.status).toBe("sent");
    });

    it("stays uniform (no throw) when the contact lookup fails", async () => {
      const h = buildHarness();
      h.resolve.mockRejectedValueOnce(new Error("backend"));

      const result = await h.service.requestOtp({ email: "user@example.com" });

      expect(h.generate).not.toHaveBeenCalled();
      expect(result.status).toBe("sent");
    });

    it("is unavailable when the feature is disabled", async () => {
      const h = buildHarness({ enabled: false });
      await expect(
        h.service.requestOtp({ email: "user@example.com" })
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe("verifyOtp", () => {
    it("mints a verified-intake session on a valid code + resolvable identity", async () => {
      const h = buildHarness();
      const result = await h.service.verifyOtp({
        email: "User@Example.com",
        code: "123456"
      });

      expect(h.verify).toHaveBeenCalledWith(
        "user@example.com",
        "123456",
        undefined
      );
      expect(h.mint).toHaveBeenCalledWith({
        accountId: "001000000000001",
        contactId: "003000000000001",
        verifiedEmail: "user@example.com",
        locale: undefined
      });
      expect(result.accessToken).toBe("jwt-token");
    });

    it("rejects an invalid code without minting", async () => {
      const h = buildHarness();
      h.verify.mockResolvedValueOnce({ valid: false, status: "INVALID_CODE" });

      await expect(
        h.service.verifyOtp({ email: "user@example.com", code: "000000" })
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.mint).not.toHaveBeenCalled();
    });

    it("fails CLOSED when a verified code has no resolvable account", async () => {
      const h = buildHarness();
      h.resolve.mockResolvedValueOnce({ status: "not_found" });

      await expect(
        h.service.verifyOtp({ email: "user@example.com", code: "123456" })
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.mint).not.toHaveBeenCalled();
    });

    it("fails CLOSED when identity resolution throws after a valid code", async () => {
      const h = buildHarness();
      h.resolve.mockRejectedValueOnce(new Error("backend"));

      await expect(
        h.service.verifyOtp({ email: "user@example.com", code: "123456" })
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.mint).not.toHaveBeenCalled();
    });
  });
});

import { ServiceUnavailableException } from "@nestjs/common";

import { IntakeBootstrapService } from "./intake-bootstrap.service";

describe("IntakeBootstrapService", () => {
  const sessions = {
    mint: jest.fn().mockReturnValue({
      accessToken: "jwt",
      tokenType: "Bearer",
      expiresAt: "2026-01-01T00:00:00.000Z",
      expiresInSeconds: 7200,
      subject: "customer-chat:x"
    })
  };
  const caseWriteGateway = {
    isConfigured: jest.fn().mockReturnValue(true),
    resolvePrimaryContactForAccount: jest.fn(),
    readContactSummary: jest.fn()
  };

  function service(
    overrides?: Partial<{
      enabled: boolean;
      emailVerificationEnabled: boolean;
      bootstrapAccountId?: string;
    }>
  ) {
    const config = {
      customerIntake: {
        enabled: overrides?.enabled ?? true,
        emailVerificationEnabled: overrides?.emailVerificationEnabled ?? false,
        bootstrapAccountId:
          overrides && Object.prototype.hasOwnProperty.call(
            overrides,
            "bootstrapAccountId"
          )
            ? overrides.bootstrapAccountId
            : "001g500000BsP8BAAV",
        sessionTtlSeconds: 7200
      }
    };
    return new IntakeBootstrapService(
      caseWriteGateway as never,
      sessions as never,
      config as never
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    caseWriteGateway.resolvePrimaryContactForAccount.mockResolvedValue({
      status: "found",
      contactId: "003x",
      accountId: "001g500000BsP8BAAV",
      name: "Ada Lovelace",
      email: "ada@corp.com"
    });
  });

  it("mints a session for the bootstrap account primary contact", async () => {
    const result = await service().bootstrapSession();
    expect(result.accessToken).toBe("jwt");
    expect(sessions.mint).toHaveBeenCalledWith({
      accountId: "001g500000BsP8BAAV",
      contactId: "003x",
      verifiedEmail: "ada@corp.com"
    });
  });

  it("rejects bootstrap when email verification is enabled", async () => {
    await expect(
      service({ emailVerificationEnabled: true }).bootstrapSession()
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("rejects bootstrap when no account id is configured", async () => {
    await expect(
      service({ bootstrapAccountId: undefined }).bootstrapSession()
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

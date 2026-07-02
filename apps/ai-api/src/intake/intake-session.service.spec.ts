import { ServiceUnavailableException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";

import type { AppConfigService } from "../config/app-config.service";
import { IntakeSessionService } from "./intake-session.service";

const SECRET = "test-secret";

function buildService(secret: string = SECRET): IntakeSessionService {
  const config = {
    jwt: { secret, issuer: "ai-api", audience: "react-chat" },
    customerIntake: { sessionTtlSeconds: 7200 }
  } as unknown as AppConfigService;
  return new IntakeSessionService(config);
}

describe("IntakeSessionService", () => {
  it("mints a token carrying chat:intake scope and verified identity claims", () => {
    const service = buildService();

    const session = service.mint({
      accountId: "001000000000001",
      contactId: "003000000000001",
      verifiedEmail: "user@example.com"
    });

    expect(session.tokenType).toBe("Bearer");
    expect(session.expiresInSeconds).toBe(7200);

    const decoded = jwt.verify(session.accessToken, SECRET) as jwt.JwtPayload;
    expect(decoded.scope).toBe("chat:intake chat:write");
    expect(decoded.accountId).toBe("001000000000001");
    expect(decoded.contactId).toBe("003000000000001");
    expect(decoded.verified).toBe(true);
    expect(decoded.sub).toContain("customer-chat:");
  });

  it("fails closed when no JWT secret is configured", () => {
    const config = {
      jwt: { secret: undefined, issuer: "ai-api", audience: "react-chat" },
      customerIntake: { sessionTtlSeconds: 7200 }
    } as unknown as AppConfigService;
    const service = new IntakeSessionService(config);
    expect(() =>
      service.mint({
        accountId: "001000000000001",
        contactId: "003000000000001",
        verifiedEmail: "user@example.com"
      })
    ).toThrow(ServiceUnavailableException);
  });
});

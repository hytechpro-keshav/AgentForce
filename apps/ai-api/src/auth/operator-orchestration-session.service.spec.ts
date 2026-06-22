import {
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import * as jwt from "jsonwebtoken";

import type { AppConfigService } from "../config/app-config.service";
import { OperatorOrchestrationSessionService } from "./operator-orchestration-session.service";

const SECRET = "operator-session-secret-0123456789";

function buildService(
  accessCode?: string
): OperatorOrchestrationSessionService {
  const config = {
    operatorOrchestrationSession: {
      accessCode,
      ttlSeconds: 3600,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 10
    },
    jwt: { secret: SECRET, issuer: undefined, audience: undefined }
  } as unknown as AppConfigService;
  return new OperatorOrchestrationSessionService(config);
}

describe("OperatorOrchestrationSessionService", () => {
  it("mints a read+control session for a valid access code — never the approval scope", () => {
    const service = buildService("let-me-in");

    const result = service.createSession({ accessCode: "let-me-in" }, "ip-1");

    expect(result.tokenType).toBe("Bearer");
    expect(result.scope).toBe(
      "agentforce:orchestrator-read agentforce:orchestrator-control"
    );
    expect(result.subject).toMatch(/^operator-console:/);

    const claims = jwt.verify(result.accessToken, SECRET) as jwt.JwtPayload;
    const scopes = String(claims.scope).split(" ");
    expect(scopes).toContain("agentforce:orchestrator-read");
    expect(scopes).toContain("agentforce:orchestrator-control");
    // The browser-reachable session must NEVER carry the approval scope.
    expect(scopes).not.toContain("agentforce:orchestrator-approval");
  });

  it("rejects an invalid access code with 401", () => {
    const service = buildService("correct-code");
    expect(() =>
      service.createSession({ accessCode: "wrong" }, "ip-1")
    ).toThrow(UnauthorizedException);
  });

  it("fails closed (503) when no access code is configured", () => {
    const service = buildService(undefined);
    expect(() =>
      service.createSession({ accessCode: "anything" }, "ip-1")
    ).toThrow(ServiceUnavailableException);
  });
});

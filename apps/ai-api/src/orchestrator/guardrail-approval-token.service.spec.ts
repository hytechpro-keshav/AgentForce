import { UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";

import type { AppConfigService } from "../config/app-config.service";
import { GuardrailApprovalTokenService } from "./guardrail-approval-token.service";

const SECRET = "test-approval-secret-0123456789";
const ISSUER = "agentforce-orchestrator";
const AUDIENCE = "guardrail-approval";

function configWith(overrides: Record<string, unknown> = {}): AppConfigService {
  return {
    orchestrator: {
      guardrailApproval: {
        tokenSecret: SECRET,
        tokenTtlSeconds: 3600,
        ...overrides
      }
    }
  } as unknown as AppConfigService;
}

describe("GuardrailApprovalTokenService", () => {
  it("mints a token that verifies back to the same workflow + decision", () => {
    const svc = new GuardrailApprovalTokenService(configWith());
    const claims = svc.verify(svc.mint("wf-1", "approved"));
    expect(claims.workflowId).toBe("wf-1");
    expect(claims.decision).toBe("approved");
    // jti is a UUID — usable directly as the resume idempotency key.
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("mints distinct jti per call so each link is single-purpose", () => {
    const svc = new GuardrailApprovalTokenService(configWith());
    const a = svc.verify(svc.mint("wf-1", "approved"));
    const b = svc.verify(svc.mint("wf-1", "approved"));
    expect(a.jti).not.toBe(b.jti);
  });

  it("isEnabled reflects whether a signing secret is configured", () => {
    expect(new GuardrailApprovalTokenService(configWith()).isEnabled()).toBe(
      true
    );
    expect(
      new GuardrailApprovalTokenService(
        configWith({ tokenSecret: undefined })
      ).isEnabled()
    ).toBe(false);
  });

  it("mint throws when no secret is configured", () => {
    const svc = new GuardrailApprovalTokenService(
      configWith({ tokenSecret: undefined })
    );
    expect(() => svc.mint("wf-1", "approved")).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    const svc = new GuardrailApprovalTokenService(configWith());
    const forged = jwt.sign({ decision: "approved" }, "other-secret", {
      algorithm: "HS256",
      subject: "wf-1",
      jwtid: "j1",
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: 3600
    });
    expect(() => svc.verify(forged)).toThrow(UnauthorizedException);
  });

  it("rejects an expired token", () => {
    const svc = new GuardrailApprovalTokenService(configWith());
    const expired = jwt.sign({ decision: "approved" }, SECRET, {
      algorithm: "HS256",
      subject: "wf-1",
      jwtid: "j1",
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: -10
    });
    expect(() => svc.verify(expired)).toThrow(UnauthorizedException);
  });

  it("rejects a wrong-audience token", () => {
    const svc = new GuardrailApprovalTokenService(configWith());
    const wrongAud = jwt.sign({ decision: "approved" }, SECRET, {
      algorithm: "HS256",
      subject: "wf-1",
      jwtid: "j1",
      issuer: ISSUER,
      audience: "some-other-aud",
      expiresIn: 3600
    });
    expect(() => svc.verify(wrongAud)).toThrow(UnauthorizedException);
  });

  it("rejects a forged 'escalated' decision (R6 — approver can never escalate)", () => {
    const svc = new GuardrailApprovalTokenService(configWith());
    const forged = jwt.sign({ decision: "escalated" }, SECRET, {
      algorithm: "HS256",
      subject: "wf-1",
      jwtid: "j1",
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: 3600
    });
    expect(() => svc.verify(forged)).toThrow(UnauthorizedException);
  });

  describe("Salesforce approval callback tokens (6b+)", () => {
    const SF_AUDIENCE = "guardrail-sf-approval";

    it("mints a decision-agnostic token that verifies back to the workflow", () => {
      const svc = new GuardrailApprovalTokenService(configWith());
      const claims = svc.verifyForSalesforce(svc.mintForSalesforce("wf-1"));
      expect(claims.workflowId).toBe("wf-1");
      expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
      // No decision is carried — Salesforce supplies it on the callback.
      expect(
        (claims as unknown as Record<string, unknown>).decision
      ).toBeUndefined();
    });

    it("mintForSalesforce throws when no secret is configured", () => {
      const svc = new GuardrailApprovalTokenService(
        configWith({ tokenSecret: undefined })
      );
      expect(() => svc.mintForSalesforce("wf-1")).toThrow();
    });

    it("an SF token cannot be replayed at the email approve endpoint", () => {
      const svc = new GuardrailApprovalTokenService(configWith());
      const sfToken = svc.mintForSalesforce("wf-1");
      // The email-link verify() uses a different audience → rejected.
      expect(() => svc.verify(sfToken)).toThrow(UnauthorizedException);
    });

    it("an email token cannot be replayed at the SF callback endpoint", () => {
      const svc = new GuardrailApprovalTokenService(configWith());
      const emailToken = svc.mint("wf-1", "approved");
      expect(() => svc.verifyForSalesforce(emailToken)).toThrow(
        UnauthorizedException
      );
    });

    it("rejects an expired SF token", () => {
      const svc = new GuardrailApprovalTokenService(configWith());
      const expired = jwt.sign({}, SECRET, {
        algorithm: "HS256",
        subject: "wf-1",
        jwtid: "j1",
        issuer: ISSUER,
        audience: SF_AUDIENCE,
        expiresIn: -10
      });
      expect(() => svc.verifyForSalesforce(expired)).toThrow(
        UnauthorizedException
      );
    });

    it("rejects an SF token signed with a different secret", () => {
      const svc = new GuardrailApprovalTokenService(configWith());
      const forged = jwt.sign({}, "other-secret", {
        algorithm: "HS256",
        subject: "wf-1",
        jwtid: "j1",
        issuer: ISSUER,
        audience: SF_AUDIENCE,
        expiresIn: 3600
      });
      expect(() => svc.verifyForSalesforce(forged)).toThrow(
        UnauthorizedException
      );
    });
  });
});

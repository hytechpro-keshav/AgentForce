import { ConflictException } from "@nestjs/common";

import type { AppConfigService } from "../config/app-config.service";
import { CaseTriageOrchestratorController } from "./case-triage-orchestrator.controller";
import type { CaseTriageOrchestratorService } from "./case-triage-orchestrator.service";
import { GuardrailApprovalTokenService } from "./guardrail-approval-token.service";

const SECRET = "controller-approval-secret";
const WF = "wf-12345678-1234-1234-1234-123456789abc";
const OTHER_WF = "wf-00000000-0000-0000-0000-000000000000";

function tokenConfig(): AppConfigService {
  return {
    orchestrator: {
      guardrailApproval: { tokenSecret: SECRET, tokenTtlSeconds: 3600 }
    }
  } as unknown as AppConfigService;
}

function build(
  resume: jest.Mock = jest.fn().mockResolvedValue({ status: "done" })
) {
  const orchestrator = {
    resume
  } as unknown as CaseTriageOrchestratorService;
  const tokens = new GuardrailApprovalTokenService(tokenConfig());
  const controller = new CaseTriageOrchestratorController(orchestrator, tokens);
  return { controller, tokens, resume };
}

describe("CaseTriageOrchestratorController — guardrail approval links", () => {
  it("GET approve renders a confirmation form for a valid token", () => {
    const { controller, tokens } = build();
    const token = tokens.mint(WF, "approved");
    const html = controller.approvePage(WF, token, {
      originalUrl: `/orchestrator/case-triage/${WF}/approve?token=${token}`
    });
    expect(html).toContain("<form");
    expect(html).toContain("Confirm Approve");
    expect(html).toContain('name="token"');
    // The form posts back to the path WITHOUT the token in the query.
    expect(html).toContain(`action="/orchestrator/case-triage/${WF}/approve"`);
  });

  it("GET approve shows an error page (no form) for an invalid token", () => {
    const { controller } = build();
    const html = controller.approvePage(WF, "not-a-token", {
      originalUrl: "/x"
    });
    expect(html).toContain("invalid or has expired");
    expect(html).not.toContain("<form");
  });

  it("POST approve resumes with the token decision + jti idempotency key", async () => {
    const { controller, tokens, resume } = build();
    const token = tokens.mint(WF, "approved");
    const { jti } = tokens.verify(token);

    const html = await controller.approveAction(WF, { token });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume.mock.calls[0][0]).toBe(WF);
    expect(resume.mock.calls[0][1]).toEqual({
      decision: "approved",
      idempotencyKey: jti
    });
    expect(html).toContain("approved");
  });

  it("POST approve rejects a token minted for a different workflow", async () => {
    const { controller, tokens, resume } = build();
    const token = tokens.mint(OTHER_WF, "approved");

    const html = await controller.approveAction(WF, { token });

    expect(resume).not.toHaveBeenCalled();
    expect(html).toContain("invalid or has expired");
  });

  it("POST approve shows 'already resolved' when the workflow is no longer resumable", async () => {
    const resume = jest.fn().mockRejectedValue(new ConflictException());
    const { controller, tokens } = build(resume);
    const token = tokens.mint(WF, "rejected");

    const html = await controller.approveAction(WF, { token });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(html).toContain("no longer awaiting approval");
  });
});

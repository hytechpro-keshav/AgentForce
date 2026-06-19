import type { AppConfigService } from "../config/app-config.service";
import type { SalesforceGuardrailApprovalGateway } from "../salesforce/salesforce-guardrail-approval.gateway";
import {
  type ApprovalEmailMessage,
  type ApprovalEmailSender
} from "./approval-email-sender";
import { GuardrailApprovalNotificationService } from "./guardrail-approval-notification.service";
import { GuardrailApprovalTokenService } from "./guardrail-approval-token.service";
import type {
  GuardrailApprovalInterrupt,
  GuardrailApprovalSubmitCommand,
  GuardrailApprovalSubmitResult,
  GuardrailSalesforceApprovalContext
} from "./dto/guardrail";

const SECRET = "notify-secret-0123456789";
// A PII-shaped case id we assert never appears in the email body.
const FULL_CASE_ID = "500g500000abcdEAAQ";
const FULL_CASE_NUMBER = "00001234";

function buildConfig(
  overrides: Record<string, unknown> = {}
): AppConfigService {
  return {
    orchestrator: {
      guardrailApproval: {
        emailEnabled: false,
        escalationEmailEnabled: false,
        salesforceApprovalEnabled: false,
        salesforceApprovalProcess: "Agentforce_Guardrail_Approval",
        tokenSecret: SECRET,
        tokenTtlSeconds: 3600,
        emailProvider: "log",
        resendApiKey: undefined,
        emailFrom: "noreply@example.com",
        emailTo: "approver@example.com",
        recipientRole: "account-manager",
        linkBaseUrl: "https://ai.example.com",
        rateLimitWindowMs: 60000,
        rateLimitMaxRequests: 20,
        ...overrides
      }
    }
  } as unknown as AppConfigService;
}

function buildPayload(): GuardrailApprovalInterrupt {
  return {
    action: "approve_case_workflow",
    workflowId: "wf-abc-123",
    caseId: FULL_CASE_ID,
    caseNumber: FULL_CASE_NUMBER,
    guardrail: {
      riskScore: 52,
      riskLevel: "high",
      policyRulesTriggered: [
        "PARTS_APPROVAL_REQUIRED",
        "SCHEDULING_AFTER_HOURS"
      ],
      approvalReasons: ["Parts approval required", "After-hours scheduling"]
    },
    context: {
      recommendedPriority: "high",
      partsStatus: "PARTIAL",
      schedulingStatus: "PROVISIONAL"
    }
  };
}

class FakeSender implements ApprovalEmailSender {
  readonly messages: ApprovalEmailMessage[] = [];
  shouldThrow = false;

  async send(message: ApprovalEmailMessage): Promise<void> {
    if (this.shouldThrow) {
      throw new Error("transport_down");
    }
    this.messages.push(message);
  }
}

/** Fake SF approval gateway capturing submit commands. */
class FakeSfGateway {
  readonly commands: GuardrailApprovalSubmitCommand[] = [];
  result: GuardrailApprovalSubmitResult = {
    submitted: true,
    processInstanceId: "04i000000000001AAA"
  };
  shouldThrow = false;

  async submitApproval(
    command: GuardrailApprovalSubmitCommand
  ): Promise<GuardrailApprovalSubmitResult> {
    this.commands.push(command);
    if (this.shouldThrow) {
      throw new Error("gateway_blew_up");
    }
    return this.result;
  }
}

function build(overrides: Record<string, unknown> = {}) {
  const config = buildConfig(overrides);
  const tokens = new GuardrailApprovalTokenService(config);
  const sender = new FakeSender();
  const gateway = new FakeSfGateway();
  const service = new GuardrailApprovalNotificationService(
    config,
    tokens,
    sender,
    gateway as unknown as SalesforceGuardrailApprovalGateway
  );
  return { service, sender, gateway };
}

function buildContext(): GuardrailSalesforceApprovalContext {
  return {
    verdict: {
      headline: "Normal priority case — approval required (medium risk)",
      summary: "Held for human approval by the compliance guardrail.",
      recommendedSteps: ["Review parts transfer"],
      highlights: [{ label: "Risk", value: "52 (high)" }]
    },
    orchestrationConsoleUrl: "https://ui.example.com/orchestration?caseId=x"
  };
}

describe("GuardrailApprovalNotificationService", () => {
  it("email disabled: returns log_only and sends nothing (6a parity)", async () => {
    const { service, sender } = build({ emailEnabled: false });
    const routing = await service.notifyApprovalRequired(
      "wf-abc-123",
      FULL_CASE_ID,
      buildPayload()
    );
    expect(routing).toEqual({ method: "log_only" });
    expect(sender.messages).toHaveLength(0);
  });

  it("email enabled: sends one email and returns email routing with sentAt", async () => {
    const { service, sender } = build({ emailEnabled: true });
    const routing = await service.notifyApprovalRequired(
      "wf-abc-123",
      FULL_CASE_ID,
      buildPayload()
    );
    expect(routing.method).toBe("email");
    expect(routing.sentAt).toBeDefined();
    expect(routing.recipientRole).toBe("account-manager");
    expect(routing.degraded).toBeUndefined();
    expect(sender.messages).toHaveLength(1);
    const message = sender.messages[0];
    expect(message.to).toBe("approver@example.com");
    expect(message.from).toBe("noreply@example.com");
    // Carries both action links pointing at the approve route.
    expect(message.html).toContain(
      "/orchestrator/case-triage/wf-abc-123/approve?token="
    );
    expect(message.text).toContain("Approve:");
    expect(message.text).toContain("Reject:");
  });

  it("is idempotent per workflow: a re-run never sends a second email", async () => {
    const { service, sender } = build({ emailEnabled: true });
    const first = await service.notifyApprovalRequired(
      "wf-abc-123",
      FULL_CASE_ID,
      buildPayload()
    );
    const second = await service.notifyApprovalRequired(
      "wf-abc-123",
      FULL_CASE_ID,
      buildPayload()
    );
    // One email, and the same routing record (same sentAt) both times.
    expect(sender.messages).toHaveLength(1);
    expect(second).toBe(first);
    expect(second.sentAt).toBe(first.sentAt);
  });

  it("is degrade-safe: a transport failure marks routing degraded and never throws", async () => {
    const { service, sender } = build({ emailEnabled: true });
    sender.shouldThrow = true;
    const routing = await service.notifyApprovalRequired(
      "wf-degrade",
      FULL_CASE_ID,
      buildPayload()
    );
    expect(routing.method).toBe("email");
    expect(routing.degraded).toBe(true);
    expect(routing.sentAt).toBeDefined();
    // A resume re-run does not retry-spam: still one (failed) attempt recorded.
    sender.shouldThrow = false;
    const retry = await service.notifyApprovalRequired(
      "wf-degrade",
      FULL_CASE_ID,
      buildPayload()
    );
    expect(retry).toBe(routing);
    expect(sender.messages).toHaveLength(0);
  });

  it("never leaks PII: the email carries labels, scores, and a case suffix only", async () => {
    const { service, sender } = build({ emailEnabled: true });
    await service.notifyApprovalRequired(
      "wf-abc-123",
      FULL_CASE_ID,
      buildPayload()
    );
    const serialized = JSON.stringify(sender.messages[0]);
    // Full identifiers must not appear — only the last-4 suffix.
    expect(serialized).not.toContain(FULL_CASE_ID);
    expect(serialized).not.toContain(FULL_CASE_NUMBER);
    expect(serialized).toContain("…1234");
    // Safe, useful facts ARE present.
    expect(serialized).toContain("52");
    expect(serialized).toContain("PARTS_APPROVAL_REQUIRED");
  });

  it("escalation email: sends a supervisor notice only when enabled, idempotently", async () => {
    const off = build({ emailEnabled: true, escalationEmailEnabled: false });
    await off.service.notifyEscalation("wf-esc", FULL_CASE_ID, buildPayload());
    expect(off.sender.messages).toHaveLength(0);

    const on = build({ emailEnabled: true, escalationEmailEnabled: true });
    await on.service.notifyEscalation("wf-esc", FULL_CASE_ID, buildPayload());
    await on.service.notifyEscalation("wf-esc", FULL_CASE_ID, buildPayload());
    expect(on.sender.messages).toHaveLength(1);
    expect(on.sender.messages[0].subject.toLowerCase()).toContain("escalated");
    // Terminal path — no approve/reject action links.
    expect(on.sender.messages[0].text).not.toContain("/approve?token=");
  });

  describe("Salesforce approval routing (6b+)", () => {
    it("submits the SF approval and returns salesforce_approval routing with externalRef", async () => {
      const { service, gateway, sender } = build({
        salesforceApprovalEnabled: true,
        emailEnabled: false
      });
      const routing = await service.notifyApprovalRequired(
        "wf-abc-123",
        FULL_CASE_ID,
        buildPayload(),
        buildContext()
      );
      expect(routing.method).toBe("salesforce_approval");
      expect(routing.sentAt).toBeDefined();
      expect(routing.externalRef).toBe("04i000000000001AAA");
      expect(routing.degraded).toBeUndefined();
      // SF path takes precedence — no email sent.
      expect(sender.messages).toHaveLength(0);
      expect(gateway.commands).toHaveLength(1);
      const command = gateway.commands[0];
      expect(command.workflowId).toBe("wf-abc-123");
      expect(command.caseId).toBe(FULL_CASE_ID);
      expect(command.resumeToken.split(".")).toHaveLength(3); // JWT
      expect(command.verdict.headline).toContain("approval required");
      expect(command.orchestrationConsoleUrl).toContain("/orchestration");
    });

    it("takes precedence over email when both are enabled", async () => {
      const { service, gateway, sender } = build({
        salesforceApprovalEnabled: true,
        emailEnabled: true
      });
      const routing = await service.notifyApprovalRequired(
        "wf-both",
        FULL_CASE_ID,
        buildPayload(),
        buildContext()
      );
      expect(routing.method).toBe("salesforce_approval");
      expect(gateway.commands).toHaveLength(1);
      expect(sender.messages).toHaveLength(0);
    });

    it("falls back to a synthesized verdict when context is absent", async () => {
      const { service, gateway } = build({
        salesforceApprovalEnabled: true
      });
      await service.notifyApprovalRequired(
        "wf-noctx",
        FULL_CASE_ID,
        buildPayload()
      );
      const command = gateway.commands[0];
      expect(command.verdict.headline.toLowerCase()).toContain("approval");
      expect(command.verdict.highlights.length).toBeGreaterThan(0);
    });

    it("is degrade-safe: a degraded submit marks routing degraded, never throws", async () => {
      const { service, gateway } = build({ salesforceApprovalEnabled: true });
      gateway.result = { submitted: false, degraded: true };
      const routing = await service.notifyApprovalRequired(
        "wf-degraded-sf",
        FULL_CASE_ID,
        buildPayload(),
        buildContext()
      );
      expect(routing.method).toBe("salesforce_approval");
      expect(routing.degraded).toBe(true);
      expect(routing.sentAt).toBeDefined();
    });

    it("is degrade-safe: a thrown gateway error never escapes the graph", async () => {
      const { service, gateway } = build({ salesforceApprovalEnabled: true });
      gateway.shouldThrow = true;
      const routing = await service.notifyApprovalRequired(
        "wf-throw-sf",
        FULL_CASE_ID,
        buildPayload(),
        buildContext()
      );
      expect(routing.degraded).toBe(true);
    });

    it("is idempotent per workflow: a re-run never submits twice", async () => {
      const { service, gateway } = build({ salesforceApprovalEnabled: true });
      const first = await service.notifyApprovalRequired(
        "wf-idem-sf",
        FULL_CASE_ID,
        buildPayload(),
        buildContext()
      );
      const second = await service.notifyApprovalRequired(
        "wf-idem-sf",
        FULL_CASE_ID,
        buildPayload(),
        buildContext()
      );
      expect(second).toBe(first);
      expect(gateway.commands).toHaveLength(1);
    });

    it("never leaks PII into the submit command", async () => {
      const { service, gateway } = build({ salesforceApprovalEnabled: true });
      await service.notifyApprovalRequired(
        "wf-pii-sf",
        FULL_CASE_ID,
        buildPayload(),
        buildContext()
      );
      const serialized = JSON.stringify(gateway.commands[0].verdict);
      expect(serialized).not.toContain(FULL_CASE_ID);
      expect(serialized).not.toContain(FULL_CASE_NUMBER);
    });
  });
});

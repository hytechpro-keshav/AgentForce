import { GuardrailPolicyService } from "./guardrail-policy.service";
import type { CaseTriageStateType } from "./case-triage.graph";

/**
 * Decision-matrix coverage for the Node 6 composite policy (phase plan
 * §3.5 / §12.2). The service reads only typed field values, so each
 * fixture sets just the channel fields a scenario exercises and casts to
 * the graph state shape.
 */

const service = new GuardrailPolicyService();

type Priority = "low" | "normal" | "high" | "critical";

function stateOf(over: Record<string, unknown>): CaseTriageStateType {
  return {
    workflowId: "wf-test",
    caseId: "500000000000001",
    principalSubject: "orchestrator",
    approvalRequired: false,
    writeBackApplied: false,
    status: "running",
    context: { accountId: "001000000000001" },
    ...over
  } as unknown as CaseTriageStateType;
}

function triage(priority: Priority): unknown {
  return {
    recommendedPriority: priority,
    summary: "s",
    suggestedNextStep: "n",
    provider: "openai",
    model: "gpt",
    fallbackUsed: false,
    latencyMs: 1
  };
}

function customerContext(over: {
  businessRisk?: string;
  strategic?: boolean;
  warranty?: string;
  repeat?: boolean;
}): unknown {
  const finding = (value: unknown) => ({ value, confidence: "high" });
  return {
    eligible: true,
    degraded: false,
    package: {
      businessRisk: finding(over.businessRisk ?? "low"),
      strategicAccount: finding(over.strategic ?? false),
      warrantyStatus: finding(over.warranty ?? "covered"),
      repeatIncident: finding({
        repeat: over.repeat ?? false,
        count: 0,
        windowDays: 30
      })
    }
  };
}

function parts(over: {
  status?: "PLANNED" | "PARTIAL" | "UNAVAILABLE" | "SKIPPED";
  degraded?: boolean;
  eligible?: boolean;
  requiredApproval?: boolean;
}): unknown {
  return {
    eligible: over.eligible ?? true,
    degraded: over.degraded ?? false,
    status: over.status,
    partPlans: [{ requiredApproval: over.requiredApproval ?? false }]
  };
}

function scheduling(over: {
  requiredApproval?: boolean;
  approvalReason?: string;
  schedulingReadiness?: string;
  degraded?: boolean;
}): unknown {
  return {
    eligible: true,
    degraded: over.degraded ?? false,
    requiredApproval: over.requiredApproval ?? false,
    approvalReason: over.approvalReason,
    schedulingReadiness: over.schedulingReadiness,
    partsEtaConsidered: true
  };
}

function ruleIds(decision: ReturnType<GuardrailPolicyService["evaluate"]>) {
  return decision.triggeredRules.map((r) => r.ruleId);
}

describe("GuardrailPolicyService", () => {
  it("#1 low-risk → autoApprove (no interrupt, no approval reasons)", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("normal"),
        partsLogistics: parts({ status: "PLANNED" }),
        scheduling: scheduling({ schedulingReadiness: "schedulable" })
      })
    );
    expect(decision.outcome).toBe("autoApprove");
    expect(decision.riskLevel).toBe("low");
    expect(decision.riskScore).toBe(0);
    expect(decision.approvalReasons).toEqual([]);
    expect(decision.autoApproveReason).toContain("no approval flags");
  });

  it("#3 minimal demo fixture → requireHumanApproval, high, score 70", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("high"),
        partsLogistics: parts({ status: "PARTIAL", requiredApproval: true }),
        scheduling: scheduling({
          requiredApproval: true,
          approvalReason: "after_hours",
          schedulingReadiness: "provisional"
        })
      })
    );
    expect(decision.outcome).toBe("requireHumanApproval");
    expect(decision.riskLevel).toBe("high");
    expect(decision.riskScore).toBe(70); // 15 + 20 + 10 + 15 + 10
    expect(ruleIds(decision)).toEqual(
      expect.arrayContaining([
        "TRIAGE_HIGH",
        "PARTS_APPROVAL_REQUIRED",
        "PARTS_PARTIAL",
        "SCHEDULING_APPROVAL_REQUIRED",
        "SCHEDULING_AFTER_HOURS"
      ])
    );
    expect(decision.channelBasis).toEqual(
      expect.arrayContaining(["triage", "partsLogistics", "scheduling"])
    );
  });

  it("#3b production-like demo Case 00001050 (all channels) → escalate, critical, score 100", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("high"),
        customerContext: customerContext({
          businessRisk: "high",
          strategic: true,
          repeat: true
        }),
        knowledgeGuidance: {
          eligible: true,
          degraded: false,
          status: "ANSWERED",
          answer: {
            recommendedActions: [{ requiredApproval: true }],
            safetyFlags: []
          }
        },
        partsLogistics: parts({ status: "PARTIAL", requiredApproval: false }),
        scheduling: scheduling({
          requiredApproval: true,
          approvalReason: "sla_breach_risk",
          schedulingReadiness: "provisional"
        })
      })
    );
    expect(decision.outcome).toBe("escalate");
    expect(decision.riskLevel).toBe("critical");
    expect(decision.riskScore).toBe(100);
    expect(ruleIds(decision)).toEqual(
      expect.arrayContaining([
        "TRIAGE_HIGH",
        "CUSTOMER_RISK_HIGH",
        "STRATEGIC_ACCOUNT",
        "REPEAT_INCIDENT",
        "PARTS_PARTIAL",
        "SCHEDULING_APPROVAL_REQUIRED",
        "SCHEDULING_SLA_BREACH",
        "KB_REQUIRED_APPROVAL"
      ])
    );
  });

  it("#4 parts-only approval, medium priority → requireHumanApproval, medium", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("normal"),
        partsLogistics: parts({ status: "PARTIAL", requiredApproval: true })
      })
    );
    expect(decision.outcome).toBe("requireHumanApproval");
    expect(decision.riskLevel).toBe("medium");
    expect(decision.riskScore).toBe(30); // 20 + 10
  });

  it("#5 scheduling SLA breach → requireHumanApproval", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("high"),
        partsLogistics: parts({ status: "PLANNED" }),
        scheduling: scheduling({
          requiredApproval: true,
          approvalReason: "sla_breach_risk",
          schedulingReadiness: "provisional"
        })
      })
    );
    expect(decision.outcome).toBe("requireHumanApproval");
    expect(decision.riskScore).toBe(45); // 15 + 15 + 15
    expect(ruleIds(decision)).toContain("SCHEDULING_SLA_BREACH");
  });

  it("#6 entitlement breach → reject (hard rule; PARTS_UNAVAILABLE suppressed)", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("normal"),
        customerContext: customerContext({ warranty: "expired" }),
        partsLogistics: parts({ status: "UNAVAILABLE", eligible: true })
      })
    );
    expect(decision.outcome).toBe("reject");
    expect(ruleIds(decision)).toContain("ENTITLEMENT_BREACH");
    // PARTS_UNAVAILABLE must NOT fire alongside ENTITLEMENT_BREACH.
    expect(ruleIds(decision)).not.toContain("PARTS_UNAVAILABLE");
    expect(decision.riskScore).toBe(10); // WARRANTY_OUT only
    expect(decision.riskLevel).toBe("low");
  });

  it("#7 safety-critical KB flag → escalate, critical (hard rule)", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("high"),
        knowledgeGuidance: {
          eligible: true,
          degraded: false,
          status: "ANSWERED",
          answer: {
            safeSummary: "s",
            sources: [],
            safetyFlags: [
              { code: "HV", message: "high voltage", severity: "critical" }
            ]
          }
        }
      })
    );
    expect(decision.outcome).toBe("escalate");
    expect(decision.riskLevel).toBe("critical");
    expect(ruleIds(decision)).toContain("SAFETY_CRITICAL_KB");
  });

  it("#8 full critical scenario → escalate, score capped at 100", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("critical"),
        customerContext: customerContext({
          businessRisk: "critical",
          strategic: true
        }),
        partsLogistics: parts({ status: "PARTIAL", requiredApproval: true }),
        scheduling: scheduling({
          requiredApproval: true,
          approvalReason: "after_hours",
          schedulingReadiness: "provisional"
        }),
        knowledgeGuidance: {
          eligible: true,
          degraded: false,
          status: "ANSWERED",
          answer: {
            safeSummary: "s",
            sources: [],
            safetyFlags: [{ code: "HV", message: "warn", severity: "high" }]
          }
        }
      })
    );
    // 30 + 25 + 10 + 20 + 10 + 15 + 10 + 20 = 140 → capped 100.
    expect(decision.riskScore).toBe(100);
    expect(decision.riskLevel).toBe("critical");
    expect(decision.outcome).toBe("escalate");
  });

  it("#9 all channels degraded + an approval flag → conservative floor to review", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("normal"),
        partsLogistics: parts({ degraded: true }),
        scheduling: scheduling({ requiredApproval: true, degraded: true })
      })
    );
    // Score alone (ALL_CHANNELS_DEGRADED 15 + SCHEDULING_APPROVAL_REQUIRED 15 = 30)
    // already lands in the medium band; assert the human-review outcome.
    expect(decision.outcome).toBe("requireHumanApproval");
    expect(ruleIds(decision)).toContain("ALL_CHANNELS_DEGRADED");
  });

  it("#10 low score but degraded channel + approval flag → floored to review", () => {
    const decision = service.evaluate(
      stateOf({
        triage: triage("normal"),
        partsLogistics: parts({ degraded: true }),
        scheduling: scheduling({
          requiredApproval: true,
          approvalReason: "none"
        })
      })
    );
    // SCHEDULING_APPROVAL_REQUIRED (+15) only → low band, but the parts
    // channel is degraded and an approval flag exists → fallback floor.
    expect(decision.riskScore).toBe(15);
    expect(decision.riskLevel).toBe("low");
    expect(decision.outcome).toBe("requireHumanApproval");
  });

  it("#11 no linked Account on a Critical Case → reject (hard rule)", () => {
    const decision = service.evaluate(
      stateOf({
        context: { accountId: undefined },
        triage: triage("critical")
      })
    );
    expect(decision.outcome).toBe("reject");
    expect(ruleIds(decision)).toContain("NO_ACCOUNT_LINKED");
  });

  it("is pure/deterministic — identical state yields identical decision", () => {
    const build = () =>
      stateOf({
        triage: triage("high"),
        partsLogistics: parts({ status: "PARTIAL", requiredApproval: true }),
        scheduling: scheduling({
          requiredApproval: true,
          approvalReason: "after_hours"
        })
      });
    expect(service.evaluate(build())).toEqual(service.evaluate(build()));
  });

  it("evaluates the full rule catalog for the audit trail (21 rules)", () => {
    const decision = service.evaluate(stateOf({ triage: triage("normal") }));
    expect(decision.allRules).toHaveLength(21);
    expect(decision.allRules.filter((r) => r.isHardRule)).toHaveLength(3);
  });
});

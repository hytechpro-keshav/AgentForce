import { AgentCaseCommentService } from "./agent-case-comment.service";
import type { SalesforceCaseGateway } from "../salesforce/salesforce-case.gateway";
import type { CaseTriageStateType } from "./case-triage.graph";

describe("AgentCaseCommentService", () => {
  const triageState = {
    workflowId: "wf-1",
    caseId: "500000000000001",
    triage: {
      recommendedPriority: "normal",
      summary: "Initial triage summary.",
      suggestedNextStep: "Next step.",
      provider: "openai",
      model: "gpt-4o-mini",
      fallbackUsed: false,
      latencyMs: 1
    }
  } as CaseTriageStateType;

  it("stepped: posts once per case+agent and refreshes Triage when summary changes", async () => {
    const postCaseComment = jest.fn().mockResolvedValue({ posted: true });
    const gateway = {
      isConfigured: () => true,
      postCaseComment
    } as unknown as SalesforceCaseGateway;
    const service = new AgentCaseCommentService(gateway);

    await service.postAgentNarrative(
      "wf-1",
      "500000000000001",
      "triage",
      triageState,
      { stepped: true }
    );
    await service.postAgentNarrative(
      "wf-1",
      "500000000000001",
      "triage",
      triageState,
      { stepped: true }
    );
    expect(postCaseComment).toHaveBeenCalledTimes(1);

    const updated = {
      ...triageState,
      triage: {
        ...triageState.triage!,
        summary: "Updated strategic account summary after Run Triage."
      }
    };
    await service.postAgentNarrative(
      "wf-1",
      "500000000000001",
      "triage",
      updated,
      { stepped: true }
    );
    expect(postCaseComment).toHaveBeenCalledTimes(2);
  });

  it("auto: posts all five agents in batch at approval time", async () => {
    const postCaseComment = jest.fn().mockResolvedValue({ posted: true });
    const gateway = {
      isConfigured: () => true,
      postCaseComment
    } as unknown as SalesforceCaseGateway;
    const service = new AgentCaseCommentService(gateway);

    const fullState = {
      ...triageState,
      knowledgeGuidance: {
        eligible: true,
        degraded: false,
        status: "ANSWERED",
        answer: {
          sources: [{ id: "1" }, { id: "2" }],
          safeSummary: "Thermal paste reapplication recommended.",
          guidanceConfidence: "high"
        }
      },
      partsLogistics: {
        eligible: true,
        degraded: false,
        fulfillmentReadiness: "ready",
        partPlans: [
          {
            partNumber: "SP-FAN-15X",
            fulfillmentWarehouseReference: "WH-FRA-004"
          }
        ]
      },
      scheduling: {
        eligible: true,
        degraded: false,
        schedulingReadiness: "unschedulable"
      },
      guardrail: {
        eligible: true,
        degraded: false,
        outcome: "requireHumanApproval",
        approvalReasons: ["Triage priority is high."],
        riskScore: 65,
        riskLevel: "high"
      }
    } as CaseTriageStateType;

    await service.postAllForAutoApproval(
      "wf-auto",
      "500000000000001",
      fullState
    );
    expect(postCaseComment).toHaveBeenCalledTimes(5);
  });

  it("no-ops when Salesforce is not configured", async () => {
    const postCaseComment = jest.fn();
    const gateway = {
      isConfigured: () => false,
      postCaseComment
    } as unknown as SalesforceCaseGateway;
    const service = new AgentCaseCommentService(gateway);

    await service.postAgentNarrative(
      "wf-1",
      "500000000000001",
      "triage",
      triageState,
      { stepped: true }
    );

    expect(postCaseComment).not.toHaveBeenCalled();
  });
});

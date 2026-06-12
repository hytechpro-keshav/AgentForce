import type { ModelRouter } from "../llm/model-router";
import type { LlmChatResponse } from "../llm/interfaces/llm-contracts";
import {
  KnowledgeGuidanceExtractor,
  type KnowledgeExtractionInput
} from "./knowledge-guidance-extractor.service";

function buildResponse(content: string): LlmChatResponse {
  return {
    content,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metadata: {
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 1,
      fallbackUsed: false,
      attemptedProviders: ["openai"]
    }
  };
}

function buildInput(
  overrides: Partial<KnowledgeExtractionInput> = {}
): KnowledgeExtractionInput {
  return {
    requestId: "wf-1",
    query: "battery overheating on model X",
    tenantId: "tenant-1",
    matches: [
      {
        text: "Replace the SP-BATT-15X battery pack; high-voltage risk.",
        metadata: { sourceId: "kb-1", title: "Battery Guide", chunkId: "c1" }
      }
    ],
    ...overrides
  };
}

function buildExtractor(chat: jest.Mock): KnowledgeGuidanceExtractor {
  return new KnowledgeGuidanceExtractor({ chat } as unknown as ModelRouter);
}

describe("KnowledgeGuidanceExtractor", () => {
  it("parses well-formed JSON into typed guidance", async () => {
    const chat = jest.fn().mockResolvedValue(
      buildResponse(
        JSON.stringify({
          displaySummary: "Replace the battery pack and check voltage.",
          recommendedActions: [
            {
              actionType: "replace_part",
              rationale: "Battery pack is failing",
              requiredApproval: true
            }
          ],
          suggestedParts: [
            { partNumber: "SP-BATT-15X", description: "Battery pack" }
          ],
          safetyFlags: [
            {
              code: "HIGH_VOLTAGE",
              message: "Disconnect power first",
              severity: "critical"
            }
          ]
        })
      )
    );
    const result = await buildExtractor(chat).extract(buildInput());

    expect(result.displaySummary).toBe(
      "Replace the battery pack and check voltage."
    );
    expect(result.recommendedActions).toEqual([
      {
        actionType: "replace_part",
        rationale: "Battery pack is failing",
        requiredApproval: true
      }
    ]);
    expect(result.suggestedParts).toEqual([
      { partNumber: "SP-BATT-15X", description: "Battery pack" }
    ]);
    expect(result.safetyFlags).toEqual([
      {
        code: "HIGH_VOLTAGE",
        message: "Disconnect power first",
        severity: "critical"
      }
    ]);
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("strips code fences before parsing", async () => {
    const chat = jest.fn().mockResolvedValue(
      buildResponse(
        '```json\n{"recommendedActions":[],"suggestedParts":[],"safetyFlags":[],"displaySummary":"ok"}\n```'
      )
    );
    const result = await buildExtractor(chat).extract(buildInput());
    expect(result.displaySummary).toBe("ok");
  });

  it("drops invalid action types and bad severities", async () => {
    const chat = jest.fn().mockResolvedValue(
      buildResponse(
        JSON.stringify({
          recommendedActions: [
            { actionType: "frobnicate", rationale: "nope", requiredApproval: true },
            { actionType: "run_diagnostic", rationale: "check codes" }
          ],
          safetyFlags: [
            { code: "X", message: "y", severity: "danger" },
            { code: "OK", message: "fine", severity: "info" }
          ],
          suggestedParts: [{ description: "no part number" }]
        })
      )
    );
    const result = await buildExtractor(chat).extract(buildInput());

    expect(result.recommendedActions).toEqual([
      {
        actionType: "run_diagnostic",
        rationale: "check codes",
        requiredApproval: false
      }
    ]);
    expect(result.safetyFlags).toEqual([
      { code: "OK", message: "fine", severity: "info" }
    ]);
    expect(result.suggestedParts).toEqual([]);
  });

  it("defaults requiredApproval to true for high-impact actions", async () => {
    const chat = jest.fn().mockResolvedValue(
      buildResponse(
        JSON.stringify({
          recommendedActions: [
            { actionType: "replace_part", rationale: "swap it" }
          ]
        })
      )
    );
    const result = await buildExtractor(chat).extract(buildInput());
    expect(result.recommendedActions[0].requiredApproval).toBe(true);
  });

  it("redacts PII from extracted free text", async () => {
    const chat = jest.fn().mockResolvedValue(
      buildResponse(
        JSON.stringify({
          displaySummary: "Email jane@example.com for parts",
          recommendedActions: [],
          suggestedParts: [],
          safetyFlags: []
        })
      )
    );
    const result = await buildExtractor(chat).extract(buildInput());
    expect(result.displaySummary).not.toContain("jane@example.com");
    expect(result.displaySummary).toContain("[redacted-email]");
  });

  it("abstains (empty) on non-JSON output but surfaces provider metadata", async () => {
    const chat = jest
      .fn()
      .mockResolvedValue(buildResponse("I cannot answer that."));
    const result = await buildExtractor(chat).extract(buildInput());
    expect(result.recommendedActions).toEqual([]);
    expect(result.suggestedParts).toEqual([]);
    expect(result.safetyFlags).toEqual([]);
    expect(result.displaySummary).toBeUndefined();
    expect(result.provider).toBe("openai");
  });

  it("never throws when the provider call fails", async () => {
    const chat = jest.fn().mockRejectedValue(new Error("provider down"));
    const result = await buildExtractor(chat).extract(buildInput());
    expect(result).toEqual({
      recommendedActions: [],
      suggestedParts: [],
      safetyFlags: []
    });
  });

  it("skips the provider call when there are no matches", async () => {
    const chat = jest.fn();
    const result = await buildExtractor(chat).extract(
      buildInput({ matches: [] })
    );
    expect(chat).not.toHaveBeenCalled();
    expect(result.recommendedActions).toEqual([]);
  });

  it("clamps oversized arrays to the max", async () => {
    const manyActions = Array.from({ length: 12 }, () => ({
      actionType: "run_diagnostic",
      rationale: "x",
      requiredApproval: false
    }));
    const chat = jest.fn().mockResolvedValue(
      buildResponse(JSON.stringify({ recommendedActions: manyActions }))
    );
    const result = await buildExtractor(chat).extract(buildInput());
    expect(result.recommendedActions.length).toBeLessThanOrEqual(5);
  });
});

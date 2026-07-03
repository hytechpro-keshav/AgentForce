import { UnauthorizedException } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type { ModelRouter } from "../llm/model-router";
import type { IntakeContextResponseDto } from "./dto/intake-context.dto";
import { IntakeAgentService } from "./intake-agent.service";
import type { IntakeService } from "./intake.service";

const mockContext: IntakeContextResponseDto = {
  displayName: "Ada Lovelace",
  accountName: "Analytical Engines Ltd",
  contactEmail: "ada@corp.com",
  devices: [{ assetId: "02i000000000001", label: "ThinkPad X1" }],
  shipTo: { city: "London", state: "LDN", country: "UK" },
  hasMultipleServiceLocations: false
};

function principal(overrides: Record<string, unknown> = {}): AuthPrincipal {
  return {
    subject: "customer-chat:x",
    scopes: ["chat:intake"],
    tenantId: "tenant-demo",
    raw: {
      verified: true,
      accountId: "001000000000001",
      contactId: "003000000000001",
      ...overrides
    }
  } as AuthPrincipal;
}

function buildService(content: string): {
  service: IntakeAgentService;
  chat: jest.Mock;
  getContext: jest.Mock;
} {
  const chat = jest.fn().mockResolvedValue({
    content,
    metadata: {
      provider: "openai",
      model: "gpt",
      fallbackUsed: false,
      latencyMs: 1
    }
  });
  const modelRouter = { chat } as unknown as ModelRouter;
  const getContext = jest.fn().mockResolvedValue(mockContext);
  const intakeService = { getContext } as unknown as IntakeService;
  return {
    service: new IntakeAgentService(modelRouter, intakeService),
    chat,
    getContext
  };
}

describe("IntakeAgentService.nextTurn", () => {
  const turn = {
    messages: [{ role: "user" as const, content: "my screen is broken" }]
  };

  it("parses the model JSON into reply + extracted fields and captures the issue", async () => {
    const { service, chat, getContext } = buildService(
      JSON.stringify({
        reply: "Sorry to hear that. When did it start?",
        subject: "Broken screen",
        description: "Laptop screen is cracked and shows lines.",
        priority: "High"
      })
    );

    const result = await service.nextTurn(principal(), turn);

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    const request = chat.mock.calls[0][0];
    expect(request.useCase).toBe("customer_chat_intake");
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("Ada Lovelace");
    expect(request.messages[0].content).toContain("Analytical Engines Ltd");
    expect(result.reply).toBe("Sorry to hear that. When did it start?");
    expect(result.extracted).toEqual({
      subject: "Broken screen",
      description: "Laptop screen is cracked and shows lines.",
      priority: "High"
    });
    expect(result.issueCaptured).toBe(true);
  });

  it("drops an out-of-range priority", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "ok",
        description: "long enough description here",
        priority: "URGENT"
      })
    );
    const result = await service.nextTurn(principal(), turn);
    expect(result.extracted.priority).toBeUndefined();
  });

  it("surfaces raw model text when output is not JSON", async () => {
    const { service } = buildService("I am not JSON at all");
    const result = await service.nextTurn(principal(), turn);
    expect(result.reply).toBe("I am not JSON at all");
    expect(result.extracted).toEqual({});
    expect(result.issueCaptured).toBe(false);
  });

  it("captures the issue from user word count when JSON parsing fails", async () => {
    const { service } = buildService("I am not JSON at all");
    const longUserTurn = {
      messages: [
        {
          role: "user" as const,
          content:
            "My laptop screen flickers badly whenever I open Chrome and it started yesterday morning after a Windows update."
        }
      ]
    };
    const result = await service.nextTurn(principal(), longUserTurn);
    expect(result.issueCaptured).toBe(true);
  });

  it("requires a verified intake identity", async () => {
    const { service } = buildService("{}");
    await expect(
      service.nextTurn(principal({ verified: false }), turn)
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

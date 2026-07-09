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

const multiDeviceContext: IntakeContextResponseDto = {
  ...mockContext,
  devices: [
    { assetId: "02iDOCK", label: "AeroVolt Nexus Docking Station - Desk 402" },
    { assetId: "02iAIR", label: "AeroVolt Stratos Air 13 - Exec Travel Unit" },
    {
      assetId: "02iPRO",
      label: "AeroVolt ProBook 15X - Corporate Deployment 01"
    }
  ]
};

function buildService(
  content: string,
  context: IntakeContextResponseDto = mockContext
): {
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
  const getContext = jest.fn().mockResolvedValue(context);
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

  it("tells the model about the picked device and mutes picker cues", async () => {
    const { service, chat } = buildService(
      JSON.stringify({
        reply: "Got it — your ThinkPad X1.",
        ui: { action: "showDevicePicker" },
        readyToSubmit: false
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [{ role: "user" as const, content: "my screen is broken" }],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    const system = chat.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("already picked the affected device");
    expect(system).toContain("ThinkPad X1");
    expect(system).toContain("ONE question per turn");
    expect(result.ui.action).toBe("none");
  });

  it("instructs one question per turn and mandatory field extraction", async () => {
    const { service, chat } = buildService(JSON.stringify({ reply: "ok" }));
    await service.nextTurn(principal(), turn);
    const system = chat.mock.calls[0][0].messages[0].content as string;
    // one-question rule with a hard, checkable constraint
    expect(system).toContain("one question only");
    expect(system).toContain("AT MOST ONE question mark");
    // subject/description/priority required on every turn
    expect(system).toContain("REQUIRED on every response");
    expect(system).toContain("never be empty or omitted");
  });

  it("ignores a selectedAssetId that is not in the server-side catalog", async () => {
    const { service, chat } = buildService(JSON.stringify({ reply: "ok" }));
    await service.nextTurn(principal(), {
      messages: [{ role: "user" as const, content: "hello there friend" }],
      uiState: { selectedAssetId: "02iNOT-A-DEVICE" }
    });
    const system = chat.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("No device has been picked");
    expect(system).not.toContain("02iNOT-A-DEVICE");
  });

  it("resolves a suggested device index to its assetId", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "Sounds like your ThinkPad X1 — tap to confirm.",
        ui: { action: "suggestDevice", suggestedDeviceIndex: 1 },
        readyToSubmit: false
      })
    );
    const result = await service.nextTurn(principal(), turn);
    expect(result.ui).toEqual({
      action: "suggestDevice",
      suggestedAssetId: "02i000000000001"
    });
  });

  it("degrades an unresolvable suggestion to the picker", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "Is it the Stratos?",
        ui: { action: "suggestDevice", suggestedDeviceIndex: 9 },
        readyToSubmit: false
      })
    );
    const result = await service.nextTurn(principal(), turn);
    expect(result.ui.action).toBe("showDevicePicker");
  });

  it("honors createCase when the customer confirmed and a device is picked", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "Creating your case now…",
        description: "Internal display black; external monitor works.",
        readyToSubmit: true,
        ui: { action: "createCase" }
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "screen went black" },
        { role: "assistant" as const, content: "Shall I create the case?" },
        { role: "user" as const, content: "yes please" }
      ],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    expect(result.readyToSubmit).toBe(true);
    expect(result.ui.action).toBe("createCase");
  });

  it("downgrades createCase to the picker while no device is locked in", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "Creating your case now…",
        readyToSubmit: true,
        ui: { action: "createCase" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), turn);
    expect(result.ui.action).toBe("showDevicePicker");
  });

  it("maps the deprecated showReview cue to a plain turn", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "Shall I go ahead and create the case?",
        readyToSubmit: true,
        ui: { action: "showReview" }
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [{ role: "user" as const, content: "screen went black" }],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    expect(result.readyToSubmit).toBe(true);
    expect(result.ui.action).toBe("none");
  });

  it("falls back to heuristic readiness when model output is not JSON", async () => {
    const { service } = buildService("not json at all");

    const short = await service.nextTurn(principal(), turn);
    expect(short.readyToSubmit).toBe(false);

    const long = await service.nextTurn(principal(), {
      messages: [
        {
          role: "user" as const,
          content:
            "My laptop screen went completely black this morning while I was working on a report."
        },
        { role: "assistant" as const, content: "When did it start?" },
        {
          role: "user" as const,
          content:
            "It started today and I already tried an external monitor which works fine somehow."
        }
      ]
    });
    expect(long.readyToSubmit).toBe(true);
  });

  it("caches the Salesforce context between turns for the same identity", async () => {
    const { service, getContext } = buildService(
      JSON.stringify({ reply: "ok" })
    );
    await service.nextTurn(principal(), turn);
    await service.nextTurn(principal(), turn);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("suggests the device the customer typed instead of deadlocking on a plain picker", async () => {
    // The live deadlock: customer typed "ProBook 15X" (never tapped a chip),
    // model went straight to createCase — with no selection the server must
    // cue a one-tap confirm on the typed device, not a bare picker.
    const { service } = buildService(
      JSON.stringify({
        reply: "Creating your case now…",
        readyToSubmit: true,
        ui: { action: "createCase" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "laptop screen is black" },
        { role: "assistant" as const, content: "Which device is affected?" },
        { role: "user" as const, content: "ProBook 15X" }
      ]
    });
    expect(result.ui).toEqual({
      action: "suggestDevice",
      suggestedAssetId: "02iPRO"
    });
  });

  it("keeps the plain picker when the typed mention is ambiguous", async () => {
    // "aerovolt" alone matches three devices — never guess.
    const { service } = buildService(
      JSON.stringify({
        reply: "Which device is affected?",
        readyToSubmit: true,
        ui: { action: "showDevicePicker" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "my aerovolt laptop is broken" },
        { role: "assistant" as const, content: "Which device is affected?" },
        { role: "user" as const, content: "the aerovolt one" }
      ]
    });
    expect(result.ui).toEqual({ action: "showDevicePicker" });
  });

  it("does not let a chosen device's tokens leak from [event] notes into matching", async () => {
    // After a selection the ack note contains the label; matching must ignore
    // hidden [event] lines so a later "Change" doesn't ghost-suggest.
    const { service } = buildService(
      JSON.stringify({
        reply: "Which device is affected?",
        readyToSubmit: false,
        ui: { action: "showDevicePicker" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "laptop screen is black" },
        {
          role: "user" as const,
          content:
            "[event] Customer selected the affected device in the chat UI: AeroVolt Stratos Air 13 - Exec Travel Unit"
        }
      ]
    });
    expect(result.ui).toEqual({ action: "showDevicePicker" });
  });

  it("rejects suffix-word and date-digit coincidences as a device match", async () => {
    // "corporate" (deployment suffix) + "01" (inside a typed date) reach two
    // tokens but include no product-name token — must NOT suggest a device.
    const { service } = buildService(
      JSON.stringify({
        reply: "Which device is affected?",
        readyToSubmit: true,
        ui: { action: "showDevicePicker" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        {
          role: "user" as const,
          content:
            "My corporate laptop stopped booting on 2026-01-15 after the update"
        }
      ]
    });
    expect(result.ui).toEqual({ action: "showDevicePicker" });
  });

  it("prefers the newest typed correction over an earlier device mention", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "Which device is affected?",
        readyToSubmit: false,
        ui: { action: "showDevicePicker" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "it is my stratos air 13" },
        { role: "assistant" as const, content: "Got it. When did it start?" },
        {
          role: "user" as const,
          content: "sorry — actually it is the probook 15x"
        }
      ]
    });
    expect(result.ui).toEqual({
      action: "suggestDevice",
      suggestedAssetId: "02iPRO"
    });
  });

  it("does not count [event] notes toward heuristic readiness", async () => {
    const { service } = buildService("not json at all");
    const result = await service.nextTurn(principal(), {
      messages: [
        {
          role: "user" as const,
          content: "my screen is broken and totally dead now"
        },
        {
          role: "user" as const,
          content:
            "[event] Customer selected the affected device in the chat UI: AeroVolt Stratos Air 13 - Exec Travel Unit"
        }
      ]
    });
    // one real typed turn of 8 words — the 18-word event note must not
    // push the fallback over its 2-turn / 25-word threshold
    expect(result.readyToSubmit).toBe(false);
  });

  it("renders the picker when the reply references chips but the directive said none", async () => {
    // The live dead end: "Please tap the matching chip below" with
    // ui.action "none" — the customer is told to use UI that never renders.
    const { service } = buildService(
      JSON.stringify({
        reply:
          "Which registered device is affected? Please tap the matching chip below to confirm.",
        readyToSubmit: false,
        ui: { action: "none" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), {
      messages: [{ role: "user" as const, content: "laptop screen is black" }]
    });
    expect(result.ui.action).toBe("showDevicePicker");
  });

  it("honors a create announcement whose directive said none", async () => {
    // Live failure: reply "Creating your case now…" with ui.action "none" —
    // the customer waits on a create that never fires.
    const { service } = buildService(
      JSON.stringify({
        reply: "Creating your case now…",
        readyToSubmit: true,
        ui: { action: "none" }
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "screen went black today" },
        { role: "assistant" as const, content: "Should I use these details?" },
        { role: "user" as const, content: "yes use these details" }
      ],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    expect(result.ui.action).toBe("createCase");
  });

  it("re-extracts the final fields when the create turn returns no description", async () => {
    // Live failure: the create turn's extraction was {}, so the stale
    // turn-1 description (missing timing/troubleshooting) landed on the Case.
    const { service, chat } = buildService(
      JSON.stringify({
        reply: "Creating your case now…",
        readyToSubmit: true,
        ui: { action: "createCase" }
      })
    );
    chat.mockResolvedValueOnce({
      content: JSON.stringify({
        reply: "Creating your case now…",
        readyToSubmit: true,
        ui: { action: "createCase" }
      }),
      metadata: {
        provider: "openai",
        model: "gpt",
        fallbackUsed: false,
        latencyMs: 1
      }
    });
    chat.mockResolvedValueOnce({
      content: JSON.stringify({
        subject: "Black screen on ThinkPad X1",
        description:
          "Internal display black since today; external monitor works. Customer restarted three times and reseated the display cable with no change.",
        priority: "Medium"
      }),
      metadata: {
        provider: "openai",
        model: "gpt",
        fallbackUsed: false,
        latencyMs: 1
      }
    });
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "screen went black today" },
        { role: "assistant" as const, content: "Should I use these details?" },
        { role: "user" as const, content: "yes use these details" }
      ],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.ui.action).toBe("createCase");
    expect(result.extracted.description).toContain(
      "reseated the display cable"
    );
    // the second call is a focused extraction over the transcript
    const finalSystem = chat.mock.calls[1][0].messages[0].content as string;
    expect(finalSystem).toContain("every troubleshooting step");
    expect(finalSystem).toContain('"ThinkPad X1"');
  });

  it("skips the re-extraction when the create turn already has a description", async () => {
    const { service, chat } = buildService(
      JSON.stringify({
        reply: "Creating your case now…",
        description:
          "Internal display black since today; external monitor works.",
        subject: "Black screen",
        priority: "Medium",
        readyToSubmit: true,
        ui: { action: "createCase" }
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [{ role: "user" as const, content: "yes use these details" }],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.ui.action).toBe("createCase");
  });

  it("never treats a register question as a create announcement", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply:
          "Shall I go ahead and register this case now? I'm ready when you are.",
        readyToSubmit: true,
        ui: { action: "none" }
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [{ role: "user" as const, content: "screen went black" }],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    expect(result.ui.action).toBe("none");
  });

  it("keeps a chip-referencing reply as a plain turn once a device is picked", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "You already tapped the chip below — thanks!",
        readyToSubmit: false,
        ui: { action: "none" }
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [{ role: "user" as const, content: "screen broken" }],
      uiState: { selectedAssetId: "02i000000000001" }
    });
    expect(result.ui).toEqual({ action: "none" });
  });

  it("instructs the conversational create contract and no repeats", async () => {
    const { service, chat } = buildService(JSON.stringify({ reply: "ok" }));
    await service.nextTurn(principal(), turn);
    const system = chat.mock.calls[0][0].messages[0].content as string;
    // staged confirms in chat, then the createCase directive
    expect(system).toContain("register this case");
    expect(system).toContain('"createCase"');
    expect(system).toContain("never before both confirmations");
    // the description is the model's consolidated understanding, not transcript
    expect(system).toContain("YOUR OWN words");
    expect(system).toContain("NEVER paste the chat transcript");
    // conversation continues after creation
    expect(system).toContain("[event] Case created");
    expect(system).toContain("Never repeat your previous message");
    expect(system).toContain("NEVER say you cannot list devices");
  });

  it("replaces contradictory can't-list replies when the device picker is shown", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply:
          "I can't list all the devices, but please tell me which registered device is affected.",
        readyToSubmit: false,
        ui: { action: "showDevicePicker" }
      }),
      multiDeviceContext
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "can you list items in my account" }
      ]
    });
    expect(result.ui).toEqual({ action: "showDevicePicker" });
    expect(result.reply).toContain("listed your registered devices below");
    expect(result.reply).not.toMatch(/can'?t list/i);
  });

  it("instructs a separate service-details step with the on-file address and email", async () => {
    const { service, chat } = buildService(JSON.stringify({ reply: "ok" }));
    await service.nextTurn(principal(), turn);
    const system = chat.mock.calls[0][0].messages[0].content as string;
    // registration is staged: issue confirm first, logistics second
    expect(system).toContain("TWO separate confirmation steps");
    expect(system).toContain(
      "Do NOT mention the service address, email, or phone in this message"
    );
    // the service-details step presents what will be used, from live context
    expect(system).toContain("on file: London, LDN, UK");
    expect(system).toContain("on file: ada@corp.com");
    // override fields exist in the JSON contract but must not echo defaults
    expect(system).toContain('"serviceAddress"');
    expect(system).toContain('"contactEmail"');
    expect(system).toContain('"contactPhone"');
    expect(system).toContain("never copy the on-file defaults");
  });

  it("extracts customer-provided contact and address overrides", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "Got it — updates will go to your alternate email.",
        subject: "Black screen",
        description: "Internal display black since today.",
        priority: "Medium",
        serviceAddress: "400 Main St, Dallas TX",
        contactEmail: "jason.alt@corp.com",
        contactPhone: "+1 512 555 0100"
      })
    );
    const result = await service.nextTurn(principal(), turn);
    expect(result.extracted.serviceAddress).toBe("400 Main St, Dallas TX");
    expect(result.extracted.contactEmail).toBe("jason.alt@corp.com");
    expect(result.extracted.contactPhone).toBe("+1 512 555 0100");
  });

  it("drops malformed or empty override values", async () => {
    const { service } = buildService(
      JSON.stringify({
        reply: "ok",
        serviceAddress: "",
        contactEmail: "not-an-email",
        contactPhone: "call me maybe"
      })
    );
    const result = await service.nextTurn(principal(), turn);
    expect(result.extracted.serviceAddress).toBeUndefined();
    expect(result.extracted.contactEmail).toBeUndefined();
    expect(result.extracted.contactPhone).toBeUndefined();
  });

  it("sniffs a typed email/phone override when the model drops the JSON fields", async () => {
    // Production failure: the model restated the new email/phone in prose
    // but returned extracted:{} — the Case kept the on-file contact.
    const { service } = buildService(
      JSON.stringify({
        reply:
          "Updates will go to your alternate email with your number on file. Is that all correct — shall I go ahead and create the case?"
      })
    );
    const result = await service.nextTurn(principal(), {
      messages: [
        { role: "user" as const, content: "my screen is broken since today" },
        { role: "assistant" as const, content: "Anything else to correct?" },
        {
          role: "user" as const,
          content:
            "send updates to jason.alt@aptivance.com and my number is +1 512 555 0100"
        }
      ]
    });
    expect(result.extracted.contactEmail).toBe("jason.alt@aptivance.com");
    expect(result.extracted.contactPhone).toBe("+1 512 555 0100");
  });

  it("never sniffs the on-file email or serial-like digits as overrides", async () => {
    const { service } = buildService(JSON.stringify({ reply: "ok" }));
    const result = await service.nextTurn(principal(), {
      messages: [
        {
          role: "user" as const,
          content:
            "you already have my email ada@corp.com and the serial is 5CD1234567"
        }
      ]
    });
    expect(result.extracted.contactEmail).toBeUndefined();
    expect(result.extracted.contactPhone).toBeUndefined();
  });
});

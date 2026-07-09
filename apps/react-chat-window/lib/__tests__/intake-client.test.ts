import { describe, expect, it } from "vitest";

import {
  buildCaseCreatePayload,
  buildTurnRequestBody,
  canSubmitCase,
  caseCreatedAnnouncement,
  caseCreatedEvent,
  deviceGreeting,
  deviceSelectionEvent,
  filterDevicesByQuery,
  parseTurnResponse,
  resolveCaseDescription,
  shouldShowDevicePicker,
  transcriptFallbackDescription
} from "@/lib/intake-client";
import type { IntakeContext, IntakeState } from "@/lib/intake-flow";
import { initialIntakeState } from "@/lib/intake-flow";

const baseContext: IntakeContext = {
  displayName: "Jason Luu",
  accountName: "Aptivance tech",
  devices: [
    { assetId: "02i1", label: "Quantum Apex 17-G" },
    { assetId: "02i2", label: "AeroVolt ProBook 15X" }
  ],
  shipTo: { city: "Austin", state: "TX", country: "US" }
};

describe("deviceGreeting", () => {
  it("greets by first name and mentions device count without listing labels", () => {
    const greeting = deviceGreeting(baseContext);
    expect(greeting).toContain("Hi Jason");
    expect(greeting).toContain("2 registered devices");
    expect(greeting).not.toContain("Quantum Apex");
  });

  it("mentions a single device without listing its label", () => {
    const greeting = deviceGreeting({
      ...baseContext,
      devices: [baseContext.devices[0]!]
    });
    expect(greeting).toContain("1 registered device");
    expect(greeting).not.toContain("Quantum Apex");
  });
});

describe("filterDevicesByQuery", () => {
  it("filters devices by label substring", () => {
    expect(filterDevicesByQuery(baseContext.devices, "probook")).toEqual([
      { assetId: "02i2", label: "AeroVolt ProBook 15X" }
    ]);
    expect(filterDevicesByQuery(baseContext.devices, "")).toEqual(
      baseContext.devices
    );
  });
});

describe("shouldShowDevicePicker", () => {
  it("shows the picker only once the model has cued it with multiple devices", () => {
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: false,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(false);
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: true,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(true);
    // hidden again once picked
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: true,
        context: baseContext,
        selectedAssetId: "02i1"
      })
    ).toBe(false);
    // single-device accounts never see the picker (auto-selected)
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: true,
        context: { ...baseContext, devices: [baseContext.devices[0]!] },
        selectedAssetId: null
      })
    ).toBe(false);
  });
});

describe("buildTurnRequestBody", () => {
  const messages = [{ role: "user" as const, content: "screen is black" }];

  it("includes uiState only when a device is selected", () => {
    expect(buildTurnRequestBody(messages, null)).toEqual({ messages });
    expect(buildTurnRequestBody(messages, "02i1")).toEqual({
      messages,
      uiState: { selectedAssetId: "02i1" }
    });
  });
});

describe("deviceSelectionEvent", () => {
  it("marks the note as a chat-UI event with the device label", () => {
    const note = deviceSelectionEvent("Quantum Apex 17-G");
    expect(note.startsWith("[event]")).toBe(true);
    expect(note).toContain("Quantum Apex 17-G");
  });
});

describe("caseCreatedEvent", () => {
  it("marks the note as a chat-UI event with the case number", () => {
    const note = caseCreatedEvent("00001234");
    expect(note.startsWith("[event]")).toBe(true);
    expect(note).toContain("#00001234");
  });

  it("stays valid without a case number", () => {
    const note = caseCreatedEvent(undefined);
    expect(note.startsWith("[event]")).toBe(true);
    expect(note).not.toContain("#");
  });
});

describe("caseCreatedAnnouncement", () => {
  it("announces the case number, key facts, follow-up email, and next prompt", () => {
    const message = caseCreatedAnnouncement({
      caseNumber: "00001234",
      subject: "Black screen on startup",
      deviceLabel: "Quantum Apex 17-G",
      priority: "High",
      email: "jason@example.com"
    });
    expect(message).toContain("#00001234");
    expect(message).toContain("Issue: Black screen on startup");
    expect(message).toContain("Device: Quantum Apex 17-G");
    expect(message).toContain("Priority: High");
    expect(message).toContain("jason@example.com");
    expect(message).toContain("anything else I can help you with?");
  });

  it("degrades gracefully when optional details are missing", () => {
    const message = caseCreatedAnnouncement({});
    expect(message).toContain("created your case");
    expect(message).not.toContain("Issue:");
    expect(message).not.toContain(" at ");
    expect(message).toContain("anything else I can help you with?");
  });

  it("shows the customer-provided service address when one was given", () => {
    const message = caseCreatedAnnouncement({
      caseNumber: "00001234",
      serviceAddress: "400 Main St, Dallas TX",
      email: "jason.alt@corp.com"
    });
    expect(message).toContain("Service at: 400 Main St, Dallas TX");
    expect(message).toContain("follow up at jason.alt@corp.com");
  });
});

describe("parseTurnResponse", () => {
  it("parses a directive turn", () => {
    const result = parseTurnResponse({
      reply: "Which device is affected?",
      extracted: { subject: "Black screen" },
      issueCaptured: true,
      ui: { action: "suggestDevice", suggestedAssetId: "02i2" },
      readyToSubmit: false
    });
    expect(result.reply).toBe("Which device is affected?");
    expect(result.ui).toEqual({
      action: "suggestDevice",
      suggestedAssetId: "02i2"
    });
    expect(result.readyToSubmit).toBe(false);
  });

  it("parses a createCase directive", () => {
    const result = parseTurnResponse({
      reply: "Creating your case now…",
      extracted: {},
      issueCaptured: true,
      ui: { action: "createCase" },
      readyToSubmit: true
    });
    expect(result.ui).toEqual({ action: "createCase" });
    expect(result.readyToSubmit).toBe(true);
  });

  it("degrades unknown fields to a plain turn", () => {
    const result = parseTurnResponse({
      reply: "",
      ui: { action: "explode" },
      readyToSubmit: "yes"
    });
    expect(result.reply).toContain("tell me a bit more");
    expect(result.ui).toBeUndefined();
    expect(result.readyToSubmit).toBeUndefined();
    expect(result.issueCaptured).toBe(false);
  });
});

describe("transcriptFallbackDescription", () => {
  it("joins typed user messages and excludes hidden [event] notes", () => {
    const state: IntakeState = {
      ...initialIntakeState,
      messages: [
        { role: "assistant", content: "Hi!", uiOnly: true },
        { role: "user", content: "Screen flickers on startup." },
        {
          role: "user",
          content: "[event] Customer selected the affected device: X",
          hidden: true
        },
        { role: "user", content: "Started today." }
      ]
    };
    expect(transcriptFallbackDescription(state)).toBe(
      "Screen flickers on startup.\nStarted today."
    );
  });
});

describe("resolveCaseDescription", () => {
  const multiTurn: IntakeState = {
    ...initialIntakeState,
    messages: [
      { role: "assistant", content: "Hi!", uiOnly: true },
      { role: "user", content: "screen is blak but external monitr works" },
      {
        role: "user",
        content: "[event] Customer selected the affected device: X",
        hidden: true
      },
      { role: "user", content: "started today, restarted 3 times" }
    ],
    extracted: {
      description:
        "Internal display is black since today; external monitor works. Customer restarted 3 times with no change."
    }
  };

  it("uses the model's consolidated understanding, not the raw transcript", () => {
    const description = resolveCaseDescription(multiTurn);
    expect(description).toBe(
      "Internal display is black since today; external monitor works. Customer restarted 3 times with no change."
    );
    expect(description).not.toContain("blak");
    expect(description).not.toContain("[event]");
  });

  it("falls back to the typed transcript when extraction never succeeded", () => {
    const description = resolveCaseDescription({
      ...multiTurn,
      extracted: {}
    });
    expect(description).toBe(
      "screen is blak but external monitr works\nstarted today, restarted 3 times"
    );
    expect(description).not.toContain("[event]");
  });

  it("falls back to a safe default when nothing was typed", () => {
    expect(resolveCaseDescription(initialIntakeState)).toBe(
      "Issue reported via chat."
    );
  });
});

describe("buildCaseCreatePayload", () => {
  const baseState: IntakeState = {
    ...initialIntakeState,
    phase: "triage",
    context: baseContext,
    messages: [{ role: "user", content: "Screen flickers on startup." }],
    extracted: {
      subject: "Screen flicker",
      description: "Screen flickers on startup.",
      priority: "High"
    },
    issueCaptured: true,
    readyToSubmit: true,
    selectedAssetId: "02i2"
  };

  it("always includes assetId and deviceLabel for the selected device", () => {
    const payload = buildCaseCreatePayload(baseState);
    expect(payload.assetId).toBe("02i2");
    expect(payload.deviceLabel).toBe("AeroVolt ProBook 15X");
    expect(payload.issueDescription).toContain("Affected device:");
    expect(payload.subject).toBe("Screen flicker");
    expect(payload.shipTo).toEqual(baseContext.shipTo);
  });

  it("sends the extracted description as the case body", () => {
    const payload = buildCaseCreatePayload(baseState);
    expect(payload.issueDescription).toContain("Screen flickers on startup.");
  });

  it("falls back to the typed transcript when no description was extracted", () => {
    const payload = buildCaseCreatePayload({
      ...baseState,
      extracted: {},
      messages: [
        { role: "user", content: "Screen flickers on startup." },
        {
          role: "user",
          content: "[event] Customer selected the affected device: X",
          hidden: true
        }
      ]
    });
    expect(payload.issueDescription).toContain("Screen flickers on startup.");
    expect(payload.issueDescription).not.toContain("[event]");
  });

  it("passes chat-provided contact and address overrides to the server", () => {
    const payload = buildCaseCreatePayload({
      ...baseState,
      extracted: {
        ...baseState.extracted,
        serviceAddress: "400 Main St, Dallas TX",
        contactEmail: "jason.alt@corp.com",
        contactPhone: "+1 512 555 0100"
      }
    });
    expect(payload.serviceAddress).toBe("400 Main St, Dallas TX");
    expect(payload.contactEmail).toBe("jason.alt@corp.com");
    expect(payload.contactPhone).toBe("+1 512 555 0100");
  });

  it("omits override keys entirely when none were given", () => {
    const payload = buildCaseCreatePayload(baseState);
    expect(payload).not.toHaveProperty("serviceAddress");
    expect(payload).not.toHaveProperty("contactEmail");
    expect(payload).not.toHaveProperty("contactPhone");
  });
});

describe("canSubmitCase", () => {
  it("requires a selected device when the account has devices on file", () => {
    expect(
      canSubmitCase({
        ...initialIntakeState,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(false);
    expect(
      canSubmitCase({
        ...initialIntakeState,
        context: baseContext,
        selectedAssetId: "02i1"
      })
    ).toBe(true);
  });
});

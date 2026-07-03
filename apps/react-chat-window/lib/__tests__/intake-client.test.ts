import { describe, expect, it } from "vitest";

import {
  buildCaseCreatePayload,
  buildTurnRequestBody,
  canSubmitCase,
  deviceGreeting,
  deviceSelectionEvent,
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
  it("greets by first name without listing every device", () => {
    const greeting = deviceGreeting(baseContext);
    expect(greeting).toContain("Hi Jason");
    expect(greeting).not.toContain("Quantum Apex");
    expect(greeting).not.toContain("device(s) on your account");
  });
});

describe("shouldShowDevicePicker", () => {
  it("shows the picker only once the model has cued it (or readiness) with multiple devices", () => {
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: false,
        readyToSubmit: false,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(false);
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: true,
        readyToSubmit: false,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(true);
    // readiness without a device still needs the picker
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: false,
        readyToSubmit: true,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(true);
    // hidden again once picked
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: true,
        readyToSubmit: true,
        context: baseContext,
        selectedAssetId: "02i1"
      })
    ).toBe(false);
    // single-device accounts never see the picker (auto-selected)
    expect(
      shouldShowDevicePicker({
        devicePickerRequested: true,
        readyToSubmit: true,
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
      { role: "user", content: "Screen is black but external monitor works." },
      {
        role: "user",
        content: "[event] Customer selected the affected device: X",
        hidden: true
      },
      { role: "user", content: "Started today, restarted 3 times." }
    ],
    // model only extracted a partial description on the first turn
    extracted: { description: "Screen is black but external monitor works." }
  };

  it("uses the full transcript (not the model's partial extraction) and drops [event] notes", () => {
    const description = resolveCaseDescription(multiTurn);
    expect(description).toBe(
      "Screen is black but external monitor works.\nStarted today, restarted 3 times."
    );
    expect(description).not.toContain("[event]");
  });

  it("prefers a customer edit over the transcript", () => {
    expect(
      resolveCaseDescription({
        ...multiTurn,
        descriptionOverride: "Customer's own corrected wording."
      })
    ).toBe("Customer's own corrected wording.");
  });

  it("falls back to a safe default when nothing was typed", () => {
    expect(resolveCaseDescription(initialIntakeState)).toBe(
      "Laptop issue reported via chat."
    );
  });
});

describe("buildCaseCreatePayload", () => {
  const baseState: IntakeState = {
    ...initialIntakeState,
    phase: "confirm",
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

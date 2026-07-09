import { describe, expect, it } from "vitest";

import {
  initialIntakeState,
  intakeReducer,
  type IntakeState
} from "@/lib/intake-flow";

const session = {
  accessToken: "jwt",
  expiresAt: "2026-01-01T00:00:00.000Z",
  subject: "customer-chat:x"
};

const twoDeviceContext = {
  devices: [
    { assetId: "02i1", label: "ThinkPad X1" },
    { assetId: "02i2", label: "MacBook Pro" }
  ],
  shipTo: {}
};

describe("intakeReducer", () => {
  it("advances email → otp → triage", () => {
    let state = intakeReducer(initialIntakeState, {
      type: "otpSent",
      email: "user@example.com"
    });
    expect(state.phase).toBe("otp");
    expect(state.email).toBe("user@example.com");

    state = intakeReducer(state, { type: "verified", session });
    expect(state.phase).toBe("triage");
    expect(state.session).toEqual(session);
  });

  it("accumulates the latest non-empty extracted fields across turns", () => {
    let state: IntakeState = { ...initialIntakeState, phase: "triage" };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Got it.",
      extracted: { subject: "Screen issue", description: "flickers" },
      issueCaptured: true
    });
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Thanks.",
      // priority arrives later; earlier subject/description must persist
      extracted: { priority: "High" },
      issueCaptured: false
    });
    expect(state.extracted).toEqual({
      subject: "Screen issue",
      description: "flickers",
      priority: "High"
    });
    // issueCaptured latches true once set
    expect(state.issueCaptured).toBe(true);
    expect(state.messages).toHaveLength(2);
  });

  it("accumulates contact and service-address overrides across turns", () => {
    let state: IntakeState = { ...initialIntakeState, phase: "triage" };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Noted — updates to your alternate email.",
      extracted: { contactEmail: "alt@corp.com" },
      issueCaptured: true
    });
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "And service at your Dallas office.",
      extracted: { serviceAddress: "400 Main St, Dallas TX" },
      issueCaptured: true
    });
    expect(state.extracted.contactEmail).toBe("alt@corp.com");
    expect(state.extracted.serviceAddress).toBe("400 Main St, Dallas TX");
  });

  it("latches the picker once the model cues it and releases it on selection", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: twoDeviceContext
    };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Which device is affected?",
      extracted: {},
      issueCaptured: true,
      ui: { action: "showDevicePicker" },
      readyToSubmit: false
    });
    expect(state.devicePickerRequested).toBe(true);

    // sticky across a plain follow-up turn
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "When did it start?",
      extracted: {},
      issueCaptured: true,
      ui: { action: "none" },
      readyToSubmit: false
    });
    expect(state.devicePickerRequested).toBe(true);

    state = intakeReducer(state, { type: "selectDevice", assetId: "02i1" });
    expect(state.devicePickerRequested).toBe(false);
    expect(state.suggestedAssetId).toBeNull();

    // "Change" explicitly reopens the picker
    state = intakeReducer(state, { type: "clearDevice" });
    expect(state.selectedAssetId).toBeNull();
    expect(state.devicePickerRequested).toBe(true);
  });

  it("accepts only catalog-valid suggestions and clears stale ones each turn", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: twoDeviceContext
    };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Sounds like your ThinkPad — tap to confirm.",
      extracted: {},
      issueCaptured: true,
      ui: { action: "suggestDevice", suggestedAssetId: "02i1" },
      readyToSubmit: false
    });
    expect(state.suggestedAssetId).toBe("02i1");
    expect(state.devicePickerRequested).toBe(true);

    // an unknown asset never becomes the suggestion — and the old one is
    // cleared rather than left pointing at a possibly-corrected device
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Hmm.",
      extracted: {},
      issueCaptured: true,
      ui: { action: "suggestDevice", suggestedAssetId: "02i9" },
      readyToSubmit: false
    });
    expect(state.suggestedAssetId).toBeNull();

    // a fresh valid suggestion sets it again; a plain turn clears it
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Your MacBook then?",
      extracted: {},
      issueCaptured: true,
      ui: { action: "suggestDevice", suggestedAssetId: "02i2" },
      readyToSubmit: false
    });
    expect(state.suggestedAssetId).toBe("02i2");
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "When did it start?",
      extracted: {},
      issueCaptured: true,
      ui: { action: "none" },
      readyToSubmit: false
    });
    expect(state.suggestedAssetId).toBeNull();
  });

  it("tracks the model's latest readiness judgment", () => {
    let state: IntakeState = { ...initialIntakeState, phase: "triage" };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Shall I create the case?",
      extracted: {},
      issueCaptured: true,
      ui: { action: "none" },
      readyToSubmit: true
    });
    expect(state.readyToSubmit).toBe(true);

    // new information makes the model ask again → readiness retracts
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Does the keyboard issue happen on battery too?",
      extracted: {},
      issueCaptured: true,
      ui: { action: "none" },
      readyToSubmit: false
    });
    expect(state.readyToSubmit).toBe(false);

    // legacy responses without the field keep the previous judgment
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "ok",
      extracted: {},
      issueCaptured: true
    });
    expect(state.readyToSubmit).toBe(false);
  });

  it("requests the case create on a createCase directive once a device is picked", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: twoDeviceContext,
      selectedAssetId: "02i1"
    };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Creating your case now…",
      extracted: {},
      issueCaptured: true,
      ui: { action: "createCase" },
      readyToSubmit: true
    });
    expect(state.createCaseRequested).toBe(true);

    state = intakeReducer(state, { type: "createCaseHandled" });
    expect(state.createCaseRequested).toBe(false);
  });

  it("ignores a createCase directive while no device is picked (devices exist)", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: twoDeviceContext,
      selectedAssetId: null
    };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Creating your case now…",
      extracted: {},
      issueCaptured: true,
      ui: { action: "createCase" },
      readyToSubmit: true
    });
    expect(state.createCaseRequested).toBe(false);
  });

  it("allows createCase without a device when none are on file", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: { devices: [], shipTo: {} }
    };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Creating your case now…",
      extracted: {},
      issueCaptured: true,
      ui: { action: "createCase" },
      readyToSubmit: true
    });
    expect(state.createCaseRequested).toBe(true);
  });

  it("treats the deprecated showReview directive as inert", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: twoDeviceContext,
      selectedAssetId: "02i1"
    };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "You can review and submit.",
      extracted: {},
      issueCaptured: true,
      ui: { action: "showReview" },
      readyToSubmit: true
    });
    expect(state.createCaseRequested).toBe(false);
    expect(state.devicePickerRequested).toBe(false);
  });

  it("keeps the conversation going after a case is created and resets per-case fields", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: twoDeviceContext,
      messages: [{ role: "user", content: "screen is black" }],
      extracted: { subject: "Black screen", priority: "High" },
      issueCaptured: true,
      readyToSubmit: true,
      selectedAssetId: "02i1",
      createCaseRequested: true
    };
    state = intakeReducer(state, {
      type: "caseCreated",
      caseId: "500000000000001",
      caseNumber: "00001234"
    });
    // no done screen: the chat continues in triage for "anything else?"
    expect(state.phase).toBe("triage");
    expect(state.caseNumber).toBe("00001234");
    expect(state.extracted).toEqual({});
    expect(state.issueCaptured).toBe(false);
    expect(state.readyToSubmit).toBe(false);
    expect(state.selectedAssetId).toBeNull();
    expect(state.createCaseRequested).toBe(false);
    // the transcript survives so the model keeps the history
    expect(state.messages).toHaveLength(1);

    expect(intakeReducer(state, { type: "reset" })).toEqual(initialIntakeState);
  });

  it("re-applies the single-device auto-select for the next case", () => {
    const oneDeviceContext = {
      devices: [{ assetId: "02i1", label: "ThinkPad X1" }],
      shipTo: {}
    };
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: oneDeviceContext,
      selectedAssetId: "02i1"
    };
    state = intakeReducer(state, {
      type: "caseCreated",
      caseId: "500000000000001",
      caseNumber: "00001234"
    });
    // a follow-up issue on a single-device account must not deadlock on
    // a picker that never renders
    expect(state.selectedAssetId).toBe("02i1");
  });

  it("auto-selects the only device when context loads", () => {
    const state = intakeReducer(initialIntakeState, {
      type: "contextLoaded",
      context: {
        devices: [{ assetId: "02i1", label: "ThinkPad X1" }],
        shipTo: {}
      }
    });
    expect(state.selectedAssetId).toBe("02i1");
  });

  it("does not auto-select when multiple devices are on file", () => {
    const state = intakeReducer(initialIntakeState, {
      type: "contextLoaded",
      context: {
        devices: [
          { assetId: "02i1", label: "ThinkPad X1" },
          { assetId: "02i2", label: "MacBook Pro" }
        ],
        shipTo: {}
      }
    });
    expect(state.selectedAssetId).toBeNull();
  });
});

describe("intakeReducer ticket status + troubleshooting", () => {
  it("latches ticketStatusRequested on a showTicketStatus cue and clears on handled", () => {
    let state: IntakeState = { ...initialIntakeState, phase: "triage" };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Let me pull up the latest on your open cases.",
      extracted: {},
      issueCaptured: false,
      ui: { action: "showTicketStatus" }
    });
    expect(state.ticketStatusRequested).toBe(true);

    state = intakeReducer(state, { type: "ticketStatusHandled" });
    expect(state.ticketStatusRequested).toBe(false);
  });

  it("counts server-declared suggestions and resets the budget after a create", () => {
    let state: IntakeState = { ...initialIntakeState, phase: "triage" };
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Try closing heavy apps — did that resolve it?",
      extracted: {},
      issueCaptured: true,
      offeredSuggestion: true
    });
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Try a restart — did that help?",
      extracted: {},
      issueCaptured: true,
      offeredSuggestion: true
    });
    expect(state.troubleshootingCount).toBe(2);

    // a plain turn must not inflate the count
    state = intakeReducer(state, {
      type: "turnResult",
      reply: "Understood — let me raise a ticket.",
      extracted: {},
      issueCaptured: true
    });
    expect(state.troubleshootingCount).toBe(2);

    state = intakeReducer(state, {
      type: "caseCreated",
      caseId: "500000000000001",
      caseNumber: "00001234"
    });
    expect(state.troubleshootingCount).toBe(0);
  });
});

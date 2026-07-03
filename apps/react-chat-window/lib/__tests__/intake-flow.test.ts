import { describe, expect, it } from "vitest";

import {
  canReview,
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
      reply: "You can review and submit.",
      extracted: {},
      issueCaptured: true,
      ui: { action: "showReview" },
      readyToSubmit: true
    });
    expect(state.readyToSubmit).toBe(true);

    // new information makes the model ask again → the CTA retracts
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

  it("stores a description edit as an override without touching extracted", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      extracted: { description: "model text" }
    };
    state = intakeReducer(state, {
      type: "editDescription",
      description: "corrected text"
    });
    expect(state.descriptionOverride).toBe("corrected text");
    // the model's extracted.description is a signal only; the edit does not mutate it
    expect(state.extracted.description).toBe("model text");
  });

  it("gates review on model readiness and a picked device", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: twoDeviceContext,
      issueCaptured: true
    };
    expect(canReview(state)).toBe(false);
    state = { ...state, readyToSubmit: true };
    expect(canReview(state)).toBe(false);
    state = intakeReducer(state, { type: "selectDevice", assetId: "02i1" });
    expect(canReview(state)).toBe(true);
  });

  it("allows review without a device when none are on file", () => {
    const state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      context: { devices: [], shipTo: {} },
      readyToSubmit: true
    };
    expect(canReview(state)).toBe(true);
  });

  it("records the created case and lands on done, and reset restores initial", () => {
    let state: IntakeState = { ...initialIntakeState, phase: "confirm" };
    state = intakeReducer(state, {
      type: "caseCreated",
      caseId: "500000000000001",
      caseNumber: "00001234"
    });
    expect(state.phase).toBe("done");
    expect(state.caseNumber).toBe("00001234");

    expect(intakeReducer(state, { type: "reset" })).toEqual(initialIntakeState);
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

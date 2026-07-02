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

  it("gates review on both an issue and a device", () => {
    let state: IntakeState = {
      ...initialIntakeState,
      phase: "triage",
      issueCaptured: true
    };
    expect(canReview(state)).toBe(false);
    state = intakeReducer(state, { type: "selectDevice", assetId: "02i1" });
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
});

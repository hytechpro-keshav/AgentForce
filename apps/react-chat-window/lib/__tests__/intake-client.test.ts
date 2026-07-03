import { describe, expect, it } from "vitest";

import { deviceGreeting, shouldShowDevicePicker, buildCaseCreatePayload, canSubmitCase } from "@/lib/intake-client";
import type { IntakeState } from "@/lib/intake-flow";
import type { IntakeContext } from "@/lib/intake-flow";

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
  it("shows the picker only after the issue is captured with multiple devices", () => {
    expect(
      shouldShowDevicePicker({
        issueCaptured: false,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(false);
    expect(
      shouldShowDevicePicker({
        issueCaptured: true,
        context: baseContext,
        selectedAssetId: null
      })
    ).toBe(true);
    expect(
      shouldShowDevicePicker({
        issueCaptured: true,
        context: { ...baseContext, devices: [baseContext.devices[0]!] },
        selectedAssetId: "02i1"
      })
    ).toBe(false);
  });
});

describe("buildCaseCreatePayload", () => {
  const baseState: IntakeState = {
    phase: "confirm",
    email: "",
    session: null,
    context: baseContext,
    messages: [{ role: "user", content: "Screen flickers on startup." }],
    extracted: {
      subject: "Screen flicker",
      description: "Screen flickers on startup.",
      priority: "High"
    },
    issueCaptured: true,
    selectedAssetId: "02i2",
    caseId: null,
    caseNumber: null
  };

  it("always includes assetId and deviceLabel for the selected device", () => {
    const payload = buildCaseCreatePayload(baseState);
    expect(payload.assetId).toBe("02i2");
    expect(payload.deviceLabel).toBe("AeroVolt ProBook 15X");
    expect(payload.issueDescription).toContain("Affected device:");
    expect(payload.subject).toBe("Screen flicker");
    expect(payload.shipTo).toEqual(baseContext.shipTo);
  });
});

describe("canSubmitCase", () => {
  it("requires a selected device when the account has devices on file", () => {
    expect(
      canSubmitCase({
        ...({
          context: baseContext,
          selectedAssetId: null
        } as IntakeState)
      })
    ).toBe(false);
    expect(
      canSubmitCase({
        ...({
          context: baseContext,
          selectedAssetId: "02i1"
        } as IntakeState)
      })
    ).toBe(true);
  });
});

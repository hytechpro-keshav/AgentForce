import type {
  IntakeContext,
  IntakeDevice,
  IntakeSession,
  IntakeState
} from "@/lib/intake-flow";

export interface IntakeClientConfig {
  emailVerificationEnabled: boolean;
  bootstrapAvailable: boolean;
}

export async function fetchIntakeConfig(): Promise<IntakeClientConfig> {
  const res = await fetch("/api/intake/config", { cache: "no-store" });
  if (!res.ok) {
    return { emailVerificationEnabled: true, bootstrapAvailable: false };
  }
  const json = (await res.json()) as Partial<IntakeClientConfig>;
  return {
    emailVerificationEnabled: json.emailVerificationEnabled !== false,
    bootstrapAvailable: json.bootstrapAvailable === true
  };
}

export async function bootstrapIntakeSession(): Promise<IntakeSession> {
  const res = await fetch("/api/intake/session/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof json.message === "string"
        ? json.message
        : "Could not start the intake session."
    );
  }
  const accessToken = String(json.accessToken ?? "");
  if (!accessToken) {
    throw new Error("Bootstrap did not return an access token.");
  }
  return {
    accessToken,
    expiresAt: String(json.expiresAt ?? ""),
    subject: String(json.subject ?? "customer-intake-session")
  };
}

export async function loadIntakeContext(
  accessToken: string
): Promise<IntakeContext> {
  const res = await fetch("/api/intake/context", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    return { devices: [], shipTo: {} };
  }
  const context = (await res.json()) as IntakeContext;
  return {
    displayName: context.displayName,
    accountName: context.accountName,
    contactEmail: context.contactEmail,
    devices: Array.isArray(context.devices) ? context.devices : [],
    shipTo: context.shipTo ?? {},
    billingLocation: context.billingLocation,
    hasMultipleServiceLocations: context.hasMultipleServiceLocations === true
  };
}

/** Short personalized opener — device names are shown in the picker later. */
export function deviceGreeting(context: IntakeContext): string {
  const firstName = context.displayName?.trim().split(/\s+/)[0];
  const accountSuffix = context.accountName ? ` for ${context.accountName}` : "";
  if (firstName) {
    return `Hi ${firstName}, I'm Ably — your AI service guide${accountSuffix}. What issue are you experiencing today?`;
  }
  return `Hi, I'm Ably — your AI service guide${accountSuffix}. What issue are you experiencing today?`;
}

/** Device chips appear only after the issue is understood and multiple devices exist. */
export function shouldShowDevicePicker(state: {
  issueCaptured: boolean;
  context: IntakeContext | null;
  selectedAssetId: string | null;
}): boolean {
  const deviceCount = state.context?.devices.length ?? 0;
  return (
    state.issueCaptured && deviceCount > 1 && state.selectedAssetId === null
  );
}

function selectedDevice(
  state: IntakeState
): IntakeDevice | undefined {
  if (!state.selectedAssetId) {
    return undefined;
  }
  return state.context?.devices.find(
    (device) => device.assetId === state.selectedAssetId
  );
}

/** Build the POST /api/intake/case body from collected intake state. */
export function buildCaseCreatePayload(
  state: IntakeState
): Record<string, string | { city?: string; state?: string; country?: string }> {
  const description =
    state.extracted.description?.trim() ||
    state.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n") ||
    "Laptop issue reported via chat.";

  const device = selectedDevice(state);
  const payload: Record<
    string,
    string | { city?: string; state?: string; country?: string }
  > = {
    issueDescription: device?.label
      ? `${description}\n\nAffected device: ${device.label}`
      : description
  };

  if (state.extracted.subject?.trim()) {
    payload.subject = state.extracted.subject.trim();
  }
  if (state.extracted.priority) {
    payload.priority = state.extracted.priority;
  }
  if (state.selectedAssetId) {
    payload.assetId = state.selectedAssetId;
  }
  if (device?.label) {
    payload.deviceLabel = device.label;
  }
  if (
    state.context?.shipTo &&
    (state.context.shipTo.city ||
      state.context.shipTo.state ||
      state.context.shipTo.country)
  ) {
    payload.shipTo = state.context.shipTo;
  }
  return payload;
}

export function canSubmitCase(state: IntakeState): boolean {
  const deviceCount = state.context?.devices.length ?? 0;
  if (deviceCount === 0) {
    return true;
  }
  return state.selectedAssetId !== null;
}

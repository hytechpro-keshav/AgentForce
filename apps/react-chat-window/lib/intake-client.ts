import type {
  IntakeContext,
  IntakeDevice,
  IntakeExtracted,
  IntakeSession,
  IntakeState,
  IntakeUiDirective
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

/**
 * Device chips are a conversation beat: they appear when the model asks for
 * the device (or declares readiness while one is still missing), and stay
 * until a device is picked.
 */
export function shouldShowDevicePicker(state: {
  devicePickerRequested: boolean;
  readyToSubmit: boolean;
  context: IntakeContext | null;
  selectedAssetId: string | null;
}): boolean {
  const deviceCount = state.context?.devices.length ?? 0;
  return (
    (state.devicePickerRequested || state.readyToSubmit) &&
    deviceCount > 1 &&
    state.selectedAssetId === null
  );
}

/** Hidden transcript note that tells the model a chip was tapped. */
export function deviceSelectionEvent(label: string): string {
  return `[event] Customer selected the affected device in the chat UI: ${label}`;
}

/** Build the POST /api/intake/turn body: transcript + live chat-UI state. */
export function buildTurnRequestBody(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  selectedAssetId: string | null
): {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  uiState?: { selectedAssetId: string };
} {
  return {
    messages,
    ...(selectedAssetId ? { uiState: { selectedAssetId } } : {})
  };
}

export interface IntakeTurnResult {
  reply: string;
  extracted: IntakeExtracted;
  issueCaptured: boolean;
  ui?: IntakeUiDirective;
  readyToSubmit?: boolean;
}

const UI_ACTIONS = new Set([
  "none",
  "showDevicePicker",
  "suggestDevice",
  "showReview"
]);

/** Defensive parse of the turn response; unknown fields degrade to a plain turn. */
export function parseTurnResponse(json: unknown): IntakeTurnResult {
  const body = (json ?? {}) as Record<string, unknown>;
  const extracted = (body.extracted ?? {}) as IntakeExtracted;
  const rawUi = body.ui as { action?: unknown; suggestedAssetId?: unknown };
  const ui: IntakeUiDirective | undefined =
    rawUi && typeof rawUi.action === "string" && UI_ACTIONS.has(rawUi.action)
      ? {
          action: rawUi.action as IntakeUiDirective["action"],
          ...(typeof rawUi.suggestedAssetId === "string"
            ? { suggestedAssetId: rawUi.suggestedAssetId }
            : {})
        }
      : undefined;
  return {
    reply:
      typeof body.reply === "string" && body.reply
        ? body.reply
        : "Could you tell me a bit more about the issue?",
    extracted,
    issueCaptured: body.issueCaptured === true,
    ui,
    ...(typeof body.readyToSubmit === "boolean"
      ? { readyToSubmit: body.readyToSubmit }
      : {})
  };
}

/** Typed user messages only — UI-injected and hidden [event] notes excluded. */
export function transcriptFallbackDescription(state: IntakeState): string {
  return state.messages
    .filter(
      (message) =>
        message.role === "user" && !message.uiOnly && !message.hidden
    )
    .map((message) => message.content)
    .join("\n");
}

/**
 * The case description body shown in the review card and sent on submit.
 * A customer edit wins; otherwise use the full typed transcript, which is
 * always complete and in the customer's own words. The model's
 * extracted.description is NOT used here — the model populates it
 * inconsistently across turns, so trusting it drops detail the customer gave.
 */
export function resolveCaseDescription(state: IntakeState): string {
  const edited = state.descriptionOverride?.trim();
  if (edited) {
    return edited;
  }
  return transcriptFallbackDescription(state) || "Laptop issue reported via chat.";
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
  const description = resolveCaseDescription(state);

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

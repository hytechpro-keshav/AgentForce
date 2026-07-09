import type {
  IntakeContext,
  IntakeDevice,
  IntakeExtracted,
  IntakeOpenCase,
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
    hasMultipleServiceLocations: context.hasMultipleServiceLocations === true,
    openCases: Array.isArray(context.openCases) ? context.openCases : []
  };
}

/** Live open cases plus the server's plain-English AI digest of them. */
export interface IntakeCasesStatus {
  cases: IntakeOpenCase[];
  summary?: string;
}

/** Live open-case status for the status bubble; degrades to an empty list. */
export async function fetchOpenCases(
  accessToken: string
): Promise<IntakeCasesStatus> {
  try {
    const res = await fetch("/api/intake/cases", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store"
    });
    if (!res.ok) {
      return { cases: [] };
    }
    const json = (await res.json()) as {
      cases?: IntakeOpenCase[];
      summary?: string;
    };
    const cases = Array.isArray(json.cases)
      ? json.cases.filter((openCase) => Boolean(openCase?.caseNumber))
      : [];
    const summary =
      typeof json.summary === "string" && json.summary.trim()
        ? json.summary.trim()
        : undefined;
    return summary ? { cases, summary } : { cases };
  } catch {
    return { cases: [] };
  }
}

/** Above this count the device picker shows a search box. */
export const DEVICE_PICKER_SEARCH_THRESHOLD = 6;

/** Short personalized opener — device names are shown in the picker later. */
export function deviceGreeting(context: IntakeContext): string {
  const firstName = context.displayName?.trim().split(/\s+/)[0];
  const accountSuffix = context.accountName
    ? ` for ${context.accountName}`
    : "";
  const deviceCount = context.devices.length;
  const deviceHint =
    deviceCount === 1
      ? " I can see 1 registered device on your account."
      : deviceCount > 1
        ? ` I can see ${deviceCount} registered devices on your account.`
        : "";
  const openCaseCount = context.openCases?.length ?? 0;
  const openCaseHint =
    openCaseCount === 1
      ? " You also have 1 open case — ask me for a status update anytime."
      : openCaseCount > 1
        ? ` You also have ${openCaseCount} open cases — ask me for a status update anytime.`
        : "";
  if (firstName) {
    return `Hi ${firstName}, I'm Ably — your AI service guide${accountSuffix}.${deviceHint}${openCaseHint} What issue are you experiencing today?`;
  }
  return `Hi, I'm Ably — your AI service guide${accountSuffix}.${deviceHint}${openCaseHint} What issue are you experiencing today?`;
}

/** Filter device chips by label when the account has many assets. */
export function filterDevicesByQuery(
  devices: IntakeDevice[],
  query: string
): IntakeDevice[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return devices;
  }
  return devices.filter((device) =>
    device.label.toLowerCase().includes(needle)
  );
}

/**
 * Device chips are a conversation beat: they appear when the model asks for
 * the device and stay until a device is picked.
 */
export function shouldShowDevicePicker(state: {
  devicePickerRequested: boolean;
  context: IntakeContext | null;
  selectedAssetId: string | null;
}): boolean {
  const deviceCount = state.context?.devices.length ?? 0;
  return (
    state.devicePickerRequested &&
    deviceCount > 1 &&
    state.selectedAssetId === null
  );
}

/** Hidden transcript note that tells the model a chip was tapped. */
export function deviceSelectionEvent(label: string): string {
  return `[event] Customer selected the affected device in the chat UI: ${label}`;
}

/** Hidden transcript note that tells the model the case now exists. */
export function caseCreatedEvent(caseNumber: string | undefined): string {
  return `[event] Case created${caseNumber ? `: #${caseNumber}` : ""}. The chat UI has already shown the case number and next steps to the customer.`;
}

/** Hidden transcript note after the live status bubble has been shown. */
export function caseStatusEvent(cases: IntakeOpenCase[]): string {
  if (cases.length === 0) {
    return "[event] The chat UI checked live case status: no open cases were found for this customer. Offer to register a new case if something needs attention.";
  }
  const summary = cases
    .map(
      (openCase) =>
        `#${openCase.caseNumber} (${openCase.status ?? "status unknown"})`
    )
    .join(", ");
  return `[event] The chat UI showed the customer live status for their open cases: ${summary}. Do not restate these details; continue the conversation.`;
}

/** Customer-friendly phrasing for common Salesforce Case statuses. */
const STATUS_HINTS: Record<string, string> = {
  New: "received — awaiting review",
  Working: "in progress — our team is on it",
  "In Progress": "in progress — our team is on it",
  Escalated: "escalated to a senior specialist",
  "On Hold": "on hold"
};

function formatOpenedDate(createdDate: string | undefined): string {
  if (!createdDate) {
    return "";
  }
  const parsed = new Date(createdDate);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

/**
 * In-chat status bubble for the customer's open cases. Preferred shape: the
 * server's plain-English AI digest (generated from ONLY the live case data)
 * plus a compact case-number reference line. Fallback when no summary came
 * back: the deterministic per-case list, so status never breaks and is never
 * invented.
 */
export function caseStatusAnnouncement(
  cases: IntakeOpenCase[],
  summary?: string
): string {
  if (cases.length === 0) {
    return "I couldn't find any open cases on your account. If something needs attention, describe the issue and I'll help you register a new case.";
  }
  if (summary?.trim()) {
    const caseNumbers = cases
      .map((openCase) => `#${openCase.caseNumber}`)
      .join(", ");
    return [
      summary.trim(),
      `Your open cases: ${caseNumbers}`,
      "Is there anything else I can help you with?"
    ].join("\n\n");
  }
  const blocks = cases.map((openCase) => {
    const title = openCase.subject
      ? `📋 Case #${openCase.caseNumber} — ${openCase.subject}`
      : `📋 Case #${openCase.caseNumber}`;
    const status = openCase.status
      ? `Status: ${openCase.status}${
          STATUS_HINTS[openCase.status]
            ? ` (${STATUS_HINTS[openCase.status]})`
            : ""
        }`
      : "Status: unavailable";
    const opened = formatOpenedDate(openCase.createdDate);
    const facts = [
      status,
      openCase.priority ? `Priority: ${openCase.priority}` : "",
      opened ? `Opened: ${opened}` : ""
    ]
      .filter(Boolean)
      .join(" · ");
    // Latest orchestrator agent narrative — shown without the internal
    // "Agent N – Team:" prefix, which means nothing to a customer.
    const updated = formatOpenedDate(openCase.latestUpdate?.createdDate);
    const update = openCase.latestUpdate
      ? `\nUpdate${updated ? ` (${updated})` : ""}: ${openCase.latestUpdate.body.replace(/^Agent [1-5] [–-] [^:]+: /, "")}`
      : "";
    return `${title}\n${facts}${update}`;
  });
  const intro =
    cases.length === 1
      ? "Here's the latest on your open case:"
      : "Here's the latest on your open cases:";
  return [intro, ...blocks, "Is there anything else I can help you with?"].join(
    "\n\n"
  );
}

/**
 * Deterministic in-chat confirmation shown right after the case is created —
 * the case number must never depend on model output, so the UI composes this
 * message itself and the conversation then continues ("anything else?").
 */
export function caseCreatedAnnouncement(details: {
  caseNumber?: string;
  subject?: string;
  deviceLabel?: string;
  priority?: string;
  email?: string;
  /** Customer-provided service address, shown when it differs from the on-file one. */
  serviceAddress?: string;
}): string {
  const lines = [
    details.caseNumber
      ? `✅ All done — I've created case #${details.caseNumber} for you.`
      : "✅ All done — I've created your case."
  ];
  const facts = [
    details.subject ? `Issue: ${details.subject}` : "",
    details.deviceLabel ? `Device: ${details.deviceLabel}` : "",
    details.priority ? `Priority: ${details.priority}` : "",
    details.serviceAddress ? `Service at: ${details.serviceAddress}` : ""
  ].filter(Boolean);
  if (facts.length > 0) {
    lines.push(facts.join("\n"));
  }
  lines.push(
    `Our service team will review it and follow up${details.email ? ` at ${details.email}` : ""} shortly — you'll receive updates every step of the way.`,
    "Is there anything else I can help you with?"
  );
  return lines.join("\n\n");
}

/** Build the POST /api/intake/turn body: transcript + live chat-UI state. */
export function buildTurnRequestBody(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  selectedAssetId: string | null,
  troubleshootingCount = 0
): {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  uiState?: { selectedAssetId?: string; troubleshootingCount?: number };
} {
  // Fields are only sent when set so older servers (strict DTO whitelists)
  // never see keys they don't know; a non-zero count implies a new server.
  const uiState: { selectedAssetId?: string; troubleshootingCount?: number } = {
    ...(selectedAssetId ? { selectedAssetId } : {}),
    ...(troubleshootingCount > 0 ? { troubleshootingCount } : {})
  };
  return {
    messages,
    ...(Object.keys(uiState).length > 0 ? { uiState } : {})
  };
}

export interface IntakeTurnResult {
  reply: string;
  extracted: IntakeExtracted;
  issueCaptured: boolean;
  ui?: IntakeUiDirective;
  readyToSubmit?: boolean;
  offeredSuggestion?: boolean;
}

const UI_ACTIONS = new Set([
  "none",
  "showDevicePicker",
  "suggestDevice",
  "showReview",
  "createCase",
  "showTicketStatus"
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
      : {}),
    offeredSuggestion: body.offeredSuggestion === true
  };
}

/** Typed user messages only — UI-injected and hidden [event] notes excluded. */
export function transcriptFallbackDescription(state: IntakeState): string {
  return state.messages
    .filter(
      (message) => message.role === "user" && !message.uiOnly && !message.hidden
    )
    .map((message) => message.content)
    .join("\n");
}

/**
 * The case description sent to Salesforce: the model's consolidated
 * understanding of the issue (symptom, when it started, what the customer
 * already tried) — NOT the raw chat transcript, which reads as noise to the
 * service team. Per-turn extraction gaps are absorbed by the reducer, which
 * accumulates the latest non-empty value; the typed transcript remains only
 * as the safety net for a conversation where extraction never succeeded.
 */
export function resolveCaseDescription(state: IntakeState): string {
  const understood = state.extracted.description?.trim();
  if (understood) {
    return understood;
  }
  return transcriptFallbackDescription(state) || "Issue reported via chat.";
}

function selectedDevice(state: IntakeState): IntakeDevice | undefined {
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
): Record<
  string,
  string | { city?: string; state?: string; country?: string }
> {
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
  // Customer-provided overrides captured in chat (server re-validates all).
  if (state.extracted.serviceAddress?.trim()) {
    payload.serviceAddress = state.extracted.serviceAddress.trim();
  }
  if (state.extracted.contactEmail?.trim()) {
    payload.contactEmail = state.extracted.contactEmail.trim();
  }
  if (state.extracted.contactPhone?.trim()) {
    payload.contactPhone = state.extracted.contactPhone.trim();
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

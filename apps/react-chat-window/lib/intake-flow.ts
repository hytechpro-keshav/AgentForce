/**
 * Client-side state machine for the guided OTP intake flow.
 *
 *   email → otp → triage (chat: clarify → in-chat summary → confirm → case
 *   created → "anything else?" — the conversation never leaves triage)
 *
 * Verified identity lives in the JWT minted at OTP verify (no account data is
 * held here); the transcript and the picked device live in this state and are
 * sent to the backend to create the Case. There is no review/submit screen:
 * the model summarizes in chat, the customer confirms in chat, and the model's
 * createCase directive triggers the case create. The reducer is pure so it can
 * be unit-tested without React.
 */
export type IntakePhase = "bootstrapping" | "email" | "otp" | "triage";

export interface IntakeSession {
  accessToken: string;
  expiresAt: string;
  subject: string;
}

export interface IntakeDevice {
  assetId: string;
  label: string;
  product?: string;
}

export interface IntakeLocation {
  city?: string;
  state?: string;
  country?: string;
}

/** Latest orchestrator agent update posted on a case (agent narratives only). */
export interface IntakeCaseUpdate {
  body: string;
  createdDate?: string;
}

/** Open-case summary carried in context (count/greeting only; the status
 * bubble always re-fetches live data via GET /api/intake/cases). */
export interface IntakeOpenCaseSummary {
  caseNumber: string;
  subject?: string;
  status?: string;
  latestUpdate?: IntakeCaseUpdate;
}

/** Live open-case row rendered in the deterministic status bubble. */
export interface IntakeOpenCase {
  caseNumber: string;
  subject?: string;
  status?: string;
  priority?: string;
  createdDate?: string;
  latestUpdate?: IntakeCaseUpdate;
}

export interface IntakeContext {
  displayName?: string;
  accountName?: string;
  contactEmail?: string;
  devices: IntakeDevice[];
  shipTo: IntakeLocation;
  billingLocation?: IntakeLocation;
  hasMultipleServiceLocations?: boolean;
  openCases?: IntakeOpenCaseSummary[];
}

export interface IntakeMessage {
  role: "user" | "assistant";
  content: string;
  /** True for UI-injected messages (e.g. device greeting) that must NOT be sent to the LLM. */
  uiOnly?: boolean;
  /** True for chat-UI event notes (e.g. device selection) sent to the LLM but never rendered. */
  hidden?: boolean;
}

export interface IntakeExtracted {
  subject?: string;
  description?: string;
  priority?: "Low" | "Medium" | "High";
  /** Customer-provided service address when different from the on-file ship-to. */
  serviceAddress?: string;
  /** Customer-provided email for updates when different from the on-file contact email. */
  contactEmail?: string;
  /** Customer-provided phone number for this case. */
  contactPhone?: string;
}

export type IntakeUiAction =
  | "none"
  | "showDevicePicker"
  | "suggestDevice"
  /** Deprecated review-card cue from older servers; treated as "none". */
  | "showReview"
  /** Customer confirmed in chat — create the Case now. */
  | "createCase"
  /** Customer asked about an existing ticket — show live case status. */
  | "showTicketStatus";

/** Widget cue returned by the model for a turn (validated server-side). */
export interface IntakeUiDirective {
  action: IntakeUiAction;
  suggestedAssetId?: string;
}

export interface IntakeState {
  phase: IntakePhase;
  email: string;
  session: IntakeSession | null;
  context: IntakeContext | null;
  messages: IntakeMessage[];
  extracted: IntakeExtracted;
  issueCaptured: boolean;
  /** Model's judgment that nothing is missing (informational — no CTA). */
  readyToSubmit: boolean;
  /** Sticky until a device is picked: the model has asked for the device. */
  devicePickerRequested: boolean;
  /** Device the model believes the customer named; highlighted in the picker. */
  suggestedAssetId: string | null;
  selectedAssetId: string | null;
  /** Set by a createCase directive; the component submits and then clears it. */
  createCaseRequested: boolean;
  /** Set by a showTicketStatus directive; the component fetches live status and clears it. */
  ticketStatusRequested: boolean;
  /** Bot-offered troubleshooting suggestions so far (server caps at 2). */
  troubleshootingCount: number;
  caseId: string | null;
  caseNumber: string | null;
}

export const initialIntakeState: IntakeState = {
  phase: "email",
  email: "",
  session: null,
  context: null,
  messages: [],
  extracted: {},
  issueCaptured: false,
  readyToSubmit: false,
  devicePickerRequested: false,
  suggestedAssetId: null,
  selectedAssetId: null,
  createCaseRequested: false,
  ticketStatusRequested: false,
  troubleshootingCount: 0,
  caseId: null,
  caseNumber: null
};

export function createInitialIntakeState(options?: {
  skipEmailVerification?: boolean;
}): IntakeState {
  if (options?.skipEmailVerification) {
    return { ...initialIntakeState, phase: "bootstrapping" };
  }
  return initialIntakeState;
}

export type IntakeAction =
  | { type: "bootstrapFailed" }
  | { type: "startBootstrap" }
  | { type: "otpSent"; email: string }
  | { type: "verified"; session: IntakeSession }
  | { type: "contextLoaded"; context: IntakeContext }
  | { type: "appendMessage"; message: IntakeMessage }
  | {
      type: "turnResult";
      reply: string;
      extracted: IntakeExtracted;
      issueCaptured: boolean;
      ui?: IntakeUiDirective;
      readyToSubmit?: boolean;
      offeredSuggestion?: boolean;
    }
  | { type: "selectDevice"; assetId: string }
  | { type: "clearDevice" }
  | { type: "createCaseHandled" }
  | { type: "ticketStatusHandled" }
  | { type: "caseCreated"; caseId: string; caseNumber?: string }
  | { type: "reset"; skipEmailVerification?: boolean };

function autoSelectedAssetId(context: IntakeContext | null): string | null {
  return context && context.devices.length === 1
    ? (context.devices[0]?.assetId ?? null)
    : null;
}

export function intakeReducer(
  state: IntakeState,
  action: IntakeAction
): IntakeState {
  switch (action.type) {
    case "bootstrapFailed":
      return { ...state, phase: "email" };
    case "startBootstrap":
      return { ...state, phase: "bootstrapping" };
    case "otpSent":
      return { ...state, phase: "otp", email: action.email };
    case "verified":
      return { ...state, phase: "triage", session: action.session };
    case "contextLoaded":
      return {
        ...state,
        context: action.context,
        selectedAssetId:
          autoSelectedAssetId(action.context) ?? state.selectedAssetId
      };
    case "appendMessage":
      return { ...state, messages: [...state.messages, action.message] };
    case "turnResult": {
      const uiAction = action.ui?.action;
      // Replace, never retain: a suggestion is only as fresh as the latest
      // turn — carrying an old one forward can leave a "tap to confirm" chip
      // pointing at a device the customer has since corrected away from.
      const suggestedAssetId =
        uiAction === "suggestDevice" &&
        action.ui?.suggestedAssetId &&
        state.context?.devices.some(
          (device) => device.assetId === action.ui?.suggestedAssetId
        )
          ? action.ui.suggestedAssetId
          : null;
      const deviceCount = state.context?.devices.length ?? 0;
      // The server already downgrades a device-less createCase; the client
      // guard keeps a stale/older server from ever auto-creating one.
      const createCaseRequested =
        uiAction === "createCase" &&
        (deviceCount === 0 || state.selectedAssetId !== null);
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "assistant", content: action.reply }
        ],
        ticketStatusRequested:
          state.ticketStatusRequested || uiAction === "showTicketStatus",
        troubleshootingCount:
          state.troubleshootingCount + (action.offeredSuggestion ? 1 : 0),
        // Extracted fields only ever accumulate the latest non-empty values.
        extracted: {
          subject: action.extracted.subject ?? state.extracted.subject,
          description:
            action.extracted.description ?? state.extracted.description,
          priority: action.extracted.priority ?? state.extracted.priority,
          serviceAddress:
            action.extracted.serviceAddress ?? state.extracted.serviceAddress,
          contactEmail:
            action.extracted.contactEmail ?? state.extracted.contactEmail,
          contactPhone:
            action.extracted.contactPhone ?? state.extracted.contactPhone
        },
        issueCaptured: state.issueCaptured || action.issueCaptured,
        readyToSubmit: action.readyToSubmit ?? state.readyToSubmit,
        devicePickerRequested:
          state.devicePickerRequested ||
          uiAction === "showDevicePicker" ||
          uiAction === "suggestDevice",
        suggestedAssetId,
        createCaseRequested: state.createCaseRequested || createCaseRequested
      };
    }
    case "selectDevice":
      return {
        ...state,
        selectedAssetId: action.assetId,
        suggestedAssetId: null,
        devicePickerRequested: false
      };
    case "clearDevice":
      // The customer explicitly wants to change: reopen the picker.
      return {
        ...state,
        selectedAssetId: null,
        devicePickerRequested: true
      };
    case "createCaseHandled":
      return { ...state, createCaseRequested: false };
    case "ticketStatusHandled":
      return { ...state, ticketStatusRequested: false };
    case "caseCreated":
      // The conversation continues after a create ("anything else?"), so the
      // per-case fields reset while the transcript, session, and context stay.
      return {
        ...state,
        phase: "triage",
        extracted: {},
        issueCaptured: false,
        readyToSubmit: false,
        devicePickerRequested: false,
        suggestedAssetId: null,
        selectedAssetId: autoSelectedAssetId(state.context),
        createCaseRequested: false,
        // A fresh issue gets a fresh troubleshooting budget.
        troubleshootingCount: 0,
        caseId: action.caseId,
        caseNumber: action.caseNumber ?? null
      };
    case "reset":
      return createInitialIntakeState({
        skipEmailVerification: action.skipEmailVerification
      });
    default:
      return state;
  }
}

/**
 * Client-side state machine for the guided OTP intake flow.
 *
 *   email → otp → triage → confirm → done
 *
 * Verified identity lives in the JWT minted at OTP verify (no account data is
 * held here); the transcript and the picked device live in this state and are
 * sent to the backend to create the Case. The reducer is pure so it can be
 * unit-tested without React.
 */
export type IntakePhase =
  | "bootstrapping"
  | "email"
  | "otp"
  | "triage"
  | "confirm"
  | "done";

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

export interface IntakeContext {
  displayName?: string;
  accountName?: string;
  contactEmail?: string;
  devices: IntakeDevice[];
  shipTo: IntakeLocation;
  billingLocation?: IntakeLocation;
  hasMultipleServiceLocations?: boolean;
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
}

export type IntakeUiAction =
  | "none"
  | "showDevicePicker"
  | "suggestDevice"
  | "showReview";

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
  /**
   * Customer's edit of the case description in the review card. When set it
   * takes precedence over the transcript-derived description; the model's
   * extracted.description is only a signal and is never trusted for the case
   * body (the model populates it inconsistently across turns).
   */
  descriptionOverride: string | null;
  /** Model's current judgment that the case is ready for review & submit. */
  readyToSubmit: boolean;
  /** Sticky until a device is picked: the model has asked for the device. */
  devicePickerRequested: boolean;
  /** Device the model believes the customer named; highlighted in the picker. */
  suggestedAssetId: string | null;
  selectedAssetId: string | null;
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
  descriptionOverride: null,
  readyToSubmit: false,
  devicePickerRequested: false,
  suggestedAssetId: null,
  selectedAssetId: null,
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
    }
  | { type: "selectDevice"; assetId: string }
  | { type: "clearDevice" }
  | { type: "editDescription"; description: string }
  | { type: "toConfirm" }
  | { type: "backToTriage" }
  | { type: "caseCreated"; caseId: string; caseNumber?: string }
  | { type: "reset"; skipEmailVerification?: boolean };

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
    case "contextLoaded": {
      const autoSelectedAssetId =
        action.context.devices.length === 1
          ? action.context.devices[0]?.assetId ?? null
          : state.selectedAssetId;
      return {
        ...state,
        context: action.context,
        selectedAssetId: autoSelectedAssetId
      };
    }
    case "appendMessage":
      return { ...state, messages: [...state.messages, action.message] };
    case "turnResult": {
      const uiAction = action.ui?.action;
      const suggestedAssetId =
        uiAction === "suggestDevice" &&
        action.ui?.suggestedAssetId &&
        state.context?.devices.some(
          (device) => device.assetId === action.ui?.suggestedAssetId
        )
          ? action.ui.suggestedAssetId
          : state.suggestedAssetId;
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "assistant", content: action.reply }
        ],
        // Extracted fields only ever accumulate the latest non-empty values.
        extracted: {
          subject: action.extracted.subject ?? state.extracted.subject,
          description:
            action.extracted.description ?? state.extracted.description,
          priority: action.extracted.priority ?? state.extracted.priority
        },
        issueCaptured: state.issueCaptured || action.issueCaptured,
        // Latest model judgment wins: the CTA reflects the current turn.
        readyToSubmit: action.readyToSubmit ?? state.readyToSubmit,
        devicePickerRequested:
          state.devicePickerRequested ||
          uiAction === "showDevicePicker" ||
          uiAction === "suggestDevice",
        suggestedAssetId
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
    case "editDescription":
      return { ...state, descriptionOverride: action.description };
    case "toConfirm":
      return { ...state, phase: "confirm" };
    case "backToTriage":
      return { ...state, phase: "triage" };
    case "caseCreated":
      return {
        ...state,
        phase: "done",
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

/**
 * The customer may move to review once the model declares readiness AND a
 * device is picked (when the account has devices on file).
 */
export function canReview(state: IntakeState): boolean {
  const deviceCount = state.context?.devices.length ?? 0;
  if (!state.readyToSubmit) {
    return false;
  }
  return deviceCount === 0 || state.selectedAssetId !== null;
}

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
export type IntakePhase = "email" | "otp" | "triage" | "confirm" | "done";

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

export interface IntakeContext {
  displayName?: string;
  accountName?: string;
  devices: IntakeDevice[];
  shipTo: { city?: string; state?: string; country?: string };
}

export interface IntakeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface IntakeExtracted {
  subject?: string;
  description?: string;
  priority?: "Low" | "Medium" | "High";
}

export interface IntakeState {
  phase: IntakePhase;
  email: string;
  session: IntakeSession | null;
  context: IntakeContext | null;
  messages: IntakeMessage[];
  extracted: IntakeExtracted;
  issueCaptured: boolean;
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
  selectedAssetId: null,
  caseId: null,
  caseNumber: null
};

export type IntakeAction =
  | { type: "otpSent"; email: string }
  | { type: "verified"; session: IntakeSession }
  | { type: "contextLoaded"; context: IntakeContext }
  | { type: "appendMessage"; message: IntakeMessage }
  | {
      type: "turnResult";
      reply: string;
      extracted: IntakeExtracted;
      issueCaptured: boolean;
    }
  | { type: "selectDevice"; assetId: string }
  | { type: "toConfirm" }
  | { type: "backToTriage" }
  | { type: "caseCreated"; caseId: string; caseNumber?: string }
  | { type: "reset" };

export function intakeReducer(
  state: IntakeState,
  action: IntakeAction
): IntakeState {
  switch (action.type) {
    case "otpSent":
      return { ...state, phase: "otp", email: action.email };
    case "verified":
      return { ...state, phase: "triage", session: action.session };
    case "contextLoaded":
      return { ...state, context: action.context };
    case "appendMessage":
      return { ...state, messages: [...state.messages, action.message] };
    case "turnResult":
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
        issueCaptured: state.issueCaptured || action.issueCaptured
      };
    case "selectDevice":
      return { ...state, selectedAssetId: action.assetId };
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
      return initialIntakeState;
    default:
      return state;
  }
}

/** The customer may move to review once they've described the issue AND picked a device. */
export function canReview(state: IntakeState): boolean {
  return state.issueCaptured && state.selectedAssetId !== null;
}

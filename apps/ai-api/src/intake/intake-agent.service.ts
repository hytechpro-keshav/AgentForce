import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type {
  LlmChatRequest,
  LlmMessage
} from "../llm/interfaces/llm-contracts";
import { ModelRouter } from "../llm/model-router";
import type {
  IntakeContextResponseDto,
  IntakeDeviceDto
} from "./dto/intake-context.dto";
import type {
  IntakeTurnExtractedDto,
  IntakeTurnRequestDto,
  IntakeTurnResponseDto,
  IntakeTurnUiAction,
  IntakeTurnUiDirectiveDto
} from "./dto/intake-turn.dto";
import { requireIntakeIdentity, type IntakeIdentity } from "./intake-claims";
import { IntakeService } from "./intake.service";

const PRIORITIES = new Set(["Low", "Medium", "High"]);
const UI_ACTIONS = new Set<IntakeTurnUiAction>([
  "none",
  "showDevicePicker",
  "suggestDevice",
  "showReview"
]);
const MIN_DESCRIPTION_LENGTH = 10;
/** Anti-trap fallback: readiness the model can't withhold forever. */
const FALLBACK_MIN_USER_TURNS = 2;
const FALLBACK_MIN_USER_WORDS = 25;
/** Devices/context rarely change mid-conversation; skip a Salesforce round-trip per turn. */
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const CONTEXT_CACHE_MAX_ENTRIES = 200;

function formatLocation(location: {
  city?: string;
  state?: string;
  country?: string;
}): string {
  return [location.city, location.state, location.country]
    .filter((part) => Boolean(part?.trim()))
    .join(", ");
}

function buildIntakeSystemPrompt(
  context: IntakeContextResponseDto,
  selectedDevice: IntakeDeviceDto | undefined
): string {
  const deviceCount = context.devices.length;
  const deviceList = context.devices
    .map((device, index) => `${index + 1}) ${device.label}`)
    .join("; ");
  const defaultShipTo = formatLocation(context.shipTo);
  const billingLine = context.billingLocation
    ? formatLocation(context.billingLocation)
    : "";

  const lines = [
    "You are Ably, a friendly customer service intake assistant.",
    `The customer is verified as ${context.displayName ?? "the account holder"}` +
      (context.accountName ? ` at ${context.accountName}.` : "."),
    context.contactEmail
      ? `Contact email on file: ${context.contactEmail}.`
      : "Contact email is on file for this account.",
    defaultShipTo
      ? `Default service / ship-to address on file: ${defaultShipTo}.`
      : "No default service address is on file.",
    context.hasMultipleServiceLocations && billingLine
      ? `This account has multiple service locations. Alternate billing address on file: ${billingLine}. Confirm where on-site service should occur if it may differ from the default ship-to.`
      : "",
    deviceCount === 0
      ? "No registered devices are on this account."
      : deviceCount === 1
        ? `One registered device on file: ${deviceList}.`
        : `${deviceCount} registered devices on file: ${deviceList}.`,
    selectedDevice
      ? `The customer has already picked the affected device in the chat UI: ${selectedDevice.label}. NEVER ask which device is affected.`
      : "No device has been picked in the chat UI yet.",
    "",
    "Conversation flow:",
    "1. Understand the issue: symptom, when it started, and what they already tried.",
    '2. Ask ONE question per turn and one question only. Your entire "reply" must contain AT MOST ONE question mark ("?"). Never put two questions in a single message — not joined with "and" and not as two separate sentences. If several things are missing, ask the single most important one now and save the rest for later turns.',
    "3. NEVER re-ask anything the customer already answered or anything stated above.",
    "4. Do NOT list every device name in your opening message.",
    "5. Do NOT ask for account name, serial numbers, or email — those are already known.",
    selectedDevice
      ? ""
      : deviceCount > 1
        ? '6. Once the issue is clear, ask which registered device is affected and set ui.action to "showDevicePicker" — or "suggestDevice" with suggestedDeviceIndex when their words clearly identify one device from the list.'
        : deviceCount === 1
          ? "6. Once the issue is clear, confirm the problem is on the registered device and verify the service location and contact details are correct."
          : "6. Once the issue is clear, tell them they can review and submit even without a device on file.",
    context.hasMultipleServiceLocations
      ? "7. Because this account has multiple locations, ask whether service should use the default ship-to address or a different site before they submit."
      : "",
    "8. Messages starting with [event] are chat-UI events (for example the customer picking a device from the picker), not typed text — acknowledge them naturally and continue with the next missing detail.",
    '9. When the symptom, timing, and troubleshooting steps are captured (and the device is picked when devices exist), summarize the issue back in one sentence, tell them to review and submit, and set readyToSubmit to true with ui.action "showReview".',
    "",
    "On EVERY turn, after reading the customer's latest message, re-read the whole conversation and fill subject, description, and priority from everything said so far. These three fields are REQUIRED on every response and must never be empty or omitted once the customer has described anything — update them as new detail arrives; do not wait until the end.",
    "",
    "Return ONLY a JSON object (no prose, no markdown) with ALL of these keys:",
    '  "subject": a short case title (<=120 chars) summarizing the issue so far,',
    '  "description": the consolidated issue description in the customer\'s words so far (symptom, when it started, what they tried),',
    '  "priority": one of "Low", "Medium", or "High" based only on the described impact,',
    '  "reply": your next message to the customer (<=600 chars),',
    '  "ui": {"action": one of "none" | "showDevicePicker" | "suggestDevice" | "showReview", "suggestedDeviceIndex": 1-based device number, only with "suggestDevice"},',
    '  "readyToSubmit": boolean — true only when nothing is missing.',
    "Do not invent facts; base subject, description, and priority solely on what the customer has said."
  ];

  return lines.filter((line) => line.length > 0).join(" ");
}

interface ParsedTurn {
  reply: string;
  fields: IntakeTurnExtractedDto;
  ui?: { action?: unknown; suggestedDeviceIndex?: unknown };
  readyToSubmit: boolean;
}

/**
 * Drives the conversational triage turn: given the transcript plus the live
 * chat-UI state, the model responds, extracts the structured case fields
 * (subject/description/priority), and cues the UI (device picker / review)
 * in one call, following the repo's prompt+JSON.parse extraction pattern.
 * Parsing is defensive so malformed model output can never break the flow —
 * it degrades to a safe reply, empty extraction, and heuristic readiness.
 */
@Injectable()
export class IntakeAgentService {
  private readonly contextCache = new Map<
    string,
    { context: IntakeContextResponseDto; expiresAt: number }
  >();

  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly intakeService: IntakeService
  ) {}

  async nextTurn(
    principal: AuthPrincipal | undefined,
    dto: IntakeTurnRequestDto
  ): Promise<IntakeTurnResponseDto> {
    const identity = requireIntakeIdentity(principal);
    const context = await this.getCachedContext(identity, principal);

    // The selection is a client hint; only a match against the server-side
    // catalog reaches the prompt, so client text can never be injected.
    const selectedDevice = dto.uiState?.selectedAssetId
      ? context.devices.find(
          (device) => device.assetId === dto.uiState?.selectedAssetId
        )
      : undefined;

    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildIntakeSystemPrompt(context, selectedDevice)
      },
      ...dto.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ];

    const request: LlmChatRequest = {
      requestId: dto.requestId,
      useCase: "customer_chat_intake",
      tenantId: principal?.tenantId,
      clientId: identity.accountId,
      surface: "react-chat-window",
      messages,
      temperature: 0.3
    };

    const response = await this.modelRouter.chat(request);
    const parsed = IntakeAgentService.parseExtraction(response.content);

    const userMessages = dto.messages.filter((m) => m.role === "user");
    const userWordCount = userMessages.reduce(
      (sum, m) => sum + m.content.trim().split(/\s+/).length,
      0
    );

    // The model's judgment is primary; the fallback only guarantees the
    // customer is never trapped without a submit path.
    const readyToSubmit =
      parsed.readyToSubmit ||
      (userMessages.length >= FALLBACK_MIN_USER_TURNS &&
        userWordCount >= FALLBACK_MIN_USER_WORDS);

    return {
      reply:
        parsed.reply ||
        "Thanks — could you tell me a bit more about the issue you're seeing?",
      extracted: parsed.fields,
      issueCaptured:
        Boolean(
          parsed.fields.description &&
            parsed.fields.description.trim().length >= MIN_DESCRIPTION_LENGTH
        ) || userWordCount >= 10,
      ui: IntakeAgentService.resolveUiDirective(
        parsed.ui,
        context,
        selectedDevice,
        readyToSubmit
      ),
      readyToSubmit
    };
  }

  private async getCachedContext(
    identity: IntakeIdentity,
    principal: AuthPrincipal | undefined
  ): Promise<IntakeContextResponseDto> {
    const key = `${identity.accountId}:${identity.contactId}`;
    const cached = this.contextCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.context;
    }
    this.contextCache.delete(key);
    const context = await this.intakeService.getContext(principal);
    if (this.contextCache.size >= CONTEXT_CACHE_MAX_ENTRIES) {
      const oldestKey = this.contextCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.contextCache.delete(oldestKey);
      }
    }
    this.contextCache.set(key, {
      context,
      expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS
    });
    return context;
  }

  /**
   * Validates the model's widget cue and enforces the never-trapped rules:
   * picker cues are moot once a device is picked, an unresolvable suggestion
   * degrades to the picker, and a ready case always cues the widget that
   * unblocks submission.
   */
  private static resolveUiDirective(
    raw: { action?: unknown; suggestedDeviceIndex?: unknown } | undefined,
    context: IntakeContextResponseDto,
    selectedDevice: IntakeDeviceDto | undefined,
    readyToSubmit: boolean
  ): IntakeTurnUiDirectiveDto {
    const deviceCount = context.devices.length;
    let action: IntakeTurnUiAction =
      typeof raw?.action === "string" &&
      UI_ACTIONS.has(raw.action as IntakeTurnUiAction)
        ? (raw.action as IntakeTurnUiAction)
        : "none";
    let suggestedAssetId: string | undefined;

    if (action === "suggestDevice") {
      const index =
        typeof raw?.suggestedDeviceIndex === "number"
          ? Math.trunc(raw.suggestedDeviceIndex)
          : NaN;
      const device = index >= 1 ? context.devices[index - 1] : undefined;
      if (device) {
        suggestedAssetId = device.assetId;
      } else {
        action = "showDevicePicker";
      }
    }

    if (
      selectedDevice &&
      (action === "showDevicePicker" || action === "suggestDevice")
    ) {
      action = "none";
      suggestedAssetId = undefined;
    }

    if (readyToSubmit) {
      if (!selectedDevice && deviceCount > 0) {
        if (action !== "suggestDevice") {
          action = "showDevicePicker";
        }
      } else {
        action = "showReview";
      }
    }

    return suggestedAssetId ? { action, suggestedAssetId } : { action };
  }

  private static parseExtraction(content: string): ParsedTurn {
    const trimmed = (content ?? "").trim();
    if (!trimmed) {
      return { reply: "", fields: {}, readyToSubmit: false };
    }
    try {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      const slice =
        start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
      const parsed = JSON.parse(slice) as Record<string, unknown>;

      const reply =
        typeof parsed["reply"] === "string"
          ? (parsed["reply"] as string).slice(0, 600)
          : "";
      const subject =
        typeof parsed["subject"] === "string"
          ? (parsed["subject"] as string).slice(0, 120)
          : undefined;
      const description =
        typeof parsed["description"] === "string"
          ? (parsed["description"] as string).slice(0, 32000)
          : undefined;
      const priorityRaw =
        typeof parsed["priority"] === "string"
          ? (parsed["priority"] as string)
          : "";
      const priority = PRIORITIES.has(priorityRaw)
        ? (priorityRaw as IntakeTurnExtractedDto["priority"])
        : undefined;
      const ui =
        parsed["ui"] && typeof parsed["ui"] === "object"
          ? (parsed["ui"] as { action?: unknown; suggestedDeviceIndex?: unknown })
          : undefined;

      return {
        reply,
        fields: { subject, description, priority },
        ui,
        readyToSubmit: parsed["readyToSubmit"] === true
      };
    } catch {
      // Non-JSON output: surface the raw text so the user sees the LLM response
      // rather than the generic "tell me more" fallback.
      return { reply: trimmed.slice(0, 600), fields: {}, readyToSubmit: false };
    }
  }
}

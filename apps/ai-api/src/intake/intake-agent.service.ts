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
/** Above this count the UI shows a search box instead of bare chips. */
const DEVICE_PICKER_SEARCH_THRESHOLD = 6;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function isTypedUserMessage(message: {
  role: string;
  content: string;
}): boolean {
  return (
    message.role === "user" &&
    !message.content.trim().toLowerCase().startsWith("[event]")
  );
}

/** Strips contradictory "can't list devices" prose when the UI is showing chips. */
function sanitizeDevicePickerReply(
  reply: string,
  action: IntakeTurnUiAction,
  deviceCount: number
): string {
  if (
    deviceCount <= 1 ||
    (action !== "showDevicePicker" && action !== "suggestDevice")
  ) {
    return reply;
  }
  if (
    !/can'?t list|cannot list|unable to list|not possible to list|too many (devices|items)|don'?t have (access|control)/i.test(
      reply
    )
  ) {
    return reply;
  }
  return deviceCount > DEVICE_PICKER_SEARCH_THRESHOLD
    ? `I've put your ${deviceCount} registered devices below — use the search box to find yours, then tap it to confirm.`
    : "I've listed your registered devices below — tap the one affected by this issue.";
}

/**
 * Deterministic fallback for when the customer TYPES the device name instead
 * of tapping a picker chip (which would otherwise deadlock the flow: the
 * model knows the device conversationally, the UI never gets a selection,
 * and the submit CTA can never appear).
 *
 * Guardrails (each defeats a verified false-positive class):
 * - Scored per message, newest first, so a correction ("actually it's my
 *   ZenBook") beats an earlier mention; ambiguity in the newest mentioning
 *   message yields no match rather than falling back to older turns.
 * - A device qualifies only with ≥2 whole-word token matches INCLUDING at
 *   least one non-numeric token from the product segment of the label (the
 *   part before " - "), so deployment-suffix words ("Corporate", "Home
 *   Office") or digits inside dates ("2026-01-15", "desk 402") never
 *   resolve a device by themselves.
 * - A single-token match qualifies only when the token is unique across the
 *   catalog, non-numeric, ≥4 chars, and from the product segment
 *   ("ProBook" alone is decisive; shared brand tokens are not).
 */
function matchDeviceFromTranscript(
  devices: IntakeDeviceDto[],
  messages: Array<{ role: string; content: string }>
): IntakeDeviceDto | undefined {
  if (devices.length === 0) {
    return undefined;
  }

  const tokenCatalogCount = new Map<string, number>();
  const profiles = devices.map((device) => {
    const tokens = new Set(tokenize(device.label));
    const productTokens = new Set(
      tokenize(device.label.split(" - ")[0] ?? device.label)
    );
    for (const token of tokens) {
      tokenCatalogCount.set(token, (tokenCatalogCount.get(token) ?? 0) + 1);
    }
    return { device, tokens, productTokens };
  });

  const typedMessages = messages.filter(isTypedUserMessage).reverse();
  for (const message of typedMessages) {
    let best:
      | { device: IntakeDeviceDto; score: number }
      | undefined;
    let tied = false;
    for (const profile of profiles) {
      let score = 0;
      let decisive = false;
      let single: string | undefined;
      for (const token of profile.tokens) {
        if (
          new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(message.content)
        ) {
          score += 1;
          single = token;
          if (profile.productTokens.has(token) && !/^\d+$/.test(token)) {
            decisive = true;
          }
        }
      }
      const qualifies =
        (score >= 2 && decisive) ||
        (score === 1 &&
          decisive &&
          single !== undefined &&
          single.length >= 4 &&
          tokenCatalogCount.get(single) === 1);
      if (!qualifies) {
        continue;
      }
      if (!best || score > best.score) {
        best = { device: profile.device, score };
        tied = false;
      } else if (score === best.score) {
        tied = true;
      }
    }
    if (best) {
      // The newest message that names a device decides — ambiguity here
      // means the customer must pick from the full list.
      return tied ? undefined : best.device;
    }
  }
  return undefined;
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
    "4. Do NOT list every device name in your opening message or in free-text replies when the device picker is visible — the chat UI shows tappable device chips (with search when many devices exist) below your message instead.",
    "4b. NEVER say you cannot list devices, that listing is unavailable, or that there are too many to show — when devices exist the UI always shows them as chips below. If the customer asks to see their account items or registered devices, tell them to tap the matching chip below (or use the search box when many devices are on file).",
    "5. Do NOT ask for account name, serial numbers, or email — those are already known.",
    selectedDevice
      ? ""
      : deviceCount > 1
        ? deviceCount > DEVICE_PICKER_SEARCH_THRESHOLD
        ? `6. Once the issue is clear, ask which registered device is affected and set ui.action to "showDevicePicker" — point them to the searchable device list below (they have ${deviceCount} devices on file). Or use "suggestDevice" with suggestedDeviceIndex when their words clearly identify one device. If the customer TYPES a device name instead of tapping the picker, do not treat it as final: set ui.action "suggestDevice" with the matching suggestedDeviceIndex and ask them to tap the highlighted chip to confirm.`
        : '6. Once the issue is clear, ask which registered device is affected and set ui.action to "showDevicePicker" — tell them to tap the matching chip below. Or use "suggestDevice" with suggestedDeviceIndex when their words clearly identify one device from the list. If the customer TYPES a device name instead of tapping the picker, do not treat it as final: set ui.action "suggestDevice" with the matching suggestedDeviceIndex and ask them to tap the highlighted chip to confirm.'
        : deviceCount === 1
          ? "6. Once the issue is clear, confirm the problem is on the registered device and verify the service location and contact details are correct."
          : "6. Once the issue is clear, tell them they can review and submit even without a device on file.",
    context.hasMultipleServiceLocations
      ? "7. Because this account has multiple locations, ask whether service should use the default ship-to address or a different site before they submit."
      : "",
    "8. Messages starting with [event] are chat-UI events (for example the customer picking a device from the picker), not typed text — acknowledge them naturally and continue with the next missing detail.",
    '9. When the symptom, timing, and troubleshooting steps are captured (and the device is picked when devices exist), summarize the issue back in one sentence, tell them to review and submit, and set readyToSubmit to true with ui.action "showReview".',
    '10. You CANNOT create or submit the case from chat — only the customer can, by tapping the "Review & submit case" button in the UI. If they ask you to submit or say "go ahead", do NOT repeat your summary; briefly tell them to tap the device chip to confirm it (when none is picked yet) and then tap Review & submit below.',
    "11. Never repeat your previous message. Every reply must move the conversation forward.",
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

    // Hidden [event] notes (e.g. a chip tap) are not typed issue detail and
    // must not inflate the readiness/issue-capture heuristics.
    const userMessages = dto.messages.filter(isTypedUserMessage);
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

    const ui = IntakeAgentService.resolveUiDirective(
      parsed.ui,
      context,
      selectedDevice,
      readyToSubmit,
      selectedDevice
        ? undefined
        : matchDeviceFromTranscript(context.devices, dto.messages)
    );

    return {
      reply: sanitizeDevicePickerReply(
        parsed.reply ||
          "Thanks — could you tell me a bit more about the issue you're seeing?",
        ui.action,
        context.devices.length
      ),
      extracted: parsed.fields,
      issueCaptured:
        Boolean(
          parsed.fields.description &&
            parsed.fields.description.trim().length >= MIN_DESCRIPTION_LENGTH
        ) || userWordCount >= 10,
      ui,
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
    readyToSubmit: boolean,
    transcriptMatch?: IntakeDeviceDto
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

    // The review card is only ever cued together with readiness.
    if (!readyToSubmit && action === "showReview") {
      action = "none";
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

    // The customer typed the device name instead of tapping a chip: upgrade
    // a plain picker to a one-tap confirm on the deterministic match, so the
    // flow can never deadlock on "review and submit" with no selectable CTA.
    if (action === "showDevicePicker" && transcriptMatch) {
      action = "suggestDevice";
      suggestedAssetId = transcriptMatch.assetId;
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

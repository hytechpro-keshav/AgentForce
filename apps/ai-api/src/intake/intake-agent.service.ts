import { Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import type {
  LlmChatRequest,
  LlmMessage
} from "../llm/interfaces/llm-contracts";
import { ModelRouter } from "../llm/model-router";
import { RagRetrievalService } from "../rag/rag-retrieval.service";
import { resolveTrustedRagContext } from "../rag/trusted-rag-context";
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
import type {
  IntakeCasesResponseDto,
  IntakeOpenCaseDto
} from "./dto/intake-cases.dto";
import { requireIntakeIdentity, type IntakeIdentity } from "./intake-claims";
import { IntakeService } from "./intake.service";

const PRIORITIES = new Set(["Low", "Medium", "High"]);
const UI_ACTIONS = new Set<IntakeTurnUiAction>([
  "none",
  "showDevicePicker",
  "suggestDevice",
  "showReview",
  "createCase",
  "showTicketStatus"
]);

/** Hard cap on bot-offered troubleshooting suggestions per conversation. */
const MAX_TROUBLESHOOTING_SUGGESTIONS = 2;

/**
 * Grounded rewrite of the open-case list into customer language. The input
 * is ONLY the live case JSON, so a wrong fact can't come from anywhere else;
 * internal operator vocabulary is banned explicitly.
 */
const CASE_SUMMARY_PROMPT =
  "You are Ably, a friendly customer support assistant. The JSON below lists the customer's open support cases; entries may include a latestUpdate note written by internal service systems. " +
  "Write a short, plain-English status update for the customer based ONLY on this data. " +
  "Group duplicate or similar cases together instead of listing every one (for example: several cases about the same black-screen issue opened the same week). " +
  "Include case numbers (like #00001209) when referring to cases. " +
  'Translate internal wording into simple customer language: NEVER use terms like "Agent 1", "Triage", "strategic account", "business risk", "customer context", or "guardrail". ' +
  "Relay concrete progress, next steps, appointments, or timing from the updates in simple words; if no timing exists, do not invent any. " +
  "No markdown, no bullet lists, no emoji. At most 120 words. Do not ask the customer any question — the chat UI adds the follow-up question itself.";
const CASE_SUMMARY_MAX_LENGTH = 1200;
/** KB grounding for suggestions: few short snippets, titles + trimmed text. */
const KB_SNIPPET_COUNT = 3;
const KB_SNIPPET_MAX_LENGTH = 400;
const KB_QUERY_MAX_LENGTH = 500;
const KB_QUERY_MIN_LENGTH = 12;

/**
 * Reply text that references the device chips — used to reconcile a model
 * reply that tells the customer to tap a chip while its own directive said
 * "none" (which would render no chips: a guaranteed dead end).
 */
const CHIP_REFERENCE_PATTERN =
  /\bchips?\b|\btap\b.{0,40}\b(below|device|list)\b|\b(device|devices)\b.{0,20}\bbelow\b|listed below/i;

/**
 * Reply text that announces the case is being created right now — used to
 * reconcile a model reply of "Creating your case now…" whose own directive
 * said "none" (observed live: the customer waits on a create that never
 * fires). Requires "now" and no question mark so confirmation questions
 * ("Shall I register this case?") never match.
 */
const CREATE_REFERENCE_PATTERN =
  /\b(creating|submitting|registering)\b.{0,24}\bcase\b.{0,12}\bnow\b/i;

/**
 * Reply text that announces the open-case status is being shown — used to
 * reconcile a reply like "here's the latest on your open cases below" whose
 * own directive said "none" (observed live: the customer is pointed at a
 * status card that never renders).
 */
function referencesStatusCard(reply: string): boolean {
  const caseRef =
    /\b(open (cases?|tickets?)|(case|ticket) status|status (of|on|for) your (cases?|tickets?))\b/i.test(
      reply
    );
  const showRef = /\b(below|pull(ing)? up|here('s| is| it is)|latest)\b/i.test(
    reply
  );
  return caseRef && showRef;
}
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

const EMAIL_PATTERN = /[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}/gi;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{5,18}\d/g;
const PHONE_CONTEXT = /\b(phone|number|call|mobile|cell|reach|contact)\b/i;

/**
 * Deterministic override capture from the customer's latest typed message —
 * the model restates a changed email/phone in its reply but omits the JSON
 * fields often enough that the Case would otherwise keep the on-file values.
 * The model's extraction wins when present; this only fills the gaps.
 */
function sniffContactEmail(
  message: string,
  onFileEmail: string | undefined
): string | undefined {
  const candidates = message.match(EMAIL_PATTERN) ?? [];
  const onFile = onFileEmail?.trim().toLowerCase();
  const overrides = candidates
    .map((candidate) => candidate.replace(/[.,;:!?]+$/, ""))
    .filter(
      (candidate) =>
        EMAIL_SHAPE.test(candidate) &&
        candidate.length <= 254 &&
        candidate.toLowerCase() !== onFile
    );
  return overrides.length > 0 ? overrides[overrides.length - 1] : undefined;
}

function sniffContactPhone(message: string): string | undefined {
  const candidates = message.match(PHONE_CANDIDATE) ?? [];
  for (const raw of candidates) {
    const candidate = raw.trim();
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      continue;
    }
    // ISO dates ("2026-01-15") and bare digit runs (serials, quantities)
    // only qualify with an explicit plus prefix or phone-context wording.
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      continue;
    }
    const separated = /[\s().-]/.test(candidate);
    if (
      candidate.startsWith("+") ||
      (separated && PHONE_CONTEXT.test(message))
    ) {
      return candidate.length <= 40 ? candidate : undefined;
    }
    if (!separated && PHONE_CONTEXT.test(message)) {
      return candidate.length <= 40 ? candidate : undefined;
    }
  }
  return undefined;
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
    let best: { device: IntakeDeviceDto; score: number } | undefined;
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
  selectedDevice: IntakeDeviceDto | undefined,
  troubleshootingCount: number,
  kbGuidance: string[]
): string {
  const deviceCount = context.devices.length;
  const deviceList = context.devices
    .map((device, index) => `${index + 1}) ${device.label}`)
    .join("; ");
  const defaultShipTo = formatLocation(context.shipTo);
  const billingLine = context.billingLocation
    ? formatLocation(context.billingLocation)
    : "";
  const openCases = context.openCases ?? [];
  const openCaseList = openCases
    .map(
      (openCase) =>
        `#${openCase.caseNumber} (${openCase.status ?? "status unknown"}${
          openCase.subject ? ` — ${openCase.subject}` : ""
        }${
          openCase.latestUpdate
            ? `; latest agent update: ${openCase.latestUpdate.body.slice(0, 200)}`
            : ""
        })`
    )
    .join("; ");
  const suggestionsLeft =
    MAX_TROUBLESHOOTING_SUGGESTIONS - troubleshootingCount;

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
    openCases.length === 0
      ? "The customer has NO open support cases on file."
      : `Open support cases already on file for this customer: ${openCaseList}.`,
    "",
    "Conversation flow:",
    "1. Understand the issue: symptom, when it started, and what they already tried.",
    openCases.length > 0
      ? '1b. The customer has open cases on file. When they describe an issue, first ask (as your single question) whether it relates to one of their existing open cases or is something new. If it relates to an existing case — or they ask for a ticket/case status update at any point — set ui.action to "showTicketStatus" with a SHORT reply like "Let me pull up the latest on your open cases — here it is below." The chat UI renders the live status itself. For follow-up questions about a specific case (progress, next steps, scheduling, ETA), answer using ONLY the open-case facts and latest agent updates listed above — relay what they say, and when they contain no answer, say the service team has not posted that detail yet. NEVER state, guess, or invent case status, progress, or arrival estimates beyond those updates.'
      : "1b. If the customer asks about an existing ticket or case status, there are no open cases on file for their account — say exactly that and offer to register a new case instead. Never invent a case or its status.",
    suggestionsLeft > 0
      ? `1c. TROUBLESHOOT BEFORE TICKETING: once the symptom is clear (and the issue is not about an existing case), offer ONE practical troubleshooting step the customer can try right now, then ask — as your single question — whether it resolved the issue. You have offered ${troubleshootingCount} of ${MAX_TROUBLESHOOTING_SUGGESTIONS} suggestions so far; never exceed ${MAX_TROUBLESHOOTING_SUGGESTIONS} in the whole conversation and never repeat one. Set "offeredSuggestion" to true on every reply that proposes a step to try. If the customer says the issue is resolved, be glad, do NOT register a case, and ask if there is anything else. If they decline to troubleshoot, already tried that step, or want a ticket straight away, move on to case registration.`
      : `1c. You have already offered ${MAX_TROUBLESHOOTING_SUGGESTIONS} troubleshooting suggestions — the maximum. Do NOT offer another. Tell the customer you'll get a technician on it and proceed with case registration. Keep "offeredSuggestion" false.`,
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
      ? "7. This account has multiple service locations — pay extra attention to confirming where on-site service should occur."
      : "",
    "8. Messages starting with [event] are chat-UI events (for example the customer picking a device from the picker, or the system confirming a case was created), not typed text — acknowledge them naturally and continue.",
    "9. Case registration is TWO separate confirmation steps — never merge them into one message:",
    '9a. STEP 1 — ISSUE SUMMARY. When the symptom, timing, and troubleshooting steps are captured (and the device is picked when devices exist), send 1-2 short sentences covering the affected device, the symptom, when it started, and what they already tried, ending with exactly one question such as "Shall I go ahead and register this case?". Do NOT mention the service address, email, or phone in this message. Use ui.action "none" and set readyToSubmit to true.',
    `9b. STEP 2 — SERVICE DETAILS. When the customer agrees to register, do NOT create the case yet. In your NEXT message state ${
      defaultShipTo
        ? `the service address you will use (on file: ${defaultShipTo})`
        : "that no service address is on file and ask where service should occur"
    } and ${
      context.contactEmail
        ? `the email updates will go to (on file: ${context.contactEmail})`
        : "the email updates will go to"
    } — or the different address/email/phone the customer already gave — then ask ONE question such as "Should I use these details, or would you like service at a different address or updates to a different email or phone?". Keep this message to two short sentences plus that question.`,
    '10. STEP 3 — CREATE. Only after the customer confirms the SERVICE DETAILS message, set ui.action to "createCase" with a SHORT reply like "Creating your case now…" — never straight after the issue summary, and never before both confirmations. Do not repeat any summary and do not ask anything. If the customer gives a different address, email, or phone at the service-details step, update the fields, restate the service details once, and ask them to confirm again.',
    "10b. If the customer gives a DIFFERENT service address, contact email, or phone number at any point, put it in serviceAddress / contactEmail / contactPhone and acknowledge it — and KEEP returning that value in the same field on every later response until they change it. Leave those three fields as empty strings only when the customer never asked for anything different — never copy the on-file defaults into them and never invent them.",
    "11. You create the case through the createCase action only — never claim the case is already created before a [event] Case created note appears in the conversation.",
    '12. After a "[event] Case created" note, the UI has already told the customer their case number and next steps. From then on, help with whatever they need next; if they describe a NEW issue, run this same intake flow again for a new case, and base subject/description/priority ONLY on messages that came after the latest case-created event.',
    "13. Never repeat your previous message. Every reply must move the conversation forward.",
    "",
    ...(kbGuidance.length > 0
      ? [
          "",
          "KNOWLEDGE BASE GUIDANCE — ground your troubleshooting suggestions on these support articles when they match the customer's device and symptom; ignore entries that do not apply. Never mention the knowledge base or article names to the customer:",
          ...kbGuidance.map((snippet, index) => `[KB ${index + 1}] ${snippet}`)
        ]
      : []),
    "",
    "On EVERY turn, after reading the customer's latest message, re-read the whole conversation and fill subject, description, and priority from everything said so far. These three fields are REQUIRED on every response and must never be empty or omitted once the customer has described anything — update them as new detail arrives; do not wait until the end.",
    'On the turns where you send the issue summary and where you set ui.action "createCase", the description field is CRITICAL: it becomes the case record the service team reads, so it must be the complete, final consolidation — symptom, affected device, when it started, and every troubleshooting step the customer mentioned anywhere in the conversation.',
    "",
    "Return ONLY a JSON object (no prose, no markdown) with ALL of these keys:",
    '  "subject": a short case title (<=120 chars) summarizing the issue so far,',
    '  "description": a clean, professional summary of the issue for the service team, written in YOUR OWN words: the symptom, when it started, what troubleshooting the customer already tried, and any relevant context. NEVER paste the chat transcript or the customer\'s messages verbatim — consolidate them.',
    '  "priority": one of "Low", "Medium", or "High" based only on the described impact,',
    '  "serviceAddress": the DIFFERENT service address the customer asked for, or "" when they are fine with the on-file address,',
    '  "contactEmail": the DIFFERENT email the customer asked updates to go to, or "" when the on-file email is fine,',
    '  "contactPhone": the phone number the customer offered for this case, or "",',
    '  "reply": your next message to the customer (<=600 chars),',
    '  "ui": {"action": one of "none" | "showDevicePicker" | "suggestDevice" | "showTicketStatus" | "createCase", "suggestedDeviceIndex": 1-based device number, only with "suggestDevice"},',
    '  "offeredSuggestion": boolean — true only when this reply proposes a troubleshooting step for the customer to try now,',
    '  "readyToSubmit": boolean — true only when nothing is missing.',
    "Do not invent facts; base subject, description, priority, and the contact/address fields solely on what the customer has said."
  ];

  return lines.filter((line) => line.length > 0).join(" ");
}

interface ParsedTurn {
  reply: string;
  fields: IntakeTurnExtractedDto;
  ui?: { action?: unknown; suggestedDeviceIndex?: unknown };
  readyToSubmit: boolean;
  offeredSuggestion: boolean;
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
  private readonly logger = new Logger(IntakeAgentService.name);
  private readonly contextCache = new Map<
    string,
    { context: IntakeContextResponseDto; expiresAt: number }
  >();

  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly intakeService: IntakeService,
    private readonly ragRetrieval: RagRetrievalService,
    private readonly config: AppConfigService
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

    const troubleshootingCount = Math.max(
      0,
      Math.trunc(dto.uiState?.troubleshootingCount ?? 0)
    );
    // KB grounding is only worth the retrieval latency while suggestions are
    // still allowed; later turns (confirm/create) skip it entirely.
    const kbGuidance =
      troubleshootingCount < MAX_TROUBLESHOOTING_SUGGESTIONS
        ? await this.retrieveTroubleshootingGuidance(dto, principal)
        : [];

    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildIntakeSystemPrompt(
          context,
          selectedDevice,
          troubleshootingCount,
          kbGuidance
        )
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

    // Informational only since the flow became conversational (create is
    // cued by the model's createCase directive, not a CTA): the model's
    // judgment plus a compat fallback for older clients still reading it.
    const readyToSubmit =
      parsed.readyToSubmit ||
      (userMessages.length >= FALLBACK_MIN_USER_TURNS &&
        userWordCount >= FALLBACK_MIN_USER_WORDS);

    const ui = IntakeAgentService.resolveUiDirective(
      parsed.ui,
      context,
      selectedDevice,
      parsed.reply,
      selectedDevice
        ? undefined
        : matchDeviceFromTranscript(context.devices, dto.messages)
    );

    // The model's extraction wins; the deterministic sniff of the latest
    // typed message fills contact overrides the model restated in prose but
    // dropped from the JSON (observed in production).
    const latestTyped = userMessages[userMessages.length - 1]?.content ?? "";
    // The create turn's extraction becomes the Case record, but the model
    // often returns {} on later turns — re-extract from the full transcript
    // so the description the service team reads is never the stale turn-1
    // version missing the clarified timing/troubleshooting details.
    let fields = parsed.fields;
    if (ui.action === "createCase" && !fields.description?.trim()) {
      const finalFields = await this.extractFinalCaseFields(
        dto,
        selectedDevice,
        principal,
        identity.accountId
      );
      fields = {
        ...fields,
        subject: fields.subject ?? finalFields.subject,
        description: finalFields.description ?? fields.description,
        priority: fields.priority ?? finalFields.priority
      };
    }

    const extracted: IntakeTurnExtractedDto = {
      ...fields,
      contactEmail:
        fields.contactEmail ??
        sniffContactEmail(latestTyped, context.contactEmail),
      contactPhone: fields.contactPhone ?? sniffContactPhone(latestTyped)
    };

    return {
      reply: sanitizeDevicePickerReply(
        parsed.reply ||
          "Thanks — could you tell me a bit more about the issue you're seeing?",
        ui.action,
        context.devices.length
      ),
      extracted,
      issueCaptured:
        Boolean(
          fields.description &&
          fields.description.trim().length >= MIN_DESCRIPTION_LENGTH
        ) || userWordCount >= 10,
      ui,
      readyToSubmit,
      // The cap is enforced here, not in the client: once 2 suggestions are
      // spent (or the turn is the create itself), the flag can never count.
      offeredSuggestion:
        parsed.offeredSuggestion &&
        ui.action !== "createCase" &&
        troubleshootingCount < MAX_TROUBLESHOOTING_SUGGESTIONS
    };
  }

  /**
   * Live open cases plus a plain-English AI digest of them. The digest is
   * generated from ONLY the fetched case data (grounded), and any failure
   * degrades to no summary — the client then renders the deterministic list.
   */
  async listOpenCasesWithSummary(
    principal: AuthPrincipal | undefined
  ): Promise<IntakeCasesResponseDto> {
    const identity = requireIntakeIdentity(principal);
    const result = await this.intakeService.listOpenCases(principal);
    const summary = await this.summarizeOpenCases(
      result.cases,
      principal,
      identity
    );
    return summary ? { ...result, summary } : result;
  }

  private async summarizeOpenCases(
    cases: IntakeOpenCaseDto[],
    principal: AuthPrincipal | undefined,
    identity: IntakeIdentity
  ): Promise<string | undefined> {
    if (cases.length === 0) {
      return undefined;
    }
    try {
      const request: LlmChatRequest = {
        useCase: "customer_chat_intake",
        tenantId: principal?.tenantId,
        clientId: identity.accountId,
        surface: "react-chat-window",
        temperature: 0.2,
        messages: [
          { role: "system", content: CASE_SUMMARY_PROMPT },
          { role: "user", content: JSON.stringify(cases) }
        ]
      };
      const response = await this.modelRouter.chat(request);
      const summary = response.content?.trim();
      return summary ? summary.slice(0, CASE_SUMMARY_MAX_LENGTH) : undefined;
    } catch (err) {
      this.logger.warn(
        `Open-case summary degraded (${(err as Error)?.name ?? "unexpected"}); deterministic list shown.`
      );
      return undefined;
    }
  }

  /**
   * Grounds the bot's troubleshooting suggestions on the tenant's support
   * knowledge base. Degrade-not-throw: RAG being disabled, unconfigured, or
   * unreachable yields no guidance and the conversation continues on the
   * model's own knowledge. Only titles + trimmed snippet text reach the
   * prompt; nothing retrieved is ever logged.
   */
  private async retrieveTroubleshootingGuidance(
    dto: IntakeTurnRequestDto,
    principal: AuthPrincipal | undefined
  ): Promise<string[]> {
    if (!this.config.rag.enabled) {
      return [];
    }
    const query = dto.messages
      .filter(isTypedUserMessage)
      .map((message) => message.content.trim())
      .join(" ")
      .slice(-KB_QUERY_MAX_LENGTH)
      .trim();
    if (query.length < KB_QUERY_MIN_LENGTH) {
      return [];
    }
    try {
      const context = resolveTrustedRagContext(
        principal,
        undefined,
        this.config
      );
      const result = await this.ragRetrieval.search(
        { query, topK: KB_SNIPPET_COUNT },
        context
      );
      return result.rawMatches
        .slice(0, KB_SNIPPET_COUNT)
        .map((match) => {
          const text = match.text
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, KB_SNIPPET_MAX_LENGTH);
          const title = match.metadata.title?.trim();
          return title && text ? `${title}: ${text}` : text;
        })
        .filter((snippet) => snippet.length > 0);
    } catch (err) {
      this.logger.warn(
        `Intake KB retrieval degraded: ${(err as Error)?.name ?? "unexpected"}`
      );
      return [];
    }
  }

  /**
   * Focused second pass over the transcript for the create turn only —
   * a single-purpose extraction is far more reliable than the conversational
   * turn at returning the complete consolidated fields. Failures degrade to
   * whatever the turn extraction produced (the client still has fallbacks).
   */
  private async extractFinalCaseFields(
    dto: IntakeTurnRequestDto,
    selectedDevice: IntakeDeviceDto | undefined,
    principal: AuthPrincipal | undefined,
    clientId: string
  ): Promise<IntakeTurnExtractedDto> {
    try {
      const request: LlmChatRequest = {
        requestId: dto.requestId ? `${dto.requestId}-final` : undefined,
        useCase: "customer_chat_intake",
        tenantId: principal?.tenantId,
        clientId,
        surface: "react-chat-window",
        messages: [
          {
            role: "system",
            content:
              `Read the following customer support intake conversation${
                selectedDevice
                  ? ` about the device "${selectedDevice.label}"`
                  : ""
              } and return ONLY a JSON object with the keys "subject" (short case title, <=120 chars), "description", and "priority" (one of "Low", "Medium", "High"). ` +
              "The description becomes the case record the service team reads: consolidate in YOUR OWN words the symptom, when it started, and every troubleshooting step the customer mentioned anywhere in the conversation. Never paste the transcript verbatim. Ignore [event] lines except as facts."
          },
          ...dto.messages.map((message) => ({
            role: message.role,
            content: message.content
          }))
        ],
        temperature: 0.1
      };
      const response = await this.modelRouter.chat(request);
      return IntakeAgentService.parseExtraction(response.content).fields;
    } catch {
      return {};
    }
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
   * degrades to the picker, a createCase without a locked-in device degrades
   * to the picker, and a reply that references chips always renders them.
   */
  private static resolveUiDirective(
    raw: { action?: unknown; suggestedDeviceIndex?: unknown } | undefined,
    context: IntakeContextResponseDto,
    selectedDevice: IntakeDeviceDto | undefined,
    reply: string,
    transcriptMatch?: IntakeDeviceDto
  ): IntakeTurnUiDirectiveDto {
    const deviceCount = context.devices.length;
    let action: IntakeTurnUiAction =
      typeof raw?.action === "string" &&
      UI_ACTIONS.has(raw.action as IntakeTurnUiAction)
        ? (raw.action as IntakeTurnUiAction)
        : "none";
    let suggestedAssetId: string | undefined;

    // The review card no longer exists; older prompts/mocks degrade cleanly.
    if (action === "showReview") {
      action = "none";
    }

    // The model announced the status card in prose but cued no action —
    // without this the customer stares at "here it is below" forever.
    if (
      action === "none" &&
      (context.openCases ?? []).length > 0 &&
      referencesStatusCard(reply)
    ) {
      action = "showTicketStatus";
    }

    // The status card renders live open cases; with none on file the model
    // was told to answer directly, so the cue degrades to a plain turn.
    if (
      action === "showTicketStatus" &&
      (context.openCases ?? []).length === 0
    ) {
      action = "none";
    }

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

    // A case can only be created once the device is locked in (when the
    // account has devices): downgrade an eager createCase to the picker so
    // the customer is asked instead of the create failing.
    if (action === "createCase" && !selectedDevice && deviceCount > 0) {
      action = "showDevicePicker";
    }

    // The model announced the create in prose but cued no action — without
    // this the customer watches "Creating your case now…" forever.
    if (
      action === "none" &&
      !reply.includes("?") &&
      CREATE_REFERENCE_PATTERN.test(reply)
    ) {
      action =
        selectedDevice || deviceCount === 0 ? "createCase" : "showDevicePicker";
    }

    // The model told the customer to tap a chip but cued no picker — without
    // this the customer is instructed to use UI that never renders.
    if (
      action === "none" &&
      !selectedDevice &&
      deviceCount > 1 &&
      CHIP_REFERENCE_PATTERN.test(reply)
    ) {
      action = "showDevicePicker";
    }

    // The customer typed the device name instead of tapping a chip: upgrade
    // a plain picker to a one-tap confirm on the deterministic match, so the
    // flow can never deadlock with no selectable CTA.
    if (action === "showDevicePicker" && transcriptMatch) {
      action = "suggestDevice";
      suggestedAssetId = transcriptMatch.assetId;
    }

    return suggestedAssetId ? { action, suggestedAssetId } : { action };
  }

  private static parseExtraction(content: string): ParsedTurn {
    const trimmed = (content ?? "").trim();
    if (!trimmed) {
      return {
        reply: "",
        fields: {},
        readyToSubmit: false,
        offeredSuggestion: false
      };
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
          ? (parsed["ui"] as {
              action?: unknown;
              suggestedDeviceIndex?: unknown;
            })
          : undefined;

      // Customer-provided overrides: kept only when plausibly real so a
      // hallucinated or malformed value can never reach the Case.
      const serviceAddress =
        typeof parsed["serviceAddress"] === "string" &&
        parsed["serviceAddress"].trim().length >= 4
          ? parsed["serviceAddress"].trim().slice(0, 255)
          : undefined;
      const contactEmailRaw =
        typeof parsed["contactEmail"] === "string"
          ? parsed["contactEmail"].trim()
          : "";
      const contactEmail =
        contactEmailRaw.length > 0 &&
        contactEmailRaw.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailRaw)
          ? contactEmailRaw
          : undefined;
      const contactPhoneRaw =
        typeof parsed["contactPhone"] === "string"
          ? parsed["contactPhone"].trim()
          : "";
      const contactPhone =
        contactPhoneRaw.length > 0 &&
        contactPhoneRaw.length <= 40 &&
        /^[+()\d][\d\s().-]{4,}$/.test(contactPhoneRaw)
          ? contactPhoneRaw
          : undefined;

      return {
        reply,
        fields: {
          subject,
          description,
          priority,
          serviceAddress,
          contactEmail,
          contactPhone
        },
        ui,
        readyToSubmit: parsed["readyToSubmit"] === true,
        offeredSuggestion: parsed["offeredSuggestion"] === true
      };
    } catch {
      // Non-JSON output: surface the raw text so the user sees the LLM response
      // rather than the generic "tell me more" fallback.
      return {
        reply: trimmed.slice(0, 600),
        fields: {},
        readyToSubmit: false,
        offeredSuggestion: false
      };
    }
  }
}

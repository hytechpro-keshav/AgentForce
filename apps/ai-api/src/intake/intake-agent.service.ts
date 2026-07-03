import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type {
  LlmChatRequest,
  LlmMessage
} from "../llm/interfaces/llm-contracts";
import { ModelRouter } from "../llm/model-router";
import type { IntakeContextResponseDto } from "./dto/intake-context.dto";
import type {
  IntakeTurnExtractedDto,
  IntakeTurnRequestDto,
  IntakeTurnResponseDto
} from "./dto/intake-turn.dto";
import { requireIntakeIdentity } from "./intake-claims";
import { IntakeService } from "./intake.service";

const PRIORITIES = new Set(["Low", "Medium", "High"]);
const MIN_DESCRIPTION_LENGTH = 10;

function formatLocation(location: {
  city?: string;
  state?: string;
  country?: string;
}): string {
  return [location.city, location.state, location.country]
    .filter((part) => Boolean(part?.trim()))
    .join(", ");
}

function buildIntakeSystemPrompt(context: IntakeContextResponseDto): string {
  const deviceCount = context.devices.length;
  const deviceLabels = context.devices.map((device) => device.label).join("; ");
  const defaultShipTo = formatLocation(context.shipTo);
  const billingLine = context.billingLocation
    ? formatLocation(context.billingLocation)
    : "";

  const lines = [
    "You are Ably, a friendly laptop-support intake assistant.",
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
        ? `One registered device on file: ${deviceLabels}.`
        : `${deviceCount} registered devices on file: ${deviceLabels}.`,
    "",
    "Conversation flow:",
    "1. First understand the issue: symptom, when it started, and what they already tried.",
    "2. Do NOT list every device name in your opening message.",
    "3. Do NOT ask for account name, serial numbers, or email — those are already known.",
    deviceCount > 1
      ? "4. After the issue is clear, ask which registered device is affected. The chat UI will show a device picker when ready."
      : deviceCount === 1
        ? "4. After the issue is clear, confirm the problem is on the registered device and verify the service location and contact details are correct."
        : "4. After the issue is clear, tell them they can review and submit even without a device on file.",
    context.hasMultipleServiceLocations
      ? "5. Because this account has multiple locations, ask whether service should use the default ship-to address or a different site before they submit."
      : "",
    "6. When enough detail is captured, tell them they can pick the device (if needed) and submit the case.",
    "",
    "Return ONLY a JSON object (no prose, no markdown) with keys:",
    '  "reply": your next message to the customer (<=600 chars),',
    '  "subject": a short case title (<=120 chars),',
    '  "description": the consolidated issue description so far,',
    '  "priority": one of "Low", "Medium", or "High" based on impact.',
    "Base priority only on the described impact; do not invent facts."
  ];

  return lines.filter((line) => line.length > 0).join(" ");
}

/**
 * Drives the conversational triage turn: given the transcript, the model
 * responds AND extracts the structured case fields (subject/description/
 * priority) in one call, following the repo's prompt+JSON.parse extraction
 * pattern. Parsing is defensive so malformed model output can never break the
 * flow — it degrades to a safe reply and empty extraction.
 */
@Injectable()
export class IntakeAgentService {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly intakeService: IntakeService
  ) {}

  async nextTurn(
    principal: AuthPrincipal | undefined,
    dto: IntakeTurnRequestDto
  ): Promise<IntakeTurnResponseDto> {
    requireIntakeIdentity(principal);
    const context = await this.intakeService.getContext(principal);

    const messages: LlmMessage[] = [
      { role: "system", content: buildIntakeSystemPrompt(context) },
      ...dto.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ];

    const request: LlmChatRequest = {
      requestId: dto.requestId,
      useCase: "customer_chat_intake",
      tenantId: principal?.tenantId,
      clientId: principal?.raw?.accountId as string | undefined,
      surface: "react-chat-window",
      messages,
      temperature: 0.3
    };

    const response = await this.modelRouter.chat(request);
    const extracted = IntakeAgentService.parseExtraction(response.content);

    const userWordCount = dto.messages
      .filter((m) => m.role === "user")
      .reduce((sum, m) => sum + m.content.trim().split(/\s+/).length, 0);

    return {
      reply:
        extracted.reply ||
        "Thanks — could you tell me a bit more about the issue you're seeing?",
      extracted: extracted.fields,
      issueCaptured:
        Boolean(
          extracted.fields.description &&
          extracted.fields.description.trim().length >= MIN_DESCRIPTION_LENGTH
        ) || userWordCount >= 10
    };
  }

  private static parseExtraction(content: string): {
    reply: string;
    fields: IntakeTurnExtractedDto;
  } {
    const trimmed = (content ?? "").trim();
    if (!trimmed) {
      return { reply: "", fields: {} };
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

      return { reply, fields: { subject, description, priority } };
    } catch {
      return { reply: trimmed.slice(0, 600), fields: {} };
    }
  }
}

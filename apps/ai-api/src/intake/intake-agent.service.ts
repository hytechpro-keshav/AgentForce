import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import type {
  LlmChatRequest,
  LlmMessage
} from "../llm/interfaces/llm-contracts";
import { ModelRouter } from "../llm/model-router";
import type {
  IntakeTurnExtractedDto,
  IntakeTurnRequestDto,
  IntakeTurnResponseDto
} from "./dto/intake-turn.dto";
import { requireIntakeIdentity } from "./intake-claims";

const PRIORITIES = new Set(["Low", "Medium", "High"]);
const MIN_DESCRIPTION_LENGTH = 10;

const SYSTEM_PROMPT = [
  "You are a friendly laptop-support intake assistant for a verified customer.",
  "Your job is to help the customer clearly describe their laptop issue so a",
  "support case can be created. Ask at most one concise follow-up question at a",
  "time about missing essentials: the symptom, when it started, and what they",
  "have already tried. Do NOT ask for account, contact, address, or serial",
  "number — those are already known. Once the issue is clear, tell them they",
  "can pick the affected device and submit.",
  "Return ONLY a JSON object (no prose, no markdown) with keys:",
  '  "reply": your next message to the customer (<=600 chars),',
  '  "subject": a short case title (<=120 chars),',
  '  "description": the consolidated issue description so far,',
  '  "priority": one of "Low", "Medium", or "High" based on impact.',
  "Base priority only on the described impact; do not invent facts."
].join(" ");

/**
 * Drives the conversational triage turn: given the transcript, the model
 * responds AND extracts the structured case fields (subject/description/
 * priority) in one call, following the repo's prompt+JSON.parse extraction
 * pattern. Parsing is defensive so malformed model output can never break the
 * flow — it degrades to a safe reply and empty extraction.
 */
@Injectable()
export class IntakeAgentService {
  constructor(private readonly modelRouter: ModelRouter) {}

  async nextTurn(
    principal: AuthPrincipal | undefined,
    dto: IntakeTurnRequestDto
  ): Promise<IntakeTurnResponseDto> {
    const identity = requireIntakeIdentity(principal);

    const messages: LlmMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
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
    const extracted = IntakeAgentService.parseExtraction(response.content);

    return {
      reply:
        extracted.reply ||
        "Thanks — could you tell me a bit more about the issue you're seeing?",
      extracted: extracted.fields,
      issueCaptured: Boolean(
        extracted.fields.description &&
        extracted.fields.description.trim().length >= MIN_DESCRIPTION_LENGTH
      )
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
      // Non-JSON output: fall back to a safe reply and no extraction.
      return { reply: "", fields: {} };
    }
  }
}

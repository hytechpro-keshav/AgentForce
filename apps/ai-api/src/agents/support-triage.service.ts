import { Injectable } from "@nestjs/common";

import { ModelRouter } from "../llm/model-router";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import {
  TRIAGE_PRIORITIES,
  type TriageCaseRequestDto,
  type TriageCaseResponseDto,
  type TriagePriorityDto
} from "./dto/triage-case.dto";

const TRIAGE_SYSTEM_PROMPT = [
  "You are a support triage assistant for Salesforce Agentforce.",
  "Given a customer case subject and description, return ONLY a JSON object",
  "with keys: priority (one of low, normal, high, critical), summary",
  "(<=160 chars), and nextStep (<=160 chars). Do not include names, email",
  "addresses, phone numbers, payment data, account numbers, service addresses,",
  "or other direct identifiers in summary or nextStep. No prose, no markdown."
].join(" ");

@Injectable()
export class SupportTriageService {
  constructor(private readonly modelRouter: ModelRouter) {}

  async triage(request: TriageCaseRequestDto): Promise<TriageCaseResponseDto> {
    const safeSubject = redactSensitiveText(request.subject);
    const safeDescription = redactSensitiveText(request.description);
    const userContent = [
      `Subject: ${safeSubject}`,
      `Description: ${safeDescription}`,
      request.reportedPriority
        ? `Reported priority: ${request.reportedPriority}`
        : undefined
    ]
      .filter(Boolean)
      .join("\n");

    const llmRequest: LlmChatRequest = {
      requestId: request.requestId,
      messages: [
        { role: "system", content: TRIAGE_SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ],
      temperature: 0
    };

    const response = await this.modelRouter.chat(llmRequest);
    const parsed = SupportTriageService.parseTriageJson(
      response.content,
      request.reportedPriority
    );

    return {
      recommendedPriority: parsed.priority,
      summary: redactSensitiveText(parsed.summary).slice(0, 160),
      suggestedNextStep: redactSensitiveText(parsed.nextStep).slice(0, 160),
      provider: response.metadata.provider,
      model: response.metadata.model,
      fallbackUsed: response.metadata.fallbackUsed,
      latencyMs: response.metadata.latencyMs
    };
  }

  private static parseTriageJson(
    content: string,
    fallbackPriority: TriagePriorityDto | undefined
  ): { priority: TriagePriorityDto; summary: string; nextStep: string } {
    const safeFallback: TriagePriorityDto = fallbackPriority ?? "normal";
    const trimmed = content.trim();
    if (!trimmed) {
      return {
        priority: safeFallback,
        summary: "No model output available; fell back to reported priority.",
        nextStep: "Escalate to a human agent for manual triage."
      };
    }

    try {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      const jsonSlice =
        start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
      const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;
      const priorityRaw =
        typeof parsed["priority"] === "string"
          ? (parsed["priority"] as string).toLowerCase()
          : safeFallback;
      const priority = TRIAGE_PRIORITIES.includes(
        priorityRaw as TriagePriorityDto
      )
        ? (priorityRaw as TriagePriorityDto)
        : safeFallback;
      const summary =
        typeof parsed["summary"] === "string"
          ? (parsed["summary"] as string).slice(0, 160)
          : "Model returned no summary.";
      const nextStep =
        typeof parsed["nextStep"] === "string"
          ? (parsed["nextStep"] as string).slice(0, 160)
          : "Route to a human agent for review.";
      return { priority, summary, nextStep };
    } catch {
      return {
        priority: safeFallback,
        summary: "Model output was not valid JSON.",
        nextStep: "Route to a human agent for manual triage."
      };
    }
  }
}

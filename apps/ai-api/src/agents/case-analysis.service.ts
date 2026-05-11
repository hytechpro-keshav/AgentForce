import { Injectable } from "@nestjs/common";

import { ModelRouter } from "../llm/model-router";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import {
  CASE_ANALYSIS_CATEGORIES,
  CASE_ANALYSIS_CONFIDENCES,
  type AnalyzeCaseRequestDto,
  type AnalyzeCaseResponseDto,
  type CaseAnalysisCategoryDto,
  type CaseAnalysisConfidenceDto
} from "./dto/case-analysis.dto";
import {
  TRIAGE_PRIORITIES,
  type TriagePriorityDto
} from "./dto/triage-case.dto";

const ANALYSIS_SYSTEM_PROMPT = [
  "You are a Salesforce Support Operations case-analysis assistant.",
  "Given sanitized Case fields, return ONLY a single JSON object with keys:",
  "summary (<=200 chars), category (one of billing, outage, technical,",
  "account, other), priority (one of low, normal, high, critical),",
  "confidence (one of low, medium, high), nextAction (<=200 chars).",
  "Do not echo names, emails, phone numbers, payment data, account numbers,",
  "service addresses, Salesforce ids, or other direct identifiers in summary",
  "or nextAction. No prose, no markdown, no code fences."
].join(" ");

@Injectable()
export class CaseAnalysisService {
  constructor(private readonly modelRouter: ModelRouter) {}

  async analyze(
    request: AnalyzeCaseRequestDto
  ): Promise<AnalyzeCaseResponseDto> {
    const safeSubject = redactSensitiveText(request.caseSubject);
    const safeDescription = redactSensitiveText(request.caseDescription);
    const userContent = [
      `Subject: ${safeSubject}`,
      `Description: ${safeDescription}`,
      request.caseStatus
        ? `Status: ${redactSensitiveText(request.caseStatus)}`
        : undefined,
      request.caseType
        ? `Type: ${redactSensitiveText(request.caseType)}`
        : undefined,
      request.caseOrigin
        ? `Origin: ${redactSensitiveText(request.caseOrigin)}`
        : undefined,
      request.reportedPriority
        ? `Reported priority: ${request.reportedPriority}`
        : undefined
    ]
      .filter(Boolean)
      .join("\n");

    const llmRequest: LlmChatRequest = {
      requestId: request.requestId,
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ],
      temperature: 0
    };

    const response = await this.modelRouter.chat(llmRequest);
    const parsed = CaseAnalysisService.parseAnalysisJson(
      response.content,
      request.reportedPriority
    );

    return {
      summary: redactSensitiveText(parsed.summary).slice(0, 200),
      category: parsed.category,
      recommendedPriority: parsed.priority,
      confidence: parsed.confidence,
      nextAction: redactSensitiveText(parsed.nextAction).slice(0, 200),
      provider: response.metadata.provider,
      model: response.metadata.model,
      fallbackUsed: response.metadata.fallbackUsed,
      latencyMs: response.metadata.latencyMs
    };
  }

  private static parseAnalysisJson(
    content: string,
    fallbackPriority: TriagePriorityDto | undefined
  ): {
    summary: string;
    category: CaseAnalysisCategoryDto;
    priority: TriagePriorityDto;
    confidence: CaseAnalysisConfidenceDto;
    nextAction: string;
  } {
    const safePriority: TriagePriorityDto = fallbackPriority ?? "normal";
    const trimmed = content.trim();
    if (!trimmed) {
      return {
        summary: "No model output available; fell back to reported priority.",
        category: "other",
        priority: safePriority,
        confidence: "low",
        nextAction: "Escalate to a human agent for manual review."
      };
    }

    try {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      const jsonSlice =
        start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
      const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;

      const summary =
        typeof parsed["summary"] === "string"
          ? (parsed["summary"] as string).slice(0, 200)
          : "Model returned no summary.";

      const categoryRaw =
        typeof parsed["category"] === "string"
          ? (parsed["category"] as string).toLowerCase()
          : "other";
      const category = CASE_ANALYSIS_CATEGORIES.includes(
        categoryRaw as CaseAnalysisCategoryDto
      )
        ? (categoryRaw as CaseAnalysisCategoryDto)
        : "other";

      const priorityRaw =
        typeof parsed["priority"] === "string"
          ? (parsed["priority"] as string).toLowerCase()
          : safePriority;
      const priority = TRIAGE_PRIORITIES.includes(
        priorityRaw as TriagePriorityDto
      )
        ? (priorityRaw as TriagePriorityDto)
        : safePriority;

      const confidenceRaw =
        typeof parsed["confidence"] === "string"
          ? (parsed["confidence"] as string).toLowerCase()
          : "low";
      const confidence = CASE_ANALYSIS_CONFIDENCES.includes(
        confidenceRaw as CaseAnalysisConfidenceDto
      )
        ? (confidenceRaw as CaseAnalysisConfidenceDto)
        : "low";

      const nextAction =
        typeof parsed["nextAction"] === "string"
          ? (parsed["nextAction"] as string).slice(0, 200)
          : "Route to a human agent for review.";

      return { summary, category, priority, confidence, nextAction };
    } catch {
      return {
        summary: "Model output was not valid JSON.",
        category: "other",
        priority: safePriority,
        confidence: "low",
        nextAction: "Route to a human agent for manual review."
      };
    }
  }
}

import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { redactSensitiveText } from "../security/sensitive-data-redactor";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type { CustomerContextPackage } from "./dto/customer-context";
import type { TriagePriorityDto } from "../agents/dto/triage-case.dto";

/**
 * Node 3 — builds redacted, context-aware knowledge queries.
 *
 * Constructs a safe, <queryMaxChars length query string from Case context,
 * triage signals, and customer history. The query is designed to produce
 * semantically relevant RAG retrievals without leaking PII, account ids,
 * or customer names.
 */
@Injectable()
export class KnowledgeQueryBuilder {
  constructor(private readonly config: AppConfigService) {}

  /**
   * Build a redacted, context-aware knowledge query.
   *
   * @param caseSubject - Case subject line (redacted if needed)
   * @param caseDescription - Case description (redacted if needed)
   * @param triagePriority - Triage priority classification (if available)
   * @param triageSeverity - Triage severity classification (if available)
   * @param customerTier - Customer tier (e.g., "premium")
   * @param productModel - Product model identifier (e.g., "VX-900")
   * @param warrantyStatus - Warranty status (e.g., "covered")
   * @param repeatIncidentCount - Count of prior repeat incidents
   * @param priorFixCount - Count of prior fixes for the same issue
   *
   * @returns A redacted query string, <= queryMaxChars length.
   */
  build(input: {
    caseSubject?: string;
    caseDescription?: string;
    triagePriority?: TriagePriorityDto;
    triageSeverity?: string;
    customerTier?: string;
    productModel?: string;
    warrantyStatus?: string;
    repeatIncidentCount?: number;
    priorFixCount?: number;
  }): string {
    const maxChars = this.config.orchestrator.knowledge.queryMaxChars || 200;
    const parts: string[] = [];

    // Assemble the query from available signals, prioritizing conciseness.
    // Start with priority + issue.
    if (input.triagePriority) {
      const priority = this.sanitize(input.triagePriority);
      parts.push(`${priority}-priority`);
    }

    if (input.caseSubject) {
      const subject = this.sanitize(input.caseSubject);
      parts.push(subject);
    }

    // Add product and warranty context (helps narrow the search).
    if (input.productModel) {
      const model = this.sanitize(input.productModel);
      parts.push(`on model ${model}`);
    }

    if (input.warrantyStatus) {
      parts.push(`${input.warrantyStatus} warranty`);
    }

    // Add tier hint if it's premium (high-value context).
    if (input.customerTier === "premium") {
      parts.push("premium customer");
    }

    // Add signals about prior fixes / repeat incidents (often indicates root cause).
    if (input.priorFixCount && input.priorFixCount > 0) {
      parts.push(`${input.priorFixCount} prior fixes`);
    }

    if (input.repeatIncidentCount && input.repeatIncidentCount > 0) {
      parts.push(`repeat issue (${input.repeatIncidentCount}x)`);
    }

    // Join parts and truncate to maxChars.
    let query = parts.filter(Boolean).join(". ");

    // Final redaction pass to catch any PII that slipped through.
    query = redactSensitiveText(query);

    // Truncate if needed.
    if (query.length > maxChars) {
      query = query.substring(0, maxChars - 1).trim() + ".";
    }

    return query;
  }

  /** Sanitize a string to remove or redact risky content. */
  private sanitize(text: string): string {
    // Replace email addresses, phone numbers, account/case IDs.
    // Use the same redactor as sensitive-data-redactor.
    return redactSensitiveText(text);
  }
}
